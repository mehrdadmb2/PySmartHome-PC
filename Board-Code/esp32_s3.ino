/*
 * PySmartHome-PC – ESP32-S3 Node (نمایش ساده 128x32)
 * آی‌پی: 192.168.1.115
 * پین‌ها: SDA=5, SCL=4, DHT22=6
 */

#include <WiFi.h>
#include <WebServer.h>
#include <DHT.h>
#include <Adafruit_SSD1306.h>
#include "secrets.h"

IPAddress localIP(192, 168, 1, 115);
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);

#define DHTPIN 6
#define DHTTYPE DHT22
#define I2C_SDA 5
#define I2C_SCL 4
#define OLED_ADDR 0x3C

// DHT22 retry configuration
#define DHT_MAX_RETRIES 3
#define DHT_RETRY_DELAY_MS 2000

DHT dht(DHTPIN, DHTTYPE);
Adafruit_SSD1306 display(128, 32, &Wire, -1);
WebServer server(80);

float currentTemp = 0, currentHum = 0;

bool readDHT22WithRetry(float &t, float &h) {
  for (int attempt = 1; attempt <= DHT_MAX_RETRIES; attempt++) {
    t = dht.readTemperature();
    h = dht.readHumidity();
    if (!isnan(t) && !isnan(h)) {
      return true;
    }
    Serial.printf("[SENSOR] Read failed (attempt %d/%d)\n", attempt, DHT_MAX_RETRIES);
    if (attempt < DHT_MAX_RETRIES) {
      delay(DHT_RETRY_DELAY_MS);
    }
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("[ESP32-S3] Starting...");

  Wire.begin(I2C_SDA, I2C_SCL);
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("[OLED] FAILED");
    while (1) delay(1000);
  }
  Serial.println("[OLED] OK");

  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0,0);
  display.print("WiFi...");
  display.display();

  WiFi.config(localIP, gateway, subnet);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(500);
  Serial.print("[WiFi] OK, IP: ");
  Serial.println(WiFi.localIP());

  dht.begin();

  server.on("/api/status", HTTP_GET, []() {
    String json = "{\"temp\":" + String(currentTemp, 1) + ",\"humidity\":" + String(currentHum, 1) + "}";
    server.send(200, "application/json", json);
  });
  server.begin();
  Serial.println("[HTTP] Server started");
  Serial.println("[ESP32-S3] Ready.\n");
}

void loop() {
  server.handleClient();
  static unsigned long lastRead = 0;
  static int failCount = 0;
  if (millis() - lastRead >= 5000) {
    lastRead = millis();
    float t, h;
    if (readDHT22WithRetry(t, h)) {
      failCount = 0;
      currentTemp = t; currentHum = h;
      Serial.printf("[SENSOR] %.1f C, %.1f %%\n", t, h);

      display.clearDisplay();
      display.setTextSize(1);
      display.setCursor(0, 0);
      display.print("T:"); display.print(t,1); display.print("C  H:"); display.print(h,1); display.print("%");
      display.setCursor(0, 16);
      display.print(WiFi.localIP());
      display.display();
    } else {
      failCount++;
      Serial.printf("[SENSOR] Failed after %d attempts • failCount=%d\n", DHT_MAX_RETRIES, failCount);
      if (failCount >= 3) {
        Serial.println("[SENSOR] Multiple failures, reinitializing DHT...");
        dht.begin();
        failCount = 0;
      }
    }
  }
  yield();
}