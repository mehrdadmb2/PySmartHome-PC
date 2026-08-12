# 🏠 PySmartHome-PC

> **A rock‑solid smart home platform**  
> ESP32 sensor nodes → Windows Python server → Local + Online dashboards  
> with live charts, historical data, power outage schedule, and cyberpunk UI.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-blue.svg)](https://www.python.org/)
[![GitHub stars](https://img.shields.io/github/stars/mehrdadmb2/PySmartHome-PC?style=social)](https://github.com/mehrdadmb2/PySmartHome-PC/stargazers)
[![GitHub last commit](https://img.shields.io/github/last-commit/mehrdadmb2/PySmartHome-PC)](https://github.com/mehrdadmb2/PySmartHome-PC/commits/main)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-lightgrey)]()

---

## ✨ Features

- **ESP32 sensor nodes** – read temperature & humidity (DHT22) and display them on OLED.
- **Windows Python server** – polls ESP32s every 10s, logs data to CSV, serves local dashboard.
- **GitHub Pages online dashboard** – identical look, data fetched from repository CSV files.
- **Live charts** – interactive with zoom, pan, combined view, and export options.
- **Daily statistics** – average, min/max, sample count, trend vs yesterday.
- **Power outage schedule** – editable via internal dashboard; shows yesterday/today/tomorrow.
- **File manager** (local only) – upload, download, delete any file on the server.
- **Three themes** – dark cyberpunk, light, retro green CRT (toggle one click).
- **Persian & English** – language switch with full RTL support.
- **Auto‑start** – place a shortcut in the Windows Startup folder, no admin privileges needed.
- **Robust logging & retry** – connection failures are logged, push to GitHub retried.

---

## 🧱 Architecture

```
                  Wi‑Fi
     ┌─────────────┼─────────────┐
     │                           │
  [ESP32 Hub]               [ESP32‑S3]
 (192.168.1.119)           (192.168.1.115)
   DHT22 + OLED             DHT22 + OLED
   /api/status JSON         /api/status JSON
     │                           │
     └───────────┬───────────────┘
                 │ HTTP GET every 10s
                 ▼
         ┌───────────────────┐
         │  Windows Laptop    │
         │  server.py (Flask) │
         │  CSV logs          │
         │  Local dashboard   │
         │  GitHub uploader   │
         └─────────┬─────────┘
                   │ every 5 min
                   ▼
         ┌───────────────────┐
         │  GitHub Repository │
         │  data/*.csv        │
         │  status.json       │
         │  outage_schedule.json │
         │  docs/ (GitHub Pages) │
         └───────────────────┘
                   │
                   ▼
         ┌───────────────────┐
         │  Online Dashboard  │
         │  (GitHub Pages)    │
         └───────────────────┘
```

---

## 🧰 Hardware Requirements

| Component | Quantity | Notes |
|-----------|----------|-------|
| ESP32 Dev Module | 1 | Node 1 (Hub) – IP `192.168.1.119` |
| ESP32‑S3 | 1 | Node 2 – IP `192.168.1.115` |
| DHT22 | 2 | Temperature & Humidity sensor |
| OLED 128x64 I2C | 1 | For ESP32 Hub |
| OLED 128x32 I2C | 1 | For ESP32‑S3 |
| Micro USB cables | 2 | Power & programming |
| Windows PC/Laptop | 1 | Runs the Python server (can be the same you use daily) |

---

## 💾 Software Requirements (Windows)

- **Python 3.11 or later** – download from [python.org](https://python.org).
- **Git** (optional) – to clone the repository.
- **Libraries** (auto‑installed by `server.py`):
  - `flask`
  - `apscheduler`
  - `requests`
  - `jdatetime`

---

## 📥 Installation & Setup

### 1. Clone / Download the project
```bash
git clone https://github.com/mehrdadmb2/PySmartHome-PC.git
cd PySmartHome-PC
```
Or download the ZIP from the repository and extract it.

### 2. Configure GitHub token
Create a file `config.txt` in the root folder with your **GitHub personal access token** (classic, with `repo` scope):
```
token ghp_xxxxxxxxxxxxxxxxxxxx
```

### 3. (Optional) Edit ESP32 IPs in `server.py`
Open `server.py` and update the two lines if your ESP32s have different IPs:
```python
ESP32_HUB_URL = "http://192.168.1.119/api/status"
ESP32_S3_URL  = "http://192.168.1.115/api/status"
```

### 4. Flash the ESP32s
- Open the `esp32_hub/` and `esp32_s3/` folders in Arduino IDE.
- Install the required libraries (`DHT sensor library`, `Adafruit SSD1306`, `NTPClient`).
- Upload each sketch to the corresponding board.
- The OLEDs should display WiFi connection, then temperature, humidity, date, and time.

### 5. Start the server
Double‑click `start_server.bat` (or run `python server.py` in a terminal).  
The first run will:
- Install missing Python packages.
- Create all required folders and dashboard files.
- Upload dashboard files to GitHub (if missing).
- Enable GitHub Pages for the `docs/` folder.
- Create a **Windows Scheduled Task** for auto‑start (or you can manually add a shortcut to the `Startup` folder).

### 6. Open the dashboards
- **Local Dashboard:** `http://localhost:5000` (or `http://YOUR_PC_IP:5000` from other devices)
- **Online Dashboard:** `https://mehrdadmb2.github.io/PySmartHome-PC` (after the first push, usually within 5 minutes)

---

## 📊 Dashboard Capabilities

### 🏠 Internal Dashboard (local)
- Real‑time sensor values with 60‑second updates.
- Interactive charts with zoom, pan, and combined sensor view.
- Statistics per room: average, min/max, sample count, trend arrow.
- **Power outage schedule** – view yesterday/today/tomorrow and **edit** them via a modal.
- **File manager** – upload, download, delete files on the server.
- Theme switch (Dark / Light / Retro CRT).
- Language toggle (فارسی / English).

### 🌐 Online Dashboard (GitHub Pages)
- Same visual design and chart features as the internal one.
- Data fetched from the repository’s CSV files (updated every 5 minutes).
- Power outage schedule (read‑only, updated from the server).
- No file manager (static site limitation).
- All themes and language toggle work.

---

## 🕹️ Power Outage Schedule

A special feature for regions with daily scheduled power cuts.  
- The server stores the schedule in `outage_schedule.json`.
- The **internal dashboard** lets you edit the start/end time for any date.
- The schedule is automatically pushed to GitHub, making it available to the online dashboard.
- The card shows yesterday, today, and tomorrow with Persian dates.

Example schedule entry:
```json
{
  "2025-08-12": {
    "start": "09:00",
    "end": "11:00"
  }
}
```

---

## 📁 File Structure

```
PySmartHome-PC/
├── server.py                 # Main Python server
├── config.txt                # GitHub token (git‑ignored)
├── requirements.txt          # Python dependencies
├── start_server.bat          # Double‑click launcher
├── outage_schedule.json      # Power cut times (auto‑generated)
├── data/                     # CSV logs (one file per day per board)
├── templates/                # Flask HTML template (internal dashboard)
│   └── index.html
├── static/                   # CSS, JS for internal dashboard
│   ├── style.css
│   └── app.js
├── site/                     # Local copy of dashboard (uploaded to GitHub)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── docs/                     # GitHub Pages (online dashboard)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── esp32_hub/                # Arduino sketch for ESP32 Hub
│   └── esp32_hub.ino
└── esp32_s3/                 # Arduino sketch for ESP32‑S3
    └── esp32_s3.ino
```

---

## 🔌 API Endpoints (Local Server)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Local dashboard |
| `GET` | `/api/current` | Latest sensor values (JSON) |
| `GET` | `/api/nodestatus` | Online/offline status of nodes |
| `GET` | `/api/data?board=esp32_1&range=daily&date=2025-08-12` | Historical CSV data as JSON |
| `GET` | `/api/datetime` | Current Gregorian & Jalali date/time |
| `GET` | `/api/outage` | Power outage schedule (JSON) |
| `POST` | `/api/outage/update` | Update outage schedule (requires `date`, `start`, `end`) |
| `GET` | `/api/files` | List all files on the server |
| `GET` | `/api/download?path=...` | Download a file |
| `POST` | `/api/upload` | Upload a file (multipart form) |
| `GET` | `/api/delete?path=...` | Delete a file |

---

## 🤖 ESP32 API

Each ESP32 runs a minimal web server that provides a single endpoint:

```
GET /api/status
```
Returns:
```json
{
  "temp": 28.5,
  "humidity": 45.0
}
```

The ESP32s also display the current temperature, humidity, Persian date, and time on their OLED screens.

---

## 🚀 Roadmap / Planned Features

- [x] Robust error handling & logging.
- [x] WebSocket real‑time updates for the internal dashboard.
- [x] Power outage schedule.
- [ ] Temperature forecasting with linear regression.
- [ ] Outdoor weather comparison (OpenWeatherMap API).
- [ ] Progressive Web App (PWA) support.
- [ ] Telegram alerts (if not filtered).
- [ ] 3D floor plan visualization.

---

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.  
Make sure to update the `server.py` and dashboard files consistently.

---

## 📝 License

MIT License – see [LICENSE](LICENSE) file for details.

---

**Made with ❤️ by [Mehrdad Behrouzi](https://github.com/mehrdadmb2)**  
Feel free to star ⭐ the repo if you find it useful!
``
