/*
 * PySmartHome-PC | Resilient ESP32 sensor + OLED + ArzPulse market ticker
 *
 * IMPORTANT:
 * 1) Set WIFI_SSID / WIFI_PASSWORD below before flashing.
 * 2) Keep the static IPs aligned with PYSMART_ESP32_1_URL and
 *    PYSMART_ESP32_S3_URL in the PC configuration.
 * 3) GitHub Actions precomputes a tiny market JSON; a low-priority task fetches it.
 */

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <WiFiClient.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>
#include <math.h>
#include <string.h>
#include <esp_system.h>
#include "MarketState.h"

// ----------------------- User network settings -----------------------

const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Keep these addresses aligned with the PySmartHome-PC server defaults.
static const IPAddress NODE_IP(192, 168, 1, 119);
static const IPAddress GATEWAY_IP(192, 168, 1, 1);
static const IPAddress SUBNET_MASK(255, 255, 255, 0);
static const IPAddress DNS_PRIMARY(192, 168, 1, 1);
static const IPAddress DNS_SECONDARY(1, 1, 1, 1);

// Change this to false only if you also update the PC node URL to the
// DHCP address (or reserve that address in your router).
static const bool USE_STATIC_IP = true;

// ----------------------- Hardware configuration ----------------------

#define DHT_PIN 13
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
static const uint32_t PRICE_RETRY_MS = 30UL * 1000UL;
static const uint32_t PRICE_RETRY_MAX_MS = 5UL * 60UL * 1000UL;
static const uint32_t PRICE_STALE_MS = 10UL * 60UL * 1000UL;

// Set this to the LAN IPv4 address of the PC running server.py.
// Example: http://192.168.1.100:5000/api/market
// The board talks to the PC over plain local HTTP; the PC fetches GitHub over HTTPS.
static const char* MARKET_SNAPSHOT_URL =
    "http://192.168.1.100:5000/api/market";

DHT dht(DHT_PIN, DHT_TYPE);
Adafruit_SSD1306 display(128, 64, &Wire, -1);
WebServer server(80);

// ----------------------------- Live state -----------------------------

float currentTemp = NAN;
float currentHumidity = NAN;
bool sensorEverValid = false;
uint32_t lastSensorSuccessAt = 0;
uint32_t lastSensorAttemptAt = 0;


bool displayReady = false;
uint32_t lastDisplayRetryAt = 0;
uint32_t lastDisplayRenderAt = 0;
uint32_t nextWifiRetryAt = 0;

// ------------------------------- Helpers ------------------------------

bool timeReached(uint32_t now, uint32_t target) {
  return static_cast<int32_t>(now - target) >= 0;
}

void printI2CDevices() {
  // Only probe the two documented SSD1306 addresses. A full 7-bit bus scan
  // can take several seconds when an I2C line is held low by a faulty module.
  Serial.println("[I2C] Probing OLED addresses...");
  uint8_t found = 0;
  const uint8_t addresses[] = {OLED_ADDRESS, OLED_ADDRESS_ALT};
  for (uint8_t address : addresses) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.printf("[I2C] Device found at 0x%02X\n", address);
      ++found;
    }
  }
  if (found == 0) Serial.println("[I2C] No OLED found at 0x3C/0x3D. Check SDA/SCL, power and GND.");
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
                    OLED_ADDRESS, 128, 64);
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

// ---------------------- Compact market snapshot -----------------------


static MarketState marketState = {
  0, 0, false, false, true, true, 0, 0, "Not fetched yet", ""
};
static portMUX_TYPE marketStateMux = portMUX_INITIALIZER_UNLOCKED;
static TaskHandle_t marketTaskHandle = nullptr;

void copyText(char* destination, size_t size, const char* source) {
  if (!destination || size == 0) return;
  snprintf(destination, size, "%s", source ? source : "");
}

MarketState getMarketState() {
  MarketState snapshot;
  portENTER_CRITICAL(&marketStateMux);
  snapshot = marketState;
  portEXIT_CRITICAL(&marketStateMux);
  return snapshot;
}

void setMarketError(int httpCode, const char* message) {
  char safeMessage[sizeof(marketState.lastError)];
  copyText(safeMessage, sizeof(safeMessage), message);
  portENTER_CRITICAL(&marketStateMux);
  marketState.lastHttpCode = httpCode;
  copyText(marketState.lastError, sizeof(marketState.lastError), safeMessage);
  portEXIT_CRITICAL(&marketStateMux);
}

bool dollarIsStale(const MarketState& state, uint32_t now) {
  return !state.dollarValid || state.dollarSourceStale ||
         state.lastSuccessAt == 0 || now - state.lastSuccessAt > PRICE_STALE_MS;
}

bool goldIsStale(const MarketState& state, uint32_t now) {
  return !state.goldValid || state.goldSourceStale ||
         state.lastSuccessAt == 0 || now - state.lastSuccessAt > PRICE_STALE_MS;
}

bool fetchCompactMarketSnapshot() {
  if (WiFi.status() != WL_CONNECTED) {
    setMarketError(0, "WiFi offline");
    return false;
  }

  WiFiClient localClient;
  // This is a small HTTP request to the PC on the same LAN. The PC, not the
  // ESP32, performs HTTPS/TLS and downloads the precomputed GitHub snapshot.
  localClient.setTimeout(1200);

  HTTPClient http;
  http.setConnectTimeout(1200);
  http.setTimeout(1500);
  http.setReuse(false);
  http.setUserAgent("PySmartHome-PC/4.1.1 ESP32-market-client");

  // The local Flask endpoint explicitly sends Cache-Control: no-store.
  // Avoid dynamic URL construction so the repeated fetch does not fragment heap.
  if (!http.begin(localClient, MARKET_SNAPSHOT_URL)) {
    setMarketError(-1000, "HTTP begin failed");
    return false;
  }

  http.addHeader("Accept", "application/json");
  http.addHeader("Accept-Encoding", "identity");
  http.addHeader("Cache-Control", "no-cache");
  http.addHeader("Connection", "close");

  const int code = http.GET();
  if (code != HTTP_CODE_OK) {
    char message[48];
    snprintf(message, sizeof(message), "HTTP %d", code);
    setMarketError(code, message);
    http.end();
    return false;
  }

  const int contentLength = http.getSize();
  if (contentLength > 512) {
    setMarketError(code, "Snapshot too large");
    http.end();
    return false;
  }

  // No filter and no heap-backed DynamicJsonDocument: the Action has already
  // reduced the multi-kilobyte source to a small fixed-schema payload.
  StaticJsonDocument<384> document;
  DeserializationError parseError = deserializeJson(
      document, *http.getStreamPtr(),
      DeserializationOption::NestingLimit(3));
  http.end();

  if (parseError || document.overflowed()) {
    char message[48];
    snprintf(message, sizeof(message), "JSON %.34s",
             parseError ? parseError.c_str() : "NoMemory");
    setMarketError(code, message);
    return false;
  }

  if ((document["v"] | 0) != 1) {
    setMarketError(code, "Unsupported snapshot version");
    return false;
  }

  const uint64_t dollar = document["usd_toman"].as<uint64_t>();
  const uint64_t gold = document["gold18k_toman"].as<uint64_t>();
  const bool dollarStale = document["usd_stale"] | true;
  const bool goldStale = document["gold_stale"] | true;
  const char* updatedAt = document["updated_at"] | "";

  if (dollar == 0 || gold == 0 || !updatedAt || strlen(updatedAt) < 10) {
    setMarketError(code, "Missing/invalid market values");
    return false;
  }

  const uint32_t receivedAt = millis();
  portENTER_CRITICAL(&marketStateMux);
  // Do not refresh the freshness timer just because an unchanged, cached JSON
  // file was downloaded again. If Actions stop updating, prices turn stale.
  if (marketState.lastSuccessAt == 0 ||
      strncmp(marketState.updatedAt, updatedAt, sizeof(marketState.updatedAt) - 1) != 0) {
    marketState.lastSuccessAt = receivedAt;
  }
  marketState.dollarToman = dollar;
  marketState.gold18KToman = gold;
  marketState.dollarValid = true;
  marketState.goldValid = true;
  marketState.dollarSourceStale = dollarStale;
  marketState.goldSourceStale = goldStale;
  marketState.lastHttpCode = code;
  copyText(marketState.lastError, sizeof(marketState.lastError), "OK");
  copyText(marketState.updatedAt, sizeof(marketState.updatedAt), updatedAt);
  portEXIT_CRITICAL(&marketStateMux);

  Serial.printf("[Market] Snapshot OK | HTTP %d | bytes=%d | updated=%s | USD=%llu T | Gold18K=%llu T\n",
                code, contentLength,
                updatedAt,
                static_cast<unsigned long long>(dollar),
                static_cast<unsigned long long>(gold));
  return true;
}

uint32_t marketRetryDelay(uint8_t failures) {
  uint32_t delayMs = PRICE_RETRY_MS;
  for (uint8_t i = 1; i < failures && delayMs < PRICE_RETRY_MAX_MS; ++i) {
    delayMs *= 2;
    if (delayMs > PRICE_RETRY_MAX_MS) delayMs = PRICE_RETRY_MAX_MS;
  }
  return delayMs;
}

void marketPriceTask(void* parameter) {
  uint8_t failures = 0;
  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      setMarketError(0, "WiFi offline");
      vTaskDelay(pdMS_TO_TICKS(5000));
      continue;
    }

    const bool ok = fetchCompactMarketSnapshot();
    uint32_t waitMs;
    if (ok) {
      failures = 0;
      waitMs = PRICE_REFRESH_MS;
    } else {
      if (failures < 10) ++failures;
      waitMs = marketRetryDelay(failures);
      const MarketState state = getMarketState();
      Serial.printf("[Market] Fetch failed: %s | retry in %lu ms | main loop is unaffected\n",
                    state.lastError, static_cast<unsigned long>(waitMs));
    }
    vTaskDelay(pdMS_TO_TICKS(waitMs));
  }
}

void startMarketPriceTask() {
  const BaseType_t result = xTaskCreatePinnedToCore(
      marketPriceTask,
      "market-fetch",
      6144,
      nullptr,
      1,
      &marketTaskHandle,
      0);
  if (result != pdPASS) {
    marketTaskHandle = nullptr;
    setMarketError(-2000, "Task creation failed");
    Serial.println("[Market] Could not create fetch task; sensor/display loop stays active.");
  } else {
    Serial.println("[Market] Background fetch task started (core 0, low priority).");
  }
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
    const MarketState market = getMarketState();

    if (!sensorFresh) {
      server.send(503, "application/json",
                  "{\"error\":\"sensor_not_ready_or_stale\",\"hint\":\"Check DHT22 wiring and GPIO\"}");
      return;
    }

    char dollarValue[24] = "null";
    char goldValue[24] = "null";
    if (market.dollarValid) {
      snprintf(dollarValue, sizeof(dollarValue), "%llu",
               static_cast<unsigned long long>(market.dollarToman));
    }
    if (market.goldValid) {
      snprintf(goldValue, sizeof(goldValue), "%llu",
               static_cast<unsigned long long>(market.gold18KToman));
    }

    const String ip = WiFi.localIP().toString();
    char json[512];
    snprintf(json, sizeof(json),
        "{\"node\":\"esp32_hub\",\"temp\":%.1f,\"temperature\":%.1f,"
        "\"humidity\":%.1f,\"sensor_age_ms\":%lu,\"wifi\":true,"
        "\"ip\":\"%s\",\"prices\":{\"dollar_toman\":%s,"
        "\"gold18k_toman\":%s,\"dollar_stale\":%s,\"gold_stale\":%s}}",
        currentTemp, currentTemp, currentHumidity,
        static_cast<unsigned long>(now - lastSensorSuccessAt),
        ip.c_str(), dollarValue, goldValue,
        dollarIsStale(market, now) ? "true" : "false",
        goldIsStale(market, now) ? "true" : "false");

    server.send(200, "application/json", json);
  });

  server.on("/api/health", HTTP_GET, []() {
    sendNoCacheHeaders();
    const uint32_t now = millis();
    const bool sensorFresh = sensorEverValid &&
        (now - lastSensorSuccessAt <= SENSOR_STALE_MS);
    const MarketState market = getMarketState();

    char json[512];
    snprintf(json, sizeof(json),
        "{\"node\":\"esp32_hub\",\"wifi\":%s,\"sensor_valid\":%s,"
        "\"oled_ready\":%s,\"dollar_valid\":%s,\"gold_valid\":%s,"
        "\"ip\":\"%s\",\"price_http\":%d,\"price_error\":\"%s\","
        "\"price_age_ms\":%lu,\"price_updated_at\":\"%s\","
        "\"free_heap\":%u,\"min_free_heap\":%u,\"reset_reason\":%d}",
        WiFi.status() == WL_CONNECTED ? "true" : "false",
        sensorFresh ? "true" : "false",
        displayReady ? "true" : "false",
        market.dollarValid ? "true" : "false",
        market.goldValid ? "true" : "false",
        WiFi.localIP().toString().c_str(), market.lastHttpCode,
        market.lastError, market.lastSuccessAt ? (now - market.lastSuccessAt) : 0UL,
        market.updatedAt, ESP.getFreeHeap(), ESP.getMinFreeHeap(),
        static_cast<int>(esp_reset_reason()));
    server.send(200, "application/json", json);
  });

  server.onNotFound([]() {
    sendNoCacheHeaders();
    server.send(404, "application/json", "{\"error\":\"not_found\"}");
  });

  server.begin();
  Serial.println("[HTTP] Web server ready on port 80.");
}

// --------------------------- OLED: 128x64 -----------------------------

void renderDisplay() {
  if (!displayReady) return;

  const uint32_t now = millis();
  const bool sensorFresh = sensorEverValid &&
      (now - lastSensorSuccessAt <= SENSOR_STALE_MS);

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setTextWrap(false);

  // Header and connection state.
  display.setCursor(2, 1);
  display.print("PY SMART HOME");
  display.setCursor(103, 1);
  display.print(WiFi.status() == WL_CONNECTED ? "NET" : "OFF");

  // Temperature and humidity cards.
  display.drawRoundRect(1, 11, 62, 17, 3, SSD1306_WHITE);
  display.drawRoundRect(65, 11, 62, 17, 3, SSD1306_WHITE);
  display.setCursor(5, 16);
  display.print("T ");
  if (sensorFresh) {
    display.print(currentTemp, 1);
    display.print("C");
  } else {
    display.print("--");
  }
  display.setCursor(69, 16);
  display.print("H ");
  if (sensorFresh) {
    display.print(currentHumidity, 0);
    display.print("%");
  } else {
    display.print("--");
  }

  // Market prices are precomputed by GitHub Actions and downloaded as a
  // tiny snapshot in a background task. The display loop never performs I/O.
  const MarketState market = getMarketState();
  char dollarText[24] = "--";
  char goldText[24] = "--";
  if (market.dollarValid) formatToman(market.dollarToman, dollarText, sizeof(dollarText));
  if (market.goldValid) formatToman(market.gold18KToman, goldText, sizeof(goldText));

  display.drawRoundRect(1, 31, 126, 14, 3, SSD1306_WHITE);
  display.setCursor(5, 35);
  display.print("USD ");
  if (market.dollarValid) {
    if (dollarIsStale(market, now)) display.print("~");
    display.print(dollarText);
    display.print(" T");
  } else {
    display.print("waiting...");
  }

  display.drawRoundRect(1, 48, 126, 15, 3, SSD1306_WHITE);
  display.setCursor(5, 52);
  display.print("1g18K ");
  if (market.goldValid) {
    if (goldIsStale(market, now)) display.print("~");
    display.print(goldText);
    display.print(" T");
  } else {
    display.print("waiting...");
  }

  display.display();
}

// -------------------------------- Setup --------------------------------

void setup() {
  Serial.begin(115200);
  delay(250);
  Serial.println();
  Serial.println("======================================");
  Serial.printf("[BOOT] Reset reason: %d | Free heap: %u bytes\n",
                static_cast<int>(esp_reset_reason()), ESP.getFreeHeap());
  Serial.println(" PySmartHome-PC sensor node starting");
  Serial.println("======================================");

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(100000);
  Wire.setTimeOut(50);
  printI2CDevices();
  beginDisplay();

  dht.begin();
  Serial.printf("[DHT22] Initialized on GPIO %d\n", DHT_PIN);

  startWiFi();
  configureHttpServer();
  startMarketPriceTask();

  Serial.println("[BOOT] Ready. Market networking runs outside the sensor/display loop.");
}

// --------------------------------- Loop --------------------------------

void loop() {
  const uint32_t now = millis();

  // Keep the PC polling endpoint responsive even while a sensor or market
  // provider is unavailable.
  server.handleClient();

  maintainWiFi(now);
  readSensorIfDue(now);

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
