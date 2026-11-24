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


def test_download_source_retries_then_uses_fallback(monkeypatch):
    from io import BytesIO
    from urllib.error import URLError
    from scripts import update_market_snapshot as updater

    payload = {
        "dollarPrice": 700_000_000,
        "gold18K": 120_000_000,
        "timestamp": "2026-11-24T11:59:00Z",
        "derivedStale": {"dollar": False, "gold18K": False},
    }
    calls = []

    class FakeResponse(BytesIO):
        status = 200
        def __enter__(self):
            return self
        def __exit__(self, *_args):
            self.close()

    def fake_urlopen(request, timeout):
        calls.append(request.full_url.split("?v=", 1)[0])
        if len(calls) <= 3:
            raise URLError("temporary timeout")
        return FakeResponse(json.dumps(payload).encode("utf-8"))

    monkeypatch.setattr(updater, "SOURCE_URLS", ("https://primary.invalid/latest.json", "https://fallback.invalid/latest.json"))
    monkeypatch.setattr(updater.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr("time.sleep", lambda _seconds: None)

    result = updater.download_source()
    assert result["dollarPrice"] == 700_000_000
    assert calls[:3] == ["https://primary.invalid/latest.json"] * 3
    assert calls[3] == "https://fallback.invalid/latest.json"


def test_decode_github_contents_api_base64_envelope():
    import base64
    from scripts.update_market_snapshot import decode_source_document

    payload = {
        "dollarPrice": 700_000_000,
        "gold18K": 120_000_000,
        "timestamp": "2026-11-24T11:59:00Z",
        "derivedStale": {"dollar": False, "gold18K": False},
    }
    encoded = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
    envelope = json.dumps({"encoding": "base64", "content": encoded}).encode("utf-8")
    decoded = decode_source_document(envelope, "https://api.github.com/repos/owner/repo/contents/data.json")
    assert decoded["dollarPrice"] == 700_000_000
