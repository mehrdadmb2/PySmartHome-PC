# PySmartHome-PC — Release and Migration Notes

## Version 4.1.2 — GitHub source recovery and LAN proxy correction

- Corrected market-source URLs against the live repositories. The PC now reads the exact `market/esp32.json` file through the GitHub Contents API first, then exact-file Raw GitHub and jsDelivr fallbacks. The `/tree/main/market` HTML page is never treated as JSON.
- Added ArzPulse exact-file fallbacks on the PC only; the ESP32 never downloads the large ArzPulse document.
- Seeded first-run market cache from the bundled compact file and retained persistent last-good cache across source outages and PC restarts.
- Enabled LAN binding by default for the ESP32 profile, including compatibility with old `.env` files still specifying `127.0.0.1`; loopback-only mode remains available with `PYSMART_HOME_LAN_ACCESS=0`.
- Added `/api/health` and `/api/diagnostics` source reporting, a Private/LocalSubnet firewall helper, and a PowerShell endpoint/listener diagnostic script.
- Aligned the PC refresh cadence with the five-minute GitHub Action schedule and ordered the automatic CI → firmware compile → market update chain.

### 4.1.2 validation status

- Python syntax compilation and market unit tests pass in the build environment.
- Market-proxy helper smoke checks pass, including bundled-cache seeding and GitHub Contents API response decoding.
- Workflow YAML and final ZIP integrity were checked. Full Flask integration tests, Arduino CLI compilation, and physical board testing still need confirmation from GitHub Actions and the actual hardware.

---

The latest prepared source bundle is **4.1.2**. The earlier 4.1.0 and 4.0.0 notes are retained below for historical upgrades.onfirm the public dashboard works at `https://mehrdadmb2.github.io/PySmartHome-PC/`. Visit it once, then inspect `https://mehrdadmb2.github.io/github-page-insights/` for platform ID `pysmarthome-pc-github-pages`. Analytics requires the referenced Page Insights Worker and database to be operational.
9. Install runtime packages and start `start_server.bat` to validate the local dashboard. Run `python -m pytest -q` in an environment with `requirements-dev.txt` installed. Only after this works, optionally build the desktop folder via `build_desktop.bat`.

## Important behavior boundaries

- GitHub Pages is static: it displays the last public snapshot and cannot access the PC's live APIs or edit local CSV files.
- Sensor CSV and schedule/status JSON published in a public repository are publicly downloadable. Do not publish sensitive data.
- The local service defaults to `127.0.0.1`. Set `PYSMART_HOME_HOST=0.0.0.0` only for intentional trusted-LAN use and protect it with the operating-system firewall. Never port-forward this development-oriented service to the public internet.
- Remote non-loopback write operations require `PYSMART_HOME_ADMIN_KEY`; this key is only for local/LAN administrative requests, not a full user identity system.
- The bundled desktop target is a Windows one-folder distribution. It has not been built inside this Linux editing environment; build it on Windows using `build_desktop.bat`.

## Validation status for this prepared source bundle

- Python byte-compilation passed.
- JavaScript syntax checks passed for the dashboard, background, analytics loader, and service worker.
- All six market snapshot unit tests passed locally. The complete Flask integration suite could not be run in this editing environment because Flask is not installed and the package index was unreachable. The CI workflow installs the declared dependencies and runs the full suite.
- Arduino compilation and physical-board tests were not run in this editing environment. The firmware-build workflow is included to compile both sketches on GitHub Actions; hardware behavior still requires testing on the actual boards.


# PySmartHome-PC 4.1.0 — Market pipeline and firmware recovery

## Upgrade from 4.0.0

1. Back up your repository and local `data/` directory.
2. Replace the project files with the 4.1.0 source bundle. Keep your local `config.txt` and do not commit it; `.gitignore` now excludes it.
3. Open both board sketches under `Board-Code/esp32_hub/` and `Board-Code/esp32_s3/`. Enter your own 2.4 GHz Wi-Fi SSID and password into each local sketch before compiling. Those values are intentionally placeholders in the distributed source.
4. In GitHub, enable **Settings → Actions → General → Workflow permissions → Read and write permissions**.
5. Push the updated repository to `main`, then run **Actions → Update compact market snapshot → Run workflow** once. Verify that `market/esp32.json`, `market/currencies/usd.json`, and `market/metals/gold_18k_1g.json` appear.
6. On the PC, copy `.env.example` to `.env`, set `PYSMART_HOME_HOST=0.0.0.0`, restart the server, and allow inbound TCP 5000 on the trusted Windows Private network. Find the PC IPv4 address using `ipconfig`.
7. In both sketches, replace `192.168.1.100` in `MARKET_SNAPSHOT_URL` with the PC IPv4 address. Verify `http://<PC-LAN-IP>:5000/api/market` returns the compact JSON from another LAN device.
8. Install ArduinoJson **6.21.5** and the existing Adafruit/DHT libraries, compile and upload the Hub and S3 sketches, then open Serial Monitor at 115200 baud.
9. Check PC `/api/health` for `market_proxy_ready: true`; check each board's `/api/health` for `price_http: 200`, `price_error: "OK"`, a non-empty `price_updated_at`, and stable free-heap values across repeated refreshes.

## Architecture change

The boards no longer download ArzPulse's large `docs/data/latest.json` file, contact GitHub, perform TLS, or divide IRR prices by ten. GitHub Actions performs source parsing, validation, stale checking, category separation, and IRR-to-Toman conversion. The PC fetches and validates only the fixed, compact `market/esp32.json` file and exposes it on `/api/market` over local HTTP. The boards read that local endpoint in a low-priority FreeRTOS task separated from the sensor/display loop, with bounded timeouts and retries.

The Python dashboard/server, existing sensor endpoints, CSV history format, node IP addresses, and hardware pin assignments remain unchanged.

## If the board still locks up

Market fetching is now plain HTTP to the PC, performed in a background task; no HTTPS/TLS is run on the microcontroller. This prevents the market HTTP request from directly blocking `loop()`, but it cannot fix a weak USB cable, unstable 5 V source, shorted peripheral, faulty reset circuit, or defective board. First test the board with only USB power, then reconnect the DHT22 and OLED separately. If RESET does not recover the board, investigate the supply/reset hardware before changing the market code again.

## Validation note

Python and JSON pipeline tests can be run locally with `python -m pytest -q`. The repository also includes GitHub Actions workflows that compile both sketches with Arduino CLI; successful CI compilation is not a substitute for testing the firmware on the actual board and power supply.
