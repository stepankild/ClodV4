#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <GxEPD2_4C.h>
#include <U8g2_for_Adafruit_GFX.h>
#include "config.h"

GxEPD2_4C<GxEPD2_420c_GDEY0420F51, GxEPD2_420c_GDEY0420F51::HEIGHT> display(
    GxEPD2_420c_GDEY0420F51(SS, EPD_DC, EPD_RST, EPD_BUSY)
);
U8G2_FOR_ADAFRUIT_GFX u8g2Fonts;

#define BK  GxEPD_BLACK
#define WH  GxEPD_WHITE
#define RD  GxEPD_RED
#define YL  GxEPD_YELLOW
#define W 400
#define H 300
#define MAX_HIST 60

struct SData {
  String zoneName, timestamp;
  bool online;
  float temps[4]; String tempLocs[4]; int tempCount;
  float airT, rh, rh2, vpd;
  int co2, lux;
  float photoDay, photoNight;
  bool hasAirT, hasRH, hasRH2, hasCO2, hasLux, hasVPD, hasPhoto;
  float histT[MAX_HIST], histRH[MAX_HIST], histVPD[MAX_HIST];
  int histCount;
} D;

bool connectWiFi() {
  WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long s = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - s < WIFI_TIMEOUT) delay(200);
  return WiFi.status() == WL_CONNECTED;
}

float calcVPD(float lf, float at, float rh) {
  if (lf < -40 || at < -40 || rh < 0) return -999;
  float svpL = 0.6108f * expf(17.27f * lf / (lf + 237.3f));
  float svpA = 0.6108f * expf(17.27f * at / (at + 237.3f));
  return max(0.0f, svpL - svpA * rh / 100.0f);
}

bool fetchData() {
  // Use plain HTTP to local Pi proxy (no SSL needed on LAN)
  WiFiClient client;
  HTTPClient http;
  http.begin(client, String("http://") + API_HOST + ":" + String(API_PORT) + API_PATH);
  http.addHeader("X-API-KEY", API_KEY);
  http.setTimeout(10000);
  int code = http.GET();
  Serial.printf("HTTP %d\n", code);
  if (code != 200) {
    Serial.println(http.getString());
    http.end();
    return false;
  }
  String payload = http.getString(); http.end();
  Serial.printf("Payload: %d bytes\n", payload.length());

  JsonDocument doc;
  if (deserializeJson(doc, payload)) return false;

  D.zoneName = doc["zone"].as<String>();
  D.online = doc["online"] | false;
  D.timestamp = doc["ts"].as<String>();
  D.tempCount = 0;
  for (JsonObject t : doc["temps"].as<JsonArray>()) {
    if (D.tempCount >= 4) break;
    D.temps[D.tempCount] = t["v"]; D.tempLocs[D.tempCount] = t["loc"].as<String>();
    D.tempCount++;
  }
  D.hasAirT = !doc["airT"].isNull(); D.airT = doc["airT"] | 0.0f;
  D.hasRH = !doc["rh"].isNull(); D.rh = doc["rh"] | 0.0f;
  D.hasRH2 = !doc["rh2"].isNull(); D.rh2 = doc["rh2"] | 0.0f;
  D.hasCO2 = !doc["co2"].isNull(); D.co2 = doc["co2"] | 0;
  D.hasLux = !doc["lux"].isNull(); D.lux = doc["lux"] | 0;
  D.hasVPD = !doc["vpd"].isNull(); D.vpd = doc["vpd"] | 0.0f;
  D.hasPhoto = !doc["photo"].isNull();
  if (D.hasPhoto) { D.photoDay = doc["photo"]["day"] | 0.0f; D.photoNight = doc["photo"]["night"] | 0.0f; }

  JsonArray hist = doc["hist"], canopyH = doc["canopyHist"];
  D.histCount = 0;
  int i = 0;
  for (JsonObject h : hist) {
    if (i >= MAX_HIST) break;
    D.histT[i] = h["t"] | -999.0f;
    D.histRH[i] = h["rh"] | -999.0f;
    float ct = (i < (int)canopyH.size()) ? canopyH[i].as<float>() : -999.0f;
    D.histVPD[i] = calcVPD(ct, D.histT[i], D.histRH[i]);
    i++;
  }
  D.histCount = i;
  return true;
}

// ===== Drawing primitives =====
void tc(int16_t x, int16_t y, const char* s) {
  u8g2Fonts.setCursor(x - u8g2Fonts.getUTF8Width(s) / 2, y);
  u8g2Fonts.print(s);
}
void tr(int16_t x, int16_t y, const char* s) {
  u8g2Fonts.setCursor(x - u8g2Fonts.getUTF8Width(s), y);
  u8g2Fonts.print(s);
}

// Rounded filled card with border
void card(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t border) {
  display.fillRoundRect(x, y, w, h, 5, WH);
  display.drawRoundRect(x, y, w, h, 5, border);
  display.drawRoundRect(x + 1, y + 1, w - 2, h - 2, 4, border); // double border = premium feel
}

// Card with colored header strip
void cardWithHeader(int16_t x, int16_t y, int16_t w, int16_t h,
                    uint16_t headerColor, const char* label) {
  display.fillRoundRect(x, y, w, h, 5, WH);
  display.fillRoundRect(x, y, w, 14, 5, headerColor);
  display.fillRect(x, y + 10, w, 4, headerColor);  // square off bottom of header
  display.drawRoundRect(x, y, w, h, 5, headerColor);

  u8g2Fonts.setFont(u8g2_font_helvR08_tr);
  u8g2Fonts.setForegroundColor(WH);
  u8g2Fonts.setBackgroundColor(headerColor);
  tc(x + w / 2, y + 11, label);
  u8g2Fonts.setBackgroundColor(WH);
}

void getMinMax(float* v, int n, float &lo, float &hi) {
  lo = 99999; hi = -99999;
  for (int i = 0; i < n; i++) {
    if (v[i] < -900) continue;
    if (v[i] < lo) lo = v[i];
    if (v[i] > hi) hi = v[i];
  }
  if (lo >= hi) { lo -= 1; hi += 1; }
  float p = (hi - lo) * 0.08f; lo -= p; hi += p;
}

void chartLine(int16_t cx, int16_t cy, int16_t cw, int16_t ch,
               float* v, int n, float lo, float hi, uint16_t col) {
  if (n < 2 || hi <= lo) return;
  float r = hi - lo;
  int px = -1, py = -1;
  for (int i = 0; i < n; i++) {
    if (v[i] < -900) { px = -1; continue; }
    int x = cx + (i * cw) / (n - 1);
    int y = cy + ch - 1 - (int)((v[i] - lo) / r * (ch - 1));
    y = constrain(y, cy, cy + ch - 1);
    if (px >= 0) {
      display.drawLine(px, py, x, y, col);
      display.drawLine(px, py + 1, x, y + 1, col);
    }
    px = x; py = y;
  }
}

// =============================================
// LAYOUT — Premium controller aesthetic
// =============================================
//
// ┌──────────────────────────────────────────┐
// │ TRUE GROW  ·  Zone Name       14:32  ●  │  24px header
// ├────────┬────────┬────────┬───────────────┤
// │▓CANOPY▓│▓SUBSTR▓│▓AMBIE.▓│  ▓▓ CO2 ▓▓   │
// │        │        │        │               │  64px
// │ 19.5°  │ 19.6°  │ 20.1°  │    428        │  sensor
// │        │        │        │    ppm        │  cards
// ├────────┼────────┼────────┼───────────────┤
// │▓ RH  ▓▓│▓ VPD ▓▓│▓LIGHT▓▓│  ▓PHOTO ▓▓   │
// │  72%   │  0.61  │ 301lux │ ████░░░ 18/6  │  56px
// ├────────┴────────┴────────┴───────────────┤
// │  Temp ── RH ── VPD ──      -24h     now  │
// │  ╱╲  ╱──╲                                │  100px
// │ ╱  ╲╱    ╲  ╱╲                           │  chart
// │╱          ╲╱  ╲                          │
// ├──────────────────────────────────────────┤
// │ 27.03.26 14:32    ·    24h    ·   3.8V  │  18px footer
// └──────────────────────────────────────────┘

void drawDisplay() {
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(WH);
    u8g2Fonts.setFontMode(1);
    u8g2Fonts.setFontDirection(0);
    u8g2Fonts.setBackgroundColor(WH);
    char buf[32];

    // ========== HEADER (0-23) ==========
    display.fillRect(0, 0, W, 23, BK);
    u8g2Fonts.setBackgroundColor(BK);

    // Brand
    u8g2Fonts.setFont(u8g2_font_helvB08_tr);
    u8g2Fonts.setForegroundColor(YL);
    u8g2Fonts.setCursor(8, 16);
    u8g2Fonts.print("TRUE GROW");

    // Zone name
    u8g2Fonts.setFont(u8g2_font_helvR10_tr);
    u8g2Fonts.setForegroundColor(WH);
    u8g2Fonts.setCursor(82, 16);
    u8g2Fonts.print(D.zoneName.c_str());

    // Time
    if (D.timestamp.length() > 16) {
      u8g2Fonts.setFont(u8g2_font_helvR08_tr);
      u8g2Fonts.setForegroundColor(WH);
      String ts = D.timestamp.substring(11, 16);
      tr(W - 22, 16, ts.c_str());
    }

    // Status dot
    display.fillCircle(W - 10, 12, 5, D.online ? WH : RD);
    if (D.online) display.drawCircle(W - 10, 12, 5, WH);

    u8g2Fonts.setBackgroundColor(WH);

    // ========== TOP ROW: 3 TEMP CARDS + CO2 (26-90) ==========
    int y = 26;
    int gap = 4;
    int tempW = 90;
    int co2W = W - 3 * tempW - 4 * gap - 2 * 4; // remaining width

    // Temperature cards
    for (int i = 0; i < 3; i++) {
      int cx = 4 + i * (tempW + gap);
      bool hasVal = (i < D.tempCount);
      const char* loc = hasVal ? D.tempLocs[i].c_str() : (i == 0 && D.hasAirT ? "ambient" : "---");
      float val = hasVal ? D.temps[i] : (i == 0 && D.hasAirT ? D.airT : 0);

      uint16_t hdrCol = (i == 0) ? RD : (i == 1) ? BK : YL;
      cardWithHeader(cx, y, tempW, 64, hdrCol, loc);

      if (hasVal || (i == 0 && D.hasAirT)) {
        // Big temperature number
        u8g2Fonts.setFont(u8g2_font_helvB18_tr);
        u8g2Fonts.setForegroundColor(BK);
        snprintf(buf, sizeof(buf), "%.1f", val);
        tc(cx + tempW / 2, y + 44, buf);

        // Degree
        u8g2Fonts.setFont(u8g2_font_helvR10_tr);
        u8g2Fonts.setForegroundColor(BK);
        int tw = u8g2Fonts.getUTF8Width(buf);
        // Using superscript-like smaller font for degree
        u8g2Fonts.setFont(u8g2_font_helvR08_tr);
        u8g2Fonts.setCursor(cx + tempW / 2 + tw / 2 + 2, y + 36);
        u8g2Fonts.print("o");
        u8g2Fonts.setCursor(cx + tempW / 2 + tw / 2 + 8, y + 44);
        u8g2Fonts.setFont(u8g2_font_helvR10_tr);
        u8g2Fonts.print("C");
      } else {
        u8g2Fonts.setFont(u8g2_font_helvB14_tr);
        u8g2Fonts.setForegroundColor(BK);
        tc(cx + tempW / 2, y + 44, "---");
      }
    }

    // CO2 big card
    {
      int cx = 4 + 3 * (tempW + gap);
      uint16_t co2c = D.co2 > 1500 ? RD : (D.co2 > 1000 ? YL : BK);
      cardWithHeader(cx, y, co2W, 64, co2c, "CO2");

      u8g2Fonts.setFont(u8g2_font_helvB24_tr);
      u8g2Fonts.setForegroundColor(D.co2 > 1500 ? RD : BK);
      snprintf(buf, sizeof(buf), "%d", D.co2);
      tc(cx + co2W / 2, y + 48, buf);

      u8g2Fonts.setFont(u8g2_font_helvR08_tr);
      u8g2Fonts.setForegroundColor(BK);
      tc(cx + co2W / 2, y + 60, "ppm");
    }

    // ========== SECOND ROW: RH + VPD + LIGHT + PHOTO (94-148) ==========
    y = 94;
    int row2H = 54;
    int boxW = (W - 5 * gap - 8) / 4;

    // Humidity
    {
      int cx = 4;
      cardWithHeader(cx, y, boxW, row2H, BK, "HUMIDITY");
      float rv = D.hasRH2 ? D.rh2 : D.rh;
      u8g2Fonts.setFont(u8g2_font_helvB18_tr);
      u8g2Fonts.setForegroundColor(BK);
      snprintf(buf, sizeof(buf), "%.0f%%", rv);
      tc(cx + boxW / 2, y + 40, buf);
      // Show second RH small
      if (D.hasRH && D.hasRH2) {
        u8g2Fonts.setFont(u8g2_font_micro_tr);
        u8g2Fonts.setForegroundColor(BK);
        snprintf(buf, sizeof(buf), "STCC4:%.0f%%", D.rh);
        tc(cx + boxW / 2, y + 50, buf);
      }
    }

    // VPD
    {
      int cx = 4 + (boxW + gap);
      uint16_t vc = D.vpd > 1.6f ? RD : (D.vpd > 1.2f ? YL : BK);
      cardWithHeader(cx, y, boxW, row2H, vc, "VPD kPa");
      u8g2Fonts.setFont(u8g2_font_helvB18_tr);
      u8g2Fonts.setForegroundColor(vc == BK ? BK : vc);
      snprintf(buf, sizeof(buf), "%.2f", D.vpd);
      tc(cx + boxW / 2, y + 40, buf);
      // Range hint
      u8g2Fonts.setFont(u8g2_font_micro_tr);
      u8g2Fonts.setForegroundColor(BK);
      const char* hint = D.vpd < 0.4f ? "LOW" : D.vpd <= 0.8f ? "CLONE" : D.vpd <= 1.2f ? "VEG" : D.vpd <= 1.6f ? "FLOWER" : "HIGH!";
      tc(cx + boxW / 2, y + 50, hint);
    }

    // Light
    {
      int cx = 4 + 2 * (boxW + gap);
      cardWithHeader(cx, y, boxW, row2H, YL, "LIGHT");
      u8g2Fonts.setFont(u8g2_font_helvB14_tr);
      u8g2Fonts.setForegroundColor(BK);
      if (D.hasLux) {
        if (D.lux >= 1000) snprintf(buf, sizeof(buf), "%.1fk", D.lux / 1000.0f);
        else snprintf(buf, sizeof(buf), "%d", D.lux);
        tc(cx + boxW / 2, y + 38, buf);
        u8g2Fonts.setFont(u8g2_font_helvR08_tr);
        tc(cx + boxW / 2, y + 50, "lux");
      } else {
        tc(cx + boxW / 2, y + 38, "---");
      }
    }

    // Photoperiod
    {
      int cx = 4 + 3 * (boxW + gap);
      int pw = W - cx - 4;
      cardWithHeader(cx, y, pw, row2H, BK, "PHOTOPERIOD");
      if (D.hasPhoto) {
        // Day/night numbers
        u8g2Fonts.setFont(u8g2_font_helvB10_tr);
        u8g2Fonts.setForegroundColor(BK);
        snprintf(buf, sizeof(buf), "%.0f / %.0f h", D.photoDay, D.photoNight);
        tc(cx + pw / 2, y + 32, buf);
        // Mini bar
        int bx = cx + 6, bw = pw - 12, by = y + 38, bh = 8;
        int dayW = (int)(bw * D.photoDay / 24.0f);
        if (dayW > 0) display.fillRoundRect(bx, by, dayW, bh, 2, YL);
        if (dayW < bw) display.fillRoundRect(bx + dayW, by, bw - dayW, bh, 2, BK);
      }
    }

    // ========== CHART AREA (152-280) ==========
    y = 152;
    int chartH = 118;
    int chartX = 4;
    int chartW = W - 8;
    int plotX = chartX + 28;
    int plotW = chartW - 56;
    int plotY = y + 14;
    int plotH = chartH - 28;

    // Chart frame
    display.drawRect(chartX, y, chartW, chartH, BK);

    // Legend bar at top of chart
    u8g2Fonts.setFont(u8g2_font_helvR08_tr);
    int lx = plotX;
    // Temp
    display.fillRect(lx, y + 4, 10, 3, RD);
    u8g2Fonts.setForegroundColor(RD);
    u8g2Fonts.setCursor(lx + 13, y + 10);
    u8g2Fonts.print("Temp");
    lx += 50;
    // RH
    display.fillRect(lx, y + 4, 10, 3, BK);
    u8g2Fonts.setForegroundColor(BK);
    u8g2Fonts.setCursor(lx + 13, y + 10);
    u8g2Fonts.print("RH%");
    lx += 40;
    // VPD
    display.fillRect(lx, y + 4, 10, 3, YL);
    u8g2Fonts.setForegroundColor(YL);
    u8g2Fonts.setCursor(lx + 13, y + 10);
    u8g2Fonts.print("VPD");

    // Time range label
    u8g2Fonts.setForegroundColor(BK);
    tr(plotX + plotW, y + 10, "24h");

    // Plot area background — subtle grid
    for (int g = 1; g < 4; g++) {
      int gy = plotY + (plotH * g) / 4;
      for (int gx = plotX; gx < plotX + plotW; gx += 4) display.drawPixel(gx, gy, BK);
    }
    for (int g = 1; g < 4; g++) {
      int gx = plotX + (plotW * g) / 4;
      for (int gy = plotY; gy < plotY + plotH; gy += 4) display.drawPixel(gx, gy, BK);
    }

    // Draw chart lines
    if (D.histCount > 1) {
      float tLo, tHi, rLo, rHi, vLo, vHi;
      getMinMax(D.histT, D.histCount, tLo, tHi);
      getMinMax(D.histRH, D.histCount, rLo, rHi);

      chartLine(plotX, plotY, plotW, plotH, D.histT, D.histCount, tLo, tHi, RD);
      chartLine(plotX, plotY, plotW, plotH, D.histRH, D.histCount, rLo, rHi, BK);

      // VPD
      bool hasV = false;
      for (int i = 0; i < D.histCount; i++) if (D.histVPD[i] > -900) { hasV = true; break; }
      if (hasV) {
        getMinMax(D.histVPD, D.histCount, vLo, vHi);
        chartLine(plotX, plotY, plotW, plotH, D.histVPD, D.histCount, vLo, vHi, YL);
      }

      // Y-axis labels
      u8g2Fonts.setFont(u8g2_font_micro_tr);
      u8g2Fonts.setForegroundColor(RD);
      snprintf(buf, sizeof(buf), "%.0f", tHi); tr(plotX - 2, plotY + 5, buf);
      snprintf(buf, sizeof(buf), "%.0f", tLo); tr(plotX - 2, plotY + plotH, buf);

      u8g2Fonts.setForegroundColor(BK);
      snprintf(buf, sizeof(buf), "%.0f", rHi);
      u8g2Fonts.setCursor(plotX + plotW + 3, plotY + 5); u8g2Fonts.print(buf);
      snprintf(buf, sizeof(buf), "%.0f", rLo);
      u8g2Fonts.setCursor(plotX + plotW + 3, plotY + plotH); u8g2Fonts.print(buf);
    }

    // Time axis labels
    u8g2Fonts.setFont(u8g2_font_micro_tr);
    u8g2Fonts.setForegroundColor(BK);
    int axY = plotY + plotH + 7;
    tc(plotX, axY, "-24h");
    tc(plotX + plotW / 4, axY, "-18h");
    tc(plotX + plotW / 2, axY, "-12h");
    tc(plotX + 3 * plotW / 4, axY, "-6h");
    tc(plotX + plotW, axY, "now");

    // ========== FOOTER (282-299) ==========
    y = 283;
    display.fillRect(0, y, W, H - y, BK);
    u8g2Fonts.setBackgroundColor(BK);
    u8g2Fonts.setFont(u8g2_font_helvR08_tr);

    // Date
    u8g2Fonts.setForegroundColor(WH);
    if (D.timestamp.length() > 16) {
      String ts = D.timestamp.substring(8, 10) + "." +
                  D.timestamp.substring(5, 7) + "." +
                  D.timestamp.substring(2, 4) + " " +
                  D.timestamp.substring(11, 16);
      u8g2Fonts.setCursor(8, y + 13);
      u8g2Fonts.print(ts.c_str());
    }

    // All temps compact
    u8g2Fonts.setForegroundColor(YL);
    String allT = "";
    for (int i = 0; i < D.tempCount; i++) {
      if (i > 0) allT += " | ";
      allT += String(D.temps[i], 1);
    }
    if (D.hasAirT) { allT += " | "; allT += String(D.airT, 1); }
    tc(W / 2, y + 13, allT.c_str());

    // Battery
    u8g2Fonts.setForegroundColor(WH);
    int batRaw = analogRead(9);
    float batV = batRaw * 2.0f * 3.3f / 4095.0f;
    if (batV > 1.0f) {
      snprintf(buf, sizeof(buf), "%.1fV", batV);
      tr(W - 8, y + 13, buf);
    }

    u8g2Fonts.setBackgroundColor(WH);

  } while (display.nextPage());
}

void drawError(const char* msg) {
  display.setFullWindow(); display.firstPage();
  do {
    display.fillScreen(WH);
    u8g2Fonts.setFontMode(1); u8g2Fonts.setFontDirection(0);
    u8g2Fonts.setBackgroundColor(WH);
    u8g2Fonts.setFont(u8g2_font_helvB14_tr);
    u8g2Fonts.setForegroundColor(RD);
    tc(W/2, H/2 - 10, "ERROR");
    u8g2Fonts.setFont(u8g2_font_helvR10_tr);
    u8g2Fonts.setForegroundColor(BK);
    tc(W/2, H/2 + 15, msg);
  } while (display.nextPage());
}

bool isNightTime() {
  if (D.timestamp.length() < 13) return false;
  int hour = D.timestamp.substring(11, 13).toInt();
  if (NIGHT_SLEEP_HOUR_START > NIGHT_SLEEP_HOUR_END) {
    // e.g. 19..8 → night is 19,20,21,...,23,0,1,...,7
    return hour >= NIGHT_SLEEP_HOUR_START || hour < NIGHT_SLEEP_HOUR_END;
  }
  return hour >= NIGHT_SLEEP_HOUR_START && hour < NIGHT_SLEEP_HOUR_END;
}

uint64_t calcSleepMinutes() {
  if (!isNightTime()) return SLEEP_MINUTES;
  // Calculate minutes until NIGHT_SLEEP_HOUR_END
  if (D.timestamp.length() < 16) return 60;
  int hour = D.timestamp.substring(11, 13).toInt();
  int minute = D.timestamp.substring(14, 16).toInt();
  int wakeMinutes = NIGHT_SLEEP_HOUR_END * 60;
  int nowMinutes = hour * 60 + minute;
  int diff = wakeMinutes - nowMinutes;
  if (diff <= 0) diff += 24 * 60; // wrap around midnight
  return (uint64_t)diff;
}

void goToSleep() {
  digitalWrite(EPD_POWER, LOW);
  WiFi.disconnect(true); WiFi.mode(WIFI_OFF);
  uint64_t sleepMin = calcSleepMinutes();
  Serial.printf("Sleep %llu min%s\n", sleepMin, isNightTime() ? " (night)" : "");
  esp_sleep_enable_timer_wakeup(sleepMin * 60ULL * 1000000ULL);
  esp_deep_sleep_start();
}

void setup() {
  Serial.begin(115200);
  // Wait for USB CDC to initialize on ESP32-S3
  delay(2000);
  Serial.println("\n\n=== ESPink v4 ===");

  pinMode(EPD_POWER, OUTPUT); digitalWrite(EPD_POWER, HIGH); delay(50);
  SPI.begin(EPD_SCK, EPD_MISO, EPD_MOSI, SS);
  display.init(115200, true, 50, false);
  display.setRotation(0); display.setTextWrap(false);
  u8g2Fonts.begin(display);

  Serial.print("WiFi...");
  if (!connectWiFi()) {
    Serial.println("FAIL");
    drawError("WiFi failed");
    delay(60000); // wait 1 min instead of sleep for debug
    ESP.restart();
    return;
  }
  Serial.printf("OK %s RSSI=%d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  Serial.printf("Free heap: %d\n", ESP.getFreeHeap());

  // Retry API up to 3 times (SSL can be flaky)
  bool ok = false;
  for (int attempt = 1; attempt <= 3; attempt++) {
    Serial.printf("API attempt %d...", attempt);
    if (fetchData()) { ok = true; break; }
    Serial.println("FAIL");
    delay(2000);
  }
  if (!ok) {
    drawError("API failed");
    delay(30000);
    ESP.restart();
    return;
  }
  Serial.printf("OK hist=%d\n", D.histCount);

  Serial.print("Draw...");
  drawDisplay();
  Serial.println("OK");
  display.hibernate();
  goToSleep();
}

void loop() {}
