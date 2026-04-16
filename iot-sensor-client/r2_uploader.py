#!/usr/bin/env python3
"""
Cloudflare R2 uploader for timelapse photos.
Reads credentials from /etc/truegrow-r2.env (or env vars).

Usage:
    from r2_uploader import upload_photo_variants
    urls = upload_photo_variants(local_path, zone='vega', date='2026-04-16', name='16-25')
    # returns {'full': '...', 'medium': '...', 'thumb': '...'} or None on failure
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError
except ImportError:
    print("ERROR: boto3 not installed. Run: pip install boto3", file=sys.stderr)
    raise


def _load_env_file(path="/etc/truegrow-r2.env"):
    """Load KEY=VALUE pairs from a simple env file into os.environ if present."""
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


_load_env_file()

R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY")
R2_BUCKET = os.environ.get("R2_BUCKET", "truegrow-timelapse")
R2_PUBLIC_URL = os.environ.get("R2_PUBLIC_URL", "").rstrip("/")

_client = None


def get_client():
    global _client
    if _client is not None:
        return _client
    if not (R2_ACCOUNT_ID and R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY):
        raise RuntimeError(
            "R2 credentials missing. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY"
        )
    _client = boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
        config=Config(retries={"max_attempts": 3, "mode": "standard"}),
    )
    return _client


def _build_variant(src_path: Path, size_px: int, quality: int) -> Path:
    """ffmpeg downscale to given width, return temp file path."""
    dst = Path(tempfile.mkstemp(suffix=".jpg")[1])
    result = subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(src_path),
            "-vf", f"scale={size_px}:-2",
            "-q:v", str(quality),
            str(dst),
        ],
        capture_output=True,
        timeout=30,
    )
    if result.returncode != 0:
        dst.unlink(missing_ok=True)
        raise RuntimeError(f"ffmpeg failed: {result.stderr.decode('utf-8', 'replace')[-200:]}")
    return dst


def _put(local_path: Path, key: str):
    client = get_client()
    with local_path.open("rb") as f:
        client.put_object(
            Bucket=R2_BUCKET,
            Key=key,
            Body=f,
            ContentType="image/jpeg",
            CacheControl="public, max-age=604800, immutable",  # 7 days, immutable
        )
    size_kb = local_path.stat().st_size / 1024
    return size_kb


def upload_photo_variants(local_path, zone: str, date: str, name: str):
    """
    Upload full + thumb variants.
    local_path: original JPEG (high res)
    zone: e.g. 'vega'
    date: YYYY-MM-DD
    name: HH-MM (no .jpg extension)

    Returns dict of public URLs (full, thumb) or None on failure.
    """
    src = Path(local_path)
    if not src.is_file():
        print(f"R2: source missing {src}", file=sys.stderr)
        return None

    base_key = f"{zone}/{date}/{name}"
    results = {}

    # full (original) — ~780KB at Tapo C110 default
    try:
        size = _put(src, f"{base_key}.jpg")
        results["full"] = f"{R2_PUBLIC_URL}/{base_key}.jpg"
        print(f"R2 full: {size:.0f} KB")
    except Exception as e:
        print(f"R2 full upload failed: {e}", file=sys.stderr)
        return None

    # thumb 320px (used in archive grid + viewer placeholder)
    try:
        thumb = _build_variant(src, 320, 5)
        try:
            size = _put(thumb, f"{base_key}-thumb.jpg")
            results["thumb"] = f"{R2_PUBLIC_URL}/{base_key}-thumb.jpg"
            print(f"R2 thumb: {size:.1f} KB")
        finally:
            thumb.unlink(missing_ok=True)
    except Exception as e:
        print(f"R2 thumb upload failed: {e}", file=sys.stderr)

    return results


def list_photos(zone: str):
    """List objects for a zone. Groups by date -> [names].
    Returns: [{'date': 'YYYY-MM-DD', 'count': N, 'photos': [name, ...]}, ...] sorted newest first.
    """
    client = get_client()
    prefix = f"{zone}/"
    paginator = client.get_paginator("list_objects_v2")
    days = {}
    for page in paginator.paginate(Bucket=R2_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []) or []:
            # key: vega/YYYY-MM-DD/HH-MM.jpg  or -thumb.jpg / -medium.jpg
            key = obj["Key"]
            if not key.endswith(".jpg"):
                continue
            rel = key[len(prefix):]  # YYYY-MM-DD/HH-MM[-thumb|-medium].jpg
            parts = rel.split("/")
            if len(parts) != 2:
                continue
            date, fname = parts
            stem = fname[:-4]  # strip .jpg
            # Only count full (no -thumb / -medium suffix)
            if stem.endswith("-thumb") or stem.endswith("-medium"):
                continue
            days.setdefault(date, []).append(stem)
    out = []
    for date in sorted(days.keys(), reverse=True):
        photos = sorted(days[date])
        out.append({"date": date, "count": len(photos), "photos": photos})
    return out


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--test", action="store_true", help="upload a test file")
    p.add_argument("--list", action="store_true", help="list uploaded photos")
    p.add_argument("--zone", default="vega")
    args = p.parse_args()

    if args.test:
        tmp = Path("/tmp/r2-test.txt")
        tmp.write_text("hello from pi")
        client = get_client()
        client.put_object(
            Bucket=R2_BUCKET,
            Key="_test/from-pi.txt",
            Body=tmp.read_bytes(),
            ContentType="text/plain",
        )
        print(f"OK: https://pub-...r2.dev/_test/from-pi.txt (public URL: {R2_PUBLIC_URL}/_test/from-pi.txt)")
    elif args.list:
        for d in list_photos(args.zone):
            print(f"{d['date']}: {d['count']} photos")
