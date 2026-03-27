#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "esp_camera.h"
#include "config.h"

// AI-Thinker ESP32-CAM pin definitions
#define PWDN_GPIO     32
#define RESET_GPIO    -1
#define XCLK_GPIO     0
#define SIOD_GPIO     26
#define SIOC_GPIO     27
#define Y9_GPIO       35
#define Y8_GPIO       34
#define Y7_GPIO       39
#define Y6_GPIO       36
#define Y5_GPIO       21
#define Y4_GPIO       19
#define Y3_GPIO       18
#define Y2_GPIO       5
#define VSYNC_GPIO    25
#define HREF_GPIO     23
#define PCLK_GPIO     22

bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO;
  config.pin_d1 = Y3_GPIO;
  config.pin_d2 = Y4_GPIO;
  config.pin_d3 = Y5_GPIO;
  config.pin_d4 = Y6_GPIO;
  config.pin_d5 = Y7_GPIO;
  config.pin_d6 = Y8_GPIO;
  config.pin_d7 = Y9_GPIO;
  config.pin_xclk = XCLK_GPIO;
  config.pin_pclk = PCLK_GPIO;
  config.pin_vsync = VSYNC_GPIO;
  config.pin_href = HREF_GPIO;
  config.pin_sccb_sda = SIOD_GPIO;
  config.pin_sccb_scl = SIOC_GPIO;
  config.pin_pwdn = PWDN_GPIO;
  config.pin_reset = RESET_GPIO;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_LATEST;

  // Use PSRAM for high resolution
  if (psramFound()) {
    config.frame_size = FRAMESIZE;
    config.jpeg_quality = JPEG_QUALITY;
    config.fb_count = 2;
    config.fb_location = CAMERA_FB_IN_PSRAM;
    Serial.println("PSRAM found, high-res mode");
  } else {
    config.frame_size = FRAMESIZE_SVGA;
    config.jpeg_quality = 16;
    config.fb_count = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
    Serial.println("No PSRAM, low-res mode");
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return false;
  }

  // Adjust sensor settings for better plant photos
  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    s->set_brightness(s, 1);      // slightly brighter
    s->set_saturation(s, 1);      // slightly more vivid
    s->set_whitebal(s, 1);        // auto white balance
    s->set_awb_gain(s, 1);
    s->set_exposure_ctrl(s, 1);   // auto exposure
    s->set_aec2(s, 1);            // AEC DSP
    s->set_gain_ctrl(s, 1);       // auto gain
  }

  return true;
}

bool connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(250);
  }
  return WiFi.status() == WL_CONNECTED;
}

camera_fb_t* takePhoto() {
  // Flash on
  if (FLASH_ON) {
    pinMode(FLASH_PIN, OUTPUT);
    digitalWrite(FLASH_PIN, HIGH);
    delay(200);  // Let the flash stabilize + auto-exposure adjust
  }

  // Throw away first frame (often has bad exposure)
  camera_fb_t* fb = esp_camera_fb_get();
  if (fb) esp_camera_fb_return(fb);
  delay(200);

  // Take actual photo
  fb = esp_camera_fb_get();

  // Flash off
  if (FLASH_ON) {
    digitalWrite(FLASH_PIN, LOW);
  }

  return fb;
}

bool uploadPhoto(camera_fb_t* fb) {
  if (!fb || fb->len == 0) return false;

  HTTPClient http;
  String url = String("http://") + API_HOST + ":" + String(API_PORT) + API_PATH;

  http.begin(url);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-API-KEY", API_KEY);
  http.addHeader("X-Zone-ID", ZONE_ID);
  http.setTimeout(30000);  // 30s for large photos

  Serial.printf("Uploading %d bytes...\n", fb->len);
  int code = http.POST(fb->buf, fb->len);
  String resp = http.getString();
  http.end();

  Serial.printf("Upload response: %d %s\n", code, resp.c_str());
  return code == 201 || code == 200;
}

void goToSleep() {
  esp_camera_deinit();
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);

  // Turn off flash LED
  pinMode(FLASH_PIN, OUTPUT);
  digitalWrite(FLASH_PIN, LOW);

  esp_sleep_enable_timer_wakeup((uint64_t)SLEEP_SECONDS * 1000000ULL);
  Serial.printf("Sleeping for %d seconds (%d hours)...\n", SLEEP_SECONDS, SLEEP_SECONDS / 3600);
  Serial.flush();
  esp_deep_sleep_start();
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== ESP32-CAM Timelapse ===");

  // Init camera
  Serial.print("Camera init...");
  if (!initCamera()) {
    Serial.println("FAILED");
    goToSleep();
    return;
  }
  Serial.println("OK");

  // Connect WiFi
  Serial.print("WiFi...");
  if (!connectWiFi()) {
    Serial.println("FAILED");
    goToSleep();
    return;
  }
  Serial.printf("OK %s\n", WiFi.localIP().toString().c_str());

  // Take photo
  Serial.print("Photo...");
  camera_fb_t* photo = takePhoto();
  if (!photo) {
    Serial.println("FAILED");
    goToSleep();
    return;
  }
  Serial.printf("OK %dx%d %d bytes\n", photo->width, photo->height, photo->len);

  // Upload
  bool ok = false;
  for (int i = 0; i < 3; i++) {
    Serial.printf("Upload attempt %d...", i + 1);
    if (uploadPhoto(photo)) {
      ok = true;
      Serial.println("OK");
      break;
    }
    Serial.println("FAIL");
    delay(2000);
  }

  esp_camera_fb_return(photo);

  if (!ok) {
    Serial.println("All upload attempts failed");
  }

  goToSleep();
}

void loop() {
  // Never reached
}
