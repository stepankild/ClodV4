#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <GxEPD2_4C.h>
#include <U8g2_for_Adafruit_GFX.h>
#include "config.h"

// 4-color 4.2" display (400x300) — GDEY0420F51
GxEPD2_4C<GxEPD2_420c_GDEY0420F51, GxEPD2_420c_GDEY0420F51::HEIGHT> display(
    GxEPD2_420c_GDEY0420F51(SS, EPD_DC, EPD_RST, EPD_BUSY)
);

U8G2_FOR_ADAFRUIT_GFX u8g2Fonts;

// Colors for 4-color display
#define BLACK   GxEPD_BLACK
#define WHITE   GxEPD_WHITE
#define RED     GxEPD_RED
#define YELLOW  GxEPD_YELLOW

// Display dimensions
#define W 400
#define H 300

// ===== Data structure =====
struct DisplayData {
  String zoneName;
  bool online;
  String timestamp;
  float temps[4];       // up to 4 temperature sensors
  String tempLocs[4];
  int tempCount;
  float airT;
  float rh;
  float rh2;
  int co2;
  int lux;
  float vpd;
  float photoDay;
  float photoNight;
  bool hasAirT, hasRH, hasRH2, hasCO2, hasLux, hasVPD, hasPhoto;
};

DisplayData data;

// ===== WiFi connect =====
bool connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_TIMEOUT) {
    delay(250);
  }
  return WiFi.status() == WL_CONNECTED;
}

// ===== Fetch data from API =====
bool fetchData() {
  WiFiClientSecure client;
  client.setInsecure(); // Skip cert verification (Railway uses Let's Encrypt)

  HTTPClient http;
  String url = String("https://") + API_HOST + API_PATH;
  http.begin(client, url);
  http.addHeader("X-API-KEY", API_KEY);
  http.setTimeout(10000);

  int code = http.GET();
  if (code != 200) {
    Serial.printf("HTTP error: %d\n", code);
    http.end();
    return false;
  }

  String payload = http.getString();
  http.end();

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload);
  if (err) {
    Serial.printf("JSON error: %s\n", err.c_str());
    return false;
  }

  data.zoneName = doc["zone"].as<String>();
  data.online = doc["online"] | false;
  data.timestamp = doc["ts"].as<String>();

  // Temperatures array
  JsonArray temps = doc["temps"];
  data.tempCount = 0;
  for (JsonObject t : temps) {
    if (data.tempCount >= 4) break;
    data.temps[data.tempCount] = t["v"];
    data.tempLocs[data.tempCount] = t["loc"].as<String>();
    data.tempCount++;
  }

  data.hasAirT = !doc["airT"].isNull();
  data.airT = doc["airT"] | 0.0f;

  data.hasRH = !doc["rh"].isNull();
  data.rh = doc["rh"] | 0.0f;

  data.hasRH2 = !doc["rh2"].isNull();
  data.rh2 = doc["rh2"] | 0.0f;

  data.hasCO2 = !doc["co2"].isNull();
  data.co2 = doc["co2"] | 0;

  data.hasLux = !doc["lux"].isNull();
  data.lux = doc["lux"] | 0;

  data.hasVPD = !doc["vpd"].isNull();
  data.vpd = doc["vpd"] | 0.0f;

  data.hasPhoto = !doc["photo"].isNull();
  if (data.hasPhoto) {
    data.photoDay = doc["photo"]["day"] | 0.0f;
    data.photoNight = doc["photo"]["night"] | 0.0f;
  }

  return true;
}

// ===== Drawing helpers =====
void drawCenteredText(int16_t x, int16_t y, const char* text) {
  int16_t tw = u8g2Fonts.getUTF8Width(text);
  u8g2Fonts.setCursor(x - tw / 2, y);
  u8g2Fonts.print(text);
}

void drawRightText(int16_t x, int16_t y, const char* text) {
  int16_t tw = u8g2Fonts.getUTF8Width(text);
  u8g2Fonts.setCursor(x - tw, y);
  u8g2Fonts.print(text);
}

// Draw a rounded-corner box
void drawRoundBox(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
  display.fillRoundRect(x, y, w, h, 4, color);
}

// ===== Main display layout =====
// Layout: 400x300
// ┌─────────────────────────────────────┐
// │  ZONE NAME              ● ONLINE    │  <- header (30px)
// ├──────────┬──────────┬───────────────┤
// │ Canopy   │ Substrat │  Ambient      │  <- temps row (55px)
// │ 19.1°C   │ 19.0°C   │  19.0°C       │
// ├──────────┴──────────┴───────────────┤
// │ RH  66.6%  │  CO₂  390  │  VPD 1.05 │  <- metrics row (55px)
// ├─────────────────────────────────────┤
// │ Lux: 12450    Photo: 18.0/6.0       │  <- light row (45px)
// │ ████████████████░░░░░░░             │  <- light bar
// ├─────────────────────────────────────┤
// │ Updated: 2026-03-27 14:30           │  <- footer (25px)
// └─────────────────────────────────────┘

void drawDisplay() {
  display.setFullWindow();
  display.firstPage();

  do {
    display.fillScreen(WHITE);
    u8g2Fonts.setFontMode(1);
    u8g2Fonts.setFontDirection(0);

    int y = 0;

    // ===== HEADER =====
    display.fillRect(0, 0, W, 34, BLACK);
    u8g2Fonts.setFont(u8g2_font_helvB14_tr);
    u8g2Fonts.setForegroundColor(WHITE);
    u8g2Fonts.setBackgroundColor(BLACK);
    u8g2Fonts.setCursor(10, 24);
    u8g2Fonts.print(data.zoneName.c_str());

    // Online/offline indicator
    uint16_t dotColor = data.online ? WHITE : RED;
    display.fillCircle(W - 20, 17, 6, dotColor);

    y = 38;

    // ===== TEMPERATURE CARDS =====
    u8g2Fonts.setBackgroundColor(WHITE);
    int cols = data.tempCount;
    if (data.hasAirT) cols++;
    if (cols == 0) cols = 1;
    int cardW = (W - 20 - (cols - 1) * 6) / cols;
    int cx = 10;

    for (int i = 0; i < data.tempCount; i++) {
      drawRoundBox(cx, y, cardW, 55, WHITE);
      display.drawRoundRect(cx, y, cardW, 55, 4, BLACK);

      // Location label
      u8g2Fonts.setFont(u8g2_font_helvR08_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      drawCenteredText(cx + cardW / 2, y + 14, data.tempLocs[i].c_str());

      // Temperature value
      u8g2Fonts.setFont(u8g2_font_helvB18_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      char buf[16];
      snprintf(buf, sizeof(buf), "%.1f", data.temps[i]);
      drawCenteredText(cx + cardW / 2, y + 40, buf);

      // Degree symbol
      u8g2Fonts.setFont(u8g2_font_helvR10_tr);
      int16_t tw = u8g2Fonts.getUTF8Width(buf);
      u8g2Fonts.setCursor(cx + cardW / 2 + tw / 2 + 1, y + 32);
      u8g2Fonts.print("C");

      cx += cardW + 6;
    }

    // Ambient temp card (STCC4)
    if (data.hasAirT) {
      drawRoundBox(cx, y, cardW, 55, WHITE);
      display.drawRoundRect(cx, y, cardW, 55, 4, RED);

      u8g2Fonts.setFont(u8g2_font_helvR08_tr);
      u8g2Fonts.setForegroundColor(RED);
      drawCenteredText(cx + cardW / 2, y + 14, "Ambient");

      u8g2Fonts.setFont(u8g2_font_helvB18_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      char buf[16];
      snprintf(buf, sizeof(buf), "%.1f", data.airT);
      drawCenteredText(cx + cardW / 2, y + 40, buf);

      u8g2Fonts.setFont(u8g2_font_helvR10_tr);
      int16_t tw = u8g2Fonts.getUTF8Width(buf);
      u8g2Fonts.setCursor(cx + cardW / 2 + tw / 2 + 1, y + 32);
      u8g2Fonts.print("C");
    }

    y += 62;

    // ===== METRICS ROW (Humidity, CO2, VPD) =====
    int mCols = 0;
    if (data.hasRH || data.hasRH2) mCols++;
    if (data.hasCO2) mCols++;
    if (data.hasVPD) mCols++;
    if (mCols == 0) mCols = 1;
    int mW = (W - 20 - (mCols - 1) * 6) / mCols;
    cx = 10;

    // Humidity
    if (data.hasRH || data.hasRH2) {
      drawRoundBox(cx, y, mW, 55, WHITE);
      display.drawRoundRect(cx, y, mW, 55, 4, BLACK);

      u8g2Fonts.setFont(u8g2_font_helvR08_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      drawCenteredText(cx + mW / 2, y + 14, "Humidity");

      u8g2Fonts.setFont(u8g2_font_helvB18_tr);
      char buf[32];
      if (data.hasRH2) {
        snprintf(buf, sizeof(buf), "%.0f%%", data.rh2);  // SHT45 preferred
      } else {
        snprintf(buf, sizeof(buf), "%.0f%%", data.rh);
      }
      drawCenteredText(cx + mW / 2, y + 40, buf);

      // Show second humidity smaller
      if (data.hasRH && data.hasRH2) {
        u8g2Fonts.setFont(u8g2_font_helvR08_tr);
        char buf2[16];
        snprintf(buf2, sizeof(buf2), "STCC4: %.0f%%", data.rh);
        drawCenteredText(cx + mW / 2, y + 52, buf2);
      }

      cx += mW + 6;
    }

    // CO2
    if (data.hasCO2) {
      // Color-code CO2: red if >1500, yellow if >1000
      uint16_t co2Border = BLACK;
      uint16_t co2TextColor = BLACK;
      if (data.co2 > 1500) { co2Border = RED; co2TextColor = RED; }
      else if (data.co2 > 1000) { co2Border = YELLOW; co2TextColor = YELLOW; }

      drawRoundBox(cx, y, mW, 55, WHITE);
      display.drawRoundRect(cx, y, mW, 55, 4, co2Border);

      u8g2Fonts.setFont(u8g2_font_helvR08_tr);
      u8g2Fonts.setForegroundColor(co2TextColor);
      drawCenteredText(cx + mW / 2, y + 14, "CO2");

      u8g2Fonts.setFont(u8g2_font_helvB18_tr);
      char buf[16];
      snprintf(buf, sizeof(buf), "%d", data.co2);
      drawCenteredText(cx + mW / 2, y + 40, buf);

      u8g2Fonts.setFont(u8g2_font_helvR08_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      drawCenteredText(cx + mW / 2, y + 52, "ppm");

      cx += mW + 6;
    }

    // VPD
    if (data.hasVPD) {
      // Color-code VPD
      uint16_t vpdColor = BLACK;
      if (data.vpd < 0.4f) vpdColor = BLACK;       // too low
      else if (data.vpd <= 1.2f) vpdColor = BLACK;  // ok (green not available on 4C)
      else if (data.vpd <= 1.6f) vpdColor = YELLOW;
      else vpdColor = RED;

      drawRoundBox(cx, y, mW, 55, WHITE);
      display.drawRoundRect(cx, y, mW, 55, 4, vpdColor);

      u8g2Fonts.setFont(u8g2_font_helvR08_tr);
      u8g2Fonts.setForegroundColor(vpdColor);
      drawCenteredText(cx + mW / 2, y + 14, "VPD");

      u8g2Fonts.setFont(u8g2_font_helvB18_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      char buf[16];
      snprintf(buf, sizeof(buf), "%.2f", data.vpd);
      drawCenteredText(cx + mW / 2, y + 40, buf);

      u8g2Fonts.setFont(u8g2_font_helvR08_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      drawCenteredText(cx + mW / 2, y + 52, "kPa");
    }

    y += 62;

    // ===== LIGHT ROW =====
    if (data.hasLux || data.hasPhoto) {
      display.drawFastHLine(10, y, W - 20, BLACK);
      y += 8;

      u8g2Fonts.setFont(u8g2_font_helvR10_tr);
      u8g2Fonts.setForegroundColor(BLACK);

      if (data.hasLux) {
        char buf[32];
        snprintf(buf, sizeof(buf), "Light: %d lux", data.lux);
        u8g2Fonts.setCursor(10, y + 14);
        u8g2Fonts.print(buf);
      }

      if (data.hasPhoto) {
        char buf[32];
        snprintf(buf, sizeof(buf), "Photo: %.1f/%.1f h", data.photoDay, data.photoNight);
        drawRightText(W - 10, y + 14, buf);

        // Photoperiod bar
        y += 22;
        int barW = W - 20;
        int barH = 14;
        int dayW = (int)(barW * data.photoDay / 24.0f);

        // Day portion (yellow)
        if (dayW > 0) {
          display.fillRoundRect(10, y, dayW, barH, 3, YELLOW);
        }
        // Night portion (black)
        if (dayW < barW) {
          display.fillRoundRect(10 + dayW, y, barW - dayW, barH, 3, BLACK);
        }

        // Labels on bar
        u8g2Fonts.setFont(u8g2_font_helvR08_tr);
        if (dayW > 30) {
          u8g2Fonts.setForegroundColor(BLACK);
          char dayBuf[8];
          snprintf(dayBuf, sizeof(dayBuf), "%.0fh", data.photoDay);
          drawCenteredText(10 + dayW / 2, y + 11, dayBuf);
        }
        if (barW - dayW > 30) {
          u8g2Fonts.setForegroundColor(WHITE);
          char nightBuf[8];
          snprintf(nightBuf, sizeof(nightBuf), "%.0fh", data.photoNight);
          drawCenteredText(10 + dayW + (barW - dayW) / 2, y + 11, nightBuf);
        }

        y += barH + 4;
      } else {
        y += 18;
      }
    }

    // ===== FOOTER =====
    y = H - 22;
    display.drawFastHLine(10, y, W - 20, BLACK);
    u8g2Fonts.setFont(u8g2_font_helvR08_tr);
    u8g2Fonts.setForegroundColor(BLACK);

    // Parse and format timestamp
    if (data.timestamp.length() > 16) {
      // ISO format: 2026-03-27T14:30:00.000Z -> 27.03 14:30
      String ts = data.timestamp.substring(8, 10) + "." +
                  data.timestamp.substring(5, 7) + " " +
                  data.timestamp.substring(11, 16);
      char buf[64];
      snprintf(buf, sizeof(buf), "Updated: %s", ts.c_str());
      u8g2Fonts.setCursor(10, y + 16);
      u8g2Fonts.print(buf);
    }

    // Battery voltage (if available)
    int batRaw = analogRead(9);  // GPIO9 = BAT ADC on ESPink-42
    float batV = batRaw * 2.0f * 3.3f / 4095.0f;  // voltage divider
    if (batV > 1.0f) {
      char buf[16];
      snprintf(buf, sizeof(buf), "%.1fV", batV);
      drawRightText(W - 10, y + 16, buf);
    }

  } while (display.nextPage());
}

// ===== Error screen =====
void drawError(const char* msg) {
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(WHITE);
    u8g2Fonts.setFontMode(1);
    u8g2Fonts.setFontDirection(0);
    u8g2Fonts.setFont(u8g2_font_helvB14_tr);
    u8g2Fonts.setForegroundColor(RED);
    u8g2Fonts.setBackgroundColor(WHITE);
    drawCenteredText(W / 2, H / 2 - 10, "ERROR");
    u8g2Fonts.setFont(u8g2_font_helvR10_tr);
    u8g2Fonts.setForegroundColor(BLACK);
    drawCenteredText(W / 2, H / 2 + 15, msg);

    // Show retry info
    u8g2Fonts.setFont(u8g2_font_helvR08_tr);
    char buf[32];
    snprintf(buf, sizeof(buf), "Retry in %d min", SLEEP_MINUTES);
    drawCenteredText(W / 2, H / 2 + 35, buf);
  } while (display.nextPage());
}

// ===== Deep sleep =====
void goToSleep() {
  // Turn off display power
  digitalWrite(EPD_POWER, LOW);

  // Disconnect WiFi
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);

  // Configure deep sleep
  esp_sleep_enable_timer_wakeup((uint64_t)SLEEP_MINUTES * 60ULL * 1000000ULL);
  Serial.printf("Sleeping for %d minutes...\n", SLEEP_MINUTES);
  Serial.flush();

  esp_deep_sleep_start();
}

// ===== Setup & Loop =====
void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n=== ESPink-42 Zone Display ===");

  // Power on display
  pinMode(EPD_POWER, OUTPUT);
  digitalWrite(EPD_POWER, HIGH);
  delay(50);

  // Init SPI and display
  SPI.begin(EPD_SCK, EPD_MISO, EPD_MOSI, SS);
  display.init(115200, true, 50, false);
  u8g2Fonts.begin(display);

  // Connect WiFi
  Serial.print("WiFi connecting...");
  if (!connectWiFi()) {
    Serial.println(" FAILED");
    drawError("WiFi connect failed");
    goToSleep();
    return;
  }
  Serial.printf(" OK (%s)\n", WiFi.localIP().toString().c_str());

  // Fetch data
  Serial.print("Fetching data...");
  if (!fetchData()) {
    Serial.println(" FAILED");
    drawError("API fetch failed");
    goToSleep();
    return;
  }
  Serial.println(" OK");

  // Draw display
  Serial.print("Drawing...");
  drawDisplay();
  Serial.println(" OK");

  // Hibernate display
  display.hibernate();

  // Sleep
  goToSleep();
}

void loop() {
  // Never reached — deep sleep restarts from setup()
}
