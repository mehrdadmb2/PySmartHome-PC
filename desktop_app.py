#!/usr/bin/env python3
"""Optional native desktop shell for PySmartHome-PC.

Install requirements-desktop.txt to use the embedded pywebview window. Without
pywebview this launcher opens the system browser while keeping the local server
alive. Runtime CSV history and config remain next to the executable/project.
"""
from __future__ import annotations

import logging
import threading
import time
import webbrowser
from pathlib import Path

import requests

import server

URL = f"http://127.0.0.1:{server.PORT}/"
logger = logging.getLogger("pysmarthome.desktop")


def run_server() -> None:
    server.start_worker()
    server.app.run(host="127.0.0.1", port=server.PORT, debug=False, threaded=True, use_reloader=False)


def wait_for_server(timeout: float = 20.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            response = requests.get(f"http://127.0.0.1:{server.PORT}/api/health", timeout=0.7)
            if response.ok:
                return True
        except requests.RequestException:
            pass
        time.sleep(0.25)
    return False


def main() -> int:
    threading.Thread(target=run_server, name="pysmarthome-http", daemon=True).start()
    if not wait_for_server():
        logger.error("The local web server did not become ready. Check whether port %s is in use.", server.PORT)
        return 1

    try:
        import webview  # type: ignore
    except ImportError:
        print("pywebview is not installed; opening the dashboard in your default browser.")
        print(f"Dashboard: {URL}")
        webbrowser.open(URL)
        try:
            threading.Event().wait()
        except KeyboardInterrupt:
            return 0
        return 0

    webview.create_window(
        "PySmartHome-PC | Smart Home Control Center",
        URL,
        width=1440,
        height=940,
        min_size=(960, 640),
        text_select=True,
    )
    webview.start(debug=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
