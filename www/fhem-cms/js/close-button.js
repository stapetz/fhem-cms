export const closeButtonSvg = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export const closeButtonCss = `
  .cms-close-button.cms-close-button {
    box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
    width: 48px; height: 48px; min-width: 48px; min-height: 48px; max-width: 48px;
    padding: 0; margin: 0; flex: none; color: var(--cms-text, #edf4ef);
    background: var(--cms-surface, #202e27); border: 1px solid var(--cms-border, #43564a);
    border-radius: .4rem; cursor: pointer; line-height: 1;
  }
  .cms-close-button.cms-close-button:hover { background: var(--cms-surface-hover, var(--cms-surface, #202e27)); }
  .cms-close-button.cms-close-button:focus { outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 2px; }
  .cms-close-button.cms-close-button:disabled { opacity: .5; cursor: default; }
  .cms-close-button.cms-close-button svg { display: block; width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  dialog > .cms-close-button { position: absolute; top: .75rem; right: .75rem; z-index: 2; }
  dialog > h1:first-of-type, dialog > h2:first-of-type, dialog > h3:first-of-type,
  dialog > form > h1:first-of-type, dialog > form > h2:first-of-type, dialog > form > h3:first-of-type {
    padding-inline-end: 56px;
  }
`;

export function styleCloseButton(button, label = 'Dialog schließen') {
  button.className = `${button.className ? `${button.className} ` : ''}cms-close-button`;
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  button.innerHTML = closeButtonSvg;
  return button;
}

export function installCloseStyles(root) {
  if (!root) return;
  if (root.querySelector('style[data-cms-close-global]')) return;
  const style = root.ownerDocument.createElement('style');
  style.dataset.cmsCloseGlobal = '';
  style.textContent = closeButtonCss;
  root.append(style);
}

export function installCloseButton(dialog) {
  const document = dialog.ownerDocument;
  if (!document || typeof document.createElement !== 'function' || !dialog.append) return;
  const ensure = () => {
    if (!dialog.querySelector(':scope > style[data-cms-close-style]')) {
      const style = document.createElement('style');
      style.dataset.cmsCloseStyle = '';
      style.textContent = closeButtonCss;
      dialog.append(style);
    }
    if (!dialog.querySelector('.cms-close-button')) {
      const button = styleCloseButton(document.createElement('button'));
      button.type = 'button';
      button.addEventListener('click', () => {
        const event = new Event('cancel', { cancelable: true });
        if (dialog.dispatchEvent(event) && dialog.open) dialog.close();
      });
      dialog.append(button);
    }
  };
  // Editor panels are opened before their constructor populates the empty root.
  if (dialog.classList.contains('cms-editor-panel')) queueMicrotask(ensure);
  else ensure();
  if (!dialog.__cmsCloseObserver && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(ensure);
    observer.observe(dialog, { childList: true });
    dialog.__cmsCloseObserver = observer;
  }
}
