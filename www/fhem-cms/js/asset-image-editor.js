import { fetchEditableImage } from './asset-image.js';

export async function editAssetImage(root, asset, signal) {
  const imageData = await fetchEditableImage(asset, signal);
  if (signal.aborted) throw new Error('Bildbearbeitung abgebrochen.');
  const url = URL.createObjectURL(imageData.blob);
  const dialog = document.createElement('dialog');
  dialog.dataset.imageEditor = '';
  dialog.setAttribute('aria-labelledby', 'image-editor-title');
  dialog.innerHTML = `
    <style>
      .image-editor-preview { position:relative; width:fit-content; max-width:100%; margin:.5rem auto; touch-action:none; }
      .image-editor-preview img { display:block; max-width:100%; max-height:40vh; user-select:none; }
      .image-editor-selection { position:absolute; border:2px solid white; box-shadow:0 0 0 9999px rgb(0 0 0 / .45);
        pointer-events:none; }
      .image-editor-frame { overflow:hidden; }
      .image-editor-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(7rem,1fr)); gap:.5rem; }
    </style>
    <h2 id="image-editor-title">Bild bearbeiten</h2>
    <p>Bildbereich mit Maus oder Finger ziehen oder die Pixelwerte eingeben. Das Original bleibt unverändert.</p>
    <div class="image-editor-frame"><div class="image-editor-preview">
      <img alt="Bild zum Zuschneiden" draggable="false"><div class="image-editor-selection"></div>
    </div></div>
    <div class="image-editor-fields">
      <label>Links (px)<input type="number" min="0" step="1" data-crop="x"></label>
      <label>Oben (px)<input type="number" min="0" step="1" data-crop="y"></label>
      <label>Breite (px)<input type="number" min="1" step="1" data-crop="w"></label>
      <label>Höhe (px)<input type="number" min="1" step="1" data-crop="h"></label>
      <label>Ausgabebreite (px)<input type="number" min="1" step="1" data-output="w"></label>
      <label>Ausgabehöhe (px)<input type="number" min="1" step="1" data-output="h"></label>
    </div>
    <p>GIF-Einzelbilder werden als PNG gespeichert; Bildmetadaten werden nicht übernommen.</p>
    <p class="error" role="alert" data-image-error></p>
    <div class="footer"><button type="button" data-image-cancel>Abbrechen</button>
      <button type="button" data-image-save>Variante erstellen</button></div>`;
  const $ = selector => dialog.querySelector(selector);
  const image = $('img');
  image.src = url;
  try {
    await image.decode();
    if (signal.aborted) throw new Error('Bildbearbeitung abgebrochen.');
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width > 8192 || height > 8192 || width * height > 16000000) {
      throw new Error('Das dekodierte Bild überschreitet die Bearbeitungsgrenze.');
    }
    const inputs = Object.fromEntries([...dialog.querySelectorAll('[data-crop]')].map(input => [input.dataset.crop, input]));
    const output = Object.fromEntries([...dialog.querySelectorAll('[data-output]')].map(input => [input.dataset.output, input]));
    const setCrop = (x, y, w, h) => {
      for (const [key, value] of Object.entries({ x, y, w, h })) inputs[key].value = String(value);
      output.w.value = String(w); output.h.value = String(h); updateSelection();
    };
    const values = () => Object.fromEntries(Object.entries(inputs).map(([key, input]) =>
      [key, input.value === '' ? NaN : Number(input.value)]));
    const validCrop = crop => Object.values(crop).every(Number.isSafeInteger) && crop.x >= 0 && crop.y >= 0
      && crop.w > 0 && crop.h > 0 && crop.x + crop.w <= width && crop.y + crop.h <= height;
    const updateSelection = () => {
      const crop = values();
      const selection = $('.image-editor-selection');
      selection.hidden = !validCrop(crop);
      if (selection.hidden) return;
      Object.assign(selection.style, { left: `${crop.x / width * 100}%`, top: `${crop.y / height * 100}%`,
        width: `${crop.w / width * 100}%`, height: `${crop.h / height * 100}%` });
    };
    for (const input of Object.values(inputs)) input.addEventListener('input', () => {
      const crop = values();
      if (validCrop(crop)) { output.w.value = String(crop.w); output.h.value = String(crop.h); }
      updateSelection();
    });
    const preview = $('.image-editor-preview');
    let start;
    const point = event => {
      const rect = image.getBoundingClientRect();
      return { x: Math.max(0, Math.min(width, Math.round((event.clientX - rect.left) / rect.width * width))),
        y: Math.max(0, Math.min(height, Math.round((event.clientY - rect.top) / rect.height * height))) };
    };
    preview.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); start = point(event); preview.setPointerCapture(event.pointerId);
    });
    preview.addEventListener('pointermove', event => {
      if (!start) return;
      const end = point(event);
      const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
      const w = Math.abs(start.x - end.x), h = Math.abs(start.y - end.y);
      if (w && h) setCrop(x, y, w, h);
    });
    preview.addEventListener('pointerup', () => { start = null; });
    preview.addEventListener('pointercancel', () => { start = null; });
    setCrop(0, 0, width, height);
    root.append(dialog);
    return await new Promise((resolve, reject) => {
      let done = false;
      const finish = (value, error) => {
        if (done) return;
        done = true; signal.removeEventListener('abort', aborted);
        if (dialog.open) dialog.close();
        dialog.remove();
        if (error) reject(error); else resolve(value);
      };
      const aborted = () => finish(null, new Error('Bildbearbeitung abgebrochen.'));
      signal.addEventListener('abort', aborted, { once: true });
      $('[data-image-cancel]').addEventListener('click', () => finish(null));
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
      $('[data-image-save]').addEventListener('click', () => {
        const crop = values(), w = Number(output.w.value), h = Number(output.h.value);
        if (!validCrop(crop) || !Number.isSafeInteger(w) || !Number.isSafeInteger(h)
          || w < 1 || h < 1 || w > crop.w || h > crop.h) {
          $('[data-image-error]').textContent = 'Bitte gültigen Bildbereich und Ausgabegrößen innerhalb des Ausschnitts eingeben.';
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const context = canvas.getContext('2d');
        if (!context) { $('[data-image-error]').textContent = 'Bildverarbeitung ist nicht verfügbar.'; return; }
        context.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
        const type = imageData.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
        canvas.toBlob(blob => {
          if (!blob || blob.type !== type) {
            $('[data-image-error]').textContent = 'Die Bildvariante konnte nicht erzeugt werden.'; return;
          }
          const base = asset.name.replace(/\.[^.]+$/, '').slice(0, 160);
          finish(new File([blob], `${base}-variante.${type === 'image/jpeg' ? 'jpg' : 'png'}`, { type }));
        }, type, 0.9);
      });
      dialog.showModal();
      if (signal.aborted) aborted();
    });
  } finally { dialog.remove(); URL.revokeObjectURL(url); }
}
