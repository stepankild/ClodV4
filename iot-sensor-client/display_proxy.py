#!/usr/bin/env python3
"""HTTP proxy for ESPink display + ESP32-CAM.
ESP32 devices can't do HTTPS on weak WiFi (mobile hotspot),
so they hit this local proxy over HTTP, and we forward to Railway over HTTPS.
"""
import http.server
import urllib.request
import ssl
import json
import os

REMOTE_BASE = "https://clodv4-production.up.railway.app"
API_KEY = os.environ.get("SENSOR_API_KEY", "truegrow-sensor-key-2026")
PORT = 8080

class ProxyHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/display":
            self._proxy_get(f"{REMOTE_BASE}/api/sensor-data/display/zone-1")
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/camera":
            self._proxy_camera()
        else:
            self.send_response(404)
            self.end_headers()

    def _proxy_get(self, url):
        try:
            req = urllib.request.Request(url)
            req.add_header("X-API-KEY", API_KEY)
            ctx = ssl.create_default_context()
            with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
                data = resp.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_response(502)
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def _proxy_camera(self):
        """Forward JPEG upload from ESP32-CAM to Railway API."""
        try:
            content_len = int(self.headers.get('Content-Length', 0))
            zone_id = self.headers.get('X-Zone-ID', 'zone-1')
            body = self.rfile.read(content_len)

            print(f"[camera] Received {content_len} bytes from zone {zone_id}")

            url = f"{REMOTE_BASE}/api/camera/upload?zoneId={zone_id}"
            req = urllib.request.Request(url, data=body, method='POST')
            req.add_header("Content-Type", "image/jpeg")
            req.add_header("X-API-KEY", API_KEY)
            ctx = ssl.create_default_context()

            with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
                data = resp.read()

            self.send_response(201)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data)
            print(f"[camera] Upload OK: {data.decode()}")
        except Exception as e:
            print(f"[camera] Upload FAILED: {e}")
            self.send_response(502)
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def log_message(self, format, *args):
        print(f"[proxy] {args[0]}")

if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", PORT), ProxyHandler)
    print(f"Proxy running on port {PORT}")
    print(f"Remote: {REMOTE_BASE}")
    print(f"Endpoints: GET /display, POST /camera")
    server.serve_forever()
