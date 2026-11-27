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
      surface.removeEventListener('pointerleave', leave);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', reset);
      panning = false;
      reset();
    },
  };
}
