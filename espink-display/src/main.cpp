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

#define MAX_PROPS 4
struct Propagator { String loc; float t; float rh; int bat; bool hasT, hasRH, hasBat; };

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
  Propagator props[MAX_PROPS]; int propCount;
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

  // Parse propagators
  D.propCount = 0;
  JsonArray props = doc["propagators"];
  for (JsonObject p : props) {
    if (D.propCount >= MAX_PROPS) break;
    Propagator &pp = D.props[D.propCount];
    pp.loc = (const char*)(p["loc"] | p["name"] | "");
    pp.hasT = !p["t"].isNull(); pp.t = p["t"] | 0.0f;
    pp.hasRH = !p["rh"].isNull(); pp.rh = p["rh"] | 0.0f;
    pp.hasBat = !p["bat"].isNull(); pp.bat = p["bat"] | 0;
    D.propCount++;
  }
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

    // ========== TOP ROW: TEMP + HUMIDITY + CO2 (26-90) ==========
    int y = 26;
    int gap = 4;
    int cellH = 64;
    int boxW = (W - 4 * gap) / 3;

    // Temperature (SHT45 — airT)
    {
      int cx = 4;
      cardWithHeader(cx, y, boxW, cellH, RD, "TEMPERATURE");
      u8g2Fonts.setFont(u8g2_font_helvB24_tr);
      u8g2Fonts.setForegroundColor(BK);
      if (D.hasAirT) {
        snprintf(buf, sizeof(buf), "%.1f", D.airT);
        tc(cx + boxW / 2, y + 46, buf);
        u8g2Fonts.setFont(u8g2_font_helvR08_tr);
        tc(cx + boxW / 2, y + 58, "C");
      } else {
        snprintf(buf, sizeof(buf), "--");
        tc(cx + boxW / 2, y + 46, buf);
      }
    }

    // Humidity (SHT45 — rh2 preferred)
    {
      int cx = 4 + boxW + gap;
      cardWithHeader(cx, y, boxW, cellH, BK, "HUMIDITY");
      float rv = D.hasRH2 ? D.rh2 : D.rh;
      u8g2Fonts.setFont(u8g2_font_helvB24_tr);
      u8g2Fonts.setForegroundColor(BK);
      if (D.hasRH2 || D.hasRH) {
        snprintf(buf, sizeof(buf), "%.0f", rv);
        tc(cx + boxW / 2, y + 46, buf);
        u8g2Fonts.setFont(u8g2_font_helvR10_tr);
        tc(cx + boxW / 2, y + 58, "%");
      } else {
        snprintf(buf, sizeof(buf), "--");
        tc(cx + boxW / 2, y + 46, buf);
      }
    }

    // CO2
    {
      int cx = 4 + 2 * (boxW + gap);
      uint16_t co2c = D.co2 > 1500 ? RD : (D.co2 > 1000 ? YL : BK);
      cardWithHeader(cx, y, boxW, cellH, co2c, "CO2");
      u8g2Fonts.setFont(u8g2_font_helvB24_tr);
      u8g2Fonts.setForegroundColor(D.co2 > 1500 ? RD : BK);
      if (D.hasCO2) {
        snprintf(buf, sizeof(buf), "%d", D.co2);
        tc(cx + boxW / 2, y + 44, buf);
        u8g2Fonts.setFont(u8g2_font_helvR08_tr);
        u8g2Fonts.setForegroundColor(BK);
        tc(cx + boxW / 2, y + 58, "ppm");
      } else {
        snprintf(buf, sizeof(buf), "--");
        tc(cx + boxW / 2, y + 44, buf);
      }
    }

    // ========== SECOND ROW: VPD SCALE + PHOTOPERIOD (94-148) ==========
    y = 94;
    int row2H = 54;
    int vpdW = (W - 3 * gap) * 2 / 3;  // ~260px
    int photoW = W - vpdW - 3 * gap - 4;

    // VPD with visual scale
    {
      int cx = 4;
      uint16_t vc = D.vpd > 1.6f ? RD : (D.vpd > 1.2f ? YL : (D.vpd < 0.4f ? BK : BK));
      cardWithHeader(cx, y, vpdW, row2H, vc, "VPD");

      int inX = cx + 6;
      int inW = vpdW - 12;
      int scaleY = y + 38;
      int scaleH = 9;

      // Value + unit (left side)
      u8g2Fonts.setFont(u8g2_font_helvB14_tr);
      u8g2Fonts.setForegroundColor(BK);
      if (D.hasVPD) {
        snprintf(buf, sizeof(buf), "%.2f", D.vpd);
      } else {
        snprintf(buf, sizeof(buf), "--");
      }
      u8g2Fonts.setCursor(inX, y + 30);
      u8g2Fonts.print(buf);
      u8g2Fonts.setFont(u8g2_font_helvR08_tr);
      u8g2Fonts.print(" kPa");

      // Scale range: 0.0 - 2.0 kPa
      // Segments: 0-0.4 (cold/blue), 0.4-0.8 (low-optimal), 0.8-1.2 (optimal), 1.2-1.6 (high), 1.6-2.0 (too high/red)
      float vpdMin = 0.0f, vpdMax = 2.0f;
      int seg0 = inX + (int)((0.4f - vpdMin) / (vpdMax - vpdMin) * inW);
      int seg1 = inX + (int)((0.8f - vpdMin) / (vpdMax - vpdMin) * inW);
      int seg2 = inX + (int)((1.2f - vpdMin) / (vpdMax - vpdMin) * inW);
      int seg3 = inX + (int)((1.6f - vpdMin) / (vpdMax - vpdMin) * inW);
      int endX = inX + inW;

      // Draw segments
      display.fillRect(inX, scaleY, seg0 - inX, scaleH, BK);     // too low (black)
      display.fillRect(seg0, scaleY, seg1 - seg0, scaleH, YL);   // low-optimal (yellow)
      display.fillRect(seg1, scaleY, seg2 - seg1, scaleH, WH);   // optimal (white fill, border)
      display.drawRect(seg1, scaleY, seg2 - seg1, scaleH, BK);
      display.fillRect(seg2, scaleY, seg3 - seg2, scaleH, YL);   // high (yellow)
      display.fillRect(seg3, scaleY, endX - seg3, scaleH, RD);   // too high (red)

      // Current VPD marker (triangle pointing down from above the scale)
      if (D.hasVPD) {
        float v = D.vpd; if (v < vpdMin) v = vpdMin; if (v > vpdMax) v = vpdMax;
        int mx = inX + (int)((v - vpdMin) / (vpdMax - vpdMin) * inW);
        // Draw marker triangle
        display.fillTriangle(mx - 3, scaleY - 4, mx + 3, scaleY - 4, mx, scaleY, RD);
        display.drawLine(mx, scaleY, mx, scaleY + scaleH, RD);
      }

      // Scale labels under
      u8g2Fonts.setFont(u8g2_font_micro_tr);
      u8g2Fonts.setForegroundColor(BK);
      u8g2Fonts.setCursor(inX, scaleY + scaleH + 6);
      u8g2Fonts.print("0.0");
      tc(seg1, scaleY + scaleH + 6, "0.8");
      tc(seg2, scaleY + scaleH + 6, "1.2");
      tr(endX, scaleY + scaleH + 6, "2.0");
    }

    // Photoperiod
    {
      int cx = 4 + vpdW + gap;
      int pw = photoW;
      cardWithHeader(cx, y, pw, row2H, BK, "PHOTOPERIOD");
      if (D.hasPhoto) {
        u8g2Fonts.setFont(u8g2_font_helvB10_tr);
        u8g2Fonts.setForegroundColor(BK);
        snprintf(buf, sizeof(buf), "%.0f / %.0f h", D.photoDay, D.photoNight);
        tc(cx + pw / 2, y + 32, buf);
        int bx = cx + 6, bw = pw - 12, by = y + 38, bh = 8;
        int dayW = (int)(bw * D.photoDay / 24.0f);
        if (dayW > 0) display.fillRoundRect(bx, by, dayW, bh, 2, YL);
        if (dayW < bw) display.fillRoundRect(bx + dayW, by, bw - dayW, bh, 2, BK);
      } else {
        u8g2Fonts.setFont(u8g2_font_helvR10_tr);
        u8g2Fonts.setForegroundColor(BK);
        tc(cx + pw / 2, y + 36, "--");
      }
    }

    // ========== PROPAGATORS AREA (152-280) ==========
    y = 152;
    int propH = 128;
    int propX = 4;
    int propW = W - 8;

    // Outer frame
    display.drawRect(propX, y, propW, propH, BK);

    // Header bar
    display.fillRect(propX, y, propW, 14, BK);
    u8g2Fonts.setFontMode(1);
    u8g2Fonts.setBackgroundColor(BK);
    u8g2Fonts.setForegroundColor(WH);
    u8g2Fonts.setFont(u8g2_font_helvB10_tr);
    u8g2Fonts.setCursor(propX + 6, y + 11);
    u8g2Fonts.print("PROPAGATORS");
    u8g2Fonts.setBackgroundColor(WH);
    u8g2Fonts.setForegroundColor(BK);

    // Count in top-right
    u8g2Fonts.setFont(u8g2_font_helvR08_tr);
    u8g2Fonts.setBackgroundColor(BK);
    u8g2Fonts.setForegroundColor(WH);
    snprintf(buf, sizeof(buf), "%d", D.propCount);
    tr(propX + propW - 4, y + 11, buf);
    u8g2Fonts.setBackgroundColor(WH);
    u8g2Fonts.setForegroundColor(BK);

    if (D.propCount == 0) {
      u8g2Fonts.setFont(u8g2_font_helvR10_tr);
      tc(W/2, y + propH/2 + 5, "no data");
    } else {
      // 2x2 grid of propagator cards
      int gridY = y + 16;
      int gridH = propH - 16;
      int cols = (D.propCount <= 2) ? D.propCount : 2;
      int rows = (D.propCount <= 2) ? 1 : 2;
      int cellW = (propW - 4) / cols;
      int cellH = gridH / rows;

      for (int i = 0; i < D.propCount; i++) {
        int col = i % cols;
        int row = i / cols;
        int cx = propX + 2 + col * cellW;
        int cy = gridY + row * cellH;

        // Cell border
        display.drawRect(cx, cy, cellW - 2, cellH - 2, BK);

        // Location (top)
        u8g2Fonts.setFont(u8g2_font_helvB10_tr);
        u8g2Fonts.setForegroundColor(BK);
        u8g2Fonts.setCursor(cx + 4, cy + 12);
        u8g2Fonts.print(D.props[i].loc.c_str());

        // Battery in top-right
        if (D.props[i].hasBat) {
          u8g2Fonts.setFont(u8g2_font_micro_tr);
          u8g2Fonts.setForegroundColor(D.props[i].bat < 20 ? RD : BK);
          snprintf(buf, sizeof(buf), "%d%%", D.props[i].bat);
          tr(cx + cellW - 5, cy + 10, buf);
        }

        // Temperature (large)
        u8g2Fonts.setFont(u8g2_font_helvB18_tr);
        u8g2Fonts.setForegroundColor(RD);
        if (D.props[i].hasT) {
          snprintf(buf, sizeof(buf), "%.1f", D.props[i].t);
        } else {
          snprintf(buf, sizeof(buf), "--");
        }
        u8g2Fonts.setCursor(cx + 6, cy + 34);
        u8g2Fonts.print(buf);
        u8g2Fonts.setFont(u8g2_font_helvR08_tr);
        u8g2Fonts.setForegroundColor(RD);
        u8g2Fonts.print("C");

        // Humidity (next to temperature)
        u8g2Fonts.setFont(u8g2_font_helvB14_tr);
        u8g2Fonts.setForegroundColor(BK);
        if (D.props[i].hasRH) {
          snprintf(buf, sizeof(buf), "%.0f", D.props[i].rh);
        } else {
          snprintf(buf, sizeof(buf), "--");
        }
        u8g2Fonts.setCursor(cx + cellW/2 + 8, cy + 34);
        u8g2Fonts.print(buf);
        u8g2Fonts.setFont(u8g2_font_helvR08_tr);
        u8g2Fonts.print("%");

        // Labels under values
        u8g2Fonts.setFont(u8g2_font_micro_tr);
        u8g2Fonts.setForegroundColor(BK);
        u8g2Fonts.setCursor(cx + 6, cy + 43);
        u8g2Fonts.print("temp");
        u8g2Fonts.setCursor(cx + cellW/2 + 8, cy + 43);
        u8g2Fonts.print("humid");
      }
    }

    // ========== FOOTER (282-299) ==========
    y = 283;
    display.fillRect(0, y, W, H - y, BK);
    u8g2Fonts.setBackgroundColor(BK);
    u8g2Fonts.setFont(u8g2_font_helvR08_tr);

    // Date (convert UTC -> local time)
    u8g2Fonts.setForegroundColor(WH);
    if (D.timestamp.length() > 16) {
      int hh = D.timestamp.substring(11, 13).toInt() + TZ_OFFSET;
      int dd = D.timestamp.substring(8, 10).toInt();
      if (hh >= 24) { hh -= 24; dd++; }
      if (hh < 0) { hh += 24; dd--; }
      snprintf(buf, sizeof(buf), "%02d.%s.%s %02d:%s",
        dd,
        D.timestamp.substring(5, 7).c_str(),
        D.timestamp.substring(2, 4).c_str(),
        hh,
        D.timestamp.substring(14, 16).c_str());
      u8g2Fonts.setCursor(8, y + 13);
      u8g2Fonts.print(buf);
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

    // Battery icon + voltage
    int batRaw = analogRead(9);
    float batV = batRaw * 2.0f * 3.3f / 4095.0f;
    if (batV > 1.0f) {
      // Battery percentage (3.0V=0%, 4.2V=100%)
      int batPct = constrain((int)((batV - 3.0f) / 1.2f * 100), 0, 100);

      // Draw battery icon (right side of footer)
      int bx = W - 52, by = y + 4, bw = 22, bh = 10;
      // Battery body outline
      display.drawRect(bx, by, bw, bh, WH);
      // Battery tip
      display.fillRect(bx + bw, by + 3, 2, 4, WH);
      // Fill level
      int fillW = (bw - 2) * batPct / 100;
      uint16_t fillCol = batPct < 20 ? RD : WH;
      if (fillW > 0) display.fillRect(bx + 1, by + 1, fillW, bh - 2, fillCol);

      // Voltage text
      u8g2Fonts.setForegroundColor(batPct < 20 ? RD : WH);
      snprintf(buf, sizeof(buf), "%.1fV", batV);
      tr(bx - 4, y + 13, buf);
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

// Night window: NIGHT_SLEEP_HOUR_START:00 → NIGHT_SLEEP_HOUR_END:NIGHT_SLEEP_MINUTE_END
// e.g. 19:00 → 08:30
bool isNightTimeLocal(int hour, int minute) {
  int nowM = hour * 60 + minute;
  int startM = NIGHT_SLEEP_HOUR_START * 60;
  int endM = NIGHT_SLEEP_HOUR_END * 60 + NIGHT_SLEEP_MINUTE_END;
  if (startM > endM) {
    // wrap around midnight: [startM..1440) or [0..endM)
    return nowM >= startM || nowM < endM;
  }
  return nowM >= startM && nowM < endM;
}

bool isNightTime() {
  if (D.timestamp.length() < 16) return false;
  int hour = D.timestamp.substring(11, 13).toInt();
  int minute = D.timestamp.substring(14, 16).toInt();
  return isNightTimeLocal(hour, minute);
}

// Get local (Prague) time using system clock + NTP. Returns -1 if not synced yet.
int getLocalHour() {
  time_t now = time(nullptr);
  if (now < 1700000000) return -1; // before 2023 = not synced
  struct tm tm;
  localtime_r(&now, &tm);
  return tm.tm_hour;
}

int getLocalMinute() {
  time_t now = time(nullptr);
  if (now < 1700000000) return -1;
  struct tm tm;
  localtime_r(&now, &tm);
  return tm.tm_min;
}

void drawSleeping() {
  display.setFullWindow(); display.firstPage();
  do {
    display.fillScreen(BK);
    u8g2Fonts.setFontMode(1); u8g2Fonts.setFontDirection(0);
    u8g2Fonts.setBackgroundColor(BK);
    u8g2Fonts.setForegroundColor(WH);
    u8g2Fonts.setFont(u8g2_font_helvB24_tr);
    tc(W/2, H/2 - 20, "SLEEPING");
    u8g2Fonts.setFont(u8g2_font_helvR14_tr);
    tc(W/2, H/2 + 10, "Zzz...");
    u8g2Fonts.setFont(u8g2_font_helvR10_tr);
    tc(W/2, H - 20, "wake at 08:30");
  } while (display.nextPage());
}

// Sleep minutes based on NTP local time when possible, fallback to D.timestamp
uint64_t calcSleepMinutes() {
  int hour = getLocalHour();
  int minute = getLocalMinute();
  // Fallback to server timestamp if NTP not synced
  if (hour < 0 && D.timestamp.length() >= 16) {
    hour = D.timestamp.substring(11, 13).toInt();
    minute = D.timestamp.substring(14, 16).toInt();
  }
  if (hour < 0) return SLEEP_MINUTES; // no time known

  bool night = isNightTimeLocal(hour, minute);
  if (!night) return SLEEP_MINUTES;

  // Night: sleep until NIGHT_SLEEP_HOUR_END:NIGHT_SLEEP_MINUTE_END
  int wakeMinutes = NIGHT_SLEEP_HOUR_END * 60 + NIGHT_SLEEP_MINUTE_END;
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

  // NTP sync for accurate local time (Prague = UTC+TZ_OFFSET)
  configTime(TZ_OFFSET * 3600, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("NTP...");
  for (int i = 0; i < 20; i++) {
    if (time(nullptr) > 1700000000) break;
    delay(250);
  }
  int h = getLocalHour();
  int m = getLocalMinute();
  Serial.printf(" %02d:%02d\n", h, m);

  // Night mode: show SLEEPING, skip fetch, deep sleep until morning
  if (h >= 0 && isNightTimeLocal(h, m)) {
    Serial.println("Night mode — drawing SLEEPING");
    drawSleeping();
    display.hibernate();
    goToSleep();
    return;
  }

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
