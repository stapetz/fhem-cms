import { fitFreeformRect } from './fcui-freeform-layout.js';
import { fitWidgetTools } from './fcui-freeform-view.js';
import { pinCanvasPoint, pinPercentPoint } from './pin-layout.js';

export function mountPinEditor(root, page, view, editing) {
  const doc = root.ownerDocument;
  const events = new AbortController();
  const options = {signal: events.signal};
  const pins = page.widgets.filter(widget => view.isPin(widget.id));
  const tooltip = doc.createElement('output');
  tooltip.className = 'cms-pin-position';
  tooltip.setAttribute('aria-live', 'polite');
  let selected, active, dragged = false, toggleOff = false;
  function draw(position) {
    view.placePin(selected, position);
    tooltip.textContent = `X: ${position.centerX.toFixed(2)}% | Y: ${position.centerY.toFixed(2)}%`;
  }
  function select(widget) {
    if (selected) view.wrappers.get(selected.id).classList.remove('cms-widget-selected');
    selected = widget;
    tooltip.remove();
    if (!selected) return;
    view.canvas.dispatchEvent(new CustomEvent('cms-pin-select'));
    const wrapper = view.wrappers.get(selected.id);
    wrapper.classList.add('cms-widget-selected');
    wrapper.append(tooltip);
    draw(view.pinPosition(selected));
  }
  function save(position) {
    const point = pinCanvasPoint(position, view.getPinFrame());
    const rect = fitFreeformRect({...selected.rect, x: point.x - selected.rect.w / 2,
      y: point.y - selected.rect.h / 2}, page.canvas);
    editing.onFreeformChange(selected.id, rect, selected.hideOnMobile, position);
  }
  function calculate(event) {
    return pinPercentPoint({
      x: active.point.x + (event.clientX - active.x) / active.scale,
      y: active.point.y + (event.clientY - active.y) / active.scale,
    }, active.frame);
  }
  function end(event, commit) {
    if (!active || (event.pointerId !== undefined && event.pointerId !== active.id)) return;
    const gesture = active;
    const moved = gesture.moved || (commit && (event.clientX !== gesture.x || event.clientY !== gesture.y));
    const position = commit && moved ? calculate(event) : gesture.position;
    active = null;
    dragged = moved || !commit;
    gesture.wrapper.classList.remove('cms-pin-dragging');
    if (gesture.target.hasPointerCapture(gesture.id)) gesture.target.releasePointerCapture(gesture.id);
    draw(position);
    if (commit && (position.centerX !== gesture.position.centerX || position.centerY !== gesture.position.centerY)) save(position);
  }
  for (const widget of pins) {
    const wrapper = view.wrappers.get(widget.id);
    const drag = wrapper.querySelector('[data-dir="move"]');
    drag.addEventListener('dragstart', event => event.preventDefault(), options);
    drag.addEventListener('click', event => {
      if (event.detail === 0) select(selected === widget ? undefined : widget);
      else if (!dragged) select(toggleOff ? undefined : widget);
      dragged = false;
    }, options);
    drag.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || active || root.inert) return;
      event.preventDefault();
      toggleOff = selected === widget;
      select(widget);
      drag.focus({preventScroll: true});
      const position = view.pinPosition(widget);
      const frame = view.getPinFrame();
      dragged = false;
      active = {id: event.pointerId, target: drag, wrapper, position, frame,
        point: pinCanvasPoint(position, frame), x: event.clientX, y: event.clientY,
        scale: view.getScale(), moved: false};
      drag.setPointerCapture(event.pointerId);
      event.stopPropagation();
    }, options);
    drag.addEventListener('pointermove', event => {
      if (active?.id !== event.pointerId || root.inert) return;
      active.moved ||= event.clientX !== active.x || event.clientY !== active.y;
      if (active.moved) wrapper.classList.add('cms-pin-dragging');
      draw(calculate(event));
    }, options);
    drag.addEventListener('pointerup', event => end(event, !root.inert), options);
    drag.addEventListener('pointercancel', event => end(event, false), options);
    drag.addEventListener('lostpointercapture', event => end(event, false), options);
    drag.addEventListener('keydown', event => {
      if (active || root.inert) return;
      const delta = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[event.key];
      if (!delta) return;
      event.preventDefault();
      select(widget);
      const frame = view.getPinFrame();
      const point = pinCanvasPoint(view.pinPosition(widget), frame);
      const step = event.shiftKey ? 10 : 1;
      save(pinPercentPoint({x: point.x + delta[0] * step, y: point.y + delta[1] * step}, frame));
    }, options);
  }
  view.canvas.addEventListener('click', event => {
    if (!event.target.closest('.cms-freeform-pin') && !active) select();
  }, options);
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || root.inert
      || event.target.closest?.('dialog, .cms-menu-items, :popover-open')) return;
    if (active) end(event, false);
    else select();
  }, options);
  doc.defaultView.addEventListener('blur', () => end({}, false), options);
  select(pins.find(widget => widget.id === editing.selectedWidget));
  return () => { end({}, false); events.abort(); tooltip.remove(); };
}
