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
