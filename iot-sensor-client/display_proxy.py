#!/usr/bin/env python3
"""Simple HTTP proxy for ESPink display.
ESP32 can't do HTTPS on weak WiFi, so it hits this local proxy over HTTP,
and we forward the request to Railway over HTTPS.
"""
import http.server
import urllib.request
import ssl
import json
import os

REMOTE_URL = "https://clodv4-production.up.railway.app/api/sensor-data/display/zone-1"
API_KEY = os.environ.get("SENSOR_API_KEY", "truegrow-sensor-key-2026")
PORT = 8080

class ProxyHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/display":
            self.send_response(404)
            self.end_headers()
            return

        try:
            req = urllib.request.Request(REMOTE_URL)
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

    def log_message(self, format, *args):
        print(f"[proxy] {args[0]}")

if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", PORT), ProxyHandler)
    print(f"Display proxy running on port {PORT}")
    print(f"Remote: {REMOTE_URL}")
    server.serve_forever()
