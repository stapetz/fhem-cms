#!/usr/bin/env python3
"""Run the solar and all-widget layout fixtures with Safari's WebKit engine."""

import functools
import http.server
import pathlib
import threading

from playwright.sync_api import sync_playwright


ROOT = pathlib.Path(__file__).resolve().parents[1]
CASES = [
    ("90_widget_dates.html", 1400, 1000, False),
    ("58_calllist.html", 1400, 1000, False),
    ("88_volvoconnect.html", 1400, 1000, False),
    ("89_volvoconnect_order.html", 1400, 1000, False),
    ("89_volvoconnect_order.html", 1400, 600, False),
    ("89_volvoconnect_order.html", 393, 852, True),
    ("89_volvoconnect_order.html", 834, 1194, True),
    ("89_volvoconnect_order.html?columns=96&inline=1", 1600, 1000, False),
    ("89_volvoconnect_order.html?columns=192", 1400, 1000, False),
    ("71_device_first.html", 1400, 1000, False),
    ("45_solarflow_sizing.html", 1400, 1000, False),
    ("85_solar_energy.html", 1400, 1000, False),
    ("85_solar_energy.html?width=390", 390, 844, True),
    ("85_solar_energy.html?width=768&reduced=1", 768, 1024, True),
    ("86_mobile_widgets.html?mode=preview&cms-device=mobile&width=393", 393, 852, False),
    ("86_mobile_widgets.html?mode=preview&cms-device=mobile&width=834", 834, 1194, False),
    ("86_mobile_widgets.html?mode=preview&cms-device=mobile&width=852&landscape=1", 852, 393, False),
    ("86_mobile_widgets.html?mode=touch-test", 1400, 1000, True),
]


def check_popup_order(page):
    page.wait_for_function(
        "document.querySelector('#result').dataset.ready || document.querySelector('#result').dataset.result"
    )
    assert page.locator("#result").inner_text() == "READY", page.locator("#result").inner_text()
    page.evaluate("window.popupOrderTest.host().openDetails(); window.popupOrderTest.prepareFullWidth()")
    handle = page.locator('cms-volvoconnect [data-details] [data-group="state"] [data-drag-card]')
    handle.scroll_into_view_if_needed()
    source = handle.bounding_box()
    page.mouse.move(source["x"] + source["width"] / 2, source["y"] + source["height"] / 2)
    page.mouse.down()
    page.mouse.move(source["x"] + source["width"] / 2 + 20, source["y"] + source["height"] / 2)
    assert page.evaluate("Boolean(window.popupOrderTest.host().drag)")
    target = page.evaluate("""() => {
        const {$}=window.popupOrderTest,b=$('[data-detail-body]');b.scrollTop=0;
        const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+10};
    }""")
    page.mouse.move(target["x"], target["y"])
    page.mouse.up()
    assert page.evaluate("window.popupOrderTest.order()[0]") == "state", "full-width card cannot return to start"
    assert page.evaluate("""() => {const {$}=window.popupOrderTest,c=$('[data-group="state"]');
        return [...$('#top').children].every(other=>c.getBoundingClientRect().top<=other.getBoundingClientRect().top+1);}""")
    page.evaluate("window.popupOrderTest.host().cancelArrangement(); window.popupOrderTest.host().startArrangement()")
    for cancelled in [True, False]:
        corner = page.locator('cms-volvoconnect [data-details] [data-group="state"] [data-resize-card]')
        corner.scroll_into_view_if_needed()
        source = corner.bounding_box()
        x, y = source["x"] + source["width"] / 2, source["y"] + source["height"] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        assert page.evaluate("Boolean(window.popupOrderTest.host().resize)"), "corner resize did not start"
        before = page.evaluate("JSON.stringify(window.popupOrderTest.host().pendingSizes.state)")
        geometry_before = page.evaluate("window.popupOrderTest.geometry()")
        order_before = page.evaluate("window.popupOrderTest.host().pendingCardOrder")
        page.evaluate("window.popupOrderTest.host().data = window.popupOrderTest.host().snapshot")
        assert page.evaluate("Boolean(window.popupOrderTest.host().resize)"), "live update interrupted resize"
        page.mouse.move(x + 70, y - 96)
        if cancelled:
            page.keyboard.press("Escape")
        page.mouse.up()
        assert not page.evaluate("Boolean(window.popupOrderTest.host().resize)"), "resize retained pointer capture"
        if cancelled:
            assert page.evaluate("JSON.stringify(window.popupOrderTest.host().pendingSizes.state)") == before
            assert page.evaluate("window.popupOrderTest.geometry()") == geometry_before
            assert page.evaluate("window.popupOrderTest.host().pendingCardOrder") == order_before
        else:
            assert page.evaluate("JSON.stringify(window.popupOrderTest.host().pendingSizes.state)") != before
        assert page.evaluate("window.popupOrderTest.writes()") == 0, "resize wrote before apply"
    page.locator('cms-volvoconnect [data-details] [data-group="state"] [data-resize-card]').focus()
    height_before = page.evaluate("window.popupOrderTest.host().pendingSizes.state.h")
    page.keyboard.press("ArrowDown")
    assert page.evaluate("window.popupOrderTest.host().pendingSizes.state.h") == height_before + 1
    page.evaluate("window.popupOrderTest.host().cancelArrangement(); window.popupOrderTest.host().startArrangement()")
    dropped = None
    for cancelled in [True, False]:
        units = page.evaluate("window.popupOrderTest.prepareFreeDrag()")
        before = page.evaluate("window.popupOrderTest.geometry()")
        handle = page.locator('cms-volvoconnect [data-details] [data-group="gallery"] [data-drag-card]')
        handle.scroll_into_view_if_needed()
        source = handle.bounding_box()
        x, y = source["x"] + source["width"] / 2, source["y"] + source["height"] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 20, y)
        assert page.evaluate("Boolean(window.popupOrderTest.host().drag)")
        assert page.locator("cms-volvoconnect .grid-stack-placeholder .placeholder-content").count() == 1
        page.evaluate("window.popupOrderTest.host().data=window.popupOrderTest.host().snapshot")
        assert page.evaluate("Boolean(window.popupOrderTest.host().drag)"), "live update interrupted drag"
        target = {"x": x + 20 + units["dx"] * units["colWidth"], "y": y + units["dy"] * units["rowHeight"]}
        if units["mobile"]:
            target = page.evaluate("""() => {
                const b=window.popupOrderTest.$('[data-detail-body]');b.scrollTop=0;
                const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+10};
            }""")
        page.mouse.move(target["x"], target["y"])
        if cancelled and not units["mobile"]:
            edge = page.evaluate("""() => {
                const b=window.popupOrderTest.$('[data-detail-body]'),r=b.getBoundingClientRect();
                return {x:r.x+r.width/2,y:r.bottom-5,scroll:b.scrollTop};
            }""")
            page.mouse.move(edge["x"], edge["y"])
            page.wait_for_function(
                "before => window.popupOrderTest.$('[data-detail-body]').scrollTop > before",
                arg=edge["scroll"],
            )
        if cancelled:
            page.keyboard.press("Escape")
        page.mouse.up()
        if cancelled:
            assert page.evaluate("window.popupOrderTest.geometry()") == before, "Escape did not restore exact geometry"
        else:
            if units["mobile"]:
                assert page.evaluate("window.popupOrderTest.order()[0]") == "gallery"
            else:
                assert page.evaluate("window.popupOrderTest.host().pendingPositions.gallery") == {"x": units["dx"], "y": units["dy"]}
            dropped = page.evaluate("window.popupOrderTest.geometry()")
    assert page.evaluate("window.popupOrderTest.writes()") == 0, "drag wrote a draft"
    page.keyboard.press("Escape")
    assert not page.evaluate("Boolean(window.popupOrderTest.host().pendingCardOrder)"), "Escape did not cancel"
    assert page.locator("cms-volvoconnect [data-details]").is_visible()
    page.evaluate("window.popupOrderTest.host().startArrangement()")
    page.locator('cms-volvoconnect [data-details] [data-group="gallery"] [data-drag-card]').focus()
    page.keyboard.press("ArrowUp")
    assert page.evaluate("window.popupOrderTest.order()[2]") == "gallery", "keyboard did not reorder"
    units = page.evaluate("window.popupOrderTest.prepareFreeDrag()")
    handle = page.locator('cms-volvoconnect [data-details] [data-group="gallery"] [data-drag-card]')
    handle.scroll_into_view_if_needed()
    source = handle.bounding_box()
    x, y = source["x"] + source["width"] / 2, source["y"] + source["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 20, y)
    target = {"x": x + 20 + units["dx"] * units["colWidth"], "y": y + units["dy"] * units["rowHeight"]}
    if units["mobile"]:
        target = page.evaluate("""() => {
            const b=window.popupOrderTest.$('[data-detail-body]');b.scrollTop=0;
            const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+10};
        }""")
    page.mouse.move(target["x"], target["y"])
    page.mouse.up()
    page.wait_for_function("!window.popupOrderTest.host().drag")
    page.evaluate('window.popupOrderTest.host().toggleCard("doors"); window.popupOrderTest.host().saveArrangement()')
    page.wait_for_function("""window.popupOrderTest.writes() === 1
        && document.querySelector('cms-volvoconnect').shadowRoot.querySelector('[data-details]').open
        && !window.popupOrderTest.host().pendingCardOrder""")
    page.evaluate("window.popupOrderTest.host().startArrangement()")
    assert page.evaluate("window.popupOrderTest.geometry()") == dropped, "free layout was lost on Apply/reopening"
    page.evaluate("window.popupOrderTest.host().cancelArrangement()")
    page.evaluate("window.popupOrderTest.finish()")


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
                        if fixture.startswith("89_volvoconnect_order.html"):
                            check_popup_order(page)
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
