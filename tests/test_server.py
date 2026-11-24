from __future__ import annotations

import io

import pytest

import server


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "DATA_DIR", tmp_path)
    server.app.config.update(TESTING=True, MAX_CONTENT_LENGTH=server.MAX_UPLOAD_BYTES + 1024 * 1024)
    return server.app.test_client()


def test_health_has_version_and_timezone(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.get_json()
    assert data["ok"] is True
    assert data["timezone"] == "Asia/Tehran"
    assert data["version"] == "4.1.2"


def test_sensor_payload_accepts_supported_firmware_keys():
    assert server.normalize_sensor_payload({"temp": 23.4, "humidity": 41}) == (23.4, 41.0)
    assert server.normalize_sensor_payload({"temperature": 22, "humidity": 50}) == (22.0, 50.0)


@pytest.mark.parametrize("payload", [
    None,
    {"temp": "bad", "humidity": 50},
    {"temp": 105, "humidity": 50},
    {"temp": 23, "humidity": 130},
    {"temp": float("nan"), "humidity": 50},
])
def test_sensor_payload_rejects_invalid_readings(payload):
    with pytest.raises((ValueError, TypeError)):
        server.normalize_sensor_payload(payload)


def test_outage_cycle_uses_valid_slots_and_skips_friday():
    generated = server.generate_schedule(server.dt.date(2026, 10, 19), 13, span=10)
    assert "2026-10-23" not in generated  # Friday
    assert generated["2026-10-19"] == {"start": "13:00", "end": "15:00"}
    for date_value, item in generated.items():
        assert server.minutes_of(item["end"]) - server.minutes_of(item["start"]) == 120
        assert server.dt.date.fromisoformat(date_value).weekday() != 4


def test_data_api_validates_board_and_date(client):
    assert client.get("/api/data?board=unknown&date=2026-10-20").status_code == 400
    assert client.get("/api/data?board=esp32_1&date=not-a-date").status_code == 400


def test_upload_valid_sensor_csv_and_download_it(client):
    csv_bytes = b"time,temperature,humidity\n12:00:00,23.5,45.0\n12:00:10,23.6,45.2\n"
    response = client.post("/api/upload", data={"file": (io.BytesIO(csv_bytes), "esp32_1_2026-10-20.csv")}, content_type="multipart/form-data")
    assert response.status_code == 201
    assert response.get_json()["name"] == "esp32_1_2026-10-20.csv"
    listing = client.get("/api/files").get_json()
    assert listing["count"] == 1
    download = client.get("/api/download?name=esp32_1_2026-10-20.csv")
    assert download.status_code == 200
    assert b"23.5" in download.data


def test_upload_rejects_unsafe_filename_and_bad_csv(client):
    unsafe = client.post("/api/upload", data={"file": (io.BytesIO(b"time,temperature,humidity\n12:00:00,20,40\n"), "../../secret.csv")}, content_type="multipart/form-data")
    assert unsafe.status_code == 400
    invalid = client.post("/api/upload", data={"file": (io.BytesIO(b"not,a,sensor,csv\nfoo,bar\n"), "esp32_s3_2026-10-20.csv")}, content_type="multipart/form-data")
    assert invalid.status_code == 400


def test_overwrite_requires_explicit_flag(client):
    name = "esp32_1_2026-10-20.csv"
    valid = b"time,temperature,humidity\n12:00:00,23.5,45.0\n"
    first = client.post("/api/upload", data={"file": (io.BytesIO(valid), name)}, content_type="multipart/form-data")
    second = client.post("/api/upload", data={"file": (io.BytesIO(valid), name)}, content_type="multipart/form-data")
    third = client.post("/api/upload", data={"overwrite": "true", "file": (io.BytesIO(valid), name)}, content_type="multipart/form-data")
    assert first.status_code == 201
    assert second.status_code == 409
    assert third.status_code == 201


def test_delete_only_allows_sensor_csv_files(client):
    name = "esp32_1_2026-10-20.csv"
    (server.DATA_DIR / name).write_text("time,temperature,humidity\n12:00:00,23,40\n", encoding="utf-8")
    denied = client.delete("/api/files/outage_schedule.json")
    allowed = client.delete(f"/api/files/{name}")
    assert denied.status_code == 400
    assert allowed.status_code == 200
    assert not (server.DATA_DIR / name).exists()


def test_remote_mutations_require_admin_key(client, monkeypatch):
    monkeypatch.setattr(server, "API_ADMIN_KEY", "test-long-admin-key")
    data = {"file": (io.BytesIO(b"time,temperature,humidity\n12:00:00,23,40\n"), "esp32_1_2026-10-20.csv")}
    denied = client.post("/api/upload", data=data, content_type="multipart/form-data", environ_base={"REMOTE_ADDR": "192.168.1.45"})
    assert denied.status_code == 403
    data = {"file": (io.BytesIO(b"time,temperature,humidity\n12:00:00,23,40\n"), "esp32_1_2026-10-20.csv")}
    allowed = client.post("/api/upload", data=data, content_type="multipart/form-data", headers={"X-Admin-Key": "test-long-admin-key"}, environ_base={"REMOTE_ADDR": "192.168.1.45"})
    assert allowed.status_code == 201


def test_public_data_route_only_serves_allowed_data_files(client, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "DATA_DIR", tmp_path)
    (tmp_path / "private.txt").write_text("not public", encoding="utf-8")
    (tmp_path / "esp32_1_2026-10-20.csv").write_text(
        "time,temperature,humidity\n12:00:00,23,40\n", encoding="utf-8"
    )
    assert client.get("/data/private.txt").status_code == 404
    assert client.get("/data/esp32_1_2026-10-20.csv").status_code == 200


def test_market_snapshot_validator_accepts_compact_schema():
    payload = {
        "v": 1,
        "updated_at": "2026-11-24T12:00:00Z",
        "usd_toman": 1_000_000,
        "gold18k_toman": 50_000_000,
        "usd_stale": False,
        "gold_stale": True,
        "ignored_extra": "not passed to boards",
    }
    normalized = server.validate_market_snapshot(payload)
    assert normalized["usd_toman"] == 1_000_000
    assert normalized["gold_stale"] is True
    assert "ignored_extra" not in normalized


@pytest.mark.parametrize("payload", [
    {"v": 2, "updated_at": "2026-11-24T12:00:00Z", "usd_toman": 10, "gold18k_toman": 20},
    {"v": 1, "updated_at": "2026-11-24T12:00:00Z", "usd_toman": 0, "gold18k_toman": 20},
    {"v": 1, "updated_at": "2026-11-24T12:00:00Z", "usd_toman": 10, "gold18k_toman": True},
    {"v": 1, "updated_at": "", "usd_toman": 10, "gold18k_toman": 20},
    {"v": 1, "updated_at": "not-a-timestamp", "usd_toman": 10, "gold18k_toman": 20},
])
def test_market_snapshot_validator_rejects_bad_payloads(payload):
    with pytest.raises(ValueError):
        server.validate_market_snapshot(payload)


def test_market_normalizer_accepts_arzpulse_latest_and_converts_irr_to_toman(monkeypatch):
    monkeypatch.setattr(server, "MARKET_MAX_AGE_SECONDS", 900)
    source = {
        "dollarPrice": 2_900_000,
        "gold18K": 249_000_000,
        "timestamp": "2026-11-24T12:00:00Z",
        "derivedStale": {"dollar": False, "gold18K": False},
    }
    result = server._normalize_market_document(source)
    assert result["usd_toman"] == 290_000
    assert result["gold18k_toman"] == 24_900_000
    assert result["usd_stale"] is False
    assert result["gold_stale"] is False


def test_market_decoder_accepts_github_contents_base64_envelope():
    import base64
    import json
    payload = {"v": 1, "updated_at": "2026-11-24T12:00:00Z", "usd_toman": 10, "gold18k_toman": 20}
    encoded = base64.b64encode(json.dumps(payload).encode()).decode()
    envelope = json.dumps({"encoding": "base64", "content": encoded}).encode()
    decoded = server._decode_market_document(envelope, "https://api.github.com/repos/x/y/contents/a.json")
    assert decoded["usd_toman"] == 10


def test_market_cache_seeds_from_repository_market_file(tmp_path, monkeypatch):
    import json
    from pathlib import Path
    seed_root = tmp_path / "project"
    market_dir = seed_root / "market"
    market_dir.mkdir(parents=True)
    payload = {
        "v": 1,
        "updated_at": "2026-11-24T12:00:00Z",
        "usd_toman": 290_000,
        "gold18k_toman": 24_900_000,
        "usd_stale": False,
        "gold_stale": False,
    }
    (market_dir / "esp32.json").write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(server, "BASE_DIR", seed_root)
    monkeypatch.setattr(server, "ASSET_DIR", seed_root)
    monkeypatch.setattr(server, "MARKET_CACHE_FILE", seed_root / "data" / "market_snapshot_cache.json")
    monkeypatch.setattr(server, "market_snapshot", None)
    assert server.load_market_cache() is True
    assert server.market_snapshot["usd_toman"] == 290_000
    assert server.market_snapshot_source == "market/esp32.json (bundled seed)"


def test_market_endpoint_returns_503_until_cache_is_ready(client, monkeypatch):
    monkeypatch.setattr(server, "market_snapshot", None)
    monkeypatch.setattr(server, "market_snapshot_error", "not fetched yet")
    response = client.get("/api/market")
    assert response.status_code == 503
    assert response.get_json()["error"] == "market_snapshot_not_ready"


def test_market_endpoint_serves_compact_cached_payload(client, monkeypatch):
    payload = {
        "v": 1,
        "updated_at": "2026-11-24T12:00:00Z",
        "usd_toman": 1_000_000,
        "gold18k_toman": 50_000_000,
        "usd_stale": False,
        "gold_stale": False,
    }
    monkeypatch.setattr(server, "market_snapshot", payload)
    monkeypatch.setattr(server, "market_snapshot_fetched_at", server.time.time())
    response = client.get("/api/market")
    assert response.status_code == 200
    assert response.get_json() == payload
    assert response.headers["Cache-Control"].startswith("no-store")


def test_market_refresh_keeps_last_good_cache_on_failure(monkeypatch):
    old_payload = {
        "v": 1,
        "updated_at": "2026-11-24T11:00:00Z",
        "usd_toman": 900_000,
        "gold18k_toman": 45_000_000,
        "usd_stale": False,
        "gold_stale": False,
    }
    monkeypatch.setattr(server, "market_snapshot", old_payload.copy())

    def fail_request(*args, **kwargs):
        raise server.requests.Timeout("simulated timeout")

    monkeypatch.setattr(server.requests, "get", fail_request)
    assert server.refresh_market_snapshot_once() is False
    assert server.market_snapshot == old_payload
    assert "simulated timeout" in server.market_snapshot_error


def test_market_refresh_updates_cache_from_small_json(monkeypatch):
    import json

    payload = {
        "v": 1,
        "updated_at": "2026-11-24T12:00:00Z",
        "usd_toman": 1_100_000,
        "gold18k_toman": 55_000_000,
        "usd_stale": False,
        "gold_stale": False,
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")

    class FakeResponse:
        def __init__(self):
            self.headers = {"Content-Length": str(len(raw))}
            self.raw = io.BytesIO(raw)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def raise_for_status(self):
            return None

    monkeypatch.setattr(server.requests, "get", lambda *args, **kwargs: FakeResponse())
    assert server.refresh_market_snapshot_once() is True
    assert server.market_snapshot == payload
    assert server.market_snapshot_fetched_at > 0
