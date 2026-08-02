/*
 * PySmartHome-PC – ESP32-S3 Node (DEBUG کامل)
 * آی‌پی: 192.168.1.115
 * پین‌ها: SDA=5, SCL=4, DHT22=6, OLED 128x32 I2C 0x3C
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
  delay(500);
  Serial.println("\n[ESP32-S3] Starting...");

  // I2C & OLED
  Wire.begin(I2C_SDA, I2C_SCL);
  Serial.print("[OLED] Init... ");
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("FAILED");
    while (1) delay(1000);
  }
  Serial.println("OK");
  display.clearDisplay();
  display.setCursor(0,0);
  display.println("WiFi...");
  display.display();

  // WiFi
  Serial.print("[WiFi] Connecting... ");
  WiFi.config(localIP, gateway, subnet);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" OK");
  Serial.print("       IP: ");
  Serial.println(WiFi.localIP());

  // DHT22
  Serial.print("[DHT22] Init... ");
  dht.begin();
  delay(2000);
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t) && !isnan(h)) {
    currentTemp = t;
    currentHum = h;
    Serial.printf("OK (%.1f°C, %.1f%%)\n", t, h);
  } else {
    Serial.println("FAIL (check wiring)");
  }

  // Web server
  server.on("/api/status", HTTP_GET, []() {
    String json = "{\"temp\":" + String(currentTemp, 1) + ",\"humidity\":" + String(currentHum, 1) + "}";
    server.send(200, "application/json", json);
  });
  server.begin();
  Serial.println("[HTTP] Server started on port 80");
  Serial.println("[ESP32-S3] Ready.\n");
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
      Serial.printf("[SENSOR] Temp: %.1f°C, Hum: %.1f%%\n", t, h);

      // OLED display (ساده برای 128x32)
      display.clearDisplay();
      display.setTextSize(1);
      display.setCursor(0, 0);
      display.print("T:"); display.print(t, 1); display.print("C  H:"); display.print(h, 1); display.print("%");
      display.setCursor(0, 12);
      display.print(WiFi.localIP());
      display.display();  // حیاتی
    } else {
      Serial.println("[SENSOR] Read failed");
    }
  }
  yield();
}
