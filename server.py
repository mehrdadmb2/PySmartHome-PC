#!/usr/bin/env python3
"""PySmartHome-PC - resilient local smart-home dashboard server.

One shared frontend is served locally and also committed to GitHub Pages.
The `data/` directory is the only runtime data directory.
"""
from __future__ import annotations

import base64
import csv
import datetime as dt
import json
import logging
import math
import os
import re
import hmac
import ipaddress
import shutil
import sys
import tempfile
import threading
import time
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any

import requests
from flask import Flask, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

# In a PyInstaller build, persistent data/config belongs beside the executable,
# while immutable application assets live in the bundled resource directory.
FROZEN = bool(getattr(sys, "frozen", False))
BASE_DIR = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent
ASSET_DIR = Path(getattr(sys, "_MEIPASS", BASE_DIR)).resolve()
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


def load_local_env(path: Path) -> None:
    """Read a tiny .env file without overriding explicitly exported variables."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key.replace("_", "").isalnum():
            os.environ.setdefault(key, value)


def looks_like_placeholder_secret(value: str) -> bool:
    candidate = (value or "").strip()
    lowered = candidate.lower()
    if not candidate or "your_" in lowered or "placeholder" in lowered or lowered.startswith("replace_"):
        return True
    if lowered.startswith("ghp_") and set(candidate[4:]) <= {"x", "X"}:
        return True
    if lowered.startswith("github_pat_") and set(candidate.split("_", 2)[-1]) <= {"x", "X"}:
        return True
    return False


def local_config_value(key: str) -> str:
    """Read a named value from the git-ignored legacy config.txt, if present."""
    try:
        lines = (BASE_DIR / "config.txt").read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, sep, value = line.partition(" ")
        if sep and name.strip().lower() == key.lower():
            candidate = value.strip().strip('"').strip("'")
            if candidate and not looks_like_placeholder_secret(candidate):
                return candidate
    return ""


load_local_env(BASE_DIR / ".env")


def env_int(name: str, default: int, minimum: int, maximum: int | None = None) -> int:
    try:
        value = int(os.getenv(name, str(default)).strip())
    except (TypeError, ValueError):
        value = default
    value = max(minimum, value)
    return min(maximum, value) if maximum is not None else value


def env_float(name: str, default: float, minimum: float, maximum: float | None = None) -> float:
    try:
        value = float(os.getenv(name, str(default)).strip())
        if not math.isfinite(value):
            value = default
    except (TypeError, ValueError):
        value = default
    value = max(minimum, value)
    return min(maximum, value) if maximum is not None else value

# ----------------------------- configuration --------------------------------
# ESP32 nodes must reach the PC over the trusted home LAN. LAN binding is
# enabled by default for this hardware profile; Windows Firewall must restrict
# inbound TCP/5000 to the Private profile + LocalSubnet. Set
# PYSMART_HOME_LAN_ACCESS=0 to restore loopback-only mode.
def env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on", "enabled"}

LAN_ACCESS_ENABLED = env_bool("PYSMART_HOME_LAN_ACCESS", True)
_requested_host = os.getenv("PYSMART_HOME_HOST", "").strip()
if LAN_ACCESS_ENABLED:
    HOST = _requested_host if _requested_host and _requested_host not in {"127.0.0.1", "localhost", "::1"} else "0.0.0.0"
else:
    HOST = _requested_host if _requested_host and _requested_host not in {"0.0.0.0", "::"} else "127.0.0.1"
PORT = env_int("PYSMART_HOME_PORT", 5000, 1, 65535)
POLL_INTERVAL = env_int("PYSMART_HOME_POLL_SECONDS", 10, 3, 3600)
PUBLISH_INTERVAL = env_int("PYSMART_HOME_PUBLISH_SECONDS", 300, 30, 86400)
NODE_TIMEOUT = env_int("PYSMART_HOME_NODE_TIMEOUT", 45, 20, 86400)
HTTP_TIMEOUT = env_int("PYSMART_HOME_HTTP_TIMEOUT", 4, 1, 60)
MARKET_REFRESH_SECONDS = env_int("PYSMART_MARKET_REFRESH_SECONDS", 300, 60, 3600)
MARKET_HTTP_TIMEOUT = env_int("PYSMART_MARKET_HTTP_TIMEOUT", 5, 3, 20)
MARKET_CONNECT_TIMEOUT = env_int("PYSMART_MARKET_CONNECT_TIMEOUT", 2, 1, 10)
MARKET_MAX_AGE_SECONDS = env_int("PYSMART_MARKET_MAX_AGE_SECONDS", 900, 60, 86400)
# The primary endpoint is GitHub's Contents API for the exact compact file.
# It is intentionally first: the PC's GitHub Contents API sync already uses
# api.github.com, while raw.githubusercontent.com may be blocked or slow on
# some networks. Each fallback still targets a *file*, never a /tree/ directory.
MARKET_API_URL = "https://api.github.com/repos/mehrdadmb2/PySmartHome-PC/contents/market/esp32.json?ref=main"
MARKET_SOURCE_URL = os.getenv("PYSMART_MARKET_SOURCE_URL", MARKET_API_URL).strip() or MARKET_API_URL
_DEFAULT_MARKET_URLS = (
    MARKET_API_URL,
    "https://raw.githubusercontent.com/mehrdadmb2/PySmartHome-PC/main/market/esp32.json",
    "https://cdn.jsdelivr.net/gh/mehrdadmb2/PySmartHome-PC@main/market/esp32.json",
    "https://api.github.com/repos/mehrdadmb2/ArzPulse/contents/docs/data/latest.json?ref=main",
    "https://raw.githubusercontent.com/mehrdadmb2/ArzPulse/main/docs/data/latest.json",
    "https://cdn.jsdelivr.net/gh/mehrdadmb2/ArzPulse@main/docs/data/latest.json",
    "https://mehrdadmb2.github.io/ArzPulse/data/latest.json",
)
MARKET_SOURCE_URLS: list[str] = []
for _url in (MARKET_API_URL, MARKET_SOURCE_URL):
    if _url and _url not in MARKET_SOURCE_URLS:
        MARKET_SOURCE_URLS.append(_url)
for _url in os.getenv("PYSMART_MARKET_FALLBACK_URLS", "").split(","):
    _url = _url.strip()
    # This was an incorrect Pages fallback: PySmartHome Pages serves the site,
    # not necessarily the repository-root market folder. Never retry it.
    if "mehrdadmb2.github.io/PySmartHome-PC/market/" in _url:
        continue
    if _url and _url not in MARKET_SOURCE_URLS:
        MARKET_SOURCE_URLS.append(_url)
for _url in _DEFAULT_MARKET_URLS:
    if _url and _url not in MARKET_SOURCE_URLS:
        MARKET_SOURCE_URLS.append(_url)
MARKET_CACHE_FILE = DATA_DIR / "market_snapshot_cache.json"
TEMP_ALERT_THRESHOLD = env_float("PYSMART_TEMP_ALERT", 35.0, -40.0, 100.0)
API_ADMIN_KEY = os.getenv("PYSMART_HOME_ADMIN_KEY", "").strip()
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
SENSOR_CSV_RE = re.compile(r"^(esp32_1|esp32_s3)_([0-9]{4}-[0-9]{2}-[0-9]{2})\.csv$")

ESP32_HUB_URL = os.getenv("PYSMART_ESP32_1_URL", "http://192.168.1.119/api/status")
ESP32_S3_URL = os.getenv("PYSMART_ESP32_S3_URL", "http://192.168.1.115/api/status")

GITHUB_USER = os.getenv("PYSMART_GITHUB_USER", "mehrdadmb2")
GITHUB_REPO = os.getenv("PYSMART_GITHUB_REPO", "PySmartHome-PC")
GITHUB_BRANCH = os.getenv("PYSMART_GITHUB_BRANCH", "main")
GITHUB_TOKEN = os.getenv("PYSMART_GITHUB_TOKEN", "").strip() or local_config_value("token")
if looks_like_placeholder_secret(GITHUB_TOKEN):
    GITHUB_TOKEN = ""

BOARDS = {
    "esp32_1": {"name": "Room 1 • Hub", "short": "Room 1", "url": ESP32_HUB_URL},
    "esp32_s3": {"name": "Room 2 • Sensor S3", "short": "Room 2", "url": ESP32_S3_URL},
}

# Iran uses UTC+03:30. This fixed offset is intentional: it avoids host OS
# timezone database differences and matches current Iran civil time.
IRAN_TZ = dt.timezone(dt.timedelta(hours=3, minutes=30), "Asia/Tehran")
OUTAGE_FILE = DATA_DIR / "outage_schedule.json"
STATUS_FILE = DATA_DIR / "status.json"

# Outages are 2 hours, on a rolling 09:00..21:00 six-slot cycle.
SLOTS = (9, 11, 13, 15, 17, 19)
OUTAGE_DURATION_MINUTES = 120
SKIP_WEEKDAY = 4  # Friday

# ------------------------------ logging -------------------------------------
class ColorFormatter(logging.Formatter):
    RESET = "\033[0m"
    COLORS = {
        logging.DEBUG: "\033[36m",   # cyan
        logging.INFO: "\033[92m",    # green
        logging.WARNING: "\033[93m",# yellow
        logging.ERROR: "\033[91m",  # red
        logging.CRITICAL: "\033[95m",# magenta
    }

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelno, self.RESET)
        level = record.levelname.upper().ljust(8)
        stamp = iran_now().strftime("%H:%M:%S")
        category = getattr(record, "category", "SYS").upper().ljust(7)
        message = super().format(record)
        return f"{color}[{level}]\033[0m {stamp} │ \033[96m[{category}]\033[0m {message}"

handler = logging.StreamHandler()
handler.setFormatter(ColorFormatter("%(message)s"))
logger = logging.getLogger("pysmarthome")
logger.setLevel(os.getenv("PYSMART_LOG_LEVEL", "INFO").upper())
logger.handlers.clear()
logger.addHandler(handler)
logger.propagate = False

# ----------------------------- state ----------------------------------------
state_lock = threading.RLock()
github_lock = threading.Lock()
worker_started = False
market_worker_started = False
market_lock = threading.RLock()
market_snapshot: dict[str, Any] | None = None
market_snapshot_fetched_at = 0.0
market_snapshot_error = "not fetched yet"
market_snapshot_source = "none"
market_last_attempt_at = 0.0
market_consecutive_failures = 0

sensors: dict[str, dict[str, Any]] = {
    key: {
        "temperature": None,
        "humidity": None,
        "last_seen_epoch": 0.0,
        "last_success": None,
        "last_error": None,
        "latency_ms": None,
        "samples": 0,
        "consecutive_failures": 0,
    }
    for key in BOARDS
}

runtime: dict[str, Any] = {
    "started_at": time.time(),
    "last_poll": None,
    "last_publish": None,
    "last_publish_ok": None,
    "publish_error": None,
    "poll_cycles": 0,
}

# ----------------------------- time/helpers ---------------------------------
def iran_now() -> dt.datetime:
    return dt.datetime.now(IRAN_TZ).replace(microsecond=0)


def iso_now() -> str:
    return iran_now().isoformat()


def today() -> dt.date:
    return iran_now().date()


def valid_date(value: Any) -> bool:
    try:
        dt.date.fromisoformat(str(value))
        return True
    except (TypeError, ValueError):
        return False


def valid_hhmm(value: Any) -> bool:
    try:
        dt.datetime.strptime(str(value), "%H:%M")
        return True
    except (TypeError, ValueError):
        return False


def minutes_of(value: str) -> int:
    h, m = map(int, value.split(":"))
    return h * 60 + m


def hhmm(minutes: int) -> str:
    h, m = divmod(int(minutes), 60)
    return f"{h:02d}:{m:02d}"


def iso_for_date_time(date_value: dt.date, time_value: str) -> dt.datetime:
    h, m = map(int, time_value.split(":"))
    return dt.datetime.combine(date_value, dt.time(h, m), tzinfo=IRAN_TZ)


def date_range_for(name: str, end_date: dt.date) -> list[dt.date]:
    if name == "daily":
        offsets = [0]
    elif name == "yesterday":
        offsets = [1]
    elif name == "weekly":
        offsets = list(range(6, -1, -1))
    elif name == "monthly":
        offsets = list(range(29, -1, -1))
    else:
        raise ValueError("invalid range")
    return [end_date - dt.timedelta(days=o) for o in offsets]

# --------------------------- outage engine ----------------------------------
def default_schedule() -> dict[str, dict[str, str]]:
    """Seed the cycle around today: today = 13:00-15:00, Fridays = none."""
    ref = today()
    return generate_schedule(ref, 13, span=14)


def load_outage() -> dict[str, dict[str, str]]:
    try:
        raw = json.loads(OUTAGE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    clean: dict[str, dict[str, str]] = {}
    for key, item in raw.items():
        if not valid_date(key) or not isinstance(item, dict):
            continue
        start = item.get("start")
        end = item.get("end")
        if not (valid_hhmm(start) and valid_hhmm(end)):
            continue
        if minutes_of(start) < 540 or minutes_of(end) > 1260 or minutes_of(end) - minutes_of(start) != OUTAGE_DURATION_MINUTES:
            continue
        clean[str(key)] = {"start": start, "end": end}
    return clean


def save_outage(schedule: dict[str, dict[str, str]]) -> None:
    tmp = OUTAGE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(schedule, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(OUTAGE_FILE)


def generate_schedule(reference_date: dt.date, reference_start_hour: int, span: int = 21) -> dict[str, dict[str, str]]:
    """Generate both past and future slots from one reference slot.

    The cycle advances one slot per non-Friday day. Friday has no outage and
    does not consume a slot. After 19:00-21:00 the next non-Friday slot wraps
    to 09:00-11:00.
    """
    if reference_start_hour not in SLOTS:
        raise ValueError("reference start must be one of 09,11,13,15,17,19")
    ref_index = SLOTS.index(reference_start_hour)
    result: dict[str, dict[str, str]] = {}
    for offset in range(-span, span + 1):
        day = reference_date + dt.timedelta(days=offset)
        if day.weekday() == SKIP_WEEKDAY:
            continue
        # Count non-Friday days between reference and target, excluding reference itself.
        step = 1 if offset >= 0 else -1
        shift = 0
        cursor = reference_date
        for _ in range(abs(offset)):
            cursor += dt.timedelta(days=step)
            if cursor.weekday() != SKIP_WEEKDAY:
                shift += step
        slot = SLOTS[(ref_index + shift) % len(SLOTS)]
        result[day.isoformat()] = {"start": f"{slot:02d}:00", "end": f"{slot + 2:02d}:00"}
    return result


def ensure_outage_schedule() -> None:
    global outage_schedule
    with state_lock:
        if not outage_schedule:
            outage_schedule = default_schedule()
            save_outage(outage_schedule)
            logger.info("Outage cycle initialized: today 13:00–15:00", extra={"category": "OUTAGE"})
        else:
            # Always keep a usable window around now. Prefer the latest stored
            # reference for existing data, then generate any missing dates.
            today_key = today().isoformat()
            if today_key not in outage_schedule and today().weekday() != SKIP_WEEKDAY:
                # Derive today's slot from nearest stored non-Friday date.
                nearest = min(
                    (k for k in outage_schedule if valid_date(k)),
                    key=lambda k: abs((dt.date.fromisoformat(k) - today()).days),
                    default=None,
                )
                if nearest:
                    ref_day = dt.date.fromisoformat(nearest)
                    ref_start = int(outage_schedule[nearest]["start"][:2])
                    regenerated = generate_schedule(ref_day, ref_start, span=21)
                    outage_schedule.update(regenerated)
                    save_outage(outage_schedule)
                else:
                    outage_schedule = default_schedule()
                    save_outage(outage_schedule)


outage_schedule = load_outage()
ensure_outage_schedule()


def update_outage_from_reference(date_value: str, start: str, end: str) -> dict[str, dict[str, str]]:
    if not valid_date(date_value) or not valid_hhmm(start) or not valid_hhmm(end):
        raise ValueError("invalid date or time")
    if minutes_of(start) < 540 or minutes_of(end) > 1260:
        raise ValueError("outage must be within 09:00-21:00")
    if minutes_of(end) - minutes_of(start) != OUTAGE_DURATION_MINUTES:
        raise ValueError("outage duration must be exactly 2 hours")
    start_hour = int(start[:2])
    if start_hour not in SLOTS or start != f"{start_hour:02d}:00":
        raise ValueError("start must align to a 2-hour cycle slot")
    reference_date = dt.date.fromisoformat(date_value)
    if reference_date.weekday() == SKIP_WEEKDAY:
        raise ValueError("Friday is reserved as the no-outage day; choose another reference date")
    generated = generate_schedule(reference_date, start_hour, span=45)
    with state_lock:
        outage_schedule.clear()
        outage_schedule.update(generated)
        save_outage(outage_schedule)
    logger.info("Cycle recalculated from %s %s–%s", date_value, start, end, extra={"category": "OUTAGE"})
    return dict(outage_schedule)

# --------------------------- CSV storage ------------------------------------
def csv_path(board: str, date_value: str) -> Path:
    if board not in BOARDS or not valid_date(date_value):
        raise ValueError("invalid board/date")
    path = (DATA_DIR / f"{board}_{date_value}.csv").resolve()
    if DATA_DIR.resolve() not in path.parents:
        raise ValueError("invalid data path")
    return path


def append_sample(board: str, temperature: float, humidity: float, timestamp: dt.datetime) -> None:
    path = csv_path(board, timestamp.date().isoformat())
    path.parent.mkdir(parents=True, exist_ok=True)
    new_file = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        if new_file:
            writer.writerow(["time", "temperature", "humidity"])
        writer.writerow([
            timestamp.strftime("%H:%M:%S"),
            f"{temperature:.2f}",
            f"{humidity:.2f}",
        ])


def read_samples(board: str, date_value: str) -> list[dict[str, Any]]:
    path = csv_path(board, date_value)
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    try:
        with path.open("r", newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                try:
                    temperature = float(row["temperature"])
                    humidity = float(row["humidity"])
                    time_value = str(row["time"])
                    rows.append({
                        "date": date_value,
                        "time": time_value,
                        "temperature": temperature,
                        "humidity": humidity,
                    })
                except (KeyError, TypeError, ValueError):
                    continue
    except OSError as exc:
        logger.warning("Could not read %s: %s", path, exc, extra={"category": "DATA"})
    return rows

# ---------------------------- sensor polling --------------------------------
session = requests.Session()
session.headers.update({"User-Agent": "PySmartHome-PC/3.0"})


def normalize_sensor_payload(payload: Any) -> tuple[float, float]:
    if not isinstance(payload, dict):
        raise ValueError("sensor payload is not an object")
    temperature = payload.get("temperature", payload.get("temp"))
    humidity = payload.get("humidity", payload.get("hum"))
    temperature = float(temperature)
    humidity = float(humidity)
    if not math.isfinite(temperature) or not -40 <= temperature <= 100:
        raise ValueError("invalid temperature")
    if not math.isfinite(humidity) or not 0 <= humidity <= 100:
        raise ValueError("invalid humidity")
    return round(temperature, 2), round(humidity, 2)


def poll_board(board: str) -> None:
    started = time.perf_counter()
    url = BOARDS[board]["url"]
    try:
        response = session.get(url, timeout=HTTP_TIMEOUT)
        latency = int((time.perf_counter() - started) * 1000)
        response.raise_for_status()
        temperature, humidity = normalize_sensor_payload(response.json())
        stamp = iran_now()
        append_sample(board, temperature, humidity, stamp)
        with state_lock:
            s = sensors[board]
            s.update({
                "temperature": temperature,
                "humidity": humidity,
                "last_seen_epoch": time.time(),
                "last_success": iso_now(),
                "last_error": None,
                "latency_ms": latency,
                "samples": int(s["samples"]) + 1,
                "consecutive_failures": 0,
            })
        logger.info("%s → %.2f°C / %.1f%% • %d ms", BOARDS[board]["name"], temperature, humidity, latency, extra={"category": "POLL"})
    except Exception as exc:
        with state_lock:
            sensors[board]["last_error"] = str(exc)
            sensors[board]["consecutive_failures"] += 1
        logger.warning("%s unavailable • %s", BOARDS[board]["name"], exc, extra={"category": "POLL"})


def poll_all() -> None:
    for board in BOARDS:
        poll_board(board)
    with state_lock:
        runtime["last_poll"] = iso_now()
        runtime["poll_cycles"] += 1

# ----------------------------- github sync ----------------------------------
def github_enabled() -> bool:
    return bool(GITHUB_TOKEN)


def github_put(path: str, content: str, message: str) -> None:
    if not github_enabled():
        raise RuntimeError("PYSMART_GITHUB_TOKEN is not configured")
    url = f"https://api.github.com/repos/{GITHUB_USER}/{GITHUB_REPO}/contents/{path}"
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "PySmartHome-PC/3.0",
    }
    with github_lock:
        existing = session.get(url, headers=headers, params={"ref": GITHUB_BRANCH}, timeout=HTTP_TIMEOUT + 4)
        if existing.status_code not in (200, 404):
            raise RuntimeError(f"GitHub lookup HTTP {existing.status_code}")
        payload: dict[str, Any] = {
            "message": message,
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "branch": GITHUB_BRANCH,
        }
        if existing.status_code == 200:
            current = existing.json()
            # The Contents API creates a commit on every PUT. Avoid noisy commits
            # when the generated snapshot did not change.
            try:
                stored = base64.b64decode(current.get("content", "")).decode("utf-8")
            except (ValueError, UnicodeDecodeError):
                stored = None
            if stored == content:
                return
            sha = current.get("sha")
            if sha:
                payload["sha"] = sha
        response = session.put(url, headers=headers, json=payload, timeout=HTTP_TIMEOUT + 5)
        response.raise_for_status()


def build_status_snapshot() -> dict[str, Any]:
    with state_lock:
        now_ts = time.time()
        return {
            "schema_version": 3,
            "generated_at": iso_now(),
            "timezone": "Asia/Tehran",
            "nodes": {
                board: {
                    "name": cfg["name"],
                    "online": (now_ts - float(sensors[board]["last_seen_epoch"])) <= NODE_TIMEOUT,
                    "temperature": sensors[board]["temperature"],
                    "humidity": sensors[board]["humidity"],
                    "last_seen": sensors[board]["last_success"],
                    "latency_ms": sensors[board]["latency_ms"],
                    "samples": sensors[board]["samples"],
                    "consecutive_failures": sensors[board]["consecutive_failures"],
                }
                for board, cfg in BOARDS.items()
            },
            "server": {
                "uptime_seconds": max(0, int(time.time() - runtime["started_at"])),
                "last_poll": runtime["last_poll"],
                "last_publish": runtime["last_publish"],
                "publish_ok": runtime["last_publish_ok"],
            },
            "thresholds": {"temperature_alert_c": TEMP_ALERT_THRESHOLD},
        }


def publish_to_github_once() -> bool:
    snapshot = build_status_snapshot()
    try:
        STATUS_FILE.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        logger.error("Could not write local status snapshot: %s", exc, extra={"category": "SYNC"})

    if not github_enabled():
        with state_lock:
            runtime["last_publish"] = iso_now()
            runtime["last_publish_ok"] = False
            runtime["publish_error"] = "GitHub token is not configured"
        logger.info("GitHub sync skipped (token not configured)", extra={"category": "SYNC"})
        return False

    try:
        current_day = today().isoformat()
        for board in BOARDS:
            path = csv_path(board, current_day)
            if path.exists():
                github_put(f"data/{path.name}", path.read_text(encoding="utf-8"), f"data: refresh {path.name}")
        github_put("data/status.json", json.dumps(snapshot, ensure_ascii=False, indent=2), "status: refresh snapshot")
        with state_lock:
            schedule_copy = dict(outage_schedule)
        github_put("data/outage_schedule.json", json.dumps(schedule_copy, ensure_ascii=False, indent=2), "outage: refresh schedule")
        with state_lock:
            runtime["last_publish"] = iso_now()
            runtime["last_publish_ok"] = True
            runtime["publish_error"] = None
        logger.info("GitHub snapshot published successfully", extra={"category": "SYNC"})
        return True
    except Exception as exc:
        with state_lock:
            runtime["last_publish"] = iso_now()
            runtime["last_publish_ok"] = False
            runtime["publish_error"] = str(exc)
        logger.error("GitHub publish failed • %s", exc, extra={"category": "SYNC"})
        return False

# ----------------------------- market cache ---------------------------------
def validate_market_snapshot(payload: Any) -> dict[str, Any]:
    """Validate the small, versioned payload produced by the GitHub Action."""
    if not isinstance(payload, dict) or payload.get("v") != 1:
        raise ValueError("unsupported market snapshot schema")

    normalized: dict[str, Any] = {"v": 1}
    for key in ("usd_toman", "gold18k_toman"):
        value = payload.get(key)
        if isinstance(value, bool):
            raise ValueError(f"invalid {key}")
        try:
            number = int(value)
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError(f"invalid {key}") from exc
        if number <= 0 or number > 10**15:
            raise ValueError(f"out-of-range {key}")
        normalized[key] = number

    updated_at = payload.get("updated_at")
    if not isinstance(updated_at, str) or len(updated_at) < 10 or len(updated_at) > 32:
        raise ValueError("invalid updated_at")
    try:
        dt.datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("invalid updated_at") from exc
    normalized["updated_at"] = updated_at
    normalized["usd_stale"] = bool(payload.get("usd_stale", True))
    normalized["gold_stale"] = bool(payload.get("gold_stale", True))
    return normalized


def _persist_market_cache(payload: dict[str, Any], fetched_at: float) -> None:
    """Atomically persist the last valid snapshot for offline/restart recovery."""
    wrapper = {"saved_at": fetched_at, "snapshot": payload}
    temporary = MARKET_CACHE_FILE.with_suffix(".json.tmp")
    try:
        MARKET_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        temporary.write_text(json.dumps(wrapper, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        os.replace(temporary, MARKET_CACHE_FILE)
    except OSError as exc:
        logger.warning("Could not persist market cache • %s", exc, extra={"category": "MARKET"})
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass


def _parse_market_datetime(value: Any) -> dt.datetime:
    if isinstance(value, bool) or value is None:
        raise ValueError("missing market timestamp")
    if isinstance(value, (int, float)):
        numeric = float(value)
        if not math.isfinite(numeric) or numeric <= 0:
            raise ValueError("invalid market timestamp")
        if numeric > 10_000_000_000:
            numeric /= 1000.0
        return dt.datetime.fromtimestamp(numeric, tz=dt.timezone.utc)
    parsed = dt.datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def _decode_market_document(raw: bytes, source_url: str) -> dict[str, Any]:
    """Decode either raw JSON or GitHub Contents API's Base64 envelope."""
    try:
        value = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid JSON response: {exc}") from exc
    if isinstance(value, dict) and value.get("encoding") == "base64" and isinstance(value.get("content"), str):
        try:
            decoded = base64.b64decode("".join(value["content"].split()), validate=True)
            value = json.loads(decoded.decode("utf-8-sig"))
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"invalid GitHub Contents Base64 payload: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError("market response root is not a JSON object")
    return value


def _normalize_market_document(value: dict[str, Any]) -> dict[str, Any]:
    """Accept the compact PySmartHome schema or derive it from ArzPulse on the PC."""
    if value.get("v") == 1:
        return validate_market_snapshot(value)

    # Emergency PC-side fallback. The normal path is the tiny precomputed
    # market/esp32.json. If that file cannot be reached, this PC (not the ESP32)
    # can extract the two required fields from ArzPulse's full feed.
    if "dollarPrice" not in value or "gold18K" not in value:
        raise ValueError("unsupported market source: expected compact snapshot or ArzPulse latest.json")
    def to_toman(raw_value: Any, field: str) -> int:
        if isinstance(raw_value, bool) or raw_value is None:
            raise ValueError(f"invalid ArzPulse {field}")
        try:
            amount = Decimal(str(raw_value).strip())
        except (InvalidOperation, ValueError, AttributeError):
            raise ValueError(f"invalid ArzPulse {field}") from None
        if not amount.is_finite() or amount <= 0:
            raise ValueError(f"invalid ArzPulse {field}")
        converted = int((amount / Decimal(10)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        if converted <= 0 or converted > 10**15:
            raise ValueError(f"out-of-range ArzPulse {field}")
        return converted

    source_time = _parse_market_datetime(value.get("timestamp"))
    now_utc = dt.datetime.now(dt.timezone.utc)
    too_old = now_utc - source_time > dt.timedelta(seconds=MARKET_MAX_AGE_SECONDS) or source_time - now_utc > dt.timedelta(minutes=5)
    stale_flags = value.get("derivedStale") if isinstance(value.get("derivedStale"), dict) else {}
    normalized = {
        "v": 1,
        "updated_at": source_time.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "usd_toman": to_toman(value.get("dollarPrice"), "dollarPrice"),
        "gold18k_toman": to_toman(value.get("gold18K"), "gold18K"),
        "usd_stale": bool(stale_flags.get("dollar", True)) or too_old,
        "gold_stale": bool(stale_flags.get("gold18K", True)) or too_old,
    }
    return validate_market_snapshot(normalized)


def _market_source_headers(source_url: str) -> dict[str, str]:
    is_api = "api.github.com/repos/" in source_url and "/contents/" in source_url
    headers = {
        "Accept": "application/vnd.github.raw+json" if is_api else "application/json",
        "Cache-Control": "no-cache",
        "Accept-Encoding": "identity",
        "User-Agent": "PySmartHome-PC/4.1.2 market-proxy",
        "Connection": "close",
    }
    if is_api and GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return headers


def load_market_cache() -> bool:
    """Restore persisted cache, or seed from the repository's bundled market file."""
    global market_snapshot, market_snapshot_fetched_at, market_snapshot_error, market_snapshot_source
    try:
        wrapper = json.loads(MARKET_CACHE_FILE.read_text(encoding="utf-8"))
        payload = validate_market_snapshot(wrapper.get("snapshot"))
        saved_at = float(wrapper.get("saved_at", 0))
        if not math.isfinite(saved_at) or saved_at <= 0:
            raise ValueError("invalid cache timestamp")
        with market_lock:
            market_snapshot = payload
            market_snapshot_fetched_at = saved_at
            age = max(0, int(time.time() - saved_at))
            market_snapshot_error = "Restored local cache" if age <= MARKET_MAX_AGE_SECONDS else "Restored stale local cache"
            market_snapshot_source = "data/market_snapshot_cache.json"
        logger.info("Restored local market cache • age=%ss", age, extra={"category": "MARKET"})
        return True
    except FileNotFoundError:
        pass
    except Exception as exc:
        logger.warning("Ignoring invalid local market cache • %s", exc, extra={"category": "MARKET"})

    # Seed from the checked-in market output so first startup can serve prices
    # immediately, even before the first online fetch succeeds.
    candidates = (BASE_DIR / "market" / "esp32.json", ASSET_DIR / "market" / "esp32.json")
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate.resolve())
        if key in seen:
            continue
        seen.add(key)
        try:
            raw = candidate.read_bytes()
            if not raw or len(raw) > 512:
                raise ValueError("bundled ESP32 snapshot is empty or exceeds 512 bytes")
            payload = validate_market_snapshot(_decode_market_document(raw, str(candidate)))
            fetched_at = time.time()
            with market_lock:
                market_snapshot = payload
                market_snapshot_fetched_at = fetched_at
                market_snapshot_error = "Seeded from bundled market/esp32.json; checking online source"
                market_snapshot_source = "market/esp32.json (bundled seed)"
            _persist_market_cache(payload, fetched_at)
            logger.info("Seeded market cache from bundled market/esp32.json • bytes=%s", len(raw), extra={"category": "MARKET"})
            return True
        except FileNotFoundError:
            continue
        except Exception as exc:
            logger.warning("Could not seed market cache from %s • %s", candidate, exc, extra={"category": "MARKET"})
    return False


def refresh_market_snapshot_once() -> bool:
    """Fetch a compact snapshot through resilient GitHub/CDN origins; keep last-good data."""
    global market_snapshot, market_snapshot_fetched_at, market_snapshot_error
    global market_snapshot_source, market_last_attempt_at, market_consecutive_failures
    market_last_attempt_at = time.time()
    errors: list[str] = []
    for source_url in MARKET_SOURCE_URLS:
        try:
            is_api = "api.github.com/repos/" in source_url and "/contents/" in source_url
            params = None if is_api else {"v": int(time.time())}
            with requests.get(
                source_url,
                params=params,
                headers=_market_source_headers(source_url),
                timeout=(MARKET_CONNECT_TIMEOUT, MARKET_HTTP_TIMEOUT),
                stream=True,
            ) as response:
                response.raise_for_status()
                content_length = response.headers.get("Content-Length")
                if content_length and int(content_length) > 2 * 1024 * 1024:
                    raise ValueError("market source exceeds the 2 MiB safety limit")
                raw = response.raw.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024:
                    raise ValueError("market source exceeds the 2 MiB safety limit")
            document = _decode_market_document(raw, source_url)
            payload = _normalize_market_document(document)
            fetched_at = time.time()
            with market_lock:
                market_snapshot = payload
                market_snapshot_fetched_at = fetched_at
                market_snapshot_error = "OK"
                market_snapshot_source = source_url
                market_consecutive_failures = 0
            _persist_market_cache(payload, fetched_at)
            logger.info(
                "Market snapshot refreshed • source=%s • USD=%s T • Gold18K=%s T • stale=%s/%s",
                source_url.split("/")[2], payload["usd_toman"], payload["gold18k_toman"],
                payload["usd_stale"], payload["gold_stale"], extra={"category": "MARKET"},
            )
            return True
        except Exception as exc:
            host = source_url.split("/")[2] if "://" in source_url else "local"
            errors.append(f"{host}: {type(exc).__name__}: {str(exc)[:110]}")
    detail = " | ".join(errors)[:650] or "no market source configured"
    with market_lock:
        market_snapshot_error = detail
        market_consecutive_failures += 1
        has_cache = market_snapshot is not None
    logger.warning(
        "All market sources failed • attempts=%s • cached=%s • %s",
        len(MARKET_SOURCE_URLS), has_cache, detail, extra={"category": "MARKET"}
    )
    return False


def market_worker_loop() -> None:
    while True:
        ok = refresh_market_snapshot_once()
        if ok:
            delay = MARKET_REFRESH_SECONDS
        else:
            with market_lock:
                failures = max(1, market_consecutive_failures)
            delay = min(300, max(15, 15 * (2 ** min(failures - 1, 4))))
        time.sleep(delay)


# ---------------------------- background worker -----------------------------
def worker_loop() -> None:
    next_publish = 0.0
    while True:
        started = time.time()
        try:
            poll_all()
        except Exception:
            logger.exception("Unexpected polling worker failure", extra={"category": "POLL"})
        if started >= next_publish:
            publish_to_github_once()
            next_publish = started + PUBLISH_INTERVAL
        elapsed = time.time() - started
        time.sleep(max(0.5, POLL_INTERVAL - elapsed))


def start_worker() -> None:
    global worker_started, market_worker_started
    if not worker_started:
        worker_started = True
        threading.Thread(target=worker_loop, name="pysmarthome-worker", daemon=True).start()
        logger.info("Background worker started • poll=%ss • publish=%ss", POLL_INTERVAL, PUBLISH_INTERVAL, extra={"category": "SYS"})
    if not market_worker_started:
        load_market_cache()
        market_worker_started = True
        threading.Thread(target=market_worker_loop, name="pysmarthome-market", daemon=True).start()
        logger.info("Market proxy worker started • refresh=%ss • sources=%s", MARKET_REFRESH_SECONDS, len(MARKET_SOURCE_URLS), extra={"category": "MARKET"})

# ------------------------------- flask --------------------------------------
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES + 1024 * 1024

ALLOWED_PUBLIC_FILES = {
    "index.html", "app.js", "style.css", "bg.js", "sw.js",
    "manifest.webmanifest", "icon.svg", "analytics-loader.js",
}
ALLOWED_DATA_JSON = {"status.json", "outage_schedule.json"}


def is_loopback_request() -> bool:
    address = request.remote_addr or ""
    try:
        return ipaddress.ip_address(address).is_loopback
    except ValueError:
        return address.lower() == "localhost"


def mutation_is_authorized() -> bool:
    # Loopback access is trusted for normal single-PC operation. If the server
    # is LAN-exposed, remote write operations require a configured admin key.
    if is_loopback_request():
        return True
    supplied = request.headers.get("X-Admin-Key", "")
    return bool(API_ADMIN_KEY and supplied and hmac.compare_digest(supplied, API_ADMIN_KEY))


def is_sensor_csv_name(filename: str) -> bool:
    match = SENSOR_CSV_RE.fullmatch(filename)
    if not match:
        return False
    try:
        dt.date.fromisoformat(match.group(2))
        return True
    except ValueError:
        return False


def validate_sensor_csv(raw: bytes) -> tuple[bool, str]:
    if not raw:
        return False, "The uploaded CSV is empty."
    if len(raw) > MAX_UPLOAD_BYTES:
        return False, "The CSV exceeds the 5 MiB upload limit."
    try:
        decoded = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return False, "CSV must be UTF-8 encoded."
    try:
        reader = csv.DictReader(decoded.splitlines())
        headers = {str(h or "").strip().lower() for h in (reader.fieldnames or [])}
        if not {"time", "temperature", "humidity"}.issubset(headers):
            return False, "CSV must contain time, temperature, and humidity columns."
        count = 0
        for row in reader:
            if not row or not any(row.values()):
                continue
            normalized = {str(key or "").strip().lower(): value for key, value in row.items()}
            count += 1
            if count > 150000:
                return False, "The CSV has too many rows (limit: 150,000)."
            try:
                time_value = str(normalized.get("time", "")).strip()
                dt.datetime.strptime(time_value, "%H:%M:%S")
                temperature = float(normalized.get("temperature", ""))
                humidity = float(normalized.get("humidity", ""))
                if not math.isfinite(temperature) or not -40 <= temperature <= 100:
                    return False, f"Invalid temperature in row {count + 1}."
                if not math.isfinite(humidity) or not 0 <= humidity <= 100:
                    return False, f"Invalid humidity in row {count + 1}."
            except (ValueError, TypeError):
                return False, f"Invalid measurement in row {count + 1}."
        if count == 0:
            return False, "CSV does not contain any measurements."
    except csv.Error as exc:
        return False, f"CSV parsing failed: {exc}"
    return True, "ok"

@app.after_request
def headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if request.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.get("/")
def root():
    response = send_from_directory(ASSET_DIR, "index.html")
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/api/market")
def api_market():
    """Serve the tiny validated market file to ESP32 nodes over local HTTP."""
    with market_lock:
        snapshot = dict(market_snapshot) if market_snapshot is not None else None
        fetched_at = market_snapshot_fetched_at
        error = market_snapshot_error
    if snapshot is None:
        return jsonify({"ok": False, "error": "market_snapshot_not_ready", "detail": error}), 503
    snapshot_age = max(0, int(time.time() - fetched_at))
    try:
        generated_at = dt.datetime.fromisoformat(snapshot["updated_at"].replace("Z", "+00:00"))
        source_age = max(0, int((dt.datetime.now(dt.timezone.utc) - generated_at.astimezone(dt.timezone.utc)).total_seconds()))
    except (KeyError, TypeError, ValueError):
        source_age = MARKET_MAX_AGE_SECONDS + 1
    if source_age > MARKET_MAX_AGE_SECONDS:
        snapshot["usd_stale"] = True
        snapshot["gold_stale"] = True
    response = jsonify(snapshot)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["X-Market-Source-Age"] = str(source_age)
    response.headers["X-Market-Proxy-Age"] = str(max(0, int(time.time() - fetched_at)))
    return response


@app.get("/api/health")
def api_health():
    with market_lock:
        market_ready = market_snapshot is not None
        market_age = max(0, int(time.time() - market_snapshot_fetched_at)) if market_snapshot_fetched_at else None
        market_error = market_snapshot_error
        market_source = market_snapshot_source
    return jsonify({
        "ok": True,
        "service": "PySmartHome-PC",
        "version": "4.1.2",
        "schema_version": 4,
        "time": iso_now(),
        "timezone": "Asia/Tehran",
        "github_sync_enabled": github_enabled(),
        "worker_started": worker_started,
        "market_proxy_ready": market_ready,
        "market_proxy_age_seconds": market_age,
        "market_proxy_error": market_error,
        "market_proxy_source": market_source,
        "market_source_count": len(MARKET_SOURCE_URLS),
        "market_cache_persisted": MARKET_CACHE_FILE.is_file(),
        "market_lan_access_enabled": HOST in {"0.0.0.0", "::"},
        "mode": "frozen" if FROZEN else "python",
    })


@app.get("/api/diagnostics")
def api_diagnostics():
    try:
        disk = shutil.disk_usage(DATA_DIR)
        disk_status = {"total_bytes": disk.total, "free_bytes": disk.free, "used_bytes": disk.used}
    except OSError:
        disk_status = None
    with state_lock:
        with market_lock:
            market_ready = market_snapshot is not None
            market_age = max(0, int(time.time() - market_snapshot_fetched_at)) if market_snapshot_fetched_at else None
            market_error = market_snapshot_error
            market_source = market_snapshot_source
        return jsonify({
            "version": "4.1.2",
            "generated_at": iso_now(),
            "uptime_seconds": max(0, int(time.time() - runtime["started_at"])),
            "poll_cycles": runtime["poll_cycles"],
            "last_poll": runtime["last_poll"],
            "last_publish": runtime["last_publish"],
            "publish_ok": runtime["last_publish_ok"],
            "publish_error": runtime["publish_error"],
            "market_proxy_ready": market_ready,
            "market_proxy_age_seconds": market_age,
            "market_proxy_error": market_error,
            "market_proxy_source": market_source,
            "market_source_count": len(MARKET_SOURCE_URLS),
            "market_cache_persisted": MARKET_CACHE_FILE.is_file(),
            "market_max_age_seconds": MARKET_MAX_AGE_SECONDS,
            "market_lan_access_enabled": HOST in {"0.0.0.0", "::"},
            "host": HOST,
            "port": PORT,
            "poll_interval_seconds": POLL_INTERVAL,
            "publish_interval_seconds": PUBLISH_INTERVAL,
            "node_timeout_seconds": NODE_TIMEOUT,
            "github_sync_enabled": github_enabled(),
            "admin_key_configured": bool(API_ADMIN_KEY),
            "disk": disk_status,
        })


@app.get("/api/dashboard")
def api_dashboard():
    with state_lock:
        now_ts = time.time()
        return jsonify({
            "time": iso_now(),
            "timezone": "Asia/Tehran",
            "nodes": {
                board: {
                    "name": cfg["name"],
                    "online": (now_ts - float(sensors[board]["last_seen_epoch"])) <= NODE_TIMEOUT,
                    "temperature": sensors[board]["temperature"],
                    "humidity": sensors[board]["humidity"],
                    "last_seen": sensors[board]["last_success"],
                    "last_error": sensors[board]["last_error"],
                    "latency_ms": sensors[board]["latency_ms"],
                    "samples": sensors[board]["samples"],
                    "consecutive_failures": sensors[board]["consecutive_failures"],
                }
                for board, cfg in BOARDS.items()
            },
            "server": {
                "uptime_seconds": max(0, int(now_ts - runtime["started_at"])),
                "last_poll": runtime["last_poll"],
                "last_publish": runtime["last_publish"],
                "publish_ok": runtime["last_publish_ok"],
                "publish_error": runtime["publish_error"],
                "poll_cycles": runtime["poll_cycles"],
            },
            "config": {
                "temperature_alert_c": TEMP_ALERT_THRESHOLD,
                "poll_interval_s": POLL_INTERVAL,
                "node_timeout_s": NODE_TIMEOUT,
                "local_mode": True,
            },
        })


@app.get("/api/data")
def api_data():
    board = request.args.get("board", "esp32_1")
    range_name = request.args.get("range", "daily")
    date_value = request.args.get("date", today().isoformat())
    if board not in BOARDS:
        return jsonify({"error": "invalid board"}), 400
    if not valid_date(date_value):
        return jsonify({"error": "invalid date"}), 400
    if range_name not in {"daily", "yesterday", "weekly", "monthly"}:
        return jsonify({"error": "invalid range"}), 400
    dates = date_range_for(range_name, dt.date.fromisoformat(date_value))
    data: list[dict[str, Any]] = []
    for d in dates:
        data.extend(read_samples(board, d.isoformat()))
    return jsonify({"board": board, "range": range_name, "date": date_value, "count": len(data), "data": data})


@app.get("/api/outage")
def api_outage():
    ensure_outage_schedule()
    with state_lock:
        return jsonify({
            "generated_at": iso_now(),
            "timezone": "Asia/Tehran",
            "cycle": {
                "duration_minutes": OUTAGE_DURATION_MINUTES,
                "slots": [f"{h:02d}:00" for h in SLOTS],
                "skip_friday": True,
            },
            "schedule": dict(outage_schedule),
        })


@app.post("/api/outage/update")
def api_outage_update():
    if not mutation_is_authorized():
        return jsonify({"error": "remote write access is locked; configure PYSMART_HOME_ADMIN_KEY and send X-Admin-Key"}), 403
    payload = request.get_json(silent=True) or {}
    date_value = payload.get("date")
    start = payload.get("start")
    end = payload.get("end")
    try:
        new_schedule = update_outage_from_reference(str(date_value), str(start), str(end))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    published = publish_to_github_once()
    return jsonify({"ok": True, "published": published, "schedule": new_schedule})


@app.get("/api/datetime")
def api_datetime():
    now = iran_now()
    return jsonify({
        "timezone": "Asia/Tehran",
        "iso": now.isoformat(),
        "gregorian": now.strftime("%Y-%m-%d %H:%M:%S"),
        "shamsi": None,  # frontend uses Intl Persian calendar with Latin digits
    })


@app.get("/api/files")
def api_files():
    """List permitted data files. No arbitrary filesystem paths are exposed."""
    files = []
    try:
        for path in DATA_DIR.iterdir():
            if not path.is_file():
                continue
            if not (is_sensor_csv_name(path.name) or path.name in ALLOWED_DATA_JSON):
                continue
            stat = path.stat()
            files.append({
                "name": path.name,
                "size_bytes": stat.st_size,
                "modified_at": dt.datetime.fromtimestamp(stat.st_mtime, IRAN_TZ).isoformat(timespec="seconds"),
                "kind": "csv" if path.suffix.lower() == ".csv" else "json",
                "deletable": is_sensor_csv_name(path.name),
            })
    except OSError as exc:
        return jsonify({"error": f"could not list data files: {exc}"}), 500
    files.sort(key=lambda item: item["name"], reverse=True)
    return jsonify({"count": len(files), "files": files})


@app.get("/api/download")
def api_download():
    filename = secure_filename(request.args.get("name", ""))
    if not (is_sensor_csv_name(filename) or filename in ALLOWED_DATA_JSON):
        return jsonify({"error": "file is not available for download"}), 400
    path = DATA_DIR / filename
    if not path.is_file():
        return jsonify({"error": "file not found"}), 404
    return send_from_directory(DATA_DIR, filename, as_attachment=True, conditional=True)


@app.post("/api/upload")
def api_upload():
    if not mutation_is_authorized():
        return jsonify({"error": "remote write access is locked; configure PYSMART_HOME_ADMIN_KEY and send X-Admin-Key"}), 403
    uploaded = request.files.get("file")
    if uploaded is None or not uploaded.filename:
        return jsonify({"error": "choose a CSV file first"}), 400
    filename = secure_filename(uploaded.filename)
    if not is_sensor_csv_name(filename):
        return jsonify({"error": "filename must match esp32_1_YYYY-MM-DD.csv or esp32_s3_YYYY-MM-DD.csv"}), 400
    raw = uploaded.read(MAX_UPLOAD_BYTES + 1)
    valid, reason = validate_sensor_csv(raw)
    if not valid:
        return jsonify({"error": reason}), 400
    destination = DATA_DIR / filename
    overwrite = request.form.get("overwrite", "false").lower() in {"1", "true", "yes", "on"}
    if destination.exists() and not overwrite:
        return jsonify({"error": "file already exists; enable overwrite to replace it"}), 409
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", prefix=".upload-", suffix=".tmp", dir=DATA_DIR, delete=False) as fh:
            temp_name = fh.name
            fh.write(raw)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temp_name, destination)
    except OSError as exc:
        if temp_name:
            try:
                Path(temp_name).unlink(missing_ok=True)
            except OSError:
                pass
        return jsonify({"error": f"could not save file: {exc}"}), 500
    return jsonify({"ok": True, "name": filename, "size_bytes": len(raw)}), 201


@app.delete("/api/files/<path:filename>")
def api_delete_file(filename: str):
    if not mutation_is_authorized():
        return jsonify({"error": "remote write access is locked; configure PYSMART_HOME_ADMIN_KEY and send X-Admin-Key"}), 403
    safe = secure_filename(filename)
    if safe != filename or not is_sensor_csv_name(safe):
        return jsonify({"error": "only sensor CSV files can be deleted"}), 400
    path = DATA_DIR / safe
    if not path.is_file():
        return jsonify({"error": "file not found"}), 404
    try:
        path.unlink()
    except OSError as exc:
        return jsonify({"error": f"could not delete file: {exc}"}), 500
    return jsonify({"ok": True, "deleted": safe})


@app.errorhandler(413)
def request_too_large(_error):
    return jsonify({"error": "request is too large; upload limit is 5 MiB"}), 413


@app.route("/<path:path>")
def public_files(path: str):
    if path in ALLOWED_PUBLIC_FILES:
        response = send_from_directory(ASSET_DIR, path)
        if path in {"index.html", "app.js", "style.css", "sw.js", "manifest.webmanifest"}:
            response.headers["Cache-Control"] = "no-cache"
        return response
    # Expose only the exact public data formats used by the static dashboard.
    # Never serve arbitrary files that happen to be placed inside DATA_DIR.
    if path.startswith("data/"):
        relative = Path(path[5:])
        if len(relative.parts) == 1 and (is_sensor_csv_name(relative.name) or relative.name in ALLOWED_DATA_JSON):
            return send_from_directory(DATA_DIR, relative.name)
    return jsonify({"error": "not found"}), 404


if __name__ == "__main__":
    logger.info("PySmartHome-PC starting", extra={"category": "SYS"})
    logger.info("Server: http://%s:%s", HOST, PORT, extra={"category": "SYS"})
    logger.info("Room 1 endpoint: %s", ESP32_HUB_URL, extra={"category": "CFG"})
    logger.info("Room 2 endpoint: %s", ESP32_S3_URL, extra={"category": "CFG"})
    logger.info("Iran time zone: Asia/Tehran (UTC+03:30)", extra={"category": "TIME"})
    logger.info("GitHub sync: %s", "enabled" if github_enabled() else "disabled", extra={"category": "SYNC"})
    logger.info("Network exposure: %s", "LAN bind enabled • run tools/enable_lan_firewall.ps1 as Administrator" if HOST in {"0.0.0.0", "::"} else "loopback-only", extra={"category": "SEC"})
    if HOST not in {"0.0.0.0", "::"}:
        logger.warning("Market LAN access is disabled • set PYSMART_HOME_LAN_ACCESS=1 and restart", extra={"category": "MARKET"})
    logger.info("Outage reference: today 13:00–15:00 • Friday skipped", extra={"category": "OUTAGE"})
    start_worker()
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
