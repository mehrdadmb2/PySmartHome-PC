/*
 * PySmartHome-PC – ESP32-S3 Node (نمایش ساده 128x32)
 * آی‌پی: 192.168.1.115
 * پین‌ها: SDA=5, SCL=4, DHT22=6
 */

#include <WiFi.h>
#include <WebServer.h>
#include <DHT.h>
#include <Adafruit_SSD1306.h>

// Set these values for your own Wi-Fi. Never commit real network credentials.
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
IPAddress localIP(192, 168, 1, 115);
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);

#define DHTPIN 6
#define DHTTYPE DHT22
#define I2C_SDA 5
#define I2C_SCL 4
#define OLED_ADDR 0x3C

DHT dht(DHTPIN, DHTTYPE);
Adafruit_SSD1306 display(128, 32, &Wire, -1);
WebServer server(80);

float currentTemp = 0, currentHum = 0;
bool sensorValid = false;

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

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.config(localIP, gateway, subnet); // Adjust for your router or use DHCP instead.
  WiFi.begin(ssid, password);
  const unsigned long wifiDeadline = millis() + 20000;
  while (WiFi.status() != WL_CONNECTED && millis() < wifiDeadline) {
    delay(250);
    Serial.print('.');
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\n[WiFi] Connection failed. Check Wi-Fi credentials/IP settings.");
    display.clearDisplay(); display.setCursor(0, 12); display.print("WiFi failed"); display.display();
    delay(5000);
    ESP.restart();
  }
  Serial.print("[WiFi] OK, IP: ");
  Serial.println(WiFi.localIP());

  dht.begin();

  server.on("/api/status", HTTP_GET, []() {
    server.sendHeader("Cache-Control", "no-store");
    if (!sensorValid) {
      server.send(503, "application/json", "{\"error\":\"sensor_not_ready\"}");
      return;
    }
    String json = "{\"temp\":" + String(currentTemp, 1) + ",\"humidity\":" + String(currentHum, 1) + "}";
    server.send(200, "application/json", json);
  });
  server.begin();
  Serial.println("[HTTP] Server started");
  Serial.println("[ESP32-S3] Ready.\n");
}

void loop() {
  server.handleClient();
  static unsigned long lastReconnect = 0;
  if (WiFi.status() != WL_CONNECTED && millis() - lastReconnect >= 10000) {
    lastReconnect = millis();
    Serial.println("[WiFi] Disconnected; attempting reconnect...");
    WiFi.reconnect();
  }
  static unsigned long lastRead = 0;
  if (millis() - lastRead >= 5000) {
    lastRead = millis();
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t) && !isnan(h)) {
      currentTemp = t; currentHum = h; sensorValid = true;
      Serial.printf("[SENSOR] %.1f C, %.1f %%\n", t, h);

      display.clearDisplay();
      display.setTextSize(1);
      display.setCursor(0, 0);
      display.print("T:"); display.print(t,1); display.print("C  H:"); display.print(h,1); display.print("%");
      display.setCursor(0, 16);
      display.print(WiFi.localIP());
      display.display();
    } else {
      Serial.println("[SENSOR] Read failed");
    }
  }
  yield();
}
