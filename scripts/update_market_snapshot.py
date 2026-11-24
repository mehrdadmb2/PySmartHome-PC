#!/usr/bin/env python3
"""Build small, categorized PySmartHome market snapshots from ArzPulse.

This script runs in GitHub Actions. The ESP32 boards consume only
market/esp32.json; they never download or calculate the full ArzPulse dataset.
"""
from __future__ import annotations

import json
import math
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = "https://raw.githubusercontent.com/mehrdadmb2/ArzPulse/main/docs/data/latest.json"
MAX_SOURCE_AGE = timedelta(minutes=20)
USER_AGENT = "PySmartHome-PC-MarketSnapshot/1.0 (+https://github.com/mehrdadmb2/PySmartHome-PC)"


def parse_timestamp(value: Any) -> datetime | None:
    """Parse ISO-8601 or Unix timestamps and normalize them to UTC."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        if isinstance(value, (int, float)):
            numeric = float(value)
            if not math.isfinite(numeric) or numeric <= 0:
                return None
            if numeric > 10_000_000_000:  # milliseconds
                numeric /= 1000.0
            return datetime.fromtimestamp(numeric, tz=timezone.utc)
        text = str(value).strip()
        if not text:
            return None
        if text.isdigit():
            return parse_timestamp(int(text))
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (OverflowError, OSError, TypeError, ValueError):
        return None


def positive_decimal(value: Any, field: str) -> Decimal:
    if isinstance(value, bool) or value is None:
        raise ValueError(f"Missing or invalid {field}")
    try:
        parsed = Decimal(str(value).strip())
    except (InvalidOperation, ValueError, AttributeError):
        raise ValueError(f"Missing or invalid {field}") from None
    if not parsed.is_finite() or parsed <= 0:
        raise ValueError(f"Missing or invalid {field}")
    return parsed


def irr_to_toman(value: Any, field: str) -> int:
    irr = positive_decimal(value, field)
    return int((irr / Decimal(10)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def compact_json(value: dict[str, Any]) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")


def build_outputs(payload: dict[str, Any], now: datetime | None = None) -> dict[str, bytes]:
    """Validate ArzPulse input and return all generated JSON files in memory."""
    if not isinstance(payload, dict):
        raise ValueError("ArzPulse response is not a JSON object")

    dollar_toman = irr_to_toman(payload.get("dollarPrice"), "dollarPrice")
    gold_toman = irr_to_toman(payload.get("gold18K"), "gold18K")
    source_timestamp_raw = payload.get("timestamp")
    source_datetime = parse_timestamp(source_timestamp_raw)
    if source_datetime is None:
        raise ValueError("ArzPulse timestamp is missing or invalid")

    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    generated_at = current.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    source_timestamp = source_datetime.replace(microsecond=0).isoformat().replace("+00:00", "Z")

    stale_flags = payload.get("derivedStale")
    if not isinstance(stale_flags, dict):
        stale_flags = {}
    source_too_old = current - source_datetime > MAX_SOURCE_AGE or source_datetime - current > timedelta(minutes=5)
    dollar_stale = (stale_flags.get("dollar") is not False) or source_too_old
    gold_stale = (stale_flags.get("gold18K") is not False) or source_too_old

    currency = {
        "schema": 1,
        "category": "currency",
        "symbol": "USD",
        "name": "USDT/IRR reference rate",
        "value_toman": dollar_toman,
        "unit": "Toman per USD/USDT",
        "source": "ArzPulse",
        "source_timestamp": source_timestamp,
        "updated_at": generated_at,
        "stale": dollar_stale,
    }
    gold = {
        "schema": 1,
        "category": "precious_metals",
        "symbol": "GOLD_18K_1G",
        "name": "18-karat gold, 1 gram",
        "value_toman": gold_toman,
        "unit": "Toman per gram",
        "source": "ArzPulse",
        "source_timestamp": source_timestamp,
        "updated_at": generated_at,
        "stale": gold_stale,
    }

    # This is the only document the microcontrollers need to parse.
    # It contains two integer Toman prices and two freshness flags.
    esp32 = {
        "v": 1,
        "updated_at": generated_at,
        "usd_toman": dollar_toman,
        "gold18k_toman": gold_toman,
        "usd_stale": dollar_stale,
        "gold_stale": gold_stale,
    }
    status = {
        "schema": 1,
        "ok": True,
        "source": "ArzPulse",
        "generated_at": generated_at,
        "source_timestamp": source_timestamp,
        "source_age_seconds": max(0, int((current - source_datetime).total_seconds())),
        "assets": ["USD", "GOLD_18K_1G"],
        "esp32_snapshot_bytes": len(compact_json(esp32)),
    }

    return {
        "market/currencies/usd.json": compact_json(currency),
        "market/metals/gold_18k_1g.json": compact_json(gold),
        "market/esp32.json": compact_json(esp32),
        "market/status.json": compact_json(status),
    }


def download_source() -> dict[str, Any]:
    request = urllib.request.Request(
        SOURCE_URL,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Cache-Control": "no-cache",
        },
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise RuntimeError(f"ArzPulse returned HTTP {response.status}")
        raw = response.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise RuntimeError("ArzPulse response exceeded the 2 MiB safety limit")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"ArzPulse JSON is invalid: {exc}") from exc
    if not isinstance(value, dict):
        raise RuntimeError("ArzPulse JSON root is not an object")
    return value


def write_outputs(outputs: dict[str, bytes]) -> None:
    # Validate everything before touching the repository. A failed upstream
    # response therefore never destroys the last known-good snapshot.
    for relative, content in outputs.items():
        destination = ROOT / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        temporary.write_bytes(content)
        os.replace(temporary, destination)


def main() -> int:
    try:
        source = download_source()
        outputs = build_outputs(source)
        write_outputs(outputs)
        print("Market snapshot generated successfully:")
        for relative, content in outputs.items():
            print(f"  {relative}: {len(content)} bytes")
        return 0
    except (OSError, urllib.error.URLError, ValueError, RuntimeError) as exc:
        print(f"::error::Market snapshot update failed: {exc}", file=sys.stderr)
        print("The previous market files were left untouched.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
