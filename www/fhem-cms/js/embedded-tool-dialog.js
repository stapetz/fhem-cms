import { showCmsModal } from './modal-dialog.js';

export function openEmbeddedTool({ trigger, url, title, frameTitle, closeMessage, canClose }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'cms-page-modal cms-eventmonitor-modal';
  dialog.setAttribute('aria-label', title);
  const header = document.createElement('header');
  const heading = document.createElement('h2');
  heading.textContent = title;
  const openLink = document.createElement('a');
  openLink.className = 'cms-button';
  const standaloneUrl = new URL(url);
  standaloneUrl.searchParams.delete('embedded');
  openLink.href = standaloneUrl.href;
  openLink.target = '_blank';
  openLink.rel = 'noopener';
  openLink.textContent = 'In eigenem Fenster öffnen';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const frame = document.createElement('iframe');
  frame.className = 'cms-eventmonitor-frame';
  frame.title = frameTitle;
  frame.src = url.href;

  const allowed = () => {
    const error = canClose?.(frame.contentWindow);
    if (error) status.textContent = error;
    return !error;
  };
  dialog.addEventListener('cancel', event => {
    if (!allowed()) event.preventDefault();
  });
  openLink.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (!allowed()) return;
    const newWindow = window.open('', '_blank', 'popup,width=1200,height=800');
    if (!newWindow) {
      status.textContent = 'Das Fenster wurde vom Browser blockiert. Bitte Popups für diese Seite erlauben.';
      return;
    }
    newWindow.opener = null;
    newWindow.location.href = openLink.href;
    dialog.close();
  });
  const onMessage = event => {
    if (event.source === frame.contentWindow && event.origin === window.location.origin
      && event.data === closeMessage && allowed()) dialog.close();
  };
  window.addEventListener('message', onMessage);
  dialog.addEventListener('close', () => {
    window.removeEventListener('message', onMessage);
    frame.src = 'about:blank';
    dialog.remove();
    trigger.focus();
  }, { once: true });
  header.append(heading, openLink);
  dialog.append(header, status, frame);
  document.body.append(dialog);
  showCmsModal(dialog);
  dialog.querySelector('.cms-close-button')?.focus();
}
