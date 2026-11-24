# Security Policy

## Supported deployment model

PySmartHome-PC is designed for local use or a trusted private LAN, not direct exposure to the public internet. The default bind address is `127.0.0.1`. Setting `PYSMART_HOME_HOST=0.0.0.0` makes the service reachable on available network interfaces and should be done only with an appropriate host firewall and network segmentation.

The ESP32 HTTP endpoints are unauthenticated. Do not port-forward them or the Python server to the internet.

## Secrets and data

- Never commit `config.txt`, `.env`, Wi-Fi credentials, GitHub write tokens, or admin keys.
- Use the narrowest practical fine-grained GitHub token: repository access limited to this repository and Contents read/write permission only as needed.
- If a secret was committed, revoke or rotate it immediately. Deleting it in a later commit does not remove it from Git history, forks, caches, or clones.
- Files inside a public repository's `data/` folder are public. Do not upload private or sensitive measurements.
- Analytics is loaded only on the production GitHub Pages host; advanced browser telemetry is disabled by default in the included configuration.

## Remote writes

Remote clients can read the dashboard and allowed data files. Non-loopback clients cannot upload/delete sensor files or update the outage schedule unless `PYSMART_HOME_ADMIN_KEY` is configured and supplied in the `X-Admin-Key` request header. Loopback requests are allowed for local administration. This is a lightweight local-network control, not a replacement for a full identity system or HTTPS reverse proxy.

## Reporting

Please avoid posting live credentials, network details, or sensitive telemetry in public issues. Rotate any exposed credential first, then report the issue with a sanitized reproduction and the affected version.


## ESP32 market proxy on the local network

When ESP32 nodes need the `/api/market` endpoint, the Python service must bind to a LAN-accessible interface (for example `PYSMART_HOME_HOST=0.0.0.0`). Restrict the Windows Firewall inbound rule for TCP 5000 to the trusted Private profile and do not forward this port from the internet. The market endpoint is read-only and contains public quote values; administrative write endpoints continue to require loopback or `PYSMART_HOME_ADMIN_KEY`. The board-to-PC HTTP request is intentionally local-LAN only; do not expose it on an untrusted network.
