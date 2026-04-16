#!/usr/bin/env python3
"""
Timelapse camera capture for Tapo C110.
Saves one snapshot per hour to /home/stepan/timelapse/vega/YYYY-MM-DD/HH-MM.jpg
and uploads full + medium + thumb variants to Cloudflare R2.
"""

import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

CAMERA_RTSP = "rtsp://Vegavega:Tratata003@192.168.0.224:554/stream1"
OUTPUT_BASE = Path("/home/stepan/timelapse/vega")
ZONE = "vega"


def take_snapshot():
    now = datetime.now()
    day_dir = OUTPUT_BASE / now.strftime("%Y-%m-%d")
    day_dir.mkdir(parents=True, exist_ok=True)
    path = day_dir / now.strftime("%H-%M.jpg")

    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-rtsp_transport", "tcp",
                "-i", CAMERA_RTSP,
                "-frames:v", "1",
                "-update", "1",
                "-q:v", "2",  # high quality
                str(path),
            ],
            capture_output=True,
            timeout=30,
        )
        if result.returncode == 0 and path.exists():
            size_kb = path.stat().st_size / 1024
            print(f"[{now:%Y-%m-%d %H:%M}] Saved {path.name} ({size_kb:.0f} KB)")
        else:
            err = result.stderr.decode("utf-8", errors="replace")[-300:]
            print(f"[{now:%Y-%m-%d %H:%M}] ffmpeg failed: {err}")
            return False
    except subprocess.TimeoutExpired:
        print(f"[{now:%Y-%m-%d %H:%M}] timeout")
        return False
    except Exception as e:
        print(f"[{now:%Y-%m-%d %H:%M}] error: {e}")
        return False

    # Upload to R2 (non-fatal if fails — photo already on disk)
    try:
        from r2_uploader import upload_photo_variants
        date = now.strftime("%Y-%m-%d")
        name = now.strftime("%H-%M")
        urls = upload_photo_variants(path, ZONE, date, name)
        if urls and urls.get("full"):
            print(f"R2 uploaded: {urls['full']}")
        else:
            print("R2 upload partial/failed (photo still on disk)")
    except Exception as e:
        print(f"R2 upload error: {e} (photo still on disk)")

    return True


if __name__ == "__main__":
    sys.exit(0 if take_snapshot() else 1)
