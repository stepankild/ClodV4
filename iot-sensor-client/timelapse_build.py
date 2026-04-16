#!/usr/bin/env python3
"""
Build timelapse video from the last N days of snapshots and send to Telegram.
"""

import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
import requests

DAYS_BACK = 3  # include last 3 days of snapshots
FPS = 10  # 10 frames per second (at 1 frame/hour -> 1 sec of video = 10 hours)

INPUT_BASE = Path("/home/stepan/timelapse/vega")
OUTPUT_DIR = Path("/home/stepan/timelapse/videos")

TELEGRAM_BOT_TOKEN = "8688017942:AAGYuTi4q1b97kUjpls44ASra2Byr6DRXy0"
TELEGRAM_CHAT_ID = "-1003862011656"  # TrueGrow Alerts


def collect_snapshots():
    """Return list of snapshot paths from last DAYS_BACK days, sorted by time."""
    now = datetime.now()
    snapshots = []
    for i in range(DAYS_BACK - 1, -1, -1):
        day = now - timedelta(days=i)
        day_dir = INPUT_BASE / day.strftime("%Y-%m-%d")
        if not day_dir.exists():
            continue
        for f in sorted(day_dir.glob("*.jpg")):
            snapshots.append(f)
    return snapshots


def build_video(snapshots, output_path):
    """Concatenate snapshots into mp4 via ffmpeg concat demuxer."""
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        list_file = f.name
        for s in snapshots:
            # ffmpeg concat demuxer: one file per frame, duration controls speed
            f.write(f"file '{s}'\n")
            f.write(f"duration {1.0 / FPS}\n")
        # last file must be listed twice (ffmpeg concat quirk)
        if snapshots:
            f.write(f"file '{snapshots[-1]}'\n")

    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", list_file,
                "-vf", "scale=1280:-2,fps=" + str(FPS),
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",
                str(output_path),
            ],
            capture_output=True,
            timeout=600,
        )
        if result.returncode != 0:
            print("ffmpeg error:")
            print(result.stderr.decode("utf-8", errors="replace")[-1000:])
            return False
        return True
    finally:
        os.unlink(list_file)


def send_to_telegram(video_path, caption):
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendVideo"
    with open(video_path, "rb") as video:
        resp = requests.post(
            url,
            data={"chat_id": TELEGRAM_CHAT_ID, "caption": caption, "supports_streaming": "true"},
            files={"video": video},
            timeout=180,
        )
    if resp.ok:
        print(f"Telegram OK ({video_path.stat().st_size / 1024 / 1024:.1f} MB)")
        return True
    print(f"Telegram error {resp.status_code}: {resp.text[:300]}")
    return False


def main():
    snapshots = collect_snapshots()
    print(f"Found {len(snapshots)} snapshots over last {DAYS_BACK} days")
    if len(snapshots) < 5:
        print("Not enough snapshots, skipping")
        return 0

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d")
    out = OUTPUT_DIR / f"timelapse-vega-{stamp}.mp4"
    print(f"Building {out}...")

    if not build_video(snapshots, out):
        return 1

    caption = f"🌱 Timelapse Вегетация\n{DAYS_BACK} дня, {len(snapshots)} кадров"
    send_to_telegram(out, caption)

    # Keep only last 10 videos on disk
    videos = sorted(OUTPUT_DIR.glob("timelapse-vega-*.mp4"))
    for old in videos[:-10]:
        old.unlink()
        print(f"Deleted old: {old.name}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
