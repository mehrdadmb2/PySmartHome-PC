from datetime import datetime, timedelta, timezone
import json

import pytest

from scripts.update_market_snapshot import build_outputs


def decode(outputs, key):
    return json.loads(outputs[key].decode("utf-8"))


def test_builds_compact_toman_snapshot_and_categories():
    now = datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc)
    payload = {
        "dollarPrice": 700_123_456,
        "gold18K": 123_456_789,
        "timestamp": "2026-11-24T11:59:00Z",
        "derivedStale": {"dollar": False, "gold18K": False},
    }

    outputs = build_outputs(payload, now=now)
    board = decode(outputs, "market/esp32.json")
    currency = decode(outputs, "market/currencies/usd.json")
    gold = decode(outputs, "market/metals/gold_18k_1g.json")

    assert board["usd_toman"] == 70_012_346
    assert board["gold18k_toman"] == 12_345_679
    assert board["usd_stale"] is False
    assert board["gold_stale"] is False
    assert currency["category"] == "currency"
    assert gold["category"] == "precious_metals"
    assert len(outputs["market/esp32.json"]) <= 512


def test_old_source_is_marked_stale():
    now = datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc)
    payload = {
        "dollarPrice": 700_000_000,
        "gold18K": 120_000_000,
        "timestamp": (now - timedelta(hours=1)).isoformat(),
        "derivedStale": {"dollar": False, "gold18K": False},
    }
    board = decode(build_outputs(payload, now=now), "market/esp32.json")
    assert board["usd_stale"] is True
    assert board["gold_stale"] is True


@pytest.mark.parametrize("field,value", [("dollarPrice", 0), ("gold18K", None), ("dollarPrice", "NaN")])
def test_rejects_invalid_price_values(field, value):
    payload = {
        "dollarPrice": 700_000_000,
        "gold18K": 120_000_000,
        "timestamp": "2026-11-24T11:59:00Z",
        "derivedStale": {},
    }
    payload[field] = value
    with pytest.raises(ValueError):
        build_outputs(payload, now=datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc))


def test_rejects_missing_or_invalid_timestamp():
    payload = {"dollarPrice": 700_000_000, "gold18K": 120_000_000}
    with pytest.raises(ValueError, match="timestamp"):
        build_outputs(payload)
