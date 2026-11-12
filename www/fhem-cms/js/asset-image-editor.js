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
      dialog[data-image-editor] { width:min(94vw,48rem); max-height:88dvh; padding:1.25rem;
        overflow:auto; color:var(--cms-text,#edf4ef); background:var(--cms-surface,#202e27);
        border:1px solid var(--cms-border,#43564a); border-radius:1rem;
        box-shadow:0 1rem 4rem rgb(0 0 0 / .4); }
      dialog[data-image-editor]::backdrop { background:var(--cms-backdrop,rgb(0 0 0 / .6)); }
      .image-editor-preview { position:relative; width:fit-content; max-width:100%; margin:.5rem auto; }
      .image-editor-preview img { display:block; max-width:100%; max-height:40vh; user-select:none; }
      .image-editor-preview[data-crop-active] img { touch-action:none; }
      .image-editor-selection { position:absolute; border:2px solid white; box-shadow:0 0 0 9999px rgb(0 0 0 / .45);
        pointer-events:none; z-index:1; }
      .image-editor-preview:not([data-crop-active]) .image-editor-selection {
        border-color:var(--cms-accent,#8fd0a8); box-shadow:none; }
      .image-editor-preview[data-crop-active] { cursor:crosshair; touch-action:none; }
      .image-editor-toolbar { position:absolute; z-index:2; top:.5rem; right:.5rem; display:flex; gap:.3rem;
        padding:.25rem; border:1px solid var(--cms-border,#43564a); border-radius:.6rem;
        background:var(--cms-surface-raised,#2a3b32); box-shadow:0 .25rem .75rem rgb(0 0 0 / .35); }
      .image-editor-tool { display:grid; place-items:center; min-width:2.75rem; min-height:2.75rem;
        padding:.45rem; color:var(--cms-text,#edf4ef); background:var(--cms-surface,#202e27);
        border:1px solid var(--cms-border,#43564a); border-radius:.4rem; cursor:pointer; }
      .image-editor-tool[aria-pressed="true"] { outline:2px solid var(--cms-accent,#8fd0a8); }
      .image-editor-tool:focus-visible { outline:2px solid var(--cms-accent,#8fd0a8); outline-offset:2px; }
      .image-editor-tool svg { width:1.35rem; height:1.35rem; fill:none; stroke:currentColor; stroke-width:1.8;
        stroke-linecap:round; stroke-linejoin:round; }
      .image-editor-crop-actions { display:flex; justify-content:center; gap:.5rem; margin:.5rem; }
      .image-editor-crop-actions[hidden] { display:none; }
      .image-editor-frame { overflow:hidden; }
      .image-editor-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr)); gap:.5rem; }
      .image-editor-fields fieldset { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr));
        gap:.5rem; min-width:0; border:1px solid var(--cms-border,#43564a); border-radius:.4rem; }
      .image-editor-fields label { display:grid; gap:.2rem; }
      .image-editor-fields input { min-width:0; width:100%; }
    </style>
    <h2 id="image-editor-title">Bild bearbeiten</h2>
    <p>Quellbild: <strong data-source-size></strong> px. Die Ausschnittmaße beziehen sich auf Pixel im
      Quellbild; die Ausgabegröße ist die Pixelauflösung der neuen Variante. Das Original bleibt unverändert.</p>
    <div class="image-editor-frame"><div class="image-editor-preview">
      <img alt="Bildvorschau" draggable="false"><div class="image-editor-selection" hidden></div>
      <div class="image-editor-toolbar" role="toolbar" aria-label="Bildwerkzeuge">
        <button type="button" class="image-editor-tool" data-image-tool="crop" aria-label="Zuschneiden"
          title="Zuschneiden" aria-pressed="false">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v11a3 3 0 0 0 3 3h11M17 3v11M3 7h11a3 3 0 0 1 3 3v11"/></svg>
        </button>
      </div>
    </div></div>
    <div class="image-editor-crop-actions" data-crop-actions hidden>
      <button type="button" data-crop-cancel>Abbrechen</button>
      <button type="button" data-crop-confirm>OK</button>
    </div>
    <p data-crop-help aria-live="polite">Zum Zuschneiden das Crop-Symbol am Bild auswählen.</p>
    <div class="image-editor-fields">
      <fieldset><legend>Ausschnitt im Quellbild</legend>
        <label>Links (Quellpixel)<input type="number" min="0" step="1" data-crop="x"></label>
        <label>Oben (Quellpixel)<input type="number" min="0" step="1" data-crop="y"></label>
        <label>Breite (Quellpixel)<input type="number" min="1" step="1" data-crop="w"></label>
        <label>Höhe (Quellpixel)<input type="number" min="1" step="1" data-crop="h"></label>
      </fieldset>
      <fieldset><legend>Ausgabegröße der neuen Variante</legend>
        <p>Standardmäßig entspricht sie dem Ausschnitt. Kleinere Werte verkleinern das Bild.</p>
        <label>Breite (px)<input type="number" min="1" step="1" data-output="w"></label>
        <label>Höhe (px)<input type="number" min="1" step="1" data-output="h"></label>
      </fieldset>
    </div>
    <p data-image-size-summary aria-live="polite"></p>
    <p>„OK“ bestätigt den Ausschnitt. „Variante erstellen“ speichert das Ergebnis als neue Datei.</p>
    <p>GIF-Einzelbilder werden als PNG gespeichert; Bildmetadaten werden nicht übernommen.</p>
    <p class="error" role="alert" data-image-error></p>
    <div class="footer"><button type="button" data-image-cancel>Bearbeitung abbrechen</button>
      <button type="button" data-image-save>Variante erstellen</button></div>`;
  const $ = selector => dialog.querySelector(selector);
  const image = $('img');
  const preview = $('.image-editor-preview');
  const cropTool = $('[data-image-tool="crop"]');
  const cropActions = $('[data-crop-actions]');
  const cropHelp = $('[data-crop-help]');
  const summary = $('[data-image-size-summary]');
  const saveButton = $('[data-image-save]');
  image.src = url;
  try {
    await image.decode();
    if (signal.aborted) throw new Error('Bildbearbeitung abgebrochen.');
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width > 8192 || height > 8192 || width * height > 16000000) {
      throw new Error('Das dekodierte Bild überschreitet die Bearbeitungsgrenze.');
    }
    $('[data-source-size]').textContent = `${width} × ${height}`;
    const inputs = Object.fromEntries([...dialog.querySelectorAll('[data-crop]')].map(input => [input.dataset.crop, input]));
    const output = Object.fromEntries([...dialog.querySelectorAll('[data-output]')].map(input => [input.dataset.output, input]));
    let cropMode = false;
    let committedCrop = null;
    let cropSnapshot = null;
    const setCrop = (x, y, w, h) => {
      for (const [key, value] of Object.entries({ x, y, w, h })) inputs[key].value = String(value);
      output.w.value = String(w); output.h.value = String(h);
      committedCrop = null;
      updateSelection(); updateSummary(); updateSaveState();
    };
    const values = () => Object.fromEntries(Object.entries(inputs).map(([key, input]) =>
      [key, input.value === '' ? NaN : Number(input.value)]));
    const validCrop = crop => Object.values(crop).every(Number.isSafeInteger) && crop.x >= 0 && crop.y >= 0
      && crop.w > 0 && crop.h > 0 && crop.x + crop.w <= width && crop.y + crop.h <= height;
    const outputSize = () => ({ w: Number(output.w.value), h: Number(output.h.value) });
    const setCropMode = active => {
      cropMode = active;
      cropTool.setAttribute('aria-pressed', String(active));
      preview.toggleAttribute('data-crop-active', active);
      cropActions.hidden = !active;
      if (!active) start = null;
      updateSelection();
    };
    const updateSelection = () => {
      const crop = values();
      const selection = $('.image-editor-selection');
      selection.hidden = (!cropMode && !committedCrop) || !validCrop(crop);
      if (selection.hidden) return;
      Object.assign(selection.style, { left: `${crop.x / width * 100}%`, top: `${crop.y / height * 100}%`,
        width: `${crop.w / width * 100}%`, height: `${crop.h / height * 100}%` });
    };
    const updateSummary = () => {
      const crop = values(), size = outputSize();
      summary.textContent = validCrop(crop) && Number.isSafeInteger(size.w) && Number.isSafeInteger(size.h)
        ? `Ausschnitt: ${crop.w} × ${crop.h} Quellpixel · Ausgabe: ${size.w} × ${size.h} px`
        : 'Bitte gültige Pixelmaße eingeben.';
    };
    const updateSaveState = () => { saveButton.disabled = !committedCrop; };
    for (const input of Object.values(inputs)) input.addEventListener('input', () => {
      const crop = values();
      if (validCrop(crop)) { output.w.value = String(crop.w); output.h.value = String(crop.h); }
      committedCrop = null;
      updateSelection(); updateSummary(); updateSaveState();
    });
    let start;
    const point = event => {
      const rect = image.getBoundingClientRect();
      return { x: Math.max(0, Math.min(width, Math.round((event.clientX - rect.left) / rect.width * width))),
        y: Math.max(0, Math.min(height, Math.round((event.clientY - rect.top) / rect.height * height))) };
    };
    cropTool.addEventListener('click', () => {
      if (cropMode) return;
      cropSnapshot = { crop: values(), output: outputSize(), committed: committedCrop };
      setCropMode(true);
      cropHelp.textContent = 'Bildbereich mit Maus oder Finger ziehen oder die Pixelwerte eingeben; anschließend mit OK bestätigen.';
    });
    image.addEventListener('pointerdown', event => {
      if (!cropMode || event.button !== 0) return;
      event.preventDefault(); start = point(event); image.setPointerCapture(event.pointerId);
    });
    image.addEventListener('pointermove', event => {
      if (!cropMode || !start) return;
      const end = point(event);
      const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
      const w = Math.abs(start.x - end.x), h = Math.abs(start.y - end.y);
      if (w && h) setCrop(x, y, w, h);
    });
    image.addEventListener('pointerup', () => { start = null; });
    image.addEventListener('pointercancel', () => { start = null; });
    for (const input of Object.values(output)) input.addEventListener('input', updateSummary);
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
      $('[data-crop-confirm]').addEventListener('click', () => {
        const crop = values();
        if (!cropMode || !validCrop(crop)) {
          $('[data-image-error]').textContent = 'Bitte einen gültigen Ausschnitt im Quellbild wählen.';
          return;
        }
        committedCrop = crop;
        setCropMode(false);
        cropSnapshot = null;
        $('[data-image-error]').textContent = '';
        cropHelp.textContent = 'Ausschnitt bestätigt. Mit „Zuschneiden“ kann er weiter angepasst werden.';
        updateSaveState();
      });
      $('[data-crop-cancel]').addEventListener('click', () => {
        if (cropSnapshot) {
          const { crop, output: size, committed } = cropSnapshot;
          setCrop(crop.x, crop.y, crop.w, crop.h);
          output.w.value = String(size.w); output.h.value = String(size.h);
          committedCrop = committed;
          updateSummary(); updateSaveState();
        }
        cropSnapshot = null;
        setCropMode(false);
        cropHelp.textContent = committedCrop
          ? 'Ausschnitt unverändert. „Variante erstellen“ speichert ihn als neue Datei.'
          : 'Zum Zuschneiden das Crop-Symbol am Bild auswählen.';
      });
      $('[data-image-save]').addEventListener('click', () => {
        const crop = values(), w = Number(output.w.value), h = Number(output.h.value);
        if (!committedCrop || !validCrop(crop) || !Number.isSafeInteger(w) || !Number.isSafeInteger(h)
          || w < 1 || h < 1 || w > crop.w || h > crop.h) {
          $('[data-image-error]').textContent = 'Bitte den Ausschnitt mit OK bestätigen und eine gültige Ausgabegröße bis zur Ausschnittgröße eingeben.';
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
