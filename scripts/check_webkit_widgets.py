#!/usr/bin/env python3
"""Run the solar and all-widget layout fixtures with Safari's WebKit engine."""

import functools
import http.server
import pathlib
import threading

from playwright.sync_api import sync_playwright


ROOT = pathlib.Path(__file__).resolve().parents[1]
CASES = [
    ("71_device_first.html", 1400, 1000, False),
    ("85_solar_energy.html", 1400, 1000, False),
    ("85_solar_energy.html?width=390", 390, 844, True),
    ("85_solar_energy.html?width=768&reduced=1", 768, 1024, True),
    ("86_mobile_widgets.html?mode=preview&cms-device=mobile&width=393", 393, 852, False),
    ("86_mobile_widgets.html?mode=preview&cms-device=mobile&width=834", 834, 1194, False),
    ("86_mobile_widgets.html?mode=preview&cms-device=mobile&width=852&landscape=1", 852, 393, False),
    ("86_mobile_widgets.html?mode=touch-test", 1400, 1000, True),
]


def main():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.webkit.launch()
            try:
                for fixture, width, height, touch in CASES:
                    context = browser.new_context(
                        viewport={"width": width, "height": height},
                        has_touch=touch,
                        reduced_motion="reduce" if "reduced=1" in fixture else "no-preference",
                    )
                    try:
                        page = context.new_page()
                        page.goto(f"http://127.0.0.1:{server.server_port}/t/{fixture}")
                        page.wait_for_function(
                            "document.querySelector('#result').dataset.result", timeout=90000
                        )
                        result = page.locator("#result")
                        if result.get_attribute("data-result") != "pass":
                            raise AssertionError(f"{fixture}: {result.inner_text()}")
                        print(f"{fixture}: {result.inner_text()}", flush=True)
                    finally:
                        context.close()
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == "__main__":
    main()
