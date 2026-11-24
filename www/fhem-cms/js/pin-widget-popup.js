import { showCmsModal } from './modal-dialog.js';

export function createPinWidgetPopup(root, createWidget) {
  const doc = root.ownerDocument;
  let current = null;
  const close = () => {
    if (!current) return;
    const {dialog} = current;
    current = null;
    if (dialog.open) dialog.close();
    dialog.remove();
  };
  return {
    open(widget) {
      close();
      const dialog = doc.createElement('dialog');
      dialog.className = 'cms-pin-widget-popup';
      const heading = doc.createElement('h2');
      heading.textContent = widget.title || widget.config?.customTitle || widget.device || widget.id;
      dialog.setAttribute('aria-label', heading.textContent);
      const dismiss = doc.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'cms-button';
      dismiss.textContent = 'Schließen';
      dismiss.addEventListener('click', close);
      dialog.append(heading, dismiss);
      dialog.addEventListener('close', () => { if (current?.dialog === dialog) close(); });
      dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
      root.append(dialog);
      current = {dialog, id: widget.id, element: null};
      try {
        const content = doc.createElement('div');
        content.className = 'cms-pin-widget-popup-content';
        current.element = createWidget(widget.id);
        content.append(current.element);
        dialog.append(content);
        showCmsModal(dialog);
      } catch (error) {
        const message = doc.createElement('p');
        message.setAttribute('role', 'alert');
        message.textContent = `Widget konnte nicht geöffnet werden: ${error.message || String(error)}`;
        dialog.append(message);
        if (!dialog.open) showCmsModal(dialog);
      }
    },
    update(updateWidget) {
      if (current?.element) updateWidget(current.id, current.element);
    },
    close,
  };
}
