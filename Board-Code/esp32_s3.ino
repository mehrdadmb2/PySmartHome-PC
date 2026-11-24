/*
 * PySmartHome-PC | Resilient ESP32 sensor + OLED + ArzPulse market ticker
 *
 * IMPORTANT:
 * 1) Set WIFI_SSID / WIFI_PASSWORD below before flashing.
 * 2) Keep the static IPs aligned with PYSMART_ESP32_1_URL and
 *    PYSMART_ESP32_S3_URL in the PC configuration.
 * 3) Market prices are fetched from the public ArzPulse latest.json file.
 */

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>
#include <math.h>
#include <string.h>

// ----------------------- User network settings -----------------------

const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Keep these addresses aligned with the PySmartHome-PC server defaults.
static const IPAddress NODE_IP(192, 168, 1, 115);
static const IPAddress GATEWAY_IP(192, 168, 1, 1);
static const IPAddress SUBNET_MASK(255, 255, 255, 0);
static const IPAddress DNS_PRIMARY(192, 168, 1, 1);
static const IPAddress DNS_SECONDARY(1, 1, 1, 1);

// Change this to false only if you also update the PC node URL to the
// DHCP address (or reserve that address in your router).
static const bool USE_STATIC_IP = true;

// ----------------------- Hardware configuration ----------------------

#define DHT_PIN 6
#define DHT_TYPE DHT22
#define I2C_SDA_PIN 5
#define I2C_SCL_PIN 4
#define OLED_ADDRESS 0x3C
#define OLED_ADDRESS_ALT 0x3D

static const uint32_t SENSOR_INTERVAL_MS = 2500;  // DHT22 minimum interval: 2 s
static const uint32_t SENSOR_STALE_MS = 20000;
static const uint32_t WIFI_RETRY_MS = 15000;
static const uint32_t DISPLAY_RETRY_MS = 12000;
static const uint32_t PRICE_REFRESH_MS = 5UL * 60UL * 1000UL;
static const uint32_t PRICE_RETRY_MS = 60UL * 1000UL;
static const uint32_t PRICE_STALE_MS = 10UL * 60UL * 1000UL;

static const char* ARZPULSE_URL =
    "https://raw.githubusercontent.com/mehrdadmb2/ArzPulse/main/docs/data/latest.json";

DHT dht(DHT_PIN, DHT_TYPE);
Adafruit_SSD1306 display(128, 32, &Wire, -1);
WebServer server(80);

// ----------------------------- Live state -----------------------------

float currentTemp = NAN;
float currentHumidity = NAN;
bool sensorEverValid = false;
uint32_t lastSensorSuccessAt = 0;
uint32_t lastSensorAttemptAt = 0;

uint64_t dollarToman = 0;
uint64_t gold18KToman = 0;
bool dollarValid = false;
bool goldValid = false;
bool dollarSourceStale = true;
bool goldSourceStale = true;
uint32_t lastPriceSuccessAt = 0;
uint32_t nextPriceFetchAt = 0;
char marketTimestamp[28] = "";

bool displayReady = false;
uint32_t lastDisplayRetryAt = 0;
uint32_t lastDisplayRenderAt = 0;
uint32_t nextWifiRetryAt = 0;

// ------------------------------- Helpers ------------------------------

bool timeReached(uint32_t now, uint32_t target) {
  return static_cast<int32_t>(now - target) >= 0;
}

void printI2CDevices() {
  uint8_t found = 0;
  Serial.println("[I2C] Scanning bus...");
  for (uint8_t address = 1; address < 127; ++address) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.printf("[I2C] Device found at 0x%02X\n", address);
      ++found;
    }
  }
  if (found == 0) Serial.println("[I2C] No device found. Check SDA/SCL, power and GND.");
}

bool i2cAddressPresent(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

bool beginDisplay() {
  displayReady = false;

  // Adafruit_SSD1306::begin() may allocate its framebuffer even when the
  // physical display is absent, so probe the I2C address before initializing.
  if (i2cAddressPresent(OLED_ADDRESS)) {
    displayReady = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS);
    if (displayReady) {
      Serial.printf("[OLED] SSD1306 ready at 0x%02X (%dx%d)\n",
                    OLED_ADDRESS, 128, 32);
    }
  }

  if (!displayReady && i2cAddressPresent(OLED_ADDRESS_ALT)) {
    displayReady = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS_ALT);
    if (displayReady) {
      Serial.printf("[OLED] SSD1306 ready at alternate address 0x%02X\n",
                    OLED_ADDRESS_ALT);
    }
  }

  if (!displayReady) {
    Serial.println("[OLED] No SSD1306 at 0x3C/0x3D or display allocation failed; firmware and HTTP service will keep running.");
  }

  if (displayReady) {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextWrap(false);
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.print("PY SMART HOME");
    display.setCursor(0, 12);
    display.print("Starting sensors...");
    display.display();
  }
  return displayReady;
}

void formatToman(uint64_t value, char* output, size_t outputSize) {
  char raw[24];
  snprintf(raw, sizeof(raw), "%llu", static_cast<unsigned long long>(value));

  const size_t digits = strlen(raw);
  size_t out = 0;
  for (size_t i = 0; i < digits && out + 1 < outputSize; ++i) {
    output[out++] = raw[i];
    const size_t remaining = digits - i - 1;
    if (remaining > 0 && remaining % 3 == 0 && out + 1 < outputSize) {
      output[out++] = ',';
    }
  }
  output[out] = '\0';
}

bool dollarIsStale(uint32_t now) {
  return !dollarValid || dollarSourceStale ||
         (lastPriceSuccessAt == 0 || now - lastPriceSuccessAt > PRICE_STALE_MS);
}

bool goldIsStale(uint32_t now) {
  return !goldValid || goldSourceStale ||
         (lastPriceSuccessAt == 0 || now - lastPriceSuccessAt > PRICE_STALE_MS);
}

// -------------------------- Wi-Fi management --------------------------

void startWiFi() {
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);

  if (USE_STATIC_IP) {
    const bool configured = WiFi.config(
        NODE_IP, GATEWAY_IP, SUBNET_MASK, DNS_PRIMARY, DNS_SECONDARY);
    Serial.printf("[WiFi] Static IP configuration: %s\n",
                  configured ? "OK" : "FAILED");
  }

  Serial.printf("[WiFi] Connecting to SSID: %s\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  nextWifiRetryAt = millis() + WIFI_RETRY_MS;
}

void maintainWiFi(uint32_t now) {
  if (WiFi.status() == WL_CONNECTED) return;
  if (!timeReached(now, nextWifiRetryAt)) return;

  Serial.println("[WiFi] Still disconnected; retrying without reboot...");
  WiFi.disconnect(false, false);
  delay(20);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  nextWifiRetryAt = millis() + WIFI_RETRY_MS;
}

// -------------------------- DHT22 acquisition -------------------------

void readSensorIfDue(uint32_t now) {
  if (now - lastSensorAttemptAt < SENSOR_INTERVAL_MS) return;
  lastSensorAttemptAt = now;

  const float temperature = dht.readTemperature();
  const float humidity = dht.readHumidity();

  if (isnan(temperature) || isnan(humidity) ||
      temperature < -40.0f || temperature > 80.0f ||
      humidity < 0.0f || humidity > 100.0f) {
    Serial.println("[DHT22] Invalid reading; keeping the last good sample.");
    return;
  }

  currentTemp = temperature;
  currentHumidity = humidity;
  sensorEverValid = true;
  lastSensorSuccessAt = millis();

  Serial.printf("[DHT22] %.1f C | %.1f %%RH\n",
                currentTemp, currentHumidity);
}

// ------------------------ ArzPulse price reader ------------------------

bool refreshMarketPrices() {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure tlsClient;
  // This is a public, read-only JSON feed; no credentials are transmitted.
  // See README for the TLS/integrity trade-off and offline behaviour.
  tlsClient.setInsecure();
  tlsClient.setTimeout(2500);

  HTTPClient http;
  http.setConnectTimeout(1200);
  http.setTimeout(2500);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

  Serial.println("[ArzPulse] Fetching latest.json...");
  // A changing query prevents an intermediary cache from returning the same
  // snapshot indefinitely when ArzPulse updates its JSON file.
  const String requestUrl = String(ARZPULSE_URL) + "?_=" + String(millis());
  if (!http.begin(tlsClient, requestUrl)) {
    Serial.println("[ArzPulse] HTTP client initialization failed.");
    return false;
  }

  const int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) {
    Serial.printf("[ArzPulse] HTTP error: %d (%s)\n",
                  httpCode, http.errorToString(httpCode).c_str());
    http.end();
    return false;
  }

  // Filter the large ArzPulse document: retain only the two required prices,
  // their source-staleness flags, and the snapshot timestamp.
  StaticJsonDocument<256> filter;
  filter["dollarPrice"] = true;
  filter["gold18K"] = true;
  filter["timestamp"] = true;
  filter["derivedStale"]["dollar"] = true;
  filter["derivedStale"]["gold18K"] = true;

  StaticJsonDocument<256> document;
  const DeserializationError error = deserializeJson(
      document, *http.getStreamPtr(), DeserializationOption::Filter(filter));
  http.end();

  if (error) {
    Serial.printf("[ArzPulse] JSON parse failed: %s\n", error.c_str());
    return false;
  }

  const double dollarIRR = document["dollarPrice"] | 0.0;
  const double goldIRR = document["gold18K"] | 0.0;

  bool updated = false;
  if (isfinite(dollarIRR) && dollarIRR > 0.0) {
    dollarToman = static_cast<uint64_t>(llround(dollarIRR / 10.0));
    dollarValid = true;
    dollarSourceStale = document["derivedStale"]["dollar"] | true;
    updated = true;
  }
  if (isfinite(goldIRR) && goldIRR > 0.0) {
    gold18KToman = static_cast<uint64_t>(llround(goldIRR / 10.0));
    goldValid = true;
    goldSourceStale = document["derivedStale"]["gold18K"] | true;
    updated = true;
  }

  if (!updated) {
    Serial.println("[ArzPulse] JSON has no valid dollarPrice/gold18K values.");
    return false;
  }

  const char* timestamp = document["timestamp"] | "";
  snprintf(marketTimestamp, sizeof(marketTimestamp), "%s", timestamp);
  lastPriceSuccessAt = millis();

  char dollarText[24] = "--";
  char goldText[24] = "--";
  if (dollarValid) formatToman(dollarToman, dollarText, sizeof(dollarText));
  if (goldValid) formatToman(gold18KToman, goldText, sizeof(goldText));

  Serial.printf("[ArzPulse] USD: %s Toman | 18K gold (1g): %s Toman | source flags: %s/%s\n",
                dollarText, goldText,
                dollarSourceStale ? "STALE" : "FRESH",
                goldSourceStale ? "STALE" : "FRESH");
  return true;
}

// ---------------------------- HTTP service ----------------------------

void sendNoCacheHeaders() {
  server.sendHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  server.sendHeader("Pragma", "no-cache");
  server.sendHeader("Expires", "0");
}

void configureHttpServer() {
  server.on("/api/status", HTTP_GET, []() {
    sendNoCacheHeaders();

    const uint32_t now = millis();
    const bool sensorFresh = sensorEverValid &&
        (now - lastSensorSuccessAt <= SENSOR_STALE_MS);

    if (!sensorFresh) {
      server.send(503, "application/json",
                  "{\"error\":\"sensor_not_ready_or_stale\",\"hint\":\"Check DHT22 wiring and GPIO\"}");
      return;
    }

    char dollarValue[24] = "null";
    char goldValue[24] = "null";
    if (dollarValid) {
      snprintf(dollarValue, sizeof(dollarValue), "%llu",
               static_cast<unsigned long long>(dollarToman));
    }
    if (goldValid) {
      snprintf(goldValue, sizeof(goldValue), "%llu",
               static_cast<unsigned long long>(gold18KToman));
    }

    const String ip = WiFi.localIP().toString();
    char json[512];
    snprintf(json, sizeof(json),
        "{\"node\":\"esp32_s3\",\"temp\":%.1f,\"temperature\":%.1f,"
        "\"humidity\":%.1f,\"sensor_age_ms\":%lu,\"wifi\":true,"
        "\"ip\":\"%s\",\"prices\":{\"dollar_toman\":%s,"
        "\"gold18k_toman\":%s,\"dollar_stale\":%s,\"gold_stale\":%s}}",
        currentTemp, currentTemp, currentHumidity,
        static_cast<unsigned long>(now - lastSensorSuccessAt),
        ip.c_str(), dollarValue, goldValue,
        dollarIsStale(now) ? "true" : "false",
        goldIsStale(now) ? "true" : "false");

    server.send(200, "application/json", json);
  });

  server.on("/api/health", HTTP_GET, []() {
    sendNoCacheHeaders();
    const uint32_t now = millis();
    const bool sensorFresh = sensorEverValid &&
        (now - lastSensorSuccessAt <= SENSOR_STALE_MS);

    char json[256];
    snprintf(json, sizeof(json),
        "{\"node\":\"esp32_s3\",\"wifi\":%s,\"sensor_valid\":%s,"
        "\"oled_ready\":%s,\"dollar_valid\":%s,\"gold_valid\":%s,"
        "\"ip\":\"%s\"}",
        WiFi.status() == WL_CONNECTED ? "true" : "false",
        sensorFresh ? "true" : "false",
        displayReady ? "true" : "false",
        dollarValid ? "true" : "false",
        goldValid ? "true" : "false",
        WiFi.localIP().toString().c_str());
    server.send(200, "application/json", json);
  });

  server.onNotFound([]() {
    sendNoCacheHeaders();
    server.send(404, "application/json", "{\"error\":\"not_found\"}");
  });

  server.begin();
  Serial.println("[HTTP] Web server ready on port 80.");
}

// --------------------------- OLED: 128x32 -----------------------------

static char marketTicker[96] = "Waiting for ArzPulse market data...";
static char tickerWindow[21] = "";
static uint8_t tickerOffset = 0;
static uint32_t lastTickerStepAt = 0;

void rebuildMarketTicker(uint32_t now) {
  char dollarText[24] = "--";
  char goldText[24] = "--";
  char updatedTicker[96];

  if (dollarValid) formatToman(dollarToman, dollarText, sizeof(dollarText));
  if (goldValid) formatToman(gold18KToman, goldText, sizeof(goldText));

  if (dollarValid && goldValid) {
    snprintf(updatedTicker, sizeof(updatedTicker),
        "USD %s%s T   |   1g18K %s%s T   ",
        dollarIsStale(now) ? "~" : "", dollarText,
        goldIsStale(now) ? "~" : "", goldText);
  } else if (WiFi.status() != WL_CONNECTED) {
    snprintf(updatedTicker, sizeof(updatedTicker),
        "WIFI OFFLINE   |   LAST PRICES KEPT   ");
  } else {
    snprintf(updatedTicker, sizeof(updatedTicker),
        "WAITING FOR ARZPULSE PRICES   ");
  }

  // Do not reset the scroll position on every redraw.
  if (strcmp(updatedTicker, marketTicker) != 0) {
    snprintf(marketTicker, sizeof(marketTicker), "%s", updatedTicker);
    tickerOffset = 0;
  }
}

void renderDisplay() {
  if (!displayReady) return;

  const uint32_t now = millis();
  const bool sensorFresh = sensorEverValid &&
      (now - lastSensorSuccessAt <= SENSOR_STALE_MS);

  rebuildMarketTicker(now);

  if (now - lastTickerStepAt >= 330) {
    lastTickerStepAt = now;
    const size_t tickerLength = strlen(marketTicker);
    if (tickerLength > 20) {
      tickerOffset = (tickerOffset + 1) % tickerLength;
    }
  }

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setTextWrap(false);

  // 128x32 cannot fit both full prices on one static line. The boxed
  // lower ticker scrolls both complete values without truncating them.
  display.drawRoundRect(0, 0, 63, 15, 3, SSD1306_WHITE);
  display.drawRoundRect(65, 0, 63, 15, 3, SSD1306_WHITE);
  display.setCursor(4, 4);
  display.print("T ");
  if (sensorFresh) {
    display.print(currentTemp, 1);
    display.print("C");
  } else {
    display.print("--");
  }

  display.setCursor(69, 4);
  display.print("H ");
  if (sensorFresh) {
    display.print(currentHumidity, 0);
    display.print("%");
  } else {
    display.print("--");
  }

  display.drawRoundRect(0, 17, 128, 15, 3, SSD1306_WHITE);
  const size_t tickerLength = strlen(marketTicker);
  if (tickerLength <= 20) {
    display.setCursor(4, 21);
    display.print(marketTicker);
  } else {
    for (uint8_t i = 0; i < 20; ++i) {
      tickerWindow[i] = marketTicker[(tickerOffset + i) % tickerLength];
    }
    tickerWindow[20] = '\0';
    display.setCursor(4, 21);
    display.print(tickerWindow);
  }

  display.display();
}

// -------------------------------- Setup --------------------------------

void setup() {
  Serial.begin(115200);
  delay(250);
  Serial.println();
  Serial.println("======================================");
  Serial.println(" PySmartHome-PC sensor node starting");
  Serial.println("======================================");

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(100000);
  printI2CDevices();
  beginDisplay();

  dht.begin();
  Serial.printf("[DHT22] Initialized on GPIO %d\n", DHT_PIN);

  startWiFi();
  configureHttpServer();

  Serial.println("[BOOT] Ready. No automatic reboot on Wi-Fi, DHT or OLED errors.");
}

// --------------------------------- Loop --------------------------------

void loop() {
  const uint32_t now = millis();

  // Keep the PC polling endpoint responsive even while a sensor or market
  // provider is unavailable.
  server.handleClient();

  maintainWiFi(now);
  readSensorIfDue(now);

  if (WiFi.status() == WL_CONNECTED &&
      (nextPriceFetchAt == 0 || timeReached(now, nextPriceFetchAt))) {
    const bool priceOk = refreshMarketPrices();
    // Process any request that arrived while the bounded HTTPS fetch was active.
    server.handleClient();
    nextPriceFetchAt = millis() +
        (priceOk ? PRICE_REFRESH_MS : PRICE_RETRY_MS);
  }

  if (!displayReady && now - lastDisplayRetryAt >= DISPLAY_RETRY_MS) {
    lastDisplayRetryAt = now;
    Serial.println("[OLED] Retrying display initialization...");
    beginDisplay();
  }

  if (displayReady && now - lastDisplayRenderAt >= 500) {
    lastDisplayRenderAt = now;
    renderDisplay();
  }

  delay(2);
}
