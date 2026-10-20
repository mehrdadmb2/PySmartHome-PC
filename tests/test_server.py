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
    assert data["version"] == "4.0.0"


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
