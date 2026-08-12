#!/usr/bin/env python3
"""
PySmartHome-PC – Smart Home Server (Final Stable)
"""

import os, sys, subprocess, json, csv, time, datetime, base64

# ---------- 1. Install dependencies ----------
def install_requirements():
    req_file = "requirements.txt"
    if not os.path.exists(req_file):
        print("[!] requirements.txt not found")
        sys.exit(1)
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", req_file])
install_requirements()

import requests
from flask import Flask, request, render_template, send_from_directory, jsonify
from werkzeug.utils import secure_filename
from apscheduler.schedulers.background import BackgroundScheduler
import jdatetime

# ---------- 2. Configuration ----------
GITHUB_USER = "mehrdadmb2"
GITHUB_REPO = "PySmartHome-PC"
GITHUB_BRANCH = "main"

# ---------- خواندن صحیح توکن ----------
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

# ---------- بارگذاری ایمن فایل قطع برق ----------
OUTAGE_FILE = "outage_schedule.json"
outage_schedule = {}
if os.path.exists(OUTAGE_FILE):
    try:
        with open(OUTAGE_FILE, "r", encoding="utf-8") as f:
            content = f.read().strip()
            if content:
                outage_schedule = json.loads(content)
            else:
                outage_schedule = {}
    except json.JSONDecodeError:
        print("[!] outage_schedule.json corrupted, resetting.")
        outage_schedule = {}
        with open(OUTAGE_FILE, "w", encoding="utf-8") as f:
            f.write("{}")
else:
    with open(OUTAGE_FILE, "w", encoding="utf-8") as f:
        f.write("{}")

def save_outage():
    with open(OUTAGE_FILE, "w", encoding="utf-8") as f:
        json.dump(outage_schedule, f, indent=2)

# Sensor state
sensors = {
    "esp32_1": {"temp": 0, "hum": 0, "last_seen": 0},
    "esp32_s3": {"temp": 0, "hum": 0, "last_seen": 0}
}
NODE_TIMEOUT = 600

# ---------- 3. GitHub helpers ----------
def upload_file_to_github(path, content):
    url = f"https://api.github.com/repos/{GITHUB_USER}/{GITHUB_REPO}/contents/{path}"
    headers = {"Authorization": f"token {GITHUB_TOKEN}", "User-Agent": "PySmartHome"}
    resp = requests.get(url, headers=headers)
    sha = resp.json().get("sha", "") if resp.status_code == 200 else ""
    data = {
        "message": "auto update",
        "content": base64.b64encode(content.encode()).decode(),
        "branch": GITHUB_BRANCH
    }
    if sha:
        data["sha"] = sha
    requests.put(url, headers=headers, json=data)

def push_to_github():
    today = datetime.date.today().isoformat()
    for board in ["esp32_1", "esp32_s3"]:
        fname = f"{board}_{today}.csv"
        fpath = os.path.join(DATA_DIR, fname)
        if os.path.exists(fpath):
            with open(fpath, "r") as f:
                content = f.read()
            upload_file_to_github(f"data/{fname}", content)
            time.sleep(1)
    status = {
        "esp32_1_online": (time.time() - sensors["esp32_1"]["last_seen"]) < NODE_TIMEOUT,
        "esp32_s3_online": (time.time() - sensors["esp32_s3"]["last_seen"]) < NODE_TIMEOUT,
        "last_push": datetime.datetime.now().isoformat()
    }
    upload_file_to_github("status.json", json.dumps(status))
    with open(OUTAGE_FILE, "r", encoding="utf-8") as f:
        upload_file_to_github(OUTAGE_FILE, f.read())

# ---------- 4. CSV logging ----------
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

# ---------- 5. Sensor polling ----------
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
        except Exception as e:
            print(f"[!] Poll {name} failed: {e}")

# ---------- 6. Flask app ----------
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
            data.append({
                'time': row['time'],
                'temp': float(row['temperature']),
                'humidity': float(row['humidity'])
            })
    if range_type == 'hourly':
        now = datetime.datetime.now()
        cutoff = now - datetime.timedelta(hours=1)
        filtered = []
        for d in data:
            t = datetime.datetime.strptime(d['time'], '%H:%M:%S').time()
            dt = datetime.datetime.combine(datetime.date.today(), t)
            if dt >= cutoff:
                filtered.append(d)
        return jsonify(filtered)
    return jsonify(data)

@app.route('/api/datetime')
def current_datetime():
    now = datetime.datetime.now()
    jalali = jdatetime.datetime.fromgregorian(datetime=now)
    return jsonify({
        'gregorian': now.strftime('%Y-%m-%d %H:%M:%S'),
        'shamsi': jalali.strftime('%Y/%m/%d %H:%M:%S')
    })

# ---------- Power Outage ----------
@app.route('/api/outage')
def get_outage():
    return jsonify(outage_schedule)

@app.route('/api/outage/update', methods=['POST'])
def update_outage():
    data = request.get_json()
    date_str = data.get('date')
    start = data.get('start')
    end = data.get('end')
    if not date_str or not start or not end:
        return 'invalid data', 400
    outage_schedule[date_str] = {"start": start, "end": end}
    save_outage()
    return jsonify({'status': 'ok'})

# File management
@app.route('/api/files')
def list_files():
    items = []
    for dirpath, dirnames, filenames in os.walk('.'):
        if '.git' in dirpath or '__pycache__' in dirpath:
            continue
        for name in filenames:
            if name.startswith('.'):
                continue
            full = os.path.relpath(os.path.join(dirpath, name)).replace('\\', '/')
            items.append({'name': name, 'path': full, 'size': os.path.getsize(full), 'is_dir': False})
    return jsonify(items)

@app.route('/api/download')
def download_file():
    path = request.args.get('path', '')
    if '..' in path or not path:
        return 'forbidden', 403
    return send_from_directory(os.getcwd(), path, as_attachment=True)

@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return 'no file', 400
    file = request.files['file']
    dir_path = request.form.get('dir', 'www/')
    full_dir = os.path.join(os.getcwd(), dir_path)
    os.makedirs(full_dir, exist_ok=True)
    filename = secure_filename(file.filename)
    file.save(os.path.join(full_dir, filename))
    return 'uploaded', 200

@app.route('/api/delete', methods=['GET'])
def delete_file():
    path = request.args.get('path', '')
    if '..' in path or not path:
        return 'forbidden', 403
    full = os.path.join(os.getcwd(), path)
    if os.path.exists(full):
        os.remove(full)
        return 'deleted', 200
    return 'not found', 404

# ---------- 7. Startup ----------
if __name__ == '__main__':
    scheduler = BackgroundScheduler()
    scheduler.add_job(poll_sensors, 'interval', seconds=10)
    scheduler.add_job(push_to_github, 'interval', minutes=5)
    scheduler.start()

    poll_sensors()
    print("[*] Server running on http://0.0.0.0:5000")
    app.run(host='0.0.0.0', port=5000, debug=False)
