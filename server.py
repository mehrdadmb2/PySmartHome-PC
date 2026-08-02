#!/usr/bin/env python3
"""
PySmartHome-PC – Complete Windows Server
"""
import os, sys, subprocess, json, csv, time, datetime, base64
from pathlib import Path

# --- 1. Auto-install dependencies ---
def install_requirements():
    req_file = "requirements.txt"
    if not os.path.exists(req_file):
        print("[!] requirements.txt not found")
        sys.exit(1)
    try:
        import pkg_resources
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pip", "--upgrade"])
        import pkg_resources
    with open(req_file, 'r') as f:
        required = [line.strip() for line in f if line.strip()]
    installed = {pkg.key for pkg in pkg_resources.working_set}
    missing = [p for p in required if p.split('>=')[0].split('==')[0].lower() not in installed]
    if missing:
        print(f"[+] Installing missing: {missing}")
        subprocess.check_call([sys.executable, "-m", "pip", "install"] + missing)
        print("[+] Restarting...")
        os.execv(sys.executable, ['python'] + sys.argv)

install_requirements()

import requests
from flask import Flask, request, render_template, send_from_directory, jsonify
from werkzeug.utils import secure_filename
from apscheduler.schedulers.background import BackgroundScheduler
import jdatetime

# --- 2. Configuration ---
GITHUB_USER = "mehrdadmb2"
GITHUB_REPO = "PySmartHome-PC"
GITHUB_BRANCH = "main"
GITHUB_TOKEN = ""
with open("config.txt", "r") as f:
    GITHUB_TOKEN = f.read().strip().split("token ")[1] if "token " in f.read() else f.read().strip()

ESP32_HUB_URL = "http://192.168.1.119/api/status"
ESP32_S3_URL  = "http://192.168.1.115/api/status"

DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)

# Sensor state
sensors = {
    "esp32_1": {"temp": 0, "hum": 0, "last_seen": 0},
    "esp32_s3": {"temp": 0, "hum": 0, "last_seen": 0}
}
NODE_TIMEOUT = 600  # 10 minutes

# --- 3. GitHub repository setup (first run only) ---
def check_or_create_repo():
    headers = {"Authorization": f"token {GITHUB_TOKEN}", "User-Agent": "PySmartHome"}
    # Check if repo exists
    r = requests.get(f"https://api.github.com/repos/{GITHUB_USER}/{GITHUB_REPO}", headers=headers)
    if r.status_code == 404:
        print("[+] Creating repository...")
        data = {"name": GITHUB_REPO, "description": "Smart Home PC Server", "auto_init": True}
        requests.post("https://api.github.com/user/repos", headers=headers, json=data)
        time.sleep(2)

    # Upload dashboard files if missing
    files_to_upload = {
        "site/index.html": "site/index.html",
        "site/style.css": "site/style.css",
        "site/app.js": "site/app.js",
        "docs/index.html": "docs/index.html",
        "docs/style.css": "docs/style.css",
        "docs/app.js": "docs/app.js",
    }
    for local, remote in files_to_upload.items():
        if not os.path.exists(local):
            continue
        url = f"https://api.github.com/repos/{GITHUB_USER}/{GITHUB_REPO}/contents/{remote}"
        resp = requests.get(url, headers=headers)
        if resp.status_code == 200:
            continue  # already exists
        with open(local, "r", encoding="utf-8") as f:
            content = f.read()
        data = {
            "message": f"Add {remote}",
            "content": base64.b64encode(content.encode()).decode(),
            "branch": GITHUB_BRANCH
        }
        requests.put(url, headers=headers, json=data)
        time.sleep(1)
    # Enable Pages
    pages_url = f"https://api.github.com/repos/{GITHUB_USER}/{GITHUB_REPO}/pages"
    pages_config = {"source": {"branch": GITHUB_BRANCH, "path": "/docs"}}
    requests.post(pages_url, headers=headers, json=pages_config)

# --- 4. CSV logging ---
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

# --- 5. GitHub upload ---
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
    # Status
    status = {
        "esp32_1_online": (time.time() - sensors["esp32_1"]["last_seen"]) < NODE_TIMEOUT,
        "esp32_s3_online": (time.time() - sensors["esp32_s3"]["last_seen"]) < NODE_TIMEOUT,
        "last_push": datetime.datetime.now().isoformat()
    }
    upload_file_to_github("status.json", json.dumps(status))

# --- 6. Polling function (runs every 10s) ---
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

# --- 7. Flask app ---
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

# --- 8. Startup sequence ---
if __name__ == '__main__':
    print("[*] Setting up GitHub...")
    check_or_create_repo()

    # Start scheduler for polling (every 10s) and GitHub push (every 5min)
    scheduler = BackgroundScheduler()
    scheduler.add_job(poll_sensors, 'interval', seconds=10)
    scheduler.add_job(push_to_github, 'interval', minutes=5)
    scheduler.start()

    # Initial poll
    poll_sensors()

    print("[*] Server running on http://0.0.0.0:5000")
    app.run(host='0.0.0.0', port=5000, debug=False)
