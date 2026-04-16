#!/usr/bin/env python3
"""
One-shot migration: upload existing /home/stepan/timelapse/<zone>/<date>/<HH-MM>.jpg
files to Cloudflare R2, generating medium+thumb variants as it goes.

Idempotent: skips photos that are already in R2 (checked via head_object).

Usage:
    python3 timelapse_migrate.py [--zone vega] [--dry-run]
"""

import argparse
import sys
import time
from pathlib import Path

from r2_uploader import get_client, upload_photo_variants, R2_BUCKET


BASE = Path("/home/stepan/timelapse")


def already_in_r2(client, key):
    try:
        client.head_object(Bucket=R2_BUCKET, Key=key)
        return True
    except Exception:
        return False


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--zone", default="vega")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--limit", type=int, default=0, help="0 = no limit")
    args = p.parse_args()

    zone_dir = BASE / args.zone
    if not zone_dir.exists():
        print(f"no such zone dir: {zone_dir}")
        sys.exit(1)

    client = get_client()
    photos = []
    for day in sorted(zone_dir.iterdir()):
        if not day.is_dir() or len(day.name) != 10:
            continue
        for jpg in sorted(day.glob("*.jpg")):
            photos.append((day.name, jpg))

    print(f"Found {len(photos)} local photos for zone={args.zone}")
    uploaded = skipped = failed = 0
    t0 = time.time()

    for idx, (date, jpg) in enumerate(photos):
        if args.limit and uploaded >= args.limit:
            break
        name = jpg.stem  # HH-MM
        key = f"{args.zone}/{date}/{name}.jpg"
        if already_in_r2(client, key):
            skipped += 1
            if skipped % 20 == 0:
                print(f"  ...skipped {skipped} already-present")
            continue
        print(f"[{idx+1}/{len(photos)}] uploading {date}/{name}.jpg ({jpg.stat().st_size//1024} KB)")
        if args.dry_run:
            continue
        try:
            urls = upload_photo_variants(jpg, args.zone, date, name)
            if urls and urls.get("full"):
                uploaded += 1
            else:
                failed += 1
        except Exception as e:
            print(f"  FAILED: {e}")
            failed += 1

    elapsed = time.time() - t0
    print(
        f"\nDone in {elapsed:.0f}s: uploaded={uploaded}, skipped={skipped}, failed={failed}"
    )


if __name__ == "__main__":
    main()
