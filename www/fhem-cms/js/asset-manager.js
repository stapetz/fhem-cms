import { ASSET_BLOCKED, assetFolderPath, validateAssetState } from './asset-contract.js';
import { loadAssetExif } from './asset-exif.js';
import { editAssetImage } from './asset-image-editor.js';

const MiB = 1048576;
const element = (tag, text) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
};
const sizeText = bytes => `${(bytes / MiB).toLocaleString('de-DE', { maximumFractionDigits: 2 })} MiB`;

export async function openAssetManager(services, { mode = null, owner = document.body } = {}) {
  if (!services || typeof services.assetAction !== 'function' || typeof services.uploadAsset !== 'function') {
    throw new Error('Assetmanager-Dienste fehlen');
  }
  if (![null, 'image', 'document'].includes(mode)) throw new Error('Ungültiger Assetauswahlmodus');
  const host = element('div');
  host.dataset.assetManager = '';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      * { box-sizing:border-box; }
      dialog { width:min(96vw,72rem); max-height:94vh; overflow:auto; padding:1rem;
        color:var(--cms-text,#edf4ef); background:var(--cms-surface,#202e27);
        border:1px solid var(--cms-border,#43564a); border-radius:1rem; font:inherit; }
      dialog::backdrop { background:rgb(0 0 0 / .6); }
      h2,h3,p { margin:.3rem 0 .6rem; }
      form { display:grid; gap:.6rem; }
      input,select,button { font:inherit; color:inherit; border:1px solid var(--cms-border,#43564a);
        border-radius:.4rem; background:var(--cms-bg,#17211d); padding:.4rem .5rem; min-width:0; }
      button { cursor:pointer; }
      button:disabled { opacity:.5; cursor:default; }
      button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid var(--cms-accent,#8fd0a8); }
      label { display:grid; gap:.2rem; }
      .row { display:flex; gap:.5rem; flex-wrap:wrap; align-items:center; }
      .row > input,.row > select { flex:1; }
      .layout { display:grid; grid-template-columns:minmax(0,1fr); gap:1rem; }
      .layout.has-detail { grid-template-columns:minmax(0,3fr) minmax(13rem,1fr); }
      .path { display:flex; flex-wrap:wrap; gap:.2rem; margin-bottom:.5rem; }
      .folder-entry { position:relative; min-width:0; }
      .folder-entry > .folder-tile { width:100%; height:100%; padding-top:2rem; }
      .folder-edit { position:absolute; top:.2rem; right:.2rem; padding:.1rem .5rem; }
      .folder-tile { justify-content:center; min-height:7rem; }
      .folder-icon { font-size:2rem; }
      .destination { width:min(90vw,48rem); }
      .folder-create { width:min(90vw,28rem); }
      .destination .assets { max-height:40vh; }
      .assets { display:grid; grid-template-columns:repeat(auto-fill,minmax(7rem,1fr)); gap:.5rem;
        align-content:start; max-height:42vh; min-height:10rem; overflow:auto; }
      .assets.drag-over { outline:2px dashed var(--cms-accent,#8fd0a8); outline-offset:-2px;
        background:var(--cms-bg,#17211d); }
      .asset { display:flex; flex-direction:column; gap:.3rem; align-items:center; overflow-wrap:anywhere; }
      .asset[aria-pressed=true] { outline:2px solid var(--cms-accent,#8fd0a8); outline-offset:-2px; }
      .asset img { width:100%; height:5rem; object-fit:contain; }
      .asset .document { font-size:2rem; height:5rem; display:grid; place-items:center; }
      .detail { display:grid; align-content:start; gap:.5rem; }
      .preview { position:relative; }
      .preview img { width:100%; max-height:15rem; object-fit:contain; display:block; }
      .preview .info { position:absolute; right:.3rem; top:.3rem; border-radius:50%; font-weight:bold; }
      .variants { display:grid; gap:.4rem; }
      .variant { display:flex; align-items:center; gap:.4rem; padding:.3rem;
        border:1px solid var(--cms-border,#43564a); border-radius:.4rem; overflow-wrap:anywhere; }
      .variant img { width:3rem; height:3rem; object-fit:contain; }
      .variant input { flex:none; }
      .filename { display:flex; align-items:center; gap:.3rem; }
      .filename input { flex:1; }
      .exif { width:min(90vw,48rem); }
      .exif dl { display:grid; grid-template-columns:minmax(8rem,1fr) minmax(0,2fr); gap:.4rem 1rem; }
      .exif dt { font-weight:bold; } .exif dd { margin:0; overflow-wrap:anywhere; white-space:pre-wrap; }
      .status { min-height:1.3em; color:var(--cms-muted,#a5c9b2); }
      .error { color:var(--cms-danger,#ffb4a8); }
      .usage { padding-left:1.3rem; margin:.2rem 0; }
      .hint { font-size:.85rem; color:var(--cms-muted,#a5c9b2); }
      .types { display:flex; flex-wrap:wrap; gap:.5rem 1rem; }
      .types label { display:flex; align-items:center; gap:.25rem; }
      details { border:1px solid var(--cms-border,#43564a); padding:.5rem; border-radius:.5rem; }
      summary { cursor:pointer; margin-bottom:.4rem; }
      .footer { display:flex; justify-content:flex-end; gap:.5rem; }
      .detail[hidden] { display:none; }
      @media(max-width:650px) { .layout.has-detail { grid-template-columns:minmax(0,1fr); } .assets { max-height:30vh; } }
    </style>
    <dialog aria-labelledby="asset-title" data-assets-dialog>
      <h2 id="asset-title">Assetmanager</h2>
      <p class="hint">Gemeinsame Assets dieses CMS-Devices. Änderungen gelten sofort, unabhängig vom Seitenentwurf.
        „Bild entfernen“ im Widget entfernt nur den Verweis.</p>
      <form data-form>
        <div class="row"><label>Dateien in diesen Ordner hochladen<input type="file" multiple data-upload></label></div>
        <div class="path" data-path aria-label="Aktueller Ordner"></div>
        <div class="row"><button type="button" data-mkdir>Ordner erstellen</button></div>
        <p class="hint">Mehrere Dateien auswählen oder hier in die Ordneransicht ziehen.
          Uploads landen direkt im aktuell geöffneten Ordner.</p>
        <div class="layout"><div class="assets" data-assets role="group" aria-label="Ordnerinhalt"></div>
          <div class="detail" data-detail></div></div>
        <details data-admin><summary>Administration: Dateitypen und Speichergrenzen</summary>
          <p class="hint">Vorerst darf jeder CMS-Bearbeiter diese Einstellungen ändern.
          Gesperrte Typen verhindern neue Uploads; bestehende Assets bleiben erhalten.
          Web-/Skriptformate bleiben immer gesperrt. Dokumente werden nur als Download ausgeliefert.
          Uploads werden nicht auf Schadsoftware geprüft; nur vertrauenswürdige Dokumente öffnen.</p>
          <div class="types" data-types></div>
          <div class="row"><input data-new-type placeholder="Weitere Endung, z. B. epub" aria-label="Neuer Dateityp">
            <button type="button" data-add-type>Dateityp ergänzen</button></div>
          <label>Maximale Bildgröße (MiB, höchstens 50)<input type="number" step="0.001" min="0.001" max="50" data-limit="imageBytes"></label>
          <label>Maximale Dokumentgröße (MiB, höchstens 50)<input type="number" step="0.001" min="0.001" max="50" data-limit="documentBytes"></label>
          <label>Gesamtspeicher (MiB, höchstens 2048)<input type="number" step="0.001" min="0.001" max="2048" data-limit="totalBytes"></label>
          <button type="button" data-policy>Administration speichern</button>
        </details>
      </form>
      <p class="status" role="status" data-status></p>
      <p class="hint">Löschen ist bei Verwendung in Live oder Entwurf gesperrt. Frühere Sicherungen enthalten
        keine Assetdateien: Nach dem Löschen können Bild-/Dokumentverweise aus alten Sicherungen fehlen.
        Nur leere Ordner lassen sich löschen. Grenzen: 200 Ordner, 10 Ebenen, 2000 Assets.</p>
      <div class="footer"><button type="button" data-reload>Neu laden</button>
        <button type="button" data-abort hidden>Upload abbrechen</button>
        <button type="button" data-close>Schließen</button>
        <button type="button" data-select hidden>Auswählen</button></div>
    </dialog>`;
  const $ = selector => root.querySelector(selector);
  let state;
  let folder = 'root';
  let selected = null;
  let selectedFolder = null;
  let busy = false;
  let closed = false;
  let uploadController;
  let resolveClosed;
  let observer;
  let dismissFolderDialog;
  let metadataController;
  let detailRevision = 0;
  const completion = new Promise(resolve => { resolveClosed = resolve; });
  const originalFocus = document.activeElement;
  const status = (text, error = false) => {
    $('[data-status]').textContent = text;
    $('[data-status]').classList.toggle('error', error);
  };
  const usage = entries => {
    const list = element('ul'); list.className = 'usage'; list.dataset.usage = '';
    for (const entry of entries || []) {
      list.append(element('li', `${entry.source}: ${entry.pageTitle || entry.page} (${entry.page}) → ${entry.title} (${entry.widget})`));
    }
    if (!list.children.length) list.append(element('li', 'Keine Verwendung in Live oder Entwurf gefunden.'));
    showInfo('Verwendungen', [list], 'usage');
  };
  const allowed = asset => !mode || (mode === 'image' ? asset.image : !asset.image);
  const folderName = id => id === 'root' ? 'Stammordner' : state.folders.find(item => item.id === id)?.name;
  const children = parent => state.folders.filter(item => item.parent === parent)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const folderPath = id => assetFolderPath(state, id);
  const pathText = id => folderPath(id).map(folderName).join(' / ');
  const breadcrumbs = (container, current, navigate) => {
    container.replaceChildren();
    for (const id of folderPath(current)) {
      const item = element('button', folderName(id));
      item.type = 'button'; item.dataset.pathFolder = id;
      item.addEventListener('click', () => navigate(id));
      container.append(item);
    }
  };
  const folderTiles = (container, current, navigate, excluded = new Set(), editable = false) => {
    for (const child of children(current)) {
      if (excluded.has(child.id)) continue;
      const item = element('button'); item.type = 'button'; item.className = 'asset folder-tile';
      item.dataset.openFolder = child.id;
      const icon = element('span', '📁'); icon.className = 'folder-icon';
      item.append(icon, element('span', child.name));
      item.addEventListener('click', () => navigate(child.id));
      if (editable) {
        const entry = element('div'); entry.className = 'folder-entry';
        const edit = element('button', '⋯'); edit.type = 'button'; edit.className = 'folder-edit';
        edit.dataset.editFolder = child.id;
        edit.setAttribute('aria-label', `Ordner „${child.name}“ bearbeiten`);
        edit.addEventListener('click', () => {
          selected = null; selectedFolder = child.id; render();
        });
        entry.append(item, edit); container.append(entry);
      } else container.append(item);
    }
  };
  const chooseFolder = (initial, exclude = null) => new Promise(resolve => {
    const excluded = new Set(exclude ? [exclude] : []);
    for (const item of state.folders) {
      if (exclude && folderPath(item.id).includes(exclude)) excluded.add(item.id);
    }
    let current = excluded.has(initial) ? 'root' : initial;
    const dialog = element('dialog'); dialog.className = 'destination'; dialog.dataset.folderPicker = '';
    const title = element('h2', 'Zielordner auswählen'); title.id = 'folder-picker-title';
    dialog.setAttribute('aria-labelledby', title.id);
    const path = element('div'); path.className = 'path';
    const content = element('div'); content.className = 'assets';
    content.setAttribute('role', 'group'); content.setAttribute('aria-label', 'Zielordnerinhalt');
    const selectedPath = element('p'); selectedPath.dataset.destinationPath = '';
    const footer = element('div'); footer.className = 'footer';
    const cancel = element('button', 'Abbrechen'); cancel.type = 'button'; cancel.dataset.folderCancel = '';
    const accept = element('button', 'Diesen Ordner verwenden'); accept.type = 'button'; accept.dataset.folderAccept = '';
    const finish = value => {
      dismissFolderDialog = undefined; dialog.close(); dialog.remove(); resolve(value);
    };
    const navigate = id => {
      current = id;
      breadcrumbs(path, current, navigate);
      content.replaceChildren(); folderTiles(content, current, navigate, excluded);
      for (const asset of state.assets.filter(item => item.folder === current)) {
        const preview = element('div'); preview.className = 'asset'; preview.dataset.folderPreview = asset.id;
        if (asset.image) {
          const image = element('img'); image.src = asset.href; image.alt = ''; preview.append(image);
        }
        preview.append(element('span', asset.name)); content.append(preview);
      }
      if (!content.children.length) content.append(element('p', 'Dieser Ordner ist leer.'));
      selectedPath.textContent = `Ziel: ${pathText(current)}`;
    };
    cancel.addEventListener('click', () => finish(null));
    accept.addEventListener('click', () => finish(current));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    footer.append(cancel, accept); dialog.append(title, path, content, selectedPath, footer);
    dismissFolderDialog = () => finish(null);
    root.append(dialog); navigate(current); dialog.showModal();
  });
  const createFolderName = () => new Promise(resolve => {
    const dialog = element('dialog'); dialog.className = 'folder-create'; dialog.dataset.folderCreate = '';
    const title = element('h2', 'Ordner erstellen'); title.id = 'folder-create-title';
    dialog.setAttribute('aria-labelledby', title.id);
    const form = element('form');
    const label = element('label', 'Ordnername');
    const name = element('input'); name.maxLength = 128; name.required = true; name.dataset.folderName = '';
    label.append(name);
    const error = element('p'); error.className = 'error'; error.setAttribute('role', 'alert');
    const footer = element('div'); footer.className = 'footer';
    const cancel = element('button', 'Abbrechen'); cancel.type = 'button'; cancel.dataset.folderCreateCancel = '';
    const accept = element('button', 'Erstellen'); accept.type = 'submit'; accept.dataset.folderCreateAccept = '';
    const finish = value => {
      dismissFolderDialog = undefined; dialog.close(); dialog.remove(); resolve(value);
    };
    form.addEventListener('submit', event => {
      event.preventDefault();
      const value = name.value.trim();
      if (!value || value === '.' || value === '..' || /[\x00-\x1f\x7f/\\]/.test(value)) {
        error.textContent = 'Bitte einen gültigen Ordnernamen ohne Schrägstriche eingeben.'; return;
      }
      finish(value);
    });
    cancel.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    footer.append(cancel, accept);
    form.append(element('p', `Anlegen in: ${pathText(folder)}`), label, error, footer);
    dialog.append(title, form); root.append(dialog);
    dismissFolderDialog = () => finish(null);
    dialog.showModal(); name.focus();
  });
  const confirmDelete = ({ kind, message }) => new Promise(resolve => {
    const dialog = element('dialog'); dialog.dataset[`${kind}Delete`] = '';
    const title = element('h2', 'Löschen?'); title.id = 'asset-delete-title';
    dialog.setAttribute('aria-labelledby', title.id);
    dialog.append(title, element('p', message));
    const cancel = element('button', 'Abbrechen'); cancel.type = 'button'; cancel.dataset[`delete${kind === 'folder' ? 'Folder' : 'Asset'}Cancel`] = '';
    const accept = element('button', 'Löschen'); accept.type = 'button';
    accept.dataset[`delete${kind === 'folder' ? 'Folder' : 'Asset'}Accept`] = '';
    const finish = value => {
      dismissFolderDialog = undefined; dialog.close(); dialog.remove(); resolve(value);
    };
    cancel.addEventListener('click', () => finish(false));
    accept.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    dismissFolderDialog = () => finish(false);
    const footer = element('div'); footer.className = 'footer'; footer.append(cancel, accept);
    dialog.append(footer); root.append(dialog); dialog.showModal(); cancel.focus();
  });
  const showInfo = (heading, content, kind) => {
    if (closed) return;
    const dialog = element('dialog'); dialog.className = 'exif'; dialog.dataset[`${kind}Dialog`] = '';
    const title = element('h2', heading); title.id = `asset-${kind}-title`;
    dialog.setAttribute('aria-labelledby', title.id);
    const close = element('button', 'Schließen'); close.type = 'button'; close.dataset[`${kind}Close`] = '';
    const finish = () => { dismissFolderDialog = undefined; dialog.close(); dialog.remove(); };
    close.addEventListener('click', finish);
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
    const footer = element('div'); footer.className = 'footer'; footer.append(close);
    dialog.append(title, ...content, footer);
    dismissFolderDialog = finish;
    root.append(dialog); dialog.showModal();
  };
  const showExif = (asset, rows) => {
    const list = element('dl');
    for (const row of rows) list.append(element('dt', row.name), element('dd', row.value));
    showInfo(`EXIF: ${asset.name}`, [
      element('p', 'Originalmetadaten können unter anderem Standort- und Kameradaten enthalten.'), list,
    ], 'exif');
  };
  const imagePreview = (asset, box, revision) => {
    const preview = element('div'); preview.className = 'preview'; preview.dataset.imagePreview = '';
    const link = element('a'); link.href = asset.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.title = 'Bild in voller Größe anschauen'; link.setAttribute('aria-label', link.title);
    const image = element('img'); image.src = asset.href; image.alt = asset.name;
    image.addEventListener('error', () => {
      if (revision === detailRevision && !closed) status('Bildvorschau konnte nicht geladen werden.', true);
    });
    link.append(image); preview.append(link);
    const note = element('p', 'EXIF-Daten werden gelesen …'); note.className = 'hint'; note.dataset.exifStatus = '';
    box.append(preview, note);
    metadataController = new AbortController();
    loadAssetExif(asset.href, { signal: metadataController.signal }).then(rows => {
      if (closed || revision !== detailRevision) return;
      note.textContent = rows.length ? `${rows.length} EXIF-Einträge vorhanden.` : 'Keine EXIF-Daten vorhanden.';
      if (!rows.length) return;
      const info = element('button', 'i'); info.type = 'button'; info.className = 'info'; info.dataset.exifInfo = '';
      info.title = 'EXIF-Informationen anzeigen'; info.setAttribute('aria-label', info.title);
      info.addEventListener('click', () => showExif(asset, rows)); preview.append(info);
    }).catch(error => {
      if (closed || revision !== detailRevision) return;
      note.textContent = error.message || 'EXIF-Daten konnten nicht gelesen werden.';
      note.classList.add('error');
    });
  };
  const showUsage = async (asset, openPopup = true) => {
    const result = await services.assetAction({ op: 'usage', id: asset.id });
    if (!Array.isArray(result.usage)) throw new Error('Ungültige Verwendungsantwort');
    if (closed) return [];
    if (openPopup) usage(result.usage);
    return result.usage;
  };
  const mutate = async request => {
    const result = await services.assetAction({ ...request, token: state.token });
    if (!result.state) throw new Error('Assetänderung wurde nicht bestätigt');
    state = validateAssetState(result.state);
    if (folder !== 'root' && !state.folders.some(item => item.id === folder)) folder = 'root';
    render();
    return result;
  };
  const operation = async action => {
    if (busy || closed) return;
    busy = true;
    $('[data-form]').inert = true;
    $('[data-close]').disabled = true;
    $('[data-reload]').disabled = true;
    $('[data-select]').disabled = true;
    status('');
    try { await action(); }
    catch (error) {
      status(error.message || 'Asset-Aktion fehlgeschlagen', true);
      if (Array.isArray(error.usage)) usage(error.usage);
    } finally {
      busy = false;
      $('[data-form]').inert = false;
      $('[data-close]').disabled = false;
      $('[data-reload]').disabled = false;
      $('[data-select]').disabled = !state?.assets.some(asset => asset.id === selected && allowed(asset));
    }
  };
  const button = (text, action, attribute) => {
    const result = element('button', text);
    result.type = 'button';
    if (attribute) result.setAttribute(attribute, '');
    result.addEventListener('click', () => operation(action));
    return result;
  };
  function detail() {
    const revision = ++detailRevision;
    metadataController?.abort();
    const box = $('[data-detail]');
    box.replaceChildren();
    const asset = state.assets.find(item => item.id === selected);
    $('[data-select]').disabled = busy || !asset || !allowed(asset);
    const directory = state.folders.find(item => item.id === selectedFolder);
    box.hidden = !asset && !directory;
    box.parentElement.classList.toggle('has-detail', !box.hidden);
    if (directory) {
      box.append(element('strong', `Ordner: ${directory.name}`));
      const label = element('label', 'Ordnername');
      const name = element('input'); name.value = directory.name; name.maxLength = 128; name.dataset.folderName = '';
      label.append(name); box.append(label);
      let parent = directory.parent;
      const target = element('p', `Übergeordneter Ordner: ${pathText(parent)}`); target.dataset.parentName = '';
      const choose = element('button', 'Übergeordneten Ordner auswählen …'); choose.type = 'button'; choose.dataset.parent = '';
      choose.addEventListener('click', async () => {
        const destination = await chooseFolder(parent, directory.id);
        if (destination === null || closed) return;
        parent = destination; target.textContent = `Übergeordneter Ordner: ${pathText(parent)}`;
      });
      box.append(target, choose, button('Ordner umbenennen / verschieben', async () => {
        await mutate({ op: 'folder', id: directory.id, name: name.value, parent });
        status(`Ordner gespeichert: ${pathText(directory.id)}.`);
      }, 'data-folder-save'), button('Leeren Ordner löschen …', async () => {
        if (state.assets.some(item => item.folder === directory.id) || children(directory.id).length) {
          throw new Error('Der Ordner enthält noch Dateien oder Unterordner und wird nicht gelöscht.');
        }
        if (!await confirmDelete({ kind: 'folder', message: `„${pathText(directory.id)}“ unwiderruflich löschen? Nur leere Ordner lassen sich löschen. Inhalte werden niemals mitgelöscht.` })) return;
        await mutate({ op: 'rmdir', id: directory.id });
        selectedFolder = null; render(); status('Leerer Ordner gelöscht.');
      }, 'data-rmdir'));
      return;
    }
    if (!asset) return;
    box.append(element('strong', asset.name), element('p', `${asset.image ? 'Bild' : 'Dokument'} · ${sizeText(asset.bytes)}`));
    if (asset.image) {
      const original = state.assets.find(item => item.id === (asset.variantOf || asset.id));
      const variants = [original, ...state.assets.filter(item => item.variantOf === original.id)
        .sort((a, b) => a.name.localeCompare(b.name, 'de'))];
      const group = element('div'); group.className = 'variants'; group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Original und Bildvarianten');
      for (const item of variants) {
        const label = element('label'); label.className = 'variant';
        const radio = element('input'); radio.type = 'radio'; radio.name = 'asset-variant';
        radio.checked = item.id === asset.id; radio.dataset.variantId = item.id;
        radio.addEventListener('change', () => { selected = item.id; render(); });
        const preview = element('img'); preview.src = item.href; preview.alt = '';
        const description = element('span', `${item.id === original.id ? 'Original · ' : 'Variante · '}${item.name} · ${sizeText(item.bytes)}`);
        label.append(radio, preview, description); group.append(label);
      }
      box.append(group);
      imagePreview(asset, box, revision);
      box.append(button('Bild bearbeiten …', async () => {
        uploadController = new AbortController();
        $('[data-abort]').hidden = false;
        try {
          const file = await editAssetImage(root, asset, uploadController.signal);
          if (!file || closed) return;
          const result = await services.uploadAsset(file, original.folder, state.token, {
            variantOf: original.id, signal: uploadController.signal,
            onProgress: (done, total) => status(`Bildvariante hochladen: ${Math.round(done / total * 100)} %`),
          });
          if (closed) return;
          state = validateAssetState(result.state);
          const saved = state.assets.find(item => item.id === result.selected);
          if (!saved || saved.variantOf !== original.id || saved.folder !== original.folder) {
            throw new Error('Bildvariante wurde nicht bestätigt. Bitte den Assetkatalog neu laden.');
          }
          selected = saved.id; render(); status('Bildvariante gespeichert; das Original bleibt unverändert.');
        } finally { $('[data-abort]').hidden = true; uploadController = null; }
      }, 'data-edit-image'));
    }
    const label = element('label', 'Dateiname');
    const dot = asset.name.lastIndexOf('.');
    const suffix = asset.name.slice(dot);
    const filename = element('span'); filename.className = 'filename';
    const name = element('input'); name.value = asset.name.slice(0, dot); name.maxLength = 180 - suffix.length; name.dataset.assetName = '';
    const extension = element('span', suffix); extension.dataset.assetSuffix = '';
    filename.append(name, extension); label.append(filename); box.append(label);
    const saveAsset = async (requestedName, targetFolder) => {
      await mutate({ op: 'move', id: asset.id, name: requestedName, folder: targetFolder });
      const saved = state.assets.find(item => item.id === asset.id);
      if (!saved || saved.folder !== targetFolder || saved.name !== requestedName) {
        throw new Error('Änderung wurde nicht übernommen. Bitte neu laden und erneut prüfen.');
      }
      folder = saved.folder; selected = saved.id; render();
      status(`„${saved.name}“ gespeichert in ${pathText(saved.folder)}.`);
    };
    box.append(button('Umbenennen', async () => {
      if (!name.value.trim()) throw new Error('Bitte einen Dateinamen eingeben.');
      await saveAsset(name.value.trim() + suffix, asset.folder);
    }, 'data-rename'));
    box.append(element('p', `Ordner: ${pathText(asset.folder)}`));
    if (!asset.variantOf) box.append(button('Verschieben', async () => {
      const destination = await chooseFolder(asset.folder);
      if (destination === null || closed) return;
      await saveAsset(asset.name, destination);
    }, 'data-choose-destination'));
    if (!asset.image) {
      const download = element('a', 'Dokument herunterladen');
      download.href = asset.href; download.target = '_blank'; download.rel = 'noopener noreferrer'; box.append(download);
    }
    box.append(button('Verwendungen anzeigen', () => showUsage(asset), 'data-usage-button'));
    box.append(button('Löschen', async () => {
      const entries = await showUsage(asset, false);
      if (closed) return;
      if (entries.length) {
        usage(entries);
        throw new Error('Asset wird verwendet. Zuerst die im Popup genannten Verweise entfernen.');
      }
      if (!await confirmDelete({ kind: 'asset', message: `„${asset.name}“ unwiderruflich löschen? Die Datei wird aus dem Assetmanager entfernt, nicht nur aus einem Widget.` })) return;
      await mutate({ op: 'delete', id: asset.id });
      selected = null; detail(); status('Asset gelöscht.');
    }, 'data-delete-asset'));
  }
  function render() {
    breadcrumbs($('[data-path]'), folder, navigate);
    const box = $('[data-assets]'); box.replaceChildren();
    folderTiles(box, folder, navigate, new Set(), true);
    const assets = state.assets.filter(asset => asset.folder === folder && allowed(asset) && !asset.variantOf)
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
    for (const asset of assets) {
      const choose = element('button');
      choose.type = 'button'; choose.className = 'asset'; choose.dataset.assetId = asset.id;
      choose.setAttribute('aria-pressed', String(asset.id === selected
        || state.assets.some(item => item.id === selected && item.variantOf === asset.id)));
      if (asset.image) {
        const image = element('img'); image.src = asset.href; image.alt = ''; choose.append(image);
      } else {
        const icon = element('span', '▤'); icon.className = 'document'; choose.append(icon);
      }
      choose.append(element('span', asset.name), element('small', sizeText(asset.bytes)));
      choose.addEventListener('click', () => { selected = asset.id; selectedFolder = null; render(); });
      box.append(choose);
    }
    if (!box.children.length) box.append(element('p', 'Dieser Ordner ist leer.'));
    $('[data-types]').replaceChildren();
    for (const [ext, enabled] of Object.entries(state.policy.types).sort(([a], [b]) => a.localeCompare(b))) {
      const label = element('label', ext);
      const check = element('input'); check.type = 'checkbox'; check.checked = enabled; check.dataset.type = ext;
      label.prepend(check); $('[data-types]').append(label);
    }
    function navigate(id) {
      if (busy || closed) return;
      folder = id; selected = null; selectedFolder = null; render();
    }
    for (const key of ['imageBytes', 'documentBytes', 'totalBytes']) {
      $(`[data-limit="${key}"]`).value = String(state.policy[key] / MiB);
    }
    const types = Object.entries(state.policy.types).filter(([, enabled]) => enabled).map(([ext]) => `.${ext}`);
    $('[data-upload]').accept = mode === 'image' ? types.filter(ext => /\.(png|jpe?g|gif)$/.test(ext)).join(',') : types.join(',');
    detail();
    status(`${state.assets.length} Assets · ${sizeText(state.totalBytes)} / ${sizeText(state.policy.totalBytes)}`);
  }
  async function reload() {
    state = validateAssetState(await services.assetAction({ op: 'list' }));
    if (folder !== 'root' && !state.folders.some(item => item.id === folder)) folder = 'root';
    render();
  }
  const close = value => {
    if (busy || closed) return;
    closed = true;
    ++detailRevision;
    metadataController?.abort();
    dismissFolderDialog?.();
    observer?.disconnect();
    $('[data-assets-dialog]').close();
    host.remove();
    originalFocus?.focus?.();
    resolveClosed(value);
  };
  const policyFromForm = () => {
    const policy = structuredClone(state.policy);
    for (const check of root.querySelectorAll('[data-type]')) policy.types[check.dataset.type] = check.checked;
    for (const key of ['imageBytes', 'documentBytes', 'totalBytes']) {
      policy[key] = Math.round(Number($(`[data-limit="${key}"]`).value) * MiB);
    }
    return policy;
  };
  $('[data-form]').addEventListener('submit', event => event.preventDefault());
  $('[data-assets-dialog]').addEventListener('cancel', event => { event.preventDefault(); close(null); });
  $('[data-close]').addEventListener('click', () => close(null));
  $('[data-select]').hidden = !mode;
  $('[data-select]').addEventListener('click', () => {
    const asset = state?.assets.find(item => item.id === selected && allowed(item));
    if (asset) close(structuredClone(asset));
  });
  $('[data-reload]').addEventListener('click', () => operation(reload));
  $('[data-mkdir]').addEventListener('click', () => operation(async () => {
    const name = await createFolderName();
    if (name === null || closed) return;
    const parent = folder;
    await mutate({ op: 'mkdir', name, parent: folder });
    const created = state.folders.find(item => item.name === name && item.parent === parent);
    if (!created) {
      throw new Error('Ordner wurde nicht angelegt. Bitte neu laden und erneut prüfen.');
    }
    selected = null; selectedFolder = null; detail();
    status(`Ordner „${name}“ erstellt in ${pathText(parent)}.`);
  }));
  $('[data-add-type]').addEventListener('click', () => operation(async () => {
    const ext = $('[data-new-type]').value.trim().toLowerCase().replace(/^\./, '');
    if (!/^[a-z][a-z0-9]{0,9}$/.test(ext) || ASSET_BLOCKED.test(ext)) throw new Error('Dieser Dateityp ist nicht erlaubt.');
    const policy = policyFromForm();
    policy.types[ext] = true;
    await mutate({ op: 'policy', policy });
    $('[data-new-type]').value = '';
  }));
  $('[data-policy]').addEventListener('click', () => operation(async () => {
    const policy = policyFromForm();
    await mutate({ op: 'policy', policy }); status('Asset-Administration gespeichert.');
  }));
  const uploadFiles = files => {
    if (!files.length) return;
    return operation(async () => {
      if (!state) throw new Error('Bitte zuerst den Assetkatalog neu laden.');
      const destination = folder;
      selected = null; selectedFolder = null; detail();
      uploadController = new AbortController();
      $('[data-abort]').hidden = false;
      let completed = 0;
      let duplicates = 0;
      try {
        for (const file of files) {
          if (uploadController.signal.aborted || closed) throw new Error('Upload abgebrochen');
          const result = await services.uploadAsset(file, destination, state.token, {
            signal: uploadController.signal,
            onProgress: (done, total) => {
              if (!closed) status(`${completed + 1}/${files.length} · ${file.name}: ${Math.round(done / total * 100)} %`);
            },
          });
          if (closed) return;
          state = validateAssetState(result.state);
          completed++;
          if (result.duplicate) duplicates++;
          render();
        }
        status(`Upload abgeschlossen: ${completed} Datei(en) · ${pathText(destination)}.`
          + (duplicates ? ` ${duplicates} identische Datei(en) waren bereits vorhanden und wurden nicht erneut abgelegt.` : ''));
      } catch (error) {
        throw new Error(`${error.message || 'Upload fehlgeschlagen'} · ${completed}/${files.length} Datei(en) abgeschlossen.`);
      } finally { $('[data-abort]').hidden = true; uploadController = null; }
    });
  };
  $('[data-upload]').addEventListener('change', () => {
    const files = [...$('[data-upload]').files]; $('[data-upload]').value = '';
    uploadFiles(files);
  });
  const dropZone = $('[data-assets]');
  const hasFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');
  for (const type of ['dragenter', 'dragover']) dropZone.addEventListener(type, event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = busy || !state ? 'none' : 'copy';
    dropZone.classList.toggle('drag-over', !busy && !!state);
  });
  dropZone.addEventListener('dragleave', event => {
    if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('drag-over');
  });
  $('[data-assets-dialog]').addEventListener('dragover', event => {
    if (hasFiles(event)) event.preventDefault();
  });
  $('[data-assets-dialog]').addEventListener('drop', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dropZone.classList.remove('drag-over');
    if (busy || closed || !dropZone.contains(event.composedPath()[0])) return;
    const items = [...(event.dataTransfer.items || [])];
    if (items.some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
      status('Bitte Dateien statt ganzer Ordner hineinziehen.', true); return;
    }
    uploadFiles([...event.dataTransfer.files]);
  });
  $('[data-abort]').addEventListener('click', () => uploadController?.abort());
  owner.append(host);
  observer = new MutationObserver(() => {
    if (host.isConnected || closed) return;
    uploadController?.abort();
    busy = false;
    close(null);
  });
  observer.observe(document, { childList: true, subtree: true });
  if (owner !== document.body) observer.observe(owner, { childList: true, subtree: true });
  $('[data-assets-dialog]').showModal();
  await operation(reload);
  return completion;
}
