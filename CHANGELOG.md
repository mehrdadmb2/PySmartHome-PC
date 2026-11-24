## 4.1.2 - 2026-11-24

- Fixed market-source URLs: use the exact GitHub Contents API file endpoint first, followed by the raw file, jsDelivr, and ArzPulse source endpoints.
- Removed the invalid PySmartHome GitHub Pages fallback for the repository-root `market/` folder; the `/tree/main/market` page is documented as HTML, not a JSON feed.
- Seed the first-run market cache from the checked-in `market/esp32.json`; the PC can serve the last bundled snapshot immediately while online refresh retries.
- Added GitHub Contents API Base64-envelope decoding and a PC-only emergency extractor for ArzPulse's `dollarPrice` and `gold18K` fields.
- Enabled LAN binding by default for the ESP32 hardware profile, including automatic migration from an old loopback `.env`; loopback-only mode remains available with `PYSMART_HOME_LAN_ACCESS=0`.
- Added source diagnostics, slower five-minute PC refresh aligned with Actions, GitHub token reuse for API reads, and a Private/LocalSubnet-only Windows Firewall helper.
- Added retry/rebase protection when the market Action pushes while sensor-data sync is also publishing to `main`.
- Disabled duplicate automatic firmware compilation in the standalone workflow; the ordered main CI remains the automatic compile gate.

## 4.1.1 - 2026-11-24

- Fixed Arduino sketch prototype-order compilation by moving `MarketState` into per-board headers.
- Added persistent last-known-good market cache and automatic restoration after PC service restart.
- Added primary/fallback market snapshot origins, bounded timeouts, exponential retry backoff, and source-age stale flags.
- Reworked GitHub Actions into an ordered pipeline: Python quality checks → both firmware builds → market refresh after successful CI; scheduled market refresh remains every five minutes.
- Added workflow concurrency controls and compact payload validation before publishing.

# Changelog

## 4.1.0 — 2026-11-24

### Added
- Five-minute GitHub Actions market updater with manual workflow dispatch.
- Categorized USD and 18K gold JSON snapshots plus a compact ESP32-only payload.
- Market snapshot validation tests and separate ESP32 / ESP32-S3 Arduino CLI compile workflow.

### Improved
- Moved IRR-to-Toman conversion and large-source JSON processing from both microcontrollers to GitHub Actions.
- Added a PC-side market cache/proxy and changed both ESP32s to local HTTP, removing TLS/GitHub network requests from the microcontrollers.
- Kept market fetching in a low-priority FreeRTOS task, outside the sensor/display loop.
- Replaced the large filtered dynamic JSON document with a small fixed-size static document.
- Added market snapshot timestamp tracking, stale detection, bounded retries, I²C timeout configuration, and heap/reset diagnostics.
- Replaced embedded Wi-Fi credentials with safe local placeholders in both sketches.

### Preserved
- Existing Python dashboard, local API contract, CSV history, hardware pin mapping, static node IP addresses, and board display layouts.

## 4.0.0 — 2026-10-20

### Added
- Installable PWA manifest and service worker for app-shell caching and previously fetched static data.
- GitHub Page Insights SDK integration restricted to the public GitHub Pages host.
- Complete local data-file manager UI and restricted CSV upload/download/delete APIs.
- API diagnostics endpoint and remote write protection using an optional admin key.
- Optional pywebview desktop launcher and Windows packaging/setup scripts.
- Automated Python tests and GitHub Actions CI workflow.
- Ten-theme selector and full theme cycling control.

### Improved
- Safer local-only default bind address and bounded, defensive environment-variable parsing.
- Local `.env` and `config.txt` token support without placing secrets in client code.
- CSV validation, upload size limits, atomic upload replacement, and explicit overwrite confirmation.
- GitHub Contents API sync skips a write when a remote file has not changed.
- Sensor firmware reports an unavailable sensor before the first valid reading and retries Wi-Fi.
- Documentation describes current endpoints and deployment modes, security, parts list, firmware, tests, and troubleshooting.

### Security note
Any credential that appeared in an earlier public commit should be rotated/revoked. Replacing a file in this release does not erase earlier Git history.
