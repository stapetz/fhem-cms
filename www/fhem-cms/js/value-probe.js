export function createValueProbe(target, {show, hide}) {
  let enabled = false;
  let press = null;
  const clear = () => { enabled = false; press = null; hide(); };
  const down = event => {
    if (event.button !== 0) return;
    press = {id:event.pointerId, x:event.clientX, y:event.clientY, moved:false};
    if (event.pointerType === 'touch') show(event);
  };
  const move = event => {
    if (press?.id === event.pointerId
      && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 6) press.moved = true;
    if (press?.moved) { hide(); return; }
    if (event.pointerType === 'touch' ? press?.id === event.pointerId : enabled) show(event);
  };
  const up = event => {
    if (press?.id !== event.pointerId) return;
    const moved = press.moved || Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 6;
    press = null;
    if (event.pointerType === 'touch') { hide(); return; }
    if (moved) { enabled = false; hide(); return; }
    enabled = !enabled;
    if (enabled) show(event);
    else hide();
  };
  const leave = () => { hide(); };
  const keydown = event => {
    if (event.key !== 'Escape' || (!enabled && !press)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    clear();
  };
  const handlers = {pointerdown:down,pointermove:move,pointerup:up,pointerleave:leave,pointercancel:clear};
  for (const [type, handler] of Object.entries(handlers)) target.addEventListener(type, handler);
  window.addEventListener('blur', clear);
  window.addEventListener('keydown', keydown, true);
  return {
    clear,
    dispose() {
      clear();
      for (const [type, handler] of Object.entries(handlers)) target.removeEventListener(type, handler);
      window.removeEventListener('blur', clear);
      window.removeEventListener('keydown', keydown, true);
    },
  };
}
