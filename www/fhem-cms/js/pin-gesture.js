export const PIN_HOLD_MS = 400;
export const PIN_MOVE_LIMIT = 6;

export function bindPinGesture(button, {tap, open, direct, enabled}) {
  const abort = new AbortController();
  const options = {signal: abort.signal};
  let gesture = null;
  let timer = null;
  let suppressClick = false;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    const previous = gesture;
    gesture = null;
    if (previous && button.hasPointerCapture?.(previous.id)) button.releasePointerCapture(previous.id);
  };
  const hold = () => {
    if (!gesture || gesture.cancelled || gesture.held || !enabled()) return;
    gesture.held = true;
    clearTimeout(timer);
    timer = null;
    open();
  };
  button.addEventListener('pointerdown', event => {
    if (gesture) {
      gesture.cancelled = true;
      clearTimeout(timer);
      return;
    }
    if (!event.isPrimary || event.button !== 0 || !enabled()) return;
    suppressClick = true;
    gesture = {id: event.pointerId, x: event.clientX, y: event.clientY,
      started: performance.now(), held: false, cancelled: false};
    button.setPointerCapture(event.pointerId);
    if (direct()) timer = setTimeout(hold, PIN_HOLD_MS);
  }, options);
  button.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > PIN_MOVE_LIMIT) {
      gesture.cancelled = true;
      clearTimeout(timer);
      timer = null;
    }
  }, options);
  button.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const previous = gesture;
    if (Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > PIN_MOVE_LIMIT) {
      previous.cancelled = true;
    }
    if (!previous.cancelled && !previous.held && enabled()) {
      if (direct() && performance.now() - previous.started >= PIN_HOLD_MS) hold();
      else if (direct()) tap();
      else open();
    }
    cancel();
  }, options);
  for (const type of ['pointercancel', 'lostpointercapture', 'blur']) {
    button.addEventListener(type, cancel, options);
  }
  button.addEventListener('keydown', event => {
    if (event.key === 'Escape') cancel();
    if (event.key === 'Enter' || event.key === ' ') suppressClick = false;
  }, options);
  button.addEventListener('contextmenu', event => {
    if (gesture) event.preventDefault();
  }, options);
  button.addEventListener('click', event => {
    if (suppressClick && event.detail !== 0) {
      event.preventDefault();
      return;
    }
    if (enabled()) open();
  }, options);
  return () => { cancel(); abort.abort(); };
}
