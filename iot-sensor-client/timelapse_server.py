#!/usr/bin/env python3
"""
Timelapse HTTP server on Pi.
Exposes /home/stepan/timelapse/ over HTTP with API key auth.
Endpoints:
  GET /photos?zone=vega[&date=YYYY-MM-DD]  — list available photos (JSON)
  GET /photo/<zone>/<YYYY-MM-DD>/<HH-MM>.jpg — serve one photo
  GET /video/<zone>/month — build/serve last-30-days timelapse video (cached)
"""

import http.server
import json
import os
import socketserver
import subprocess
import tempfile
import threading
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path

PORT = 8090
API_KEY = "truegrow-sensor-key-2026"
BASE_DIR = Path("/home/stepan/timelapse")
VIDEO_CACHE_DIR = BASE_DIR / "videos_cache"

_video_lock = threading.Lock()


def ok_auth(headers, query):
    k = headers.get("X-API-Key") or query.get("key", [None])[0]
    return k == API_KEY


def list_photos(zone, date=None):
    zone_dir = BASE_DIR / zone
    if not zone_dir.exists():
        return []
    days = sorted(zone_dir.iterdir(), reverse=True)
    out = []
    for d in days:
        if not d.is_dir():
            continue
        if date and d.name != date:
            continue
        photos = sorted(d.glob("*.jpg"))
        out.append({
            "date": d.name,
            "count": len(photos),
            "photos": [p.name.replace(".jpg", "") for p in photos],
        })
    return out


def build_month_video(zone):
    """Build timelapse video from last 30 days. Cache if recent (<6h)."""
    VIDEO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached = VIDEO_CACHE_DIR / f"{zone}-month.mp4"

    # Use cached video if less than 6 hours old
    if cached.exists():
        age_s = (datetime.now().timestamp() - cached.stat().st_mtime)
        if age_s < 6 * 3600:
            return cached

    with _video_lock:
        # Re-check after lock
        if cached.exists():
            age_s = (datetime.now().timestamp() - cached.stat().st_mtime)
            if age_s < 6 * 3600:
                return cached

        snapshots = []
        now = datetime.now()
        zone_dir = BASE_DIR / zone
        for i in range(29, -1, -1):
            day = now - timedelta(days=i)
            day_dir = zone_dir / day.strftime("%Y-%m-%d")
            if day_dir.exists():
                snapshots.extend(sorted(day_dir.glob("*.jpg")))

        if len(snapshots) < 5:
            return None

        fps = 15
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
            list_file = f.name
            for s in snapshots:
                f.write(f"file '{s}'\n")
                f.write(f"duration {1.0 / fps}\n")
            f.write(f"file '{snapshots[-1]}'\n")

        try:
            r = subprocess.run(
                ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_file,
                 "-vf", f"scale=1280:-2,fps={fps}",
                 "-c:v", "libx264", "-preset", "fast", "-crf", "25",
                 "-pix_fmt", "yuv420p", str(cached)],
                capture_output=True, timeout=900,
            )
            if r.returncode != 0:
                print("ffmpeg error:", r.stderr.decode("utf-8", "replace")[-500:])
                return None
            return cached
        finally:
            os.unlink(list_file)


class Handler(http.server.SimpleHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "X-API-Key, Authorization")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path, content_type):
        try:
            size = path.stat().st_size
            with path.open("rb") as f:
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(size))
                self.send_header("Cache-Control", "public, max-age=3600")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                while True:
                    buf = f.read(64 * 1024)
                    if not buf:
                        break
                    self.wfile.write(buf)
        except Exception as e:
            print(f"send_file error: {e}")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "X-API-Key, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path
        query = urllib.parse.parse_qs(url.query)

        if not ok_auth(self.headers, query):
            self._send_json(401, {"error": "unauthorized"})
            return

        try:
            # /photos?zone=vega[&date=...]
            if path == "/photos":
                zone = query.get("zone", ["vega"])[0]
                date = query.get("date", [None])[0]
                return self._send_json(200, {"days": list_photos(zone, date)})

            # /photo/<zone>/<date>/<time>.jpg
            if path.startswith("/photo/"):
                parts = path[len("/photo/"):].split("/")
                if len(parts) != 3 or not parts[2].endswith(".jpg"):
                    return self._send_json(404, {"error": "not found"})
                zone, date, name = parts
                # Safety: only allow pattern YYYY-MM-DD and HH-MM.jpg
                if len(date) != 10 or len(name) > 16:
                    return self._send_json(400, {"error": "bad path"})
                p = BASE_DIR / zone / date / name
                if not p.is_file() or BASE_DIR not in p.resolve().parents:
                    return self._send_json(404, {"error": "not found"})
                return self._send_file(p, "image/jpeg")

            # /video/<zone>/month
            if path.startswith("/video/") and path.endswith("/month"):
                zone = path[len("/video/"):-len("/month")]
                v = build_month_video(zone)
                if not v or not v.exists():
                    return self._send_json(500, {"error": "video build failed"})
                return self._send_file(v, "video/mp4")

            self._send_json(404, {"error": "not found"})
        except Exception as e:
            print(f"handler error: {e}")
            self._send_json(500, {"error": str(e)})


if __name__ == "__main__":
    os.chdir(str(BASE_DIR))
    with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), Handler) as httpd:
        httpd.allow_reuse_address = True
        print(f"Timelapse server on :{PORT}, base={BASE_DIR}")
        httpd.serve_forever()
