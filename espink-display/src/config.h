#pragma once

// ===== WiFi =====
#define WIFI_SSID     "YOUR_WIFI_SSID"
#define WIFI_PASS     "YOUR_WIFI_PASSWORD"

// ===== API =====
#define API_HOST      "clodv4-production.up.railway.app"
#define API_PATH      "/api/sensor-data/display/zone-1"
#define API_KEY       "YOUR_SENSOR_API_KEY"

// ===== Timing =====
#define SLEEP_MINUTES 5          // Deep sleep between refreshes
#define WIFI_TIMEOUT  15000      // ms to wait for WiFi

// ===== ESPink-42 V3 (ESP32-S3) pinout =====
#define EPD_DC    48
#define EPD_RST   45
#define EPD_BUSY  38
#define EPD_POWER 47    // GPIO47 controls display power regulator
#define EPD_SCK   12
#define EPD_MOSI  11
#define EPD_MISO  13
// CS uses default SS = GPIO 10
