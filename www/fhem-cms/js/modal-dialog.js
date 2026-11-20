export function showCmsModal(dialog) {
  // The dialog is the last scroll container, including when its content fits.
  dialog.style.overscrollBehavior = 'contain';
  dialog.showModal();
}
