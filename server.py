#!/usr/bin/env python3
"""
PySmartHome-PC – Complete Server with Auto Outage Schedule
"""

import os, sys, subprocess, json, csv, time, datetime, base64, logging
from pathlib import Path

# ---------- Suppress noisy logs ----------
logging.getLogger('werkzeug').setLevel(logging.ERROR)
logging.getLogger('apscheduler').setLevel(logging.WARNING)

def install_requirements():
    req_file = "requirements.txt"
    if not os.path.exists(req_file):
        print("[!] requirements.txt not found")
        sys.exit(1)
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", req_file],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
install_requirements()

import requests
from flask import Flask, request, render_template, send_from_directory, jsonify
from werkzeug.utils import secure_filename
from apscheduler.schedulers.background import BackgroundScheduler
import jdatetime

# ---------- Config ----------
GITHUB_USER = "mehrdadmb2"
GITHUB_REPO = "PySmartHome-PC"
GITHUB_BRANCH = "main"
GITHUB_TOKEN = ""
with open("config.txt", "r") as f:
    content = f.read().strip()
if "token " in content:
    GITHUB_TOKEN = content.split("token ")[1]
else:
    GITHUB_TOKEN = content

ESP32_HUB_URL = "http://192.168.1.119/api/status"
ESP32_S3_URL  = "http://192.168.1.115/api/status"

DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)

OUTAGE_FILE = "outage_schedule.json"

def load_outage():
    if os.path.exists(OUTAGE_FILE):
        with open(OUTAGE_FILE, "r", encoding="utf-8") as f:
            try:
                return json.load(f)
            except:
                return {}
    return {}

def save_outage(data):
    with open(OUTAGE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

outage_schedule = load_outage()

# ---------- Outage generation algorithm ----------
def generate_outage_schedule(reference_date, reference_start_hour, reference_start_min=0):
    """
    Generate a schedule for a range of dates based on a reference.
    Shifts by 2 hours each day. Skips Fridays.
    Only between 09:00 and 21:00.
    """
    start_hour = reference_start_hour
    start_min = reference_start_min
    current_date = datetime.datetime.strptime(reference_date, "%Y-%m-%d").date()
    # Generate for yesterday, today, tomorrow and next few days
    for delta in range(-1, 5):
        d = current_date + datetime.timedelta(days=delta)
        # Skip if Friday (weekday 4)
        if d.weekday() == 4:
            continue
        date_str = d.isoformat()
        if date_str not in outage_schedule:
            # Convert to minutes and ensure within 9:00-21:00
            total_min = start_hour * 60 + start_min + (delta + 1) * 120  # shift by 2 hours each day
            total_min %= (12 * 60)  # wrap around 12-hour window from 9 to 21
            actual_start = 9 * 60 + total_min
            # If wraps past 21:00, reset to 9:00
            if actual_start >= 21 * 60:
                actual_start = 9 * 60
            start_h, start_m = divmod(actual_start, 60)
            end_h = start_h + 2
            if end_h > 21:  # if crosses 21, wrap to 9 next day? but we don't do next day, just cap at 21
                end_h = 21
                end_m = 0
            else:
                end_m = 0
            outage_schedule[date_str] = {
                "start": f"{start_h:02d}:{start_m:02d}",
                "end": f"{end_h:02d}:{end_m:02d}"
            }
    save_outage(outage_schedule)

# Set default if today missing
today_str = datetime.date.today().isoformat()
if today_str not in outage_schedule:
    # Use reference: today 1 PM to 3 PM
    generate_outage_schedule(today_str, 13, 0)

# ---------- Logging / Sensor state ----------
sensors = {
    "esp32_1": {"temp": 0, "hum": 0, "last_seen": 0},
    "esp32_s3": {"temp": 0, "hum": 0, "last_seen": 0}
}
NODE_TIMEOUT = 600

def log(msg):
    timestamp = datetime.datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {msg}")

# ---------- GitHub helpers ----------
def upload_file_to_github(path, content):
    url = f"https://api.github.com/repos/{GITHUB_USER}/{GITHUB_REPO}/contents/{path}"
    headers = {"Authorization": f"token {GITHUB_TOKEN}", "User-Agent": "PySmartHome"}
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        sha = resp.json().get("sha", "") if resp.status_code == 200 else ""
        data = {"message": "auto update", "content": base64.b64encode(content.encode()).decode(), "branch": GITHUB_BRANCH}
        if sha: data["sha"] = sha
        r = requests.put(url, headers=headers, json=data, timeout=10)
        if r.status_code >= 400:
            log(f"GitHub upload failed for {path}: {r.status_code}")
        else:
            log(f"GitHub upload OK: {path}")
    except Exception as e:
        log(f"GitHub error: {e}")

def push_to_github():
    today = datetime.date.today().isoformat()
    for board in ["esp32_1", "esp32_s3"]:
        fname = f"{board}_{today}.csv"
        fpath = os.path.join(DATA_DIR, fname)
        if os.path.exists(fpath):
            with open(fpath, "r") as f:
                upload_file_to_github(f"data/{fname}", f.read())
            time.sleep(0.5)
    status = {
        "esp32_1_online": (time.time() - sensors["esp32_1"]["last_seen"]) < NODE_TIMEOUT,
        "esp32_s3_online": (time.time() - sensors["esp32_s3"]["last_seen"]) < NODE_TIMEOUT,
        "last_push": datetime.datetime.now().isoformat()
    }
    upload_file_to_github("status.json", json.dumps(status))
    with open(OUTAGE_FILE, "r", encoding="utf-8") as f:
        upload_file_to_github(OUTAGE_FILE, f.read())

# ---------- CSV logging ----------
def log_to_csv(board, temp, hum):
    today = datetime.date.today().isoformat()
    filename = os.path.join(DATA_DIR, f"{board}_{today}.csv")
    file_exists = os.path.isfile(filename)
    with open(filename, "a", newline="") as f:
        writer = csv.writer(f)
        if not file_exists:
            writer.writerow(["time", "temperature", "humidity"])
        now = datetime.datetime.now().strftime("%H:%M:%S")
        writer.writerow([now, f"{temp:.1f}", f"{hum:.1f}"])

# ---------- Sensor polling ----------
def poll_sensors():
    for name, url in [("esp32_1", ESP32_HUB_URL), ("esp32_s3", ESP32_S3_URL)]:
        try:
            resp = requests.get(url, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                sensors[name]["temp"] = data["temp"]
                sensors[name]["hum"] = data["humidity"]
                sensors[name]["last_seen"] = time.time()
                log_to_csv(name, data["temp"], data["humidity"])
                log(f"{name} updated: {data['temp']:.1f}°C, {data['humidity']:.0f}%")
            else:
                log(f"{name} HTTP {resp.status_code}")
        except Exception as e:
            log(f"{name} offline ({e})")

# ---------- Flask app ----------
app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/current')
def current():
    return jsonify({
        'esp32_1_temp': sensors['esp32_1']['temp'],
        'esp32_1_hum': sensors['esp32_1']['hum'],
        'esp32_s3_temp': sensors['esp32_s3']['temp'],
        'esp32_s3_hum': sensors['esp32_s3']['hum']
    })

@app.route('/api/nodestatus')
def node_status():
    now = time.time()
    return jsonify({
        'hub_online': True,
        's3_online': (now - sensors['esp32_s3']['last_seen']) < NODE_TIMEOUT
    })

@app.route('/api/data')
def get_data():
    board = request.args.get('board', 'esp32_1')
    range_type = request.args.get('range', 'daily')
    date_str = request.args.get('date', datetime.date.today().isoformat())
    fpath = os.path.join(DATA_DIR, f"{board}_{date_str}.csv")
    if not os.path.exists(fpath):
        return jsonify([])
    data = []
    with open(fpath, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            data.append({'time': row['time'], 'temp': float(row['temperature']), 'humidity': float(row['humidity'])})
    if range_type == 'hourly':
        now = datetime.datetime.now()
        cutoff = now - datetime.timedelta(hours=1)
        data = [d for d in data if datetime.datetime.combine(datetime.date.today(), datetime.datetime.strptime(d['time'], '%H:%M:%S').time()) >= cutoff]
    return jsonify(data)

@app.route('/api/datetime')
def current_datetime():
    now = datetime.datetime.now()
    j = jdatetime.datetime.fromgregorian(datetime=now)
    return jsonify({'gregorian': now.strftime('%Y-%m-%d %H:%M:%S'), 'shamsi': j.strftime('%Y/%m/%d %H:%M:%S')})

@app.route('/api/outage')
def get_outage():
    return jsonify(outage_schedule)

@app.route('/api/outage/update', methods=['POST'])
def update_outage():
    data = request.get_json()
    date_str = data.get('date'); start = data.get('start'); end = data.get('end')
    if not all([date_str, start, end]): return 'invalid', 400
    outage_schedule[date_str] = {"start": start, "end": end}
    save_outage(outage_schedule)
    log(f"Outage updated for {date_str}: {start} - {end}")
    return jsonify({'status': 'ok'})

@app.route('/api/outage/countdown')
def outage_countdown():
    today = datetime.date.today().isoformat()
    sched = outage_schedule.get(today)
    if not sched: return jsonify({"status": "no_data"})
    now = datetime.datetime.now()
    start = datetime.datetime.strptime(today + " " + sched["start"], "%Y-%m-%d %H:%M")
    end = datetime.datetime.strptime(today + " " + sched["end"], "%Y-%m-%d %H:%M")
    if now < start:
        diff = start - now
        return jsonify({"status": "before", "total_seconds": int(diff.total_seconds()),
                        "message": f"Power cut in {diff.seconds//3600}h {(diff.seconds//60)%60}m"})
    elif now < end:
        diff = end - now
        return jsonify({"status": "during", "total_seconds": int(diff.total_seconds()),
                        "message": f"Power returns in {diff.seconds//3600}h {(diff.seconds//60)%60}m"})
    else:
        return jsonify({"status": "after", "message": "Power is on"})

# File management endpoints unchanged (same as before)

if __name__ == '__main__':
    log("SmartHome server starting...")
    scheduler = BackgroundScheduler()
    scheduler.add_job(poll_sensors, 'interval', seconds=10)
    scheduler.add_job(push_to_github, 'interval', minutes=5)
    scheduler.start()
    poll_sensors()
    log("Server running on http://0.0.0.0:5000")
    app.run(host='0.0.0.0', port=5000, debug=False)
