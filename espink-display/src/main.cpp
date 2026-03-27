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

#define BLACK   GxEPD_BLACK
#define WHITE   GxEPD_WHITE
#define RED     GxEPD_RED
#define YELLOW  GxEPD_YELLOW

#define W 400
#define H 300
#define MAX_HIST 40

// ===== Data =====
struct DisplayData {
  String zoneName;
  bool online;
  String timestamp;
  float temps[4];
  String tempLocs[4];
  int tempCount;
  float airT, rh, rh2, vpd;
  int co2, lux;
  float photoDay, photoNight;
  bool hasAirT, hasRH, hasRH2, hasCO2, hasLux, hasVPD, hasPhoto;
  // Sparkline history
  float histT[MAX_HIST], histRH[MAX_HIST], histCO2[MAX_HIST];
  float histVPD[MAX_HIST];
  int histCount;
};

DisplayData data;

// ===== WiFi =====
bool connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_TIMEOUT) {
    delay(250);
  }
  return WiFi.status() == WL_CONNECTED;
}

// ===== VPD calculation =====
float calcVPD(float leafT, float airT, float rh) {
  if (leafT < -40 || airT < -40 || rh < 0) return -1;
  float svpL = 0.6108f * expf(17.27f * leafT / (leafT + 237.3f));
  float svpA = 0.6108f * expf(17.27f * airT / (airT + 237.3f));
  float v = svpL - svpA * rh / 100.0f;
  return v > 0 ? v : 0;
}

// ===== Fetch data =====
bool fetchData() {
  WiFiClientSecure client;
  client.setInsecure();
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
  if (deserializeJson(doc, payload)) return false;

  data.zoneName = doc["zone"].as<String>();
  data.online = doc["online"] | false;
  data.timestamp = doc["ts"].as<String>();

  data.tempCount = 0;
  for (JsonObject t : doc["temps"].as<JsonArray>()) {
    if (data.tempCount >= 4) break;
    data.temps[data.tempCount] = t["v"];
    data.tempLocs[data.tempCount] = t["loc"].as<String>();
    data.tempCount++;
  }

  data.hasAirT = !doc["airT"].isNull(); data.airT = doc["airT"] | 0.0f;
  data.hasRH = !doc["rh"].isNull(); data.rh = doc["rh"] | 0.0f;
  data.hasRH2 = !doc["rh2"].isNull(); data.rh2 = doc["rh2"] | 0.0f;
  data.hasCO2 = !doc["co2"].isNull(); data.co2 = doc["co2"] | 0;
  data.hasLux = !doc["lux"].isNull(); data.lux = doc["lux"] | 0;
  data.hasVPD = !doc["vpd"].isNull(); data.vpd = doc["vpd"] | 0.0f;
  data.hasPhoto = !doc["photo"].isNull();
  if (data.hasPhoto) {
    data.photoDay = doc["photo"]["day"] | 0.0f;
    data.photoNight = doc["photo"]["night"] | 0.0f;
  }

  // Parse sparkline history
  JsonArray hist = doc["hist"];
  JsonArray canopyH = doc["canopyHist"];
  data.histCount = 0;
  int i = 0;
  for (JsonObject h : hist) {
    if (i >= MAX_HIST) break;
    data.histT[i] = h["t"] | -999.0f;
    data.histRH[i] = h["rh"] | -999.0f;
    data.histCO2[i] = h["co2"] | -999.0f;
    // VPD from canopy + airT + rh
    float ct = (i < (int)canopyH.size()) ? canopyH[i].as<float>() : -999.0f;
    float at = data.histT[i];
    float rh = data.histRH[i];
    if (ct > -40 && at > -40 && rh >= 0) {
      data.histVPD[i] = calcVPD(ct, at, rh);
    } else {
      data.histVPD[i] = -999.0f;
    }
    i++;
  }
  data.histCount = i;

  return true;
}

// ===== Drawing helpers =====
void textCenter(int16_t x, int16_t y, const char* text) {
  int16_t tw = u8g2Fonts.getUTF8Width(text);
  u8g2Fonts.setCursor(x - tw / 2, y);
  u8g2Fonts.print(text);
}

void textRight(int16_t x, int16_t y, const char* text) {
  int16_t tw = u8g2Fonts.getUTF8Width(text);
  u8g2Fonts.setCursor(x - tw, y);
  u8g2Fonts.print(text);
}

// Draw sparkline chart
void drawSparkline(int16_t x, int16_t y, int16_t w, int16_t h,
                   float* vals, int count, uint16_t color,
                   const char* label, const char* unit, float current) {
  if (count < 2) return;

  // Find min/max (skip invalid)
  float vmin = 99999, vmax = -99999;
  for (int i = 0; i < count; i++) {
    if (vals[i] < -900) continue;
    if (vals[i] < vmin) vmin = vals[i];
    if (vals[i] > vmax) vmax = vals[i];
  }
  if (vmin >= vmax) { vmin -= 1; vmax += 1; }

  float range = vmax - vmin;
  float padding = range * 0.1f;
  vmin -= padding;
  vmax += padding;
  range = vmax - vmin;

  // Chart area
  int16_t chartX = x + 45;  // space for label
  int16_t chartW = w - 45;
  int16_t chartH = h - 2;

  // Draw baseline
  display.drawFastHLine(chartX, y + h - 1, chartW, BLACK);

  // Draw data line
  int prevPx = -1, prevPy = -1;
  for (int i = 0; i < count; i++) {
    if (vals[i] < -900) { prevPx = -1; continue; }
    int px = chartX + (i * chartW) / (count - 1);
    int py = y + h - 1 - (int)((vals[i] - vmin) / range * chartH);
    py = constrain(py, y, y + h - 1);

    if (prevPx >= 0) {
      display.drawLine(prevPx, prevPy, px, py, color);
      // Thicken line
      display.drawLine(prevPx, prevPy + 1, px, py + 1, color);
    }
    prevPx = px;
    prevPy = py;
  }

  // Label + current value
  u8g2Fonts.setFont(u8g2_font_helvB08_tr);
  u8g2Fonts.setForegroundColor(color);
  u8g2Fonts.setCursor(x, y + 10);
  u8g2Fonts.print(label);

  u8g2Fonts.setFont(u8g2_font_helvR08_tr);
  u8g2Fonts.setForegroundColor(BLACK);
  char buf[16];
  if (strcmp(unit, " ppm") == 0) {
    snprintf(buf, sizeof(buf), "%d%s", (int)current, unit);
  } else {
    snprintf(buf, sizeof(buf), "%.1f%s", current, unit);
  }
  u8g2Fonts.setCursor(x, y + 22);
  u8g2Fonts.print(buf);

  // Min/max labels
  u8g2Fonts.setFont(u8g2_font_micro_tr);
  u8g2Fonts.setForegroundColor(BLACK);
  char minBuf[8], maxBuf[8];
  if (range > 50) {
    snprintf(maxBuf, sizeof(maxBuf), "%d", (int)vmax);
    snprintf(minBuf, sizeof(minBuf), "%d", (int)vmin);
  } else {
    snprintf(maxBuf, sizeof(maxBuf), "%.1f", vmax);
    snprintf(minBuf, sizeof(minBuf), "%.1f", vmin);
  }
  textRight(chartX - 2, y + 6, maxBuf);
  textRight(chartX - 2, y + h, minBuf);
}

// ===== Main display =====
// Layout 400x300:
// [0-30]    Header: zone name + status
// [32-72]   Temperature cards (3-4 columns)
// [74-110]  Metrics: RH, CO2, VPD, Photo bar
// [114-178] Chart: Temperature sparkline
// [180-234] Chart: Humidity sparkline
// [236-290] Chart: VPD sparkline
// [292-300] Footer: timestamp + battery

void drawDisplay() {
  display.setFullWindow();
  display.firstPage();

  do {
    display.fillScreen(WHITE);
    u8g2Fonts.setFontMode(1);
    u8g2Fonts.setFontDirection(0);

    // ===== HEADER =====
    display.fillRect(0, 0, W, 28, BLACK);
    u8g2Fonts.setFont(u8g2_font_helvB12_tr);
    u8g2Fonts.setForegroundColor(WHITE);
    u8g2Fonts.setBackgroundColor(BLACK);
    u8g2Fonts.setCursor(8, 20);
    u8g2Fonts.print(data.zoneName.c_str());

    // Status dot
    display.fillCircle(W - 16, 14, 5, data.online ? WHITE : RED);

    // ===== TEMPERATURE CARDS =====
    int y = 32;
    u8g2Fonts.setBackgroundColor(WHITE);
    int cols = data.tempCount + (data.hasAirT ? 1 : 0);
    if (cols == 0) cols = 1;
    int cardW = (W - 16 - (cols - 1) * 4) / cols;
    int cx = 8;

    for (int i = 0; i < data.tempCount; i++) {
      display.drawRoundRect(cx, y, cardW, 40, 3, BLACK);

      u8g2Fonts.setFont(u8g2_font_helvR08_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      textCenter(cx + cardW / 2, y + 12, data.tempLocs[i].c_str());

      u8g2Fonts.setFont(u8g2_font_helvB14_tr);
      char buf[16];
      snprintf(buf, sizeof(buf), "%.1f`C", data.temps[i]);
      textCenter(cx + cardW / 2, y + 33, buf);

      cx += cardW + 4;
    }

    if (data.hasAirT) {
      display.drawRoundRect(cx, y, cardW, 40, 3, RED);

      u8g2Fonts.setFont(u8g2_font_helvR08_tr);
      u8g2Fonts.setForegroundColor(RED);
      textCenter(cx + cardW / 2, y + 12, "Ambient");

      u8g2Fonts.setFont(u8g2_font_helvB14_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      char buf[16];
      snprintf(buf, sizeof(buf), "%.1f`C", data.airT);
      textCenter(cx + cardW / 2, y + 33, buf);
    }

    // ===== METRICS ROW =====
    y = 76;
    cx = 8;
    int metricW = 95;

    // Humidity
    if (data.hasRH || data.hasRH2) {
      float showRH = data.hasRH2 ? data.rh2 : data.rh;
      u8g2Fonts.setFont(u8g2_font_helvR08_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      u8g2Fonts.setCursor(cx, y + 10);
      u8g2Fonts.print("RH");
      u8g2Fonts.setFont(u8g2_font_helvB14_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      char buf[16];
      snprintf(buf, sizeof(buf), "%.0f%%", showRH);
      u8g2Fonts.setCursor(cx, y + 30);
      u8g2Fonts.print(buf);
      cx += metricW;
    }

    // CO2
    if (data.hasCO2) {
      uint16_t co2c = data.co2 > 1500 ? RED : (data.co2 > 1000 ? YELLOW : BLACK);
      u8g2Fonts.setFont(u8g2_font_helvR08_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      u8g2Fonts.setCursor(cx, y + 10);
      u8g2Fonts.print("CO2");
      u8g2Fonts.setFont(u8g2_font_helvB14_tr);
      u8g2Fonts.setForegroundColor(co2c);
      char buf[16];
      snprintf(buf, sizeof(buf), "%d", data.co2);
      u8g2Fonts.setCursor(cx, y + 30);
      u8g2Fonts.print(buf);
      cx += metricW;
    }

    // VPD
    if (data.hasVPD) {
      uint16_t vc = data.vpd > 1.6f ? RED : (data.vpd > 1.2f ? YELLOW : BLACK);
      u8g2Fonts.setFont(u8g2_font_helvR08_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      u8g2Fonts.setCursor(cx, y + 10);
      u8g2Fonts.print("VPD");
      u8g2Fonts.setFont(u8g2_font_helvB14_tr);
      u8g2Fonts.setForegroundColor(vc);
      char buf[16];
      snprintf(buf, sizeof(buf), "%.2f", data.vpd);
      u8g2Fonts.setCursor(cx, y + 30);
      u8g2Fonts.print(buf);
      cx += metricW;
    }

    // Photoperiod mini bar
    if (data.hasPhoto) {
      u8g2Fonts.setFont(u8g2_font_helvR08_tr);
      u8g2Fonts.setForegroundColor(BLACK);
      u8g2Fonts.setCursor(cx, y + 10);
      char pbuf[16];
      snprintf(pbuf, sizeof(pbuf), "%.0f/%.0fh", data.photoDay, data.photoNight);
      u8g2Fonts.print(pbuf);

      int barW = W - cx - 8;
      int dayW = (int)(barW * data.photoDay / 24.0f);
      if (dayW > 0) display.fillRect(cx, y + 15, dayW, 10, YELLOW);
      if (dayW < barW) display.fillRect(cx + dayW, y + 15, barW - dayW, 10, BLACK);
    }

    // ===== SPARKLINE CHARTS =====
    y = 114;
    int chartH = 54;
    int chartGap = 4;

    // Temperature chart
    if (data.histCount > 1) {
      display.drawFastHLine(8, y - 2, W - 16, BLACK);
      float showT = data.hasAirT ? data.airT : (data.tempCount > 0 ? data.temps[0] : 0);
      drawSparkline(8, y, W - 16, chartH, data.histT, data.histCount,
                    RED, "Temp", "`C", showT);
    }

    // Humidity chart
    y += chartH + chartGap;
    if (data.histCount > 1) {
      float showRH = data.hasRH2 ? data.rh2 : data.rh;
      drawSparkline(8, y, W - 16, chartH, data.histRH, data.histCount,
                    BLACK, "RH", "%", showRH);
    }

    // VPD chart
    y += chartH + chartGap;
    bool hasVPDhist = false;
    for (int i = 0; i < data.histCount; i++) {
      if (data.histVPD[i] > -900) { hasVPDhist = true; break; }
    }
    if (hasVPDhist && data.hasVPD) {
      drawSparkline(8, y, W - 16, chartH, data.histVPD, data.histCount,
                    YELLOW, "VPD", " kPa", data.vpd);
    }

    // ===== FOOTER =====
    y = H - 16;
    display.drawFastHLine(8, y - 4, W - 16, BLACK);

    u8g2Fonts.setFont(u8g2_font_helvR08_tr);
    u8g2Fonts.setForegroundColor(BLACK);

    // Timestamp
    if (data.timestamp.length() > 16) {
      String ts = data.timestamp.substring(8, 10) + "." +
                  data.timestamp.substring(5, 7) + " " +
                  data.timestamp.substring(11, 16);
      u8g2Fonts.setCursor(8, y + 8);
      u8g2Fonts.print(ts.c_str());
    }

    // "6h" label for charts
    textCenter(W / 2, y + 8, "6h history");

    // Battery
    int batRaw = analogRead(9);
    float batV = batRaw * 2.0f * 3.3f / 4095.0f;
    if (batV > 1.0f) {
      char buf[16];
      snprintf(buf, sizeof(buf), "%.1fV", batV);
      textRight(W - 8, y + 8, buf);
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
    textCenter(W / 2, H / 2 - 10, "ERROR");
    u8g2Fonts.setFont(u8g2_font_helvR10_tr);
    u8g2Fonts.setForegroundColor(BLACK);
    textCenter(W / 2, H / 2 + 15, msg);
    u8g2Fonts.setFont(u8g2_font_helvR08_tr);
    char buf[32];
    snprintf(buf, sizeof(buf), "Retry in %d min", SLEEP_MINUTES);
    textCenter(W / 2, H / 2 + 35, buf);
  } while (display.nextPage());
}

// ===== Deep sleep =====
void goToSleep() {
  digitalWrite(EPD_POWER, LOW);
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  esp_sleep_enable_timer_wakeup((uint64_t)SLEEP_MINUTES * 60ULL * 1000000ULL);
  Serial.printf("Sleep %d min...\n", SLEEP_MINUTES);
  Serial.flush();
  esp_deep_sleep_start();
}

// ===== Setup =====
void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n=== ESPink-42 Zone Display ===");

  pinMode(EPD_POWER, OUTPUT);
  digitalWrite(EPD_POWER, HIGH);
  delay(50);

  SPI.begin(EPD_SCK, EPD_MISO, EPD_MOSI, SS);
  display.init(115200, true, 50, false);
  display.setRotation(0);
  display.setTextWrap(false);
  u8g2Fonts.begin(display);

  Serial.print("WiFi...");
  if (!connectWiFi()) {
    Serial.println(" FAIL");
    drawError("WiFi failed");
    goToSleep();
    return;
  }
  Serial.printf(" OK %s\n", WiFi.localIP().toString().c_str());

  Serial.print("API...");
  if (!fetchData()) {
    Serial.println(" FAIL");
    drawError("API failed");
    goToSleep();
    return;
  }
  Serial.printf(" OK (%d hist pts)\n", data.histCount);

  Serial.print("Draw...");
  display.clearScreen();
  delay(100);
  drawDisplay();
  Serial.println(" OK");

  display.hibernate();
  goToSleep();
}

void loop() {}
