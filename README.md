# 🏠 PySmartHome-PC

> **Resilient, modern smart‑home platform**  
> ESP32 sensor nodes → Python server with local dashboard → GitHub Pages online dashboard  
> Live charts, historical data, smart outage scheduling, and a polished cyberpunk UI.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-blue.svg)](https://www.python.org/)
[![GitHub stars](https://img.shields.io/github/stars/mehrdadmb2/PySmartHome-PC?style=social)](https://github.com/mehrdadmb2/PySmartHome-PC/stargazers)
[![GitHub last commit](https://img.shields.io/github/last-commit/mehrdadmb2/PySmartHome-PC)](https://github.com/mehrdadmb2/PySmartHome-PC/commits/main)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-lightgrey)]()

---

## ✨ Features

- **ESP32 sensor nodes** – read temperature & humidity (DHT22) and display on OLED screens.
- **Robust Python server** – polls ESP32s every 10s, logs to CSV, serves a local dashboard, and syncs to GitHub every 5 minutes.
- **GitHub Pages online dashboard** – identical look, data fetched from the repository’s CSV files.
- **Interactive charts** – zoom, pan, combined view, and CSV export.
- **Rich statistics** – average, min/max, sample count, trend vs yesterday, and smart insights.
- **Power outage schedule** – rolling 2‑hour slots (09:00–21:00), Friday skipped, editable via the local dashboard.
- **Live countdown** – shows time until next outage or until power returns, with a progress bar.
- **File manager** (local only) – upload, download, delete server files.
- **10 themes** – from cyberpunk, light, retro CRT, forest, ocean, matrix, sunset, aurora, midnight, to candy.
- **Persian & English** – language switch with full RTL support.
- **Auto‑start** – place a shortcut in Windows Startup; no admin privileges needed.
- **Clean colour‑coded logs** – INFO, WARN, ERROR with timestamps and categories.
- **Environment variable support** – configure IPs, intervals, thresholds without touching the code.

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
         │  Windows PC        │
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
         │  index.html, app.js, style.css │
         └─────────┬─────────┘
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
| ESP32 Dev Module | 1 | Node 1 (Hub) – IP `192.168.1.119` (default) |
| ESP32‑S3 | 1 | Node 2 – IP `192.168.1.115` (default) |
| DHT22 | 2 | Temperature & humidity sensor |
| OLED 128x64 I2C | 1 | For ESP32 Hub |
| OLED 128x32 I2C | 1 | For ESP32‑S3 |
| Micro USB cables | 2 | Power & programming |
| Windows PC/Laptop | 1 | Runs the Python server (can be the same PC you use daily) |

---

## 💾 Software Requirements (Windows)

- **Python 3.11 or later** – download from [python.org](https://python.org).
- **Git** (optional) – to clone the repository.
- **Libraries** (auto‑installed by `server.py`):
  - `flask`
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

### 2. Configure GitHub token (optional but recommended)
Create a file `config.txt` in the root folder with your **GitHub personal access token** (classic, with `repo` scope):
```
token ghp_xxxxxxxxxxxxxxxxxxxx
```
If you skip this, the server will run but won't sync data to GitHub.

### 3. Customize via environment variables (optional)
You can override settings without editing `server.py` by setting system environment variables or creating a `.env` file (not required).  
For example:
```
PYSMART_ESP32_1_URL=http://192.168.1.119/api/status
PYSMART_ESP32_S3_URL=http://192.168.1.115/api/status
PYSMART_TEMP_ALERT=35
PYSMART_POLL_SECONDS=10
PYSMART_PUBLISH_SECONDS=300
```
See the `server.py` source for all available variables.

### 4. Flash the ESP32s
- Open the `Board-Code/esp32_hub.ino` and `Board-Code/esp32_s3.ino` in Arduino IDE.
- Install required libraries (`DHT sensor library`, `Adafruit SSD1306`, `NTPClient`).
- Upload each sketch to the corresponding board.
- The OLEDs will display WiFi connection, then temperature, humidity, Persian date, and time.

### 5. Start the server
Double‑click `start_server.bat` (or run `python server.py` in a terminal).  
The first run will:
- Install missing Python packages.
- Create the `data/` folder.
- Generate the initial outage schedule.
- Start the background worker for polling and GitHub sync.

### 6. Open the dashboards
- **Local Dashboard:** `http://localhost:5000` (or `http://YOUR_PC_IP:5000` from other devices)
- **Online Dashboard:** `https://mehrdadmb2.github.io/PySmartHome-PC` (after the first push, usually within 5 minutes)

---

## 📊 Dashboard Capabilities

### 🏠 Internal Dashboard (local)
- Real‑time sensor values with 10‑second updates.
- Interactive charts with zoom, pan, combined view, and CSV export.
- Statistics per room: average, min/max, sample count, trend arrow.
- **Power outage schedule** – view yesterday/today/tomorrow and **edit** the reference slot via a modal.
- **Live outage countdown** – shows remaining time, power state, and a progress bar.
- **File manager** – upload, download, delete files on the server.
- **10 themes** – cyberpunk, light, retro, forest, ocean, matrix, sunset, aurora, midnight, candy.
- **Language toggle** (فارسی / English) with full RTL support.
- **Smart insights** – temperature/humidity trends and alert status.

### 🌐 Online Dashboard (GitHub Pages)
- Same visual design and chart features as the internal one.
- Data fetched from the repository’s CSV files (updated every 5 minutes).
- Power outage schedule (read‑only, but updated from the server).
- No file manager (static site limitation).
- All themes and language toggle work.

---

## 🕹️ Power Outage Schedule

A special feature for regions with daily scheduled power cuts.  
- The schedule follows a **rolling 2‑hour cycle** between 09:00 and 21:00.
- **Friday is skipped** – no outage on Fridays.
- The server stores the schedule in `outage_schedule.json` inside the `data/` folder.
- The **internal dashboard** lets you edit the reference date and start time (any of 09:00, 11:00, 13:00, 15:00, 17:00, 19:00). The entire cycle is recalculated automatically.
- The schedule is automatically pushed to GitHub, making it available to the online dashboard.
- The card shows yesterday, today, tomorrow, and the day after with Persian dates and times.
- A live countdown displays time until the next outage or until power returns, with a progress bar.

Example schedule entry:
```json
{
  "2025-08-12": {
    "start": "13:00",
    "end": "15:00"
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
├── data/                     # CSV logs & outage schedule
│   ├── esp32_1_YYYY-MM-DD.csv
│   ├── esp32_s3_YYYY-MM-DD.csv
│   └── outage_schedule.json
├── index.html                # Dashboard HTML (served locally & committed to GitHub)
├── app.js                    # Dashboard JavaScript
├── style.css                 # Dashboard CSS with 10 themes
├── Board-Code/               # ESP32 firmware
│   ├── esp32_hub.ino
│   └── esp32_s3.ino
└── README.md                 # This file
```

> **Note:** The `data/` folder is the only runtime data directory. All CSV logs, status, and outage schedule are stored there. The `index.html`, `app.js`, and `style.css` are **shared** between the local server and GitHub Pages – they are served locally and also committed to the repository.

---

## 🔌 API Endpoints (Local Server)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Local dashboard (serves index.html) |
| `GET` | `/api/health` | Health check (returns service status) |
| `GET` | `/api/dashboard` | Complete dashboard snapshot (JSON) |
| `GET` | `/api/data?board=esp32_1&range=daily&date=2025-08-12` | Historical CSV data as JSON |
| `GET` | `/api/outage` | Power outage schedule (JSON) |
| `POST` | `/api/outage/update` | Update outage schedule (requires `date`, `start`, `end`) |
| `GET` | `/api/datetime` | Current Gregorian & Jalali date/time (Iran time) |
| `GET` | `/api/files` | List all files on the server (local only) |
| `GET` | `/api/download?path=...` | Download a file |
| `POST` | `/api/upload` | Upload a file (multipart form) |
| `GET` | `/api/delete?path=...` | Delete a file |
| `GET` | `/data/*.csv` | Public access to CSV files (for online dashboard) |

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

## 🌐 Environment Variables (Optional)

You can configure the server entirely through environment variables – no need to edit `server.py`. Set them system‑wide or in a `.env` file (not included).

| Variable | Default | Description |
|----------|---------|-------------|
| `PYSMART_ESP32_1_URL` | `http://192.168.1.119/api/status` | URL for the first ESP32 |
| `PYSMART_ESP32_S3_URL` | `http://192.168.1.115/api/status` | URL for the second ESP32 |
| `PYSMART_TEMP_ALERT` | `35` | Temperature threshold (°C) for alerts |
| `PYSMART_POLL_SECONDS` | `10` | Interval between sensor polls (seconds) |
| `PYSMART_PUBLISH_SECONDS` | `300` | Interval between GitHub syncs (seconds) |
| `PYSMART_NODE_TIMEOUT` | `45` | Seconds before a node is considered offline |
| `PYSMART_HTTP_TIMEOUT` | `4` | HTTP request timeout for sensor polling |
| `PYSMART_GITHUB_USER` | `mehrdadmb2` | GitHub username |
| `PYSMART_GITHUB_REPO` | `PySmartHome-PC` | Repository name |
| `PYSMART_GITHUB_BRANCH` | `main` | Branch to commit to |
| `PYSMART_LOG_LEVEL` | `INFO` | Log level (DEBUG, INFO, WARNING, ERROR) |
| `PYSMART_HOST` | `0.0.0.0` | Flask host IP |
| `PYSMART_PORT` | `5000` | Flask port |

> **Important:** The GitHub token is **never** stored in environment variables – it must be placed in `config.txt` to keep it out of the code and logs.

---

## 🚀 Roadmap / Planned Features

- [x] Robust error handling & logging with colours.
- [x] Rolling power outage schedule with Friday skip.
- [x] Live countdown and progress bar.
- [x] 10 themes with custom fonts.
- [x] Smart insights (trends, alerts).
- [x] Combined chart view.
- [ ] WebSocket real‑time updates for local dashboard.
- [ ] Temperature forecasting with linear regression.
- [ ] Telegram/Email alerts.
- [ ] Progressive Web App (PWA) support.
- [ ] 3D floor plan visualization.

---

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.  
Make sure to update the `server.py`, dashboard files, and this README consistently.

---

## 📝 License

MIT License – see [LICENSE](LICENSE) file for details.

---

**Made with ❤️ by [Mehrdad Behrouzi](https://github.com/mehrdadmb2)**  
Feel free to star ⭐ the repo if you find it useful!
