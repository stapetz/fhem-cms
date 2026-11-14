#!/usr/bin/env python3
"""Exercise Escape with real modal stacking in Chrome and WebKit."""

import functools
import http.server
import os
import pathlib
import threading

from playwright.sync_api import sync_playwright


ROOT = pathlib.Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def run(browser, url):
    page = browser.new_page()
    try:
        page.goto(url)
        page.locator("#result").get_by_text("READY", exact=True).wait_for()

        page.get_by_text("Einfügen", exact=True).click()
        page.get_by_text("Widget hinzufügen", exact=True).click()
        panel = page.locator('dialog[data-panel="widgets"]')
        panel.wait_for(state="visible")
        page.get_by_text("SolarFlow", exact=True).click()
        widget = panel.locator("cms-solarflow")
        dialog = widget.locator("[data-dialog]")
        dialog.wait_for(state="visible")
        check_dialog_actions(widget)
        dialog.locator('[name="title"]').fill("Nicht speichern")
        dialog.locator('[data-pick="single"]').focus()
        dialog.locator('[data-pick="single"]').click()
        picker = page.locator(".cms-dp-dialog")
        picker.wait_for(state="visible")
        picker.locator("[data-cancel]").click()
        picker.wait_for(state="detached")
        focus_after_cancel = widget.evaluate("el => el.shadowRoot.activeElement?.outerHTML || null")
        dialog.locator('[data-pick="single"]').focus()
        dialog.locator('[data-pick="single"]').click()
        picker.wait_for(state="visible")
        page.keyboard.press("Escape")
        picker.wait_for(state="detached")
        assert dialog.is_visible() and panel.is_visible(), "picker Escape closed a parent"
        assert dialog.locator('[name="title"]').input_value() == "Nicht speichern"
        assert widget.evaluate("el => el.shadowRoot.activeElement?.outerHTML || null") == focus_after_cancel, \
            "Escape changed picker focus behavior"
        page.keyboard.press("Escape")
        widget.wait_for(state="detached")
        assert panel.is_visible(), "widget Escape closed its parent panel"
        for label, tag in [
            ("Thermostat", "cms-thermostat"), ("Wert-Anzeige", "cms-value"),
            ("Schalter", "cms-switch"), ("Taster", "cms-button"),
            ("Schieberegler", "cms-slider"), ("Uhr / Datum", "cms-clock"),
            ("Status-Symbol", "cms-icon"), ("Tabelle", "cms-table"),
            ("Wert auswählen", "cms-select"), ("Diagramm", "cms-chart"),
            ("Anrufliste", "cms-calllist"), ("Solar und Energiefluss", "cms-solar-energy"),
            ("VolvoConnect", "cms-volvoconnect"), ("Textbaustein", "cms-text"),
            ("Freies HTML", "cms-html"), ("LinkWidget", "cms-link"),
        ]:
            panel.get_by_text(label, exact=True).click()
            other = panel.locator(tag)
            other.locator("[data-dialog]").wait_for(state="visible")
            check_dialog_actions(other)
            if label in ("Thermostat", "Wert-Anzeige"):
                other.locator("[data-pick-device]").click()
                nested = other.locator("[data-picker]")
                nested.wait_for(state="visible")
                page.keyboard.press("Escape")
                nested.wait_for(state="hidden")
                assert other.locator("[data-dialog]").is_visible(), f"{label} picker closed its parent"
            page.keyboard.press("Escape")
            other.wait_for(state="detached")
            assert panel.is_visible(), f"{label} Escape closed its parent"
        page.keyboard.press("Escape")
        panel.wait_for(state="detached")
        assert page.evaluate("window.writes") == 0

        page.get_by_text("Bearbeiten", exact=True).click()
        page.get_by_text("Seiteneinstellungen", exact=True).click()
        settings = page.locator('dialog[data-panel="page"]')
        settings.wait_for(state="visible")
        settings.get_by_text("Hintergrundbild auswählen", exact=True).click()
        assert settings.locator(".cms-panel-close").is_disabled()
        page.keyboard.press("Escape")
        assert settings.is_visible(), "busy panel was closed"
        page.evaluate("window.releasePicker(null)")
        page.wait_for_function("!document.querySelector('[data-panel=page] .cms-panel-close').disabled")
        settings.locator('select').first.select_option("dark")
        page.keyboard.press("Escape")
        assert settings.is_visible(), "dirty close confirmation was ignored"
        page.evaluate("window.confirmClose = true")
        page.keyboard.press("Escape")
        settings.wait_for(state="detached")
        assert page.evaluate("window.writes") == 0

        page.evaluate("""async () => {
          const { DevicePreview } = await import('../www/fhem-cms/js/device-preview.js');
          window.preview = new DevicePreview({ getUrl: () => 'about:blank' });
          await window.preview.select('iphone-se');
          const menu = [...document.querySelectorAll('.cms-menu')]
            .find(item => item.querySelector('summary').textContent === 'Bearbeiten');
          menu.open = true;
          menu.querySelector('summary').focus();
        }""")
        page.keyboard.press("Escape")
        assert page.evaluate("window.preview.deviceId") == "iphone-se", "menu Escape closed preview"
        assert page.evaluate("""() => ![...document.querySelectorAll('.cms-menu')]
          .find(item => item.querySelector('summary').textContent === 'Bearbeiten').open""")
        page.evaluate("""() => {
          const dialog = document.createElement('dialog');
          dialog.innerHTML = '<button>Modal</button>';
          document.body.append(dialog);
          dialog.showModal();
        }""")
        page.keyboard.press("Escape")
        assert page.evaluate("window.preview.deviceId") == "iphone-se", "modal Escape closed preview"
        page.wait_for_function("window.preview.iframe.contentDocument.readyState === 'complete'")
        page.evaluate("""() => {
          const doc = window.preview.iframe.contentDocument;
          const host = doc.createElement('div');
          const shadow = host.attachShadow({ mode: 'open' });
          shadow.innerHTML = '<dialog><button>Inner modal</button></dialog>';
          doc.body.append(host);
          shadow.querySelector('dialog').showModal();
          shadow.querySelector('button').focus();
        }""")
        page.keyboard.press("Escape")
        assert page.evaluate("window.preview.deviceId") == "iphone-se", "iframe modal Escape closed preview"
        assert page.evaluate("""() => !window.preview.iframe.contentDocument.querySelector('div')
          .shadowRoot.querySelector('dialog').open"""), "iframe modal did not close"
        page.keyboard.press("Escape")
        assert page.evaluate("window.preview.deviceId") == "", "preview did not close"
        page.evaluate("window.preview.destroy()")
        print(f"{browser.browser_type.name}: Escape stacking, cancellation and dirty confirmation passed", flush=True)
    finally:
        page.close()


def check_dialog_actions(widget):
    result = widget.evaluate("""el => {
      const dialog = el.shadowRoot.querySelector('[data-dialog]');
      const remove = dialog.querySelector('[data-delete]');
      const actions = remove.parentElement;
      return {
        labels: [...actions.querySelectorAll('button')].map(button => button.textContent.trim()),
        align: getComputedStyle(actions).justifyContent,
        removeMargin: getComputedStyle(remove).marginRight,
        last: actions === dialog.querySelector('form').lastElementChild
      };
    }""")
    assert result["labels"] == ["Widget löschen", "Abbrechen", "Speichern"], result
    assert result["align"] == "flex-end" and result["last"], result
    assert result["removeMargin"] == "auto", result


def main():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            chrome = os.environ.get("CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
            for kind, options in [
                (playwright.chromium, {"executable_path": chrome} if pathlib.Path(chrome).exists() else {}),
                (playwright.webkit, {}),
            ]:
                browser = kind.launch(**options)
                try:
                    run(browser, f"http://127.0.0.1:{server.server_port}/t/87_dialog_escape.html")
                finally:
                    browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == "__main__":
    main()
