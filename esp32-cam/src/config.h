#pragma once

// WiFi
#define WIFI_SSID     "gigacube-2754DD"
#define WIFI_PASS     "2rBTjt4gm532yr47"

// API — through local Pi proxy (HTTP, no SSL)
#define API_HOST      "192.168.0.210"
#define API_PORT      8080
#define API_PATH      "/camera"
#define API_KEY       "truegrow-sensor-key-2026"
#define ZONE_ID       "zone-1"

// Timing
#define PHOTOS_PER_DAY  4                          // 4 photos = every 6 hours
#define SLEEP_SECONDS   (24 * 3600 / PHOTOS_PER_DAY)  // 21600 = 6h

// Camera
#define FRAMESIZE     FRAMESIZE_UXGA   // 1600x1200
#define JPEG_QUALITY  12               // 0-63, lower = better quality

// Flash LED
#define FLASH_PIN     4
#define FLASH_ON      true             // Use flash for photos
