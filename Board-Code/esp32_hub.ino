/*
 * PySmartHome-PC – ESP32 Hub (DEBUG کامل)
 * آی‌پی: 192.168.1.119
 * پین‌ها: SDA=5, SCL=4, DHT22=13, OLED 128x64 I2C 0x3C
 * تاریخ/ساعت ایران، نمایش OLED، API وضعیت
 */

#include <WiFi.h>
#include <WebServer.h>
#include <DHT.h>
#include <Adafruit_SSD1306.h>
#include <NTPClient.h>
#include <WiFiUdp.h>

// ---------- Network ----------
const char* ssid = ">><<>><<";
const char* password = "MEHRdAd1380";
IPAddress localIP(192, 168, 1, 119);
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);

// ---------- Hardware ----------
#define DHTPIN 13
#define DHTTYPE DHT22
#define I2C_SDA 5
#define I2C_SCL 4
#define OLED_ADDR 0x3C

DHT dht(DHTPIN, DHTTYPE);
Adafruit_SSD1306 display(128, 64, &Wire, -1);
WebServer server(80);

WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "178.22.122.100", 3.5*3600, 60000); // ایران

// ---------- Persian date converter ----------
struct JalaliDate { int year, month, day; };
JalaliDate gregorianToJalali(int gy, int gm, int gd) {
  int gy2 = (gm > 2) ? (gy + 1) : gy;
  int days = 355666 + (365 * gy) + ((gy2 + 3) / 4) - ((gy2 + 99) / 100) + ((gy2 + 399) / 400) + gd + (153 * (gm > 2 ? (gm - 3) : (gm + 9)) + 2) / 5;
  int jy = -1595 + (33 * (days / 12053));
  days %= 12053;
  jy += 4 * (days / 1461);
  days %= 1461;
  if (days > 365) { jy += (days - 1) / 365; days = (days - 1) % 365; }
  int jm = (days < 186) ? 1 + days / 31 : 7 + (days - 186) / 30;
  int jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  return {jy, jm, jd};
}

float currentTemp = 0, currentHum = 0;
char persianDate[12] = "";
char timeStr[9] = "";

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[ESP32 Hub] Starting...");

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

  // NTP
  Serial.print("[NTP] Syncing... ");
  timeClient.begin();
  if (timeClient.update()) {
    Serial.println("OK");
  } else {
    Serial.println("FAIL (will retry in loop)");
  }

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

  // Web server endpoint
  server.on("/api/status", HTTP_GET, []() {
    String json = "{\"temp\":" + String(currentTemp, 1) + ",\"humidity\":" + String(currentHum, 1) + "}";
    server.send(200, "application/json", json);
  });
  server.begin();
  Serial.println("[HTTP] Server started on port 80");
  Serial.println("[ESP32 Hub] Ready.\n");
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

      // Update time
      timeClient.update();
      time_t now = timeClient.getEpochTime();
      struct tm *info = localtime(&now);
      JalaliDate j = gregorianToJalali(info->tm_year + 1900, info->tm_mon + 1, info->tm_mday);
      sprintf(persianDate, "%04d/%02d/%02d", j.year, j.month, j.day);
      sprintf(timeStr, "%02d:%02d:%02d", info->tm_hour, info->tm_min, info->tm_sec);

      Serial.printf("[SENSOR] Temp: %.1f°C, Hum: %.1f%%\n", t, h);

      // OLED display
      display.clearDisplay();
      display.drawRect(0, 0, 128, 64, SSD1306_WHITE);
      display.drawLine(0, 40, 128, 40, SSD1306_WHITE);
      display.setTextSize(1);
      display.setCursor(6, 10);
      display.print("Temp: "); display.print(t, 1); display.print(" C");
      display.setCursor(6, 24);
      display.print("Hum : "); display.print(h, 1); display.print(" %");
      display.setCursor(6, 44);
      display.print(persianDate);
      display.setCursor(72, 44);
      display.print(timeStr);
      display.display();  // <-- حیاتی
    } else {
      Serial.println("[SENSOR] Read failed");
    }
  }
  yield();
}
