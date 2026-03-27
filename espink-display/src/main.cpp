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

#define BLACK   GxEPD_BLACK
#define WHITE   GxEPD_WHITE
#define RED     GxEPD_RED
#define YELLOW  GxEPD_YELLOW
#define W 400
#define H 300
#define MAX_HIST 60

// ===== Data =====
struct SData {
  String zoneName;
  bool online;
  String timestamp;
  float temps[4]; String tempLocs[4]; int tempCount;
  float airT, rh, rh2, vpd;
  int co2, lux;
  float photoDay, photoNight;
  bool hasAirT, hasRH, hasRH2, hasCO2, hasLux, hasVPD, hasPhoto;
  float histT[MAX_HIST], histRH[MAX_HIST], histVPD[MAX_HIST];
  int histCount;
} D;

bool connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long s = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - s < WIFI_TIMEOUT) delay(200);
  return WiFi.status() == WL_CONNECTED;
}

float calcVPD(float lf, float at, float rh) {
  if (lf < -40 || at < -40 || rh < 0) return -999;
  float svpL = 0.6108f * expf(17.27f * lf / (lf + 237.3f));
  float svpA = 0.6108f * expf(17.27f * at / (at + 237.3f));
  float v = svpL - svpA * rh / 100.0f;
  return v > 0 ? v : 0;
}

bool fetchData() {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, String("https://") + API_HOST + API_PATH);
  http.addHeader("X-API-KEY", API_KEY);
  http.setTimeout(10000);
  int code = http.GET();
  if (code != 200) { http.end(); return false; }
  String payload = http.getString();
  http.end();

  JsonDocument doc;
  if (deserializeJson(doc, payload)) return false;

  D.zoneName = doc["zone"].as<String>();
  D.online = doc["online"] | false;
  D.timestamp = doc["ts"].as<String>();

  D.tempCount = 0;
  for (JsonObject t : doc["temps"].as<JsonArray>()) {
    if (D.tempCount >= 4) break;
    D.temps[D.tempCount] = t["v"];
    D.tempLocs[D.tempCount] = t["loc"].as<String>();
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

  JsonArray hist = doc["hist"];
  JsonArray canopyH = doc["canopyHist"];
  D.histCount = 0;
  int i = 0;
  for (JsonObject h : hist) {
    if (i >= MAX_HIST) break;
    D.histT[i] = h["t"] | -999.0f;
    D.histRH[i] = h["rh"] | -999.0f;
    float ct = (i < (int)canopyH.size()) ? canopyH[i].as<float>() : -999.0f;
    float at = D.histT[i];
    float rh = D.histRH[i];
    D.histVPD[i] = calcVPD(ct, at, rh);
    i++;
  }
  D.histCount = i;
  return true;
}

// ===== Drawing =====
void tCenter(int16_t x, int16_t y, const char* t) {
  u8g2Fonts.setCursor(x - u8g2Fonts.getUTF8Width(t) / 2, y);
  u8g2Fonts.print(t);
}
void tRight(int16_t x, int16_t y, const char* t) {
  u8g2Fonts.setCursor(x - u8g2Fonts.getUTF8Width(t), y);
  u8g2Fonts.print(t);
}

// Draw a single chart line within the chart area
void drawChartLine(int16_t cx, int16_t cy, int16_t cw, int16_t ch,
                   float* vals, int count, float vmin, float vmax, uint16_t color, bool thick) {
  if (count < 2 || vmax <= vmin) return;
  float range = vmax - vmin;
  int prevX = -1, prevY = -1;
  for (int i = 0; i < count; i++) {
    if (vals[i] < -900) { prevX = -1; continue; }
    int px = cx + (i * cw) / (count - 1);
    int py = cy + ch - (int)((vals[i] - vmin) / range * ch);
    py = constrain(py, cy, cy + ch);
    if (prevX >= 0) {
      display.drawLine(prevX, prevY, px, py, color);
      if (thick) display.drawLine(prevX, prevY - 1, px, py - 1, color);
    }
    prevX = px; prevY = py;
  }
}

void getMinMax(float* vals, int count, float &vmin, float &vmax) {
  vmin = 99999; vmax = -99999;
  for (int i = 0; i < count; i++) {
    if (vals[i] < -900) continue;
    if (vals[i] < vmin) vmin = vals[i];
    if (vals[i] > vmax) vmax = vals[i];
  }
  if (vmin >= vmax) { vmin -= 1; vmax += 1; }
  float pad = (vmax - vmin) * 0.08f;
  vmin -= pad; vmax += pad;
}

// ===== MAIN LAYOUT =====
// 400x300:
// [0-24]    Header
// [26-57]   4 metric boxes: temps (compact) + RH + CO2 + VPD
// [59-67]   Photo bar
// [70-182]  BIG combined chart: Temp (red) + RH (black) + VPD (yellow)
// [184-192] Chart legend
// [194-210] Secondary info: Light, all individual temps
// [212-222] Footer

void drawDisplay() {
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(WHITE);
    u8g2Fonts.setFontMode(1);
    u8g2Fonts.setFontDirection(0);
    u8g2Fonts.setBackgroundColor(WHITE);

    char buf[32];

    // ===== HEADER (0-24) =====
    display.fillRect(0, 0, W, 24, BLACK);
    u8g2Fonts.setFont(u8g2_font_helvB10_tr);
    u8g2Fonts.setForegroundColor(WHITE);
    u8g2Fonts.setBackgroundColor(BLACK);
    u8g2Fonts.setCursor(8, 17);
    u8g2Fonts.print(D.zoneName.c_str());
    display.fillCircle(W - 14, 12, 4, D.online ? WHITE : RED);
    // Timestamp in header
    if (D.timestamp.length() > 16) {
      u8g2Fonts.setFont(u8g2_font_helvR08_tr);
      String ts = D.timestamp.substring(11, 16);
      tRight(W - 26, 17, ts.c_str());
    }
    u8g2Fonts.setBackgroundColor(WHITE);

    // ===== METRIC BOXES (26-60) =====
    int y = 26;
    int boxH = 34;
    // 4 equal boxes across
    int bw = (W - 24) / 4;  // ~94px each
    int bx = 6;

    // Box 1: Main temperature (canopy or first)
    {
      display.drawRoundRect(bx, y, bw, boxH, 3, BLACK);
      u8g2Fonts.setFont(u8g2_font_micro_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      const char* lbl = D.tempCount > 0 ? D.tempLocs[0].c_str() : "Temp";
      tCenter(bx + bw/2, y + 8, lbl);
      u8g2Fonts.setFont(u8g2_font_helvB12_tr);
      float tv = D.tempCount > 0 ? D.temps[0] : (D.hasAirT ? D.airT : 0);
      snprintf(buf, sizeof(buf), "%.1f", tv);
      tCenter(bx + bw/2, y + 26, buf);
      // small C
      u8g2Fonts.setFont(u8g2_font_micro_tr);
      int tw2 = u8g2Fonts.getUTF8Width(buf);
      u8g2Fonts.setCursor(bx + bw/2 + tw2/2 + 1, y + 20);
      u8g2Fonts.print("C");
    }
    bx += bw + 4;

    // Box 2: Humidity
    {
      display.drawRoundRect(bx, y, bw, boxH, 3, BLACK);
      u8g2Fonts.setFont(u8g2_font_micro_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      tCenter(bx + bw/2, y + 8, "RH");
      u8g2Fonts.setFont(u8g2_font_helvB12_tr);
      float rv = D.hasRH2 ? D.rh2 : D.rh;
      snprintf(buf, sizeof(buf), "%.0f%%", rv);
      tCenter(bx + bw/2, y + 26, buf);
    }
    bx += bw + 4;

    // Box 3: CO2
    {
      uint16_t co2c = D.co2 > 1500 ? RED : (D.co2 > 1000 ? YELLOW : BLACK);
      display.drawRoundRect(bx, y, bw, boxH, 3, co2c);
      u8g2Fonts.setFont(u8g2_font_micro_tr);
      u8g2Fonts.setForegroundColor(co2c);
      tCenter(bx + bw/2, y + 8, "CO2");
      u8g2Fonts.setFont(u8g2_font_helvB12_tr);
      snprintf(buf, sizeof(buf), "%d", D.co2);
      tCenter(bx + bw/2, y + 26, buf);
    }
    bx += bw + 4;

    // Box 4: VPD
    if (D.hasVPD) {
      uint16_t vc = D.vpd > 1.6f ? RED : (D.vpd > 1.2f ? YELLOW : BLACK);
      display.drawRoundRect(bx, y, bw, boxH, 3, vc);
      u8g2Fonts.setFont(u8g2_font_micro_tr);
      u8g2Fonts.setForegroundColor(vc);
      tCenter(bx + bw/2, y + 8, "VPD");
      u8g2Fonts.setFont(u8g2_font_helvB12_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      snprintf(buf, sizeof(buf), "%.2f", D.vpd);
      tCenter(bx + bw/2, y + 26, buf);
    }

    // ===== PHOTOPERIOD BAR (62-72) =====
    y = 63;
    if (D.hasPhoto) {
      int barX = 6, barW = W - 12, barH = 8;
      int dayW = (int)(barW * D.photoDay / 24.0f);
      if (dayW > 0) display.fillRoundRect(barX, y, dayW, barH, 2, YELLOW);
      if (dayW < barW) display.fillRoundRect(barX + dayW, y, barW - dayW, barH, 2, BLACK);
      // Labels
      u8g2Fonts.setFont(u8g2_font_micro_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      snprintf(buf, sizeof(buf), "%.0fh day", D.photoDay);
      u8g2Fonts.setCursor(barX, y + barH + 8);
      u8g2Fonts.print(buf);
      snprintf(buf, sizeof(buf), "%.0fh night", D.photoNight);
      tRight(barX + barW, y + barH + 8, buf);
    }

    // ===== BIG COMBINED CHART (82-240) =====
    int chartY = 82;
    int chartH = 158;
    int chartX = 35;  // space for left Y labels
    int chartW = W - chartX - 35; // space for right Y labels

    display.drawRect(chartX, chartY, chartW, chartH, BLACK);

    // Grid lines (horizontal, 4 divisions)
    for (int g = 1; g < 4; g++) {
      int gy = chartY + (chartH * g) / 4;
      for (int gx = chartX; gx < chartX + chartW; gx += 6) {
        display.drawPixel(gx, gy, BLACK);
      }
    }
    // Grid lines (vertical, ~6h markers)
    if (D.histCount > 0) {
      for (int g = 1; g < 4; g++) {
        int gx = chartX + (chartW * g) / 4;
        for (int gy2 = chartY; gy2 < chartY + chartH; gy2 += 6) {
          display.drawPixel(gx, gy2, BLACK);
        }
      }
      // Time labels: -24h, -18h, -12h, -6h, now
      u8g2Fonts.setFont(u8g2_font_micro_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      tCenter(chartX, chartY + chartH + 8, "-24h");
      tCenter(chartX + chartW/4, chartY + chartH + 8, "-18h");
      tCenter(chartX + chartW/2, chartY + chartH + 8, "-12h");
      tCenter(chartX + 3*chartW/4, chartY + chartH + 8, "-6h");
      tCenter(chartX + chartW, chartY + chartH + 8, "now");
    }

    if (D.histCount > 1) {
      // Temperature line (RED) — left Y axis
      float tMin, tMax;
      getMinMax(D.histT, D.histCount, tMin, tMax);
      drawChartLine(chartX + 1, chartY + 1, chartW - 2, chartH - 2,
                    D.histT, D.histCount, tMin, tMax, RED, true);

      // Left Y-axis labels (Temp)
      u8g2Fonts.setFont(u8g2_font_micro_tr);
      u8g2Fonts.setForegroundColor(RED);
      snprintf(buf, sizeof(buf), "%.0f", tMax);
      tRight(chartX - 2, chartY + 6, buf);
      snprintf(buf, sizeof(buf), "%.0f", tMin);
      tRight(chartX - 2, chartY + chartH, buf);

      // Humidity line (BLACK dashed effect - draw every other segment)
      float rMin, rMax;
      getMinMax(D.histRH, D.histCount, rMin, rMax);
      drawChartLine(chartX + 1, chartY + 1, chartW - 2, chartH - 2,
                    D.histRH, D.histCount, rMin, rMax, BLACK, false);

      // Right Y-axis labels (RH%)
      u8g2Fonts.setForegroundColor(BLACK);
      snprintf(buf, sizeof(buf), "%.0f%%", rMax);
      u8g2Fonts.setCursor(chartX + chartW + 3, chartY + 6);
      u8g2Fonts.print(buf);
      snprintf(buf, sizeof(buf), "%.0f%%", rMin);
      u8g2Fonts.setCursor(chartX + chartW + 3, chartY + chartH);
      u8g2Fonts.print(buf);

      // VPD line (YELLOW)
      bool hasVH = false;
      for (int i = 0; i < D.histCount; i++) { if (D.histVPD[i] > -900) { hasVH = true; break; } }
      if (hasVH) {
        float vMin, vMax;
        getMinMax(D.histVPD, D.histCount, vMin, vMax);
        drawChartLine(chartX + 1, chartY + 1, chartW - 2, chartH - 2,
                      D.histVPD, D.histCount, vMin, vMax, YELLOW, true);
      }
    }

    // ===== CHART LEGEND (244-252) =====
    y = 244;
    u8g2Fonts.setFont(u8g2_font_helvR08_tr);
    int lx = chartX;

    // Temp legend
    display.fillRect(lx, y + 2, 12, 3, RED);
    u8g2Fonts.setForegroundColor(RED);
    snprintf(buf, sizeof(buf), "Temp %.1fC", D.hasAirT ? D.airT : (D.tempCount > 0 ? D.temps[0] : 0));
    u8g2Fonts.setCursor(lx + 15, y + 8);
    u8g2Fonts.print(buf);
    lx += 95;

    // RH legend
    display.fillRect(lx, y + 2, 12, 3, BLACK);
    u8g2Fonts.setForegroundColor(BLACK);
    snprintf(buf, sizeof(buf), "RH %.0f%%", D.hasRH2 ? D.rh2 : D.rh);
    u8g2Fonts.setCursor(lx + 15, y + 8);
    u8g2Fonts.print(buf);
    lx += 75;

    // VPD legend
    if (D.hasVPD) {
      display.fillRect(lx, y + 2, 12, 3, YELLOW);
      u8g2Fonts.setForegroundColor(YELLOW);
      snprintf(buf, sizeof(buf), "VPD %.2f", D.vpd);
      u8g2Fonts.setCursor(lx + 15, y + 8);
      u8g2Fonts.print(buf);
    }

    // ===== BOTTOM INFO ROW (256-274) =====
    y = 258;
    u8g2Fonts.setFont(u8g2_font_helvR08_tr);
    u8g2Fonts.setForegroundColor(BLACK);

    // All temperature sensors in a compact row
    int ix = 6;
    for (int i = 0; i < D.tempCount; i++) {
      snprintf(buf, sizeof(buf), "%s:%.1f", D.tempLocs[i].c_str(), D.temps[i]);
      u8g2Fonts.setCursor(ix, y + 10);
      u8g2Fonts.print(buf);
      ix += u8g2Fonts.getUTF8Width(buf) + 10;
    }
    if (D.hasAirT) {
      snprintf(buf, sizeof(buf), "air:%.1f", D.airT);
      u8g2Fonts.setCursor(ix, y + 10);
      u8g2Fonts.print(buf);
      ix += u8g2Fonts.getUTF8Width(buf) + 10;
    }

    // Light + second humidity on the right
    if (D.hasLux) {
      snprintf(buf, sizeof(buf), "%dlux", D.lux);
      tRight(W - 6, y + 10, buf);
    }

    // ===== FOOTER (280-298) =====
    y = 282;
    display.drawFastHLine(6, y, W - 12, BLACK);
    u8g2Fonts.setFont(u8g2_font_helvR08_tr);
    u8g2Fonts.setForegroundColor(BLACK);

    if (D.timestamp.length() > 16) {
      String ts = D.timestamp.substring(8, 10) + "." +
                  D.timestamp.substring(5, 7) + " " +
                  D.timestamp.substring(11, 16);
      u8g2Fonts.setCursor(6, y + 14);
      u8g2Fonts.print(ts.c_str());
    }

    tCenter(W / 2, y + 14, "24h");

    int batRaw = analogRead(9);
    float batV = batRaw * 2.0f * 3.3f / 4095.0f;
    if (batV > 1.0f) {
      snprintf(buf, sizeof(buf), "%.1fV", batV);
      tRight(W - 6, y + 14, buf);
    }

  } while (display.nextPage());
}

void drawError(const char* msg) {
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(WHITE);
    u8g2Fonts.setFontMode(1); u8g2Fonts.setFontDirection(0);
    u8g2Fonts.setFont(u8g2_font_helvB14_tr);
    u8g2Fonts.setForegroundColor(RED);
    u8g2Fonts.setBackgroundColor(WHITE);
    tCenter(W/2, H/2 - 10, "ERROR");
    u8g2Fonts.setFont(u8g2_font_helvR10_tr);
    u8g2Fonts.setForegroundColor(BLACK);
    tCenter(W/2, H/2 + 15, msg);
  } while (display.nextPage());
}

void goToSleep() {
  digitalWrite(EPD_POWER, LOW);
  WiFi.disconnect(true); WiFi.mode(WIFI_OFF);
  esp_sleep_enable_timer_wakeup((uint64_t)SLEEP_MINUTES * 60ULL * 1000000ULL);
  Serial.printf("Sleep %dmin\n", SLEEP_MINUTES);
  Serial.flush();
  esp_deep_sleep_start();
}

void setup() {
  Serial.begin(115200); delay(100);
  Serial.println("\n=== ESPink-42 v3 ===");

  pinMode(EPD_POWER, OUTPUT);
  digitalWrite(EPD_POWER, HIGH);
  delay(50);

  SPI.begin(EPD_SCK, EPD_MISO, EPD_MOSI, SS);
  display.init(115200, true, 50, false);
  display.setRotation(0);
  display.setTextWrap(false);
  u8g2Fonts.begin(display);

  if (!connectWiFi()) { drawError("WiFi failed"); goToSleep(); return; }
  Serial.printf("WiFi OK %s\n", WiFi.localIP().toString().c_str());

  if (!fetchData()) { drawError("API failed"); goToSleep(); return; }
  Serial.printf("Data OK, %d hist pts\n", D.histCount);

  drawDisplay();
  display.hibernate();
  goToSleep();
}

void loop() {}
