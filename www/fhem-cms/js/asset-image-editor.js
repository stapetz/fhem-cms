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
      .image-editor-selection { position:absolute; box-sizing:border-box; border:2px solid white;
        box-shadow:0 0 0 9999px rgb(0 0 0 / .45); pointer-events:none; z-index:1; }
      .image-editor-preview[data-crop-active] .image-editor-selection { pointer-events:auto; cursor:move; }
      .image-editor-selection:focus-visible { outline:2px solid var(--cms-accent,#8fd0a8); outline-offset:2px; }
      .image-editor-handle { position:absolute; width:1.5rem; height:1.5rem; min-width:0; min-height:0;
        padding:0; border:1px solid #222; border-radius:2px; background:white; transform:translate(-50%,-50%); }
      .image-editor-preview:not([data-crop-active]) .image-editor-handle { display:none; }
      .image-editor-handle[data-handle="nw"] { left:0; top:0; cursor:nwse-resize; }
      .image-editor-handle[data-handle="n"] { left:50%; top:0; cursor:ns-resize; }
      .image-editor-handle[data-handle="ne"] { left:100%; top:0; cursor:nesw-resize; }
      .image-editor-handle[data-handle="e"] { left:100%; top:50%; cursor:ew-resize; }
      .image-editor-handle[data-handle="se"] { left:100%; top:100%; cursor:nwse-resize; }
      .image-editor-handle[data-handle="s"] { left:50%; top:100%; cursor:ns-resize; }
      .image-editor-handle[data-handle="sw"] { left:0; top:100%; cursor:nesw-resize; }
      .image-editor-handle[data-handle="w"] { left:0; top:50%; cursor:ew-resize; }
      .image-editor-preview:not([data-crop-active]) .image-editor-selection {
        border-color:var(--cms-accent,#8fd0a8); box-shadow:none; }
      .image-editor-preview[data-crop-active] { cursor:crosshair; touch-action:none; }
      .image-editor-toolbar { display:flex; justify-content:flex-end; gap:.3rem;
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
      .image-editor-fields input[type="number"] { min-width:0; width:100%; }
      .image-editor-fields .image-editor-ratio { display:flex; align-items:center; gap:.5rem; grid-column:1/-1; }
    </style>
    <h2 id="image-editor-title">Bild bearbeiten</h2>
    <p>Quellbild: <strong data-source-size></strong> px. Die Ausschnittmaße beziehen sich auf Pixel im
      Quellbild; die Ausgabegröße ist die Pixelauflösung der neuen Variante. Das Original bleibt unverändert.</p>
    <div class="image-editor-toolbar" role="toolbar" aria-label="Bildwerkzeuge">
        <button type="button" class="image-editor-tool" data-image-tool="crop" aria-label="Zuschneiden"
          title="Zuschneiden" aria-pressed="false">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v11a3 3 0 0 0 3 3h11M17 3v11M3 7h11a3 3 0 0 1 3 3v11"/></svg>
        </button>
    </div>
    <div class="image-editor-frame"><div class="image-editor-preview">
      <img alt="Bildvorschau" draggable="false">
      <div class="image-editor-selection" role="group" aria-label="Ausschnitt verschieben"
        aria-describedby="image-editor-crop-help" tabindex="-1" hidden>
        ${[['nw', 'oben links'], ['n', 'oben'], ['ne', 'oben rechts'], ['e', 'rechts'],
          ['se', 'unten rechts'], ['s', 'unten'], ['sw', 'unten links'], ['w', 'links']]
          .map(([handle, label]) => `<button type="button" class="image-editor-handle" data-handle="${handle}"
            aria-label="Ausschnitt ${label} skalieren" tabindex="-1"></button>`).join('')}
      </div>
    </div></div>
    <div class="image-editor-crop-actions" data-crop-actions hidden>
      <button type="button" data-crop-cancel>Abbrechen</button>
      <button type="button" data-crop-confirm>OK</button>
    </div>
    <p id="image-editor-crop-help" data-crop-help aria-live="polite">Zum Zuschneiden das Crop-Symbol am Bild auswählen.</p>
    <div class="image-editor-fields">
      <fieldset><legend>Zuschneiden am Bild</legend>
        <label class="image-editor-ratio"><input type="checkbox" data-crop-ratio>
          Seitenverhältnis beibehalten</label>
      </fieldset>
      <fieldset><legend>Ausgabegröße der neuen Variante</legend>
        <p>Standardmäßig entspricht sie dem Ausschnitt. Kleinere Werte verkleinern das Bild.</p>
        <label>Breite (px)<input type="number" min="1" step="1" data-output="w"></label>
        <label>Höhe (px)<input type="number" min="1" step="1" data-output="h"></label>
        <label class="image-editor-ratio"><input type="checkbox" data-output-ratio checked>
          Seitenverhältnis beibehalten</label>
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
    const output = Object.fromEntries([...dialog.querySelectorAll('[data-output]')].map(input => [input.dataset.output, input]));
    const selection = $('.image-editor-selection');
    const cropLock = $('[data-crop-ratio]');
    const outputLock = $('[data-output-ratio]');
    let crop = { x: 0, y: 0, w: width, h: height };
    let cropMode = false;
    let committedCrop = { ...crop };
    let cropSnapshot = null;
    let cropRatio = width / height;
    let gesture = null;
    const setCrop = (x, y, w, h) => {
      crop = { x, y, w, h };
      output.w.value = String(w); output.h.value = String(h);
      committedCrop = null;
      updateSelection(); updateSummary(); updateSaveState();
    };
    const validCrop = crop => Object.values(crop).every(Number.isSafeInteger) && crop.x >= 0 && crop.y >= 0
      && crop.w > 0 && crop.h > 0 && crop.x + crop.w <= width && crop.y + crop.h <= height;
    const outputSize = () => ({ w: Number(output.w.value), h: Number(output.h.value) });
    const setCropMode = active => {
      cropMode = active;
      cropTool.setAttribute('aria-pressed', String(active));
      preview.toggleAttribute('data-crop-active', active);
      cropActions.hidden = !active;
      selection.tabIndex = active ? 0 : -1;
      for (const handle of selection.querySelectorAll('[data-handle]')) handle.tabIndex = active ? 0 : -1;
      if (!active) gesture = null;
      updateSelection();
      updateSaveState();
    };
    const updateSelection = () => {
      selection.hidden = (!cropMode && !committedCrop) || !validCrop(crop);
      if (selection.hidden) return;
      Object.assign(selection.style, { left: `${crop.x / width * 100}%`, top: `${crop.y / height * 100}%`,
        width: `${crop.w / width * 100}%`, height: `${crop.h / height * 100}%` });
    };
    const updateSummary = () => {
      const size = outputSize();
      summary.textContent = validCrop(crop) && Number.isSafeInteger(size.w) && Number.isSafeInteger(size.h)
        ? `Ausschnitt: ${crop.w} × ${crop.h} Quellpixel · Ausgabe: ${size.w} × ${size.h} px`
        : 'Bitte gültige Pixelmaße eingeben.';
    };
    const updateSaveState = () => { saveButton.disabled = cropMode || !committedCrop; };
    const point = event => {
      const rect = image.getBoundingClientRect();
      return { x: Math.max(0, Math.min(width, Math.round((event.clientX - rect.left) / rect.width * width))),
        y: Math.max(0, Math.min(height, Math.round((event.clientY - rect.top) / rect.height * height))) };
    };
    cropTool.addEventListener('click', () => {
      if (cropMode) return;
      cropSnapshot = { crop: { ...crop }, output: outputSize(), committed: committedCrop,
        cropLocked: cropLock.checked, cropRatio, outputLocked: outputLock.checked };
      setCropMode(true);
      cropHelp.textContent = 'Auswahl innen verschieben, an den Griffen vergrößern/verkleinern oder außerhalb neu aufziehen. '
        + 'Auch per Pfeiltasten (Umschalt: 10 Pixel); anschließend mit OK bestätigen.';
    });
    cropLock.addEventListener('change', () => { cropRatio = crop.w / crop.h; });
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const moveCrop = (base, dx, dy) => {
      setCrop(clamp(base.x + dx, 0, width - base.w), clamp(base.y + dy, 0, height - base.h), base.w, base.h);
    };
    const resizeCrop = (base, handle, dx, dy) => {
      const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
      const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
      const anchorX = sx < 0 ? base.x + base.w : sx > 0 ? base.x : base.x + base.w / 2;
      const anchorY = sy < 0 ? base.y + base.h : sy > 0 ? base.y : base.y + base.h / 2;
      const maxW = sx < 0 ? anchorX : sx > 0 ? width - anchorX : 2 * Math.min(anchorX, width - anchorX);
      const maxH = sy < 0 ? anchorY : sy > 0 ? height - anchorY : 2 * Math.min(anchorY, height - anchorY);
      let w = clamp(base.w + sx * dx, 1, maxW);
      let h = clamp(base.h + sy * dy, 1, maxH);
      if (cropLock.checked) {
        const useWidth = sx && (!sy || Math.abs(dx) >= Math.abs(dy * cropRatio));
        w = clamp(useWidth ? w : h * cropRatio, Math.max(1, cropRatio), Math.min(maxW, maxH * cropRatio));
        h = w / cropRatio;
      }
      w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
      const x = clamp(Math.round(sx < 0 ? anchorX - w : sx > 0 ? anchorX : anchorX - w / 2), 0, width - w);
      const y = clamp(Math.round(sy < 0 ? anchorY - h : sy > 0 ? anchorY : anchorY - h / 2), 0, height - h);
      setCrop(x, y, w, h);
    };
    preview.addEventListener('pointerdown', event => {
      if (!cropMode || event.button !== 0 || gesture) return;
      const handle = event.target.closest('[data-handle]')?.dataset.handle;
      const mode = handle ? 'resize' : selection.contains(event.target) ? 'move' : 'create';
      gesture = { id: event.pointerId, start: point(event), crop: { ...crop }, output: outputSize(), mode, handle };
      event.preventDefault();
      if (mode === 'move') selection.focus({ preventScroll: true });
      else if (handle) event.target.focus({ preventScroll: true });
      preview.setPointerCapture(event.pointerId);
    });
    preview.addEventListener('pointermove', event => {
      if (!cropMode || !gesture || gesture.id !== event.pointerId) return;
      const end = point(event);
      const { start, crop: base, mode, handle } = gesture;
      const dx = end.x - start.x, dy = end.y - start.y;
      if (mode === 'move') moveCrop(base, dx, dy);
      else if (mode === 'resize') resizeCrop(base, handle, dx, dy);
      else {
        let w = Math.abs(dx), h = Math.abs(dy);
        if (cropLock.checked) {
          w = Math.min(Math.max(w, h * cropRatio), dx < 0 ? start.x : width - start.x,
            (dy < 0 ? start.y : height - start.y) * cropRatio);
          h = w / cropRatio;
        }
        w = Math.round(w); h = Math.round(h);
        if (w && h) setCrop(dx < 0 ? start.x - w : start.x, dy < 0 ? start.y - h : start.y, w, h);
      }
    });
    const endGesture = event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      if (event.type === 'pointercancel') {
        const { crop: base, output: size } = gesture;
        setCrop(base.x, base.y, base.w, base.h);
        output.w.value = String(size.w); output.h.value = String(size.h);
        updateSummary();
      }
      gesture = null;
      if (preview.hasPointerCapture(event.pointerId)) preview.releasePointerCapture(event.pointerId);
    };
    preview.addEventListener('pointerup', endGesture);
    preview.addEventListener('pointercancel', endGesture);
    preview.addEventListener('lostpointercapture', endGesture);
    selection.addEventListener('keydown', event => {
      if (!cropMode || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      const handle = event.target.closest('[data-handle]')?.dataset.handle;
      if (handle) resizeCrop(crop, handle, dx, dy);
      else moveCrop(crop, dx, dy);
    });
    const syncOutput = key => {
      const value = Number(output[key].value);
      if (outputLock.checked && Number.isSafeInteger(value) && value > 0) {
        const other = key === 'w' ? 'h' : 'w';
        output[other].value = String(Math.max(1, Math.round(value * crop[other] / crop[key])));
      }
      updateSummary();
    };
    for (const [key, input] of Object.entries(output)) input.addEventListener('input', () => syncOutput(key));
    outputLock.addEventListener('change', () => syncOutput('w'));
    output.w.value = String(width); output.h.value = String(height);
    updateSummary(); updateSaveState();
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
        if (!cropMode || !validCrop(crop)) {
          $('[data-image-error]').textContent = 'Bitte einen gültigen Ausschnitt im Quellbild wählen.';
          return;
        }
        committedCrop = { ...crop };
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
          cropLock.checked = cropSnapshot.cropLocked; cropRatio = cropSnapshot.cropRatio;
          outputLock.checked = cropSnapshot.outputLocked;
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
        const w = Number(output.w.value), h = Number(output.h.value);
        if (cropMode || !committedCrop || !validCrop(crop) || !Number.isSafeInteger(w) || !Number.isSafeInteger(h)
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
