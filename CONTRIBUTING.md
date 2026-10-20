# Contributing

Thanks for helping improve PySmartHome-PC. The project is local-first: changes should preserve the ability to poll sensors and view data without GitHub credentials or a cloud service.

## Before opening a pull request

1. Describe the user-facing problem, expected behavior, and affected mode (local, LAN, Pages, offline/PWA, or desktop).
2. Do not include Wi-Fi credentials, GitHub tokens, admin keys, or private data files.
3. Keep new API input validated and avoid exposing arbitrary filesystem paths.
4. Preserve the CSV compatibility contract unless a migration is included.
5. Run:

   ```powershell
   pip install -r requirements-dev.txt
   python -m pytest -q
   python -m compileall -q server.py desktop_app.py tests
   node --check app.js
   node --check bg.js
   node --check analytics-loader.js
   node --check sw.js
   ```

6. Include screenshots or example JSON/CSV samples for substantial interface or API changes.

## Scope and style

- Prefer small, testable server helpers over putting all validation in Flask routes.
- Keep sensor collection resilient if one device or GitHub is offline.
- Do not publish the GitHub write token to browser code.
- Do not enable analytics or advanced telemetry on local/LAN dashboards by default.
- Preserve the shared frontend so local mode and GitHub Pages remain visually consistent.

## Issues

For hardware issues, include the board model, GPIO mapping, sanitized node response, and relevant log lines. For publishing issues, include HTTP status/error messages but redact credentials. For data bugs, provide a small synthetic CSV rather than a personal history file.
