# PySmartHome-PC 4.0.0 — Release and Migration Notes

## What changed

- Preserved the existing sensor dashboard, charts, CSV history, outage-cycle planner, GitHub data publishing, and ESP32 firmware layout.
- Added ten selectable visual themes, an improved combined-node chart path, a local CSV file manager, validated CSV import/export workflow, and a small diagnostics endpoint.
- Added an installable PWA shell, conservative service-worker caching, a Windows desktop wrapper/build scripts, and a CI workflow.
- Added GitHub Page Insights integration scoped to the production GitHub Pages origin/path; no GitHub write token is sent to the browser.
- Standardized local configuration through `.env.example`, ignored local secret files, replaced firmware Wi-Fi values with placeholders, and added remote write checks for non-loopback clients.
- Rewrote project documentation and added security/contribution/changelog files.

## Recommended update process

1. Make a branch or download a backup of the existing repository first.
2. Extract `PySmartHome-PC-v4.0.0-source-replacements.zip` into the **repository root**, allowing the included files to replace files with the same names. This archive intentionally omits the historical `data/` directory so it cannot overwrite your live CSV history and schedule snapshots.
3. Do not add a `config.txt` file to Git. If the old repository tracked it, run from the local clone:

   ```powershell
   git rm --cached --ignore-unmatch config.txt
   ```

   This removes the tracked copy from the next commit while leaving a local working copy alone if one exists. The `.gitignore` update prevents it from being added again accidentally.
4. **Immediately revoke or rotate any GitHub token that was ever committed.** A new commit deleting a secret does not delete it from previous Git history, forks, cached copies, or clones. If old public firmware contained real Wi-Fi credentials, change the Wi-Fi password and update both local sketches before reflashing.
5. Create a private local `.env` from `.env.example`; never upload `.env` or `config.txt`. Set the sensor addresses for your LAN. For publishing sensor snapshots, create a new fine-grained GitHub token restricted to this repository and only the required Contents read/write permission; store it in `PYSMART_GITHUB_TOKEN` in your local `.env` or OS environment.
6. Review `Board-Code/esp32_hub.ino` and `Board-Code/esp32_s3.ino`. Put your actual SSID/password into your local copies, compile and flash them, but do not commit those credential changes.
7. Commit and push the code/documentation changes. In GitHub repository **Settings → Pages**, select **Deploy from a branch**, branch `main`, folder `/(root)`.
8. Confirm the public dashboard works at `https://mehrdadmb2.github.io/PySmartHome-PC/`. Visit it once, then inspect `https://mehrdadmb2.github.io/github-page-insights/` for platform ID `pysmarthome-pc-github-pages`. Analytics requires the referenced Page Insights Worker and database to be operational.
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
- Automated Flask integration tests are included and are configured in GitHub Actions. They could not be executed in the current editing environment because Flask/pytest dependencies were not available locally and package installation could not reach a package index. Run the test commands after dependencies are installed or let GitHub Actions execute the workflow.
