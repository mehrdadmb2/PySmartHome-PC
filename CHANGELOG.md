# Changelog

## 4.0.0 — 2026-10-20

### Added
- Installable PWA manifest and service worker for app-shell caching and previously fetched static data.
- GitHub Page Insights SDK integration restricted to the public GitHub Pages host.
- Complete local data-file manager UI and restricted CSV upload/download/delete APIs.
- API diagnostics endpoint and remote write protection using an optional admin key.
- Optional pywebview desktop launcher and Windows packaging/setup scripts.
- Automated Python tests and a GitHub Actions CI workflow.
- Ten-theme selector and full theme cycling control.

### Improved
- Safer local-only default bind address and bounded, defensive environment-variable parsing.
- Local `.env` and `config.txt` token support without placing secrets in client code.
- CSV validation, upload size limits, atomic upload replacement, and explicit overwrite confirmation.
- GitHub Contents API sync skips a write when a remote file has not changed.
- Sensor firmware no longer ships real Wi-Fi credentials; it reports an unavailable sensor before the first valid reading and retries Wi-Fi.
- Documentation now describes current endpoints and deployment modes, plus security, parts list, firmware, tests, and troubleshooting.

### Security note
Any credential that appeared in an earlier public commit should be rotated/revoked. Replacing a file in this release does not erase earlier Git history.
