/*
 * PySmartHome-PC – ESP32-S3 Sensor Node
 * IP: 192.168.1.115
 * Pins: SDA=5, SCL=4, DHT22=6
 * OLED 128x32 (I2C 0x3C)
 */

#include <WiFi.h>
#include <WebServer.h>
#include <DHT.h>
#include <Adafruit_SSD1306.h>

const char* ssid = ">><<>><<";
const char* password = "MEHRdAd1380";
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

void setup() {
  Serial.begin(115200);
  Wire.begin(I2C_SDA, I2C_SCL);
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) while (1);
  display.clearDisplay();
  display.println("WiFi...");
  display.display();

  WiFi.config(localIP, gateway, subnet);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) delay(500);
  dht.begin();

  server.on("/api/status", HTTP_GET, []() {
    String json = "{";
    json += "\"temp\":" + String(currentTemp, 1) + ",";
    json += "\"humidity\":" + String(currentHum, 1);
    json += "}";
    server.send(200, "application/json", json);
  });
  server.begin();
}

void loop() {
  server.handleClient();
  static unsigned long lastRead = 0;
  if (millis() - lastRead >= 5000) {
    lastRead = millis();
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t) && !isnan(h)) {
      currentTemp = t;
      currentHum = h;
      display.clearDisplay();
      display.setCursor(0,0);
      display.printf("T:%.1fC H:%.1f%%", t, h);
      display.display();
    }
  }
}
