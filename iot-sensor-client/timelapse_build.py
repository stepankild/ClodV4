#!/usr/bin/env python3
"""
Build timelapse video from last N days of snapshots.
Uploads to Cloudflare R2 at <zone>/videos/<N>d.mp4 and (optionally) sends to Telegram.

Usage:
    python3 timelapse_build.py [--zone vega] [--days 3] [--telegram]
    python3 timelapse_build.py --all   # rebuild 3d, 7d, 14d, 30d presets
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from r2_uploader import get_client, R2_BUCKET, R2_PUBLIC_URL

FPS = 10  # 1 sec of video = 10 hours real time (at 1 frame/hour)

INPUT_BASE_ROOT = Path("/home/stepan/timelapse")
OUTPUT_DIR = Path("/home/stepan/timelapse/videos")

TELEGRAM_BOT_TOKEN = "8688017942:AAGYuTi4q1b97kUjpls44ASra2Byr6DRXy0"
TELEGRAM_CHAT_ID = "-1003862011656"  # TrueGrow Alerts

PRESET_DAYS = [3, 7, 14, 30]
LOCAL_RETENTION_DAYS = 90   # keep 90 days of photos on Pi (R2 has them forever)
R2_RETENTION_DAYS = 365     # keep 1 year of photos on R2


def collect_snapshots(zone: str, days: int):
    """Return list of snapshot paths from last N days, sorted chronologically."""
    base = INPUT_BASE_ROOT / zone
    now = datetime.now()
    snapshots = []
    for i in range(days - 1, -1, -1):
        day = now - timedelta(days=i)
        day_dir = base / day.strftime("%Y-%m-%d")
        if not day_dir.exists():
            continue
        for f in sorted(day_dir.glob("*.jpg")):
            snapshots.append(f)
    return snapshots


def build_video(snapshots, output_path, fps=FPS):
    """Concatenate snapshots into mp4 via ffmpeg concat demuxer."""
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        list_file = f.name
        for s in snapshots:
            f.write(f"file '{s}'\n")
            f.write(f"duration {1.0 / fps}\n")
        if snapshots:
            f.write(f"file '{snapshots[-1]}'\n")

    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", list_file,
                "-vf", f"scale=1280:-2,fps={fps}",
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",  # allow streaming playback before full download
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


def upload_to_r2(video_path: Path, key: str, metadata: dict):
    client = get_client()
    with video_path.open("rb") as f:
        client.put_object(
            Bucket=R2_BUCKET,
            Key=key,
            Body=f,
            ContentType="video/mp4",
            CacheControl="public, max-age=300",  # 5min — short so updates are seen
            Metadata={k: str(v) for k, v in metadata.items()},
        )
    public_url = f"{R2_PUBLIC_URL.rstrip('/')}/{key}"
    size_mb = video_path.stat().st_size / 1024 / 1024
    print(f"R2 uploaded: {public_url} ({size_mb:.1f} MB)")
    return public_url


def send_to_telegram(video_path: Path, caption: str):
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendVideo"
    with video_path.open("rb") as video:
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


def build_one(zone: str, days: int, telegram: bool = False, key_suffix: str | None = None):
    """Build + upload to R2. Returns (success, public_url)."""
    snapshots = collect_snapshots(zone, days)
    print(f"[{zone}/{days}d] {len(snapshots)} snapshots")
    if len(snapshots) < 5:
        print("  not enough snapshots (<5), skipping")
        return False, None

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    local_key = key_suffix or f"{days}d"
    out = OUTPUT_DIR / f"{zone}-{local_key}.mp4"
    print(f"  building {out}...")

    if not build_video(snapshots, out):
        return False, None

    now_iso = datetime.now(timezone.utc).isoformat()
    r2_key = f"{zone}/videos/{local_key}.mp4"
    try:
        url = upload_to_r2(out, r2_key, {
            "days": str(days),
            "frames": str(len(snapshots)),
            "generated_at": now_iso,
        })
    except Exception as e:
        print(f"  R2 upload failed: {e}")
        url = None

    if telegram:
        caption = f"🌱 Timelapse Вегетация\n{days} дн., {len(snapshots)} кадров"
        send_to_telegram(out, caption)

    # Keep only preset + last 5 custom videos on disk
    for old in OUTPUT_DIR.glob(f"{zone}-custom-*.mp4"):
        pass  # handled below
    customs = sorted(OUTPUT_DIR.glob(f"{zone}-custom-*.mp4"))
    for f in customs[:-5]:
        f.unlink()

    return True, url


def cleanup_local_photos(zone: str, keep_days: int):
    """Delete date-folders older than keep_days from Pi. R2 keeps originals."""
    base = INPUT_BASE_ROOT / zone
    if not base.exists():
        return 0
    cutoff = (datetime.now() - timedelta(days=keep_days)).strftime("%Y-%m-%d")
    deleted = 0
    for day_dir in base.iterdir():
        if not day_dir.is_dir() or len(day_dir.name) != 10:
            continue
        if day_dir.name < cutoff:
            # Remove the whole day folder
            import shutil
            try:
                shutil.rmtree(day_dir)
                deleted += 1
                print(f"  deleted old day: {day_dir.name}")
            except Exception as e:
                print(f"  failed to delete {day_dir}: {e}")
    # Also clean stale thumbs_cache (not used anymore since migration to R2)
    tc = Path("/home/stepan/timelapse/thumbs_cache")
    if tc.exists():
        import shutil
        try:
            shutil.rmtree(tc)
            print("  removed dead thumbs_cache")
        except Exception:
            pass
    return deleted


def cleanup_r2_photos(zone: str, keep_days: int):
    """Delete photo objects older than keep_days from R2 bucket."""
    client = get_client()
    cutoff = (datetime.now() - timedelta(days=keep_days)).strftime("%Y-%m-%d")
    prefix = f"{zone}/"
    to_delete = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=R2_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []) or []:
            key = obj["Key"]
            if "/videos/" in key:
                continue  # videos are separate bucket area
            if not key.endswith(".jpg"):
                continue
            # key like 'vega/YYYY-MM-DD/HH-MM.jpg' or '...-thumb.jpg'
            parts = key[len(prefix):].split("/")
            if len(parts) < 2 or len(parts[0]) != 10:
                continue
            if parts[0] < cutoff:
                to_delete.append({"Key": key})
    if not to_delete:
        return 0
    # Batch delete (1000 max per call)
    for i in range(0, len(to_delete), 1000):
        batch = to_delete[i:i + 1000]
        client.delete_objects(Bucket=R2_BUCKET, Delete={"Objects": batch})
    print(f"  R2: deleted {len(to_delete)} old objects (>{keep_days}d)")
    return len(to_delete)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--zone", default="vega")
    p.add_argument("--days", type=int, help="Build for last N days")
    p.add_argument("--all", action="store_true", help="Rebuild all preset periods (3/7/14/30)")
    p.add_argument("--telegram", action="store_true", help="Also send to Telegram alerts group")
    p.add_argument("--custom-key", help="Custom R2 key suffix (used for on-demand builds)")
    p.add_argument("--no-cleanup", action="store_true", help="Skip retention cleanup (debug)")
    args = p.parse_args()

    if args.all:
        # Presets: always rebuild; telegram only for the 3-day build
        for n in PRESET_DAYS:
            build_one(args.zone, n, telegram=(n == 3))
        if not args.no_cleanup:
            print(f"Cleanup: keeping last {LOCAL_RETENTION_DAYS}d local + {R2_RETENTION_DAYS}d on R2")
            cleanup_local_photos(args.zone, LOCAL_RETENTION_DAYS)
            try:
                cleanup_r2_photos(args.zone, R2_RETENTION_DAYS)
            except Exception as e:
                print(f"R2 cleanup failed (non-fatal): {e}")
        return 0

    if not args.days:
        print("Either --days N or --all required")
        return 1

    suffix = args.custom_key or f"{args.days}d"
    ok, url = build_one(args.zone, args.days, telegram=args.telegram, key_suffix=suffix)
    if url:
        # Print URL on last line for callers that want to parse
        print(f"URL: {url}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
