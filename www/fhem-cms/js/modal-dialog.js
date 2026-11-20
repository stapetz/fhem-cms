const guarded = new WeakSet();

function canScroll(event, popup, delta, axis) {
  for (const node of event.composedPath()) {
    if (node.nodeType === 1) {
      const vertical = axis === 'y';
      const overflow = getComputedStyle(node)[vertical ? 'overflowY' : 'overflowX'];
      const limit = vertical ? node.scrollHeight - node.clientHeight : node.scrollWidth - node.clientWidth;
      const position = vertical ? node.scrollTop : node.scrollLeft;
      if (/^(auto|scroll|overlay)$/.test(overflow) && limit > 0
        && (delta < 0 ? position > 0.5 : position < limit - 0.5)) return true;
    }
    if (node === popup) break;
  }
  return false;
}

export function containPopupScroll(popup) {
  if (guarded.has(popup)) return;
  guarded.add(popup);
  const contain = (event, x, y) => {
    if (event.defaultPrevented || (!x && !y)) return;
    const vertical = Math.abs(y) >= Math.abs(x);
    if (!canScroll(event, popup, vertical ? y : x, vertical ? 'y' : 'x')) event.preventDefault();
  };
  popup.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) contain(event, event.deltaX, event.deltaY);
  }, { passive: false });

  let touch;
  popup.addEventListener('touchstart', event => {
    touch = event.touches.length === 1 ? event.touches[0] : null;
  }, { passive: true });
  popup.addEventListener('touchmove', event => {
    const next = event.touches.length === 1 ? event.touches[0] : null;
    if (touch && next && touch.identifier === next.identifier) {
      contain(event, touch.clientX - next.clientX, touch.clientY - next.clientY);
    }
    touch = next;
  }, { passive: false });
}

export function showCmsModal(dialog) {
  // The dialog is the last scroll container, including when its content fits.
  dialog.style.overscrollBehavior = 'contain';
  containPopupScroll(dialog);
  dialog.showModal();
}
