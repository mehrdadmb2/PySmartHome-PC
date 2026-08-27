#!/usr/bin/env python3
"""
PySmartHome-PC – Smart Home Server
با لاگ‌های رنگی، زمان‌بندی قطع برق پویا، همگام‌سازی با گیت‌هاب
"""

import os, sys, subprocess, json, csv, time, datetime, base64, logging
from pathlib import Path

# ========== ANSI Colors ==========
class Colors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'

def log_info(msg):
    print(f"{Colors.OKGREEN}[INFO]{Colors.ENDC} {datetime.datetime.now().strftime('%H:%M:%S')} - {msg}")

def log_warning(msg):
    print(f"{Colors.WARNING}[WARN]{Colors.ENDC} {datetime.datetime.now().strftime('%H:%M:%S')} - {msg}")

def log_error(msg):
    print(f"{Colors.FAIL}[ERROR]{Colors.ENDC} {datetime.datetime.now().strftime('%H:%M:%S')} - {msg}")

def log_debug(msg):
    print(f"{Colors.OKCYAN}[DEBUG]{Colors.ENDC} {datetime.datetime.now().strftime('%H:%M:%S')} - {msg}")

# غیرفعال کردن لاگ‌های مزاحم
logging.getLogger('werkzeug').setLevel(logging.ERROR)
logging.getLogger('apscheduler').setLevel(logging.WARNING)

# نصب خودکار پیش‌نیازها
def install_requirements():
    req_file = "requirements.txt"
    if not os.path.exists(req_file):
        log_error("فایل requirements.txt یافت نشد")
        sys.exit(1)
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", req_file],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        log_info("✅ پیش‌نیازها نصب شدند")
    except Exception as e:
        log_error(f"خطا در نصب پیش‌نیازها: {e}")
        sys.exit(1)

install_requirements()

import requests
from flask import Flask, request, render_template, send_from_directory, jsonify
from werkzeug.utils import secure_filename
from apscheduler.schedulers.background import BackgroundScheduler
import jdatetime

# ========== Config ==========
GITHUB_USER = "mehrdadmb2"
GITHUB_REPO = "PySmartHome-PC"
GITHUB_BRANCH = "main"
GITHUB_TOKEN = ""
try:
    with open("config.txt", "r") as f:
        content = f.read().strip()
    if "token " in content:
        GITHUB_TOKEN = content.split("token ")[1]
    else:
        GITHUB_TOKEN = content
except:
    log_error("config.txt پیدا نشد یا معتبر نیست")
    sys.exit(1)

ESP32_HUB_URL = "http://192.168.1.119/api/status"
ESP32_S3_URL  = "http://192.168.1.115/api/status"

DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)
OUTAGE_FILE = "outage_schedule.json"

# ========== مدیریت قطع برق ==========
SLOTS = [9, 11, 13, 15, 17, 19]  # ساعت شروع هر بازه ۲ ساعته

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

def generate_outage_schedule(reference_date, reference_start_hour):
    """
    تولید برنامه قطع برق برای دیروز، امروز، فردا و چند روز آینده.
    بازه‌ها: 9-11, 11-13, 13-15, 15-17, 17-19, 19-21
    جمعه‌ها برق نیست.
    """
    if reference_start_hour not in SLOTS:
        reference_start_hour = 13  # پیش‌فرض
    ref_slot = SLOTS.index(reference_start_hour)
    current_date = datetime.datetime.strptime(reference_date, "%Y-%m-%d").date()

    for delta in range(-1, 6):  # از دیروز تا ۵ روز آینده
        d = current_date + datetime.timedelta(days=delta)
        if d.weekday() == 4:  # جمعه
            continue
        # محاسبه شیفت بر اساس تعداد روزهای غیر جمعه
        non_friday_count = 0
        step = 1 if delta >= 0 else -1
        for i in range(1, abs(delta) + 1):
            tmp = current_date + datetime.timedelta(days=i * step)
            if tmp.weekday() != 4:
                non_friday_count += 1
        # اگر دیروز باشد، شیفت منفی می‌شود
        if delta < 0:
            non_friday_count = -non_friday_count
        slot = (ref_slot + non_friday_count) % len(SLOTS)
        start_h = SLOTS[slot]
        end_h = start_h + 2
        if end_h > 21:
            end_h = 21
        date_str = d.isoformat()
        outage_schedule[date_str] = {
            "start": f"{start_h:02d}:00",
            "end": f"{end_h:02d}:00"
        }
    save_outage(outage_schedule)

# اگر امروز در برنامه نبود، تولید کن
today_str = datetime.date.today().isoformat()
if today_str not in outage_schedule:
    # ساعت مرجع را از برنامه امروز اگر موجود است بگیریم، وگرنه ۱۳
    ref_hour = 13
    if today_str in outage_schedule:
        ref_hour = int(outage_schedule[today_str]["start"].split(":")[0])
    generate_outage_schedule(today_str, ref_hour)

log_info("📅 برنامه قطع برق بارگذاری شد")

# ========== وضعیت سنسورها ==========
sensors = {
    "esp32_1": {"temp": 0, "hum": 0, "last_seen": 0},
    "esp32_s3": {"temp": 0, "hum": 0, "last_seen": 0}
}
NODE_TIMEOUT = 600  # ۱۰ دقیقه

# ========== گیت‌هاب ==========
def upload_file_to_github(path, content):
    url = f"https://api.github.com/repos/{GITHUB_USER}/{GITHUB_REPO}/contents/{path}"
    headers = {"Authorization": f"token {GITHUB_TOKEN}", "User-Agent": "PySmartHome"}
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        sha = resp.json().get("sha", "") if resp.status_code == 200 else ""
        data = {
            "message": "auto update",
            "content": base64.b64encode(content.encode()).decode(),
            "branch": GITHUB_BRANCH
        }
        if sha:
            data["sha"] = sha
        r = requests.put(url, headers=headers, json=data, timeout=10)
        if r.status_code >= 400:
            log_warning(f"❌ آپلود به گیت‌هاب برای {path} ناموفق: {r.status_code}")
        else:
            log_info(f"✅ آپلود به گیت‌هاب: {path}")
    except Exception as e:
        log_error(f"❌ خطای گیت‌هاب: {e}")

def push_to_github():
    today = datetime.date.today().isoformat()
    for board in ["esp32_1", "esp32_s3"]:
        fname = f"{board}_{today}.csv"
        fpath = os.path.join(DATA_DIR, fname)
        if os.path.exists(fpath):
            with open(fpath, "r") as f:
                upload_file_to_github(f"data/{fname}", f.read())
            time.sleep(0.3)
    # وضعیت
    status = {
        "esp32_1_online": (time.time() - sensors["esp32_1"]["last_seen"]) < NODE_TIMEOUT,
        "esp32_s3_online": (time.time() - sensors["esp32_s3"]["last_seen"]) < NODE_TIMEOUT,
        "last_push": datetime.datetime.now().isoformat()
    }
    upload_file_to_github("status.json", json.dumps(status))
    # برنامه قطع برق
    with open(OUTAGE_FILE, "r", encoding="utf-8") as f:
        upload_file_to_github(OUTAGE_FILE, f.read())

# ========== ثبت CSV ==========
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

# ========== پول کردن سنسورها ==========
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
                log_info(f"📡 {name} -> {data['temp']:.1f}°C, {data['humidity']:.0f}%")
            else:
                log_warning(f"⚠️ {name} HTTP {resp.status_code}")
        except Exception as e:
            log_warning(f"⚠️ {name} آفلاین: {e}")

# ========== Flask App ==========
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
        'hub_online': (now - sensors['esp32_1']['last_seen']) < NODE_TIMEOUT,
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
    date_str = data.get('date')
    start = data.get('start')
    end = data.get('end')
    if not all([date_str, start, end]):
        return 'invalid', 400
    outage_schedule[date_str] = {"start": start, "end": end}
    save_outage(outage_schedule)
    log_info(f"✏️ برنامه قطع برق برای {date_str} به {start} - {end} تغییر کرد")
    return jsonify({'status': 'ok'})

@app.route('/api/outage/countdown')
def outage_countdown():
    today = datetime.date.today().isoformat()
    sched = outage_schedule.get(today)
    if not sched:
        return jsonify({"status": "no_data"})
    now = datetime.datetime.now()
    start = datetime.datetime.strptime(today + " " + sched["start"], "%Y-%m-%d %H:%M")
    end = datetime.datetime.strptime(today + " " + sched["end"], "%Y-%m-%d %H:%M")
    if now < start:
        diff = start - now
        return jsonify({
            "status": "before",
            "total_seconds": int(diff.total_seconds()),
            "message": f"⏳ قطع برق در {diff.seconds//3600}h {(diff.seconds//60)%60}m"
        })
    elif now < end:
        diff = end - now
        return jsonify({
            "status": "during",
            "total_seconds": int(diff.total_seconds()),
            "message": f"⚡ وصل شدن در {diff.seconds//3600}h {(diff.seconds//60)%60}m"
        })
    else:
        return jsonify({"status": "after", "message": "✅ برق وصل است"})

# مدیریت فایل‌ها (مشابه قبل)
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

# ========== راه‌اندازی ==========
if __name__ == '__main__':
    log_info("🚀 راه‌اندازی سرور SmartHome...")
    scheduler = BackgroundScheduler()
    scheduler.add_job(poll_sensors, 'interval', seconds=10)
    scheduler.add_job(push_to_github, 'interval', minutes=5)
    scheduler.start()
    poll_sensors()  # اولین پول
    log_info("🌐 سرور روی http://0.0.0.0:5000 اجرا می‌شود")
    app.run(host='0.0.0.0', port=5000, debug=False)
