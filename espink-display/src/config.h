#pragma once

// ===== WiFi =====
#define WIFI_SSID     "gigacube-2754DD"
#define WIFI_PASS     "2rBTjt4gm532yr47"

// ===== API =====
// Go through main Pi proxy (HTTP, no SSL needed)
#define API_HOST      "192.168.0.210"
#define API_PORT      8080
#define API_PATH      "/display"
#define API_KEY       "truegrow-sensor-key-2026"

// ===== Timing =====
#define SLEEP_MINUTES 5          // Deep sleep between refreshes
#define NIGHT_SLEEP_HOUR_START 19 // Hour to start long sleep (19:00)
#define NIGHT_SLEEP_HOUR_END   8  // Hour to wake up (08:00)
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
