// Shared spacebar-pan state: while the pointer hovers a pannable surface and
// the space bar is held, the surface signals pan readiness via CSS classes
// (`pan-ready` -> grab cursor, `panning` -> grabbing cursor). Widgets decide
// themselves how a pan drag translates into content movement.
const FORM_FIELDS = /^(INPUT|TEXTAREA|SELECT|BUTTON)$/;

export function createSpacebarPan(surface) {
  let space = false, hover = false, panning = false;
  const update = () => {
    surface.classList.toggle('pan-ready', space && !panning);
    surface.classList.toggle('panning', panning);
  };
  const enter = () => { hover = true; };
  const leave = () => { hover = false; };
  const keydown = event => {
    if (event.code !== 'Space') return;
    const target = event.composedPath()[0];
    if (target instanceof Element && (FORM_FIELDS.test(target.tagName) || target.isContentEditable)) return;
    if (!hover && !panning && !space) return;
    event.preventDefault();
    space = true;
    update();
  };
  const keyup = event => {
    if (event.code !== 'Space') return;
    space = false;
    update();
  };
  const reset = () => { space = false; update(); };
  surface.addEventListener('pointerenter', enter);
  surface.addEventListener('pointermove', enter);
  surface.addEventListener('pointerleave', leave);
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', reset);
  return {
    get active() { return space; },
    start() { panning = true; update(); },
    stop() { panning = false; update(); },
    dispose() {
      surface.removeEventListener('pointerenter', enter);
      surface.removeEventListener('pointermove', enter);
      surface.removeEventListener('pointerleave', leave);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', reset);
      panning = false;
      reset();
    },
  };
}

export function createTimePan(target, {controller, bounds, plotWidth, start, commit}) {
  const touches = new Map();
  let gesture = null, suppressTouch = false, pending = false;
  let marks = [], original = [];
  const restore = () => marks.forEach((mark, i) => {
    if (original[i] === null) mark.removeAttribute('transform');
    else mark.setAttribute('transform', original[i]);
  });
  const average = () => [...touches.values()].reduce((sum, x) => sum + x, 0) / touches.size;
  const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  const capture = event => {
    if (target.hasPointerCapture(event.pointerId)) return;
    try { target.setPointerCapture(event.pointerId); }
    catch (error) {
      if (!['NotFoundError','InvalidStateError','NotSupportedError'].includes(error.name)) throw error;
    }
  };
  const begin = x => {
    const [rawFrom, rawTo] = bounds();
    const from = Math.floor(rawFrom), to = Math.floor(rawTo);
    const width = plotWidth();
    if (!(to > from) || !(width > 0)) return;
    marks = [...target.querySelectorAll('path,polyline,polygon,circle')];
    original = marks.map(mark => mark.getAttribute('transform'));
    gesture = {x, last:x, from, to, secondsPerPixel:(to - from) / width, shift:0};
    start?.();
    controller.start();
  };
  const finish = apply => {
    if (!gesture) return;
    const {from, to, shift} = gesture;
    gesture = null;
    controller.stop();
    if (apply && Math.abs(shift) >= 2) {
      pending = true;
      commit(from + shift, to + shift);
    }
    else restore();
  };
  const down = event => {
    if (pending) { consume(event); return; }
    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, event.clientX);
      if (touches.size < 2 && !suppressTouch) return;
      suppressTouch = true;
      consume(event);
      capture(event);
      if (!gesture) begin(average());
      else {
        const x = average();
        gesture.x += x - gesture.last;
        gesture.last = x;
      }
    } else if (event.button === 0 && controller.active) {
      consume(event);
      begin(event.clientX);
      capture(event);
    }
  };
  const move = event => {
    if (!gesture) {
      if (suppressTouch && event.pointerType === 'touch') consume(event);
      return;
    }
    consume(event);
    if (event.pointerType === 'touch') {
      if (!touches.has(event.pointerId)) return;
      touches.set(event.pointerId, event.clientX);
      gesture.last = average();
    } else {
      if (!(event.buttons & 1)) { finish(true); return; }
      gesture.last = event.clientX;
    }
    gesture.shift = Math.round(Math.min((gesture.x - gesture.last) * gesture.secondsPerPixel,
      Math.max(0, Math.floor(Date.now() / 1000) - gesture.to)));
    const dx = -gesture.shift / gesture.secondsPerPixel * target.viewBox.baseVal.width
      / target.getBoundingClientRect().width;
    marks.forEach((mark, i) => mark.setAttribute('transform', `translate(${dx} 0) ${original[i] || ''}`));
  };
  const up = event => {
    const touch = event.pointerType === 'touch';
    if (touch) touches.delete(event.pointerId);
    if (!gesture && !suppressTouch) return;
    consume(event);
    if (gesture && touch && touches.size >= 2) {
      const x = average();
      gesture.x += x - gesture.last;
      gesture.last = x;
      return;
    }
    finish(event.type !== 'pointercancel');
    if (!touches.size) suppressTouch = false;
  };
  const reset = () => { finish(false); touches.clear(); suppressTouch = false; };
  const preventNativePan = event => {
    if (event.touches.length >= 2 || suppressTouch) event.preventDefault();
  };
  const handlers = {pointerdown:down, pointermove:move, pointerup:up, pointercancel:up};
  for (const [type, handler] of Object.entries(handlers)) target.addEventListener(type, handler, true);
  target.addEventListener('touchstart', preventNativePan, {passive:false});
  target.addEventListener('touchmove', preventNativePan, {passive:false});
  window.addEventListener('blur', reset);
  return {
    get busy() { return Boolean(gesture) || pending; },
    dispose() {
      reset();
      for (const [type, handler] of Object.entries(handlers)) target.removeEventListener(type, handler, true);
      target.removeEventListener('touchstart', preventNativePan);
      target.removeEventListener('touchmove', preventNativePan);
      window.removeEventListener('blur', reset);
    },
  };
}
