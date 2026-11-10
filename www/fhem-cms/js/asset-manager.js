import { ASSET_BLOCKED, validateAssetState } from './asset-contract.js';

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
      .layout { display:grid; grid-template-columns:minmax(0,3fr) minmax(13rem,1fr); gap:1rem; }
      .assets { display:grid; grid-template-columns:repeat(auto-fill,minmax(7rem,1fr)); gap:.5rem;
        align-content:start; max-height:42vh; min-height:10rem; overflow:auto; }
      .asset { display:flex; flex-direction:column; gap:.3rem; align-items:center; overflow-wrap:anywhere; }
      .asset[aria-pressed=true] { outline:2px solid var(--cms-accent,#8fd0a8); outline-offset:-2px; }
      .asset img { width:100%; height:5rem; object-fit:contain; }
      .asset .document { font-size:2rem; height:5rem; display:grid; place-items:center; }
      .detail { display:grid; align-content:start; gap:.5rem; }
      .status { min-height:1.3em; color:var(--cms-muted,#a5c9b2); }
      .error { color:var(--cms-danger,#ffb4a8); }
      .usage { padding-left:1.3rem; margin:.2rem 0; }
      .hint { font-size:.85rem; color:var(--cms-muted,#a5c9b2); }
      .types { display:flex; flex-wrap:wrap; gap:.5rem 1rem; }
      .types label { display:flex; align-items:center; gap:.25rem; }
      details { border:1px solid var(--cms-border,#43564a); padding:.5rem; border-radius:.5rem; }
      summary { cursor:pointer; margin-bottom:.4rem; }
      .footer { display:flex; justify-content:flex-end; gap:.5rem; }
      @media(max-width:650px) { .layout { grid-template-columns:minmax(0,1fr); } .assets { max-height:30vh; } }
    </style>
    <dialog aria-labelledby="asset-title" data-assets-dialog>
      <h2 id="asset-title">Assetmanager</h2>
      <p class="hint">Gemeinsame Assets dieses CMS-Devices. Änderungen gelten sofort, unabhängig vom Seitenentwurf.
        „Bild entfernen“ im Widget entfernt nur den Verweis.</p>
      <form data-form>
        <label>Ordner<select data-folder></select></label>
        <details data-folder-tools><summary>Ordner verwalten</summary>
          <label>Ordnername<input data-folder-name maxlength="128"></label>
          <label>Übergeordneter Ordner<select data-parent></select></label>
          <div class="row"><button type="button" data-mkdir>Unterordner anlegen</button>
            <button type="button" data-folder-save>Ordner umbenennen / verschieben</button>
            <button type="button" data-rmdir>Leeren Ordner löschen</button></div>
        </details>
        <div class="row"><label>Dateien in diesen Ordner hochladen<input type="file" multiple data-upload></label>
          <input type="search" data-search placeholder="Dateiname suchen" aria-label="Dateiname suchen"></div>
        <div class="layout"><div class="assets" data-assets role="group" aria-label="Assets"></div>
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
      <p class="status" role="status" data-status></p><ul class="usage" data-usage></ul>
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
  let busy = false;
  let closed = false;
  let uploadController;
  let resolveClosed;
  let observer;
  const completion = new Promise(resolve => { resolveClosed = resolve; });
  const originalFocus = document.activeElement;
  const status = (text, error = false) => {
    $('[data-status]').textContent = text;
    $('[data-status]').classList.toggle('error', error);
  };
  const usage = entries => {
    $('[data-usage]').replaceChildren();
    for (const entry of entries || []) {
      $('[data-usage]').append(element('li', `${entry.source}: ${entry.pageTitle || entry.page} (${entry.page}) → ${entry.title} (${entry.widget})`));
    }
  };
  const allowed = asset => !mode || (mode === 'image' ? asset.image : !asset.image);
  const options = select => {
    select.replaceChildren();
    const append = (parent, depth) => {
      const option = element('option', parent === 'root' ? 'Alle Assets / Stammordner' : `${'— '.repeat(depth)}${state.folders.find(item => item.id === parent).name}`);
      option.value = parent; select.append(option);
      for (const child of state.folders.filter(item => item.parent === parent).sort((a, b) => a.name.localeCompare(b.name, 'de'))) append(child.id, depth + 1);
    };
    append('root', 0);
  };
  const showUsage = async asset => {
    const result = await services.assetAction({ op: 'usage', id: asset.id });
    if (!Array.isArray(result.usage)) throw new Error('Ungültige Verwendungsantwort');
    usage(result.usage);
    status(result.usage.length ? 'Asset wird an diesen Stellen verwendet:' : 'Keine Verwendung in Live oder Entwurf gefunden.');
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
    usage([]);
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
    const box = $('[data-detail]');
    box.replaceChildren();
    const asset = state.assets.find(item => item.id === selected);
    $('[data-select]').disabled = busy || !asset || !allowed(asset);
    if (!asset) { box.append(element('p', 'Asset auswählen, um Details und Verwendungen zu sehen.')); return; }
    box.append(element('strong', asset.name), element('p', `${asset.image ? 'Bild' : 'Dokument'} · ${sizeText(asset.bytes)}`));
    const label = element('label', 'Dateiname');
    const name = element('input'); name.value = asset.name; name.maxLength = 180; name.dataset.assetName = '';
    label.append(name); box.append(label);
    const folderLabel = element('label', 'Zielordner');
    const target = element('select'); target.dataset.assetFolder = ''; options(target); target.value = asset.folder;
    folderLabel.append(target); box.append(folderLabel);
    box.append(button('Umbenennen / verschieben', () => mutate({ op: 'move', id: asset.id, name: name.value, folder: target.value }), 'data-move'));
    const download = element('a', asset.image ? 'Bild öffnen' : 'Dokument herunterladen');
    download.href = asset.href; download.target = '_blank'; download.rel = 'noopener noreferrer';
    box.append(download, button('Verwendungen anzeigen', () => showUsage(asset), 'data-usage-button'));
    const confirmBox = element('label', ' Löschen bestätigen (unwiderruflich)');
    const confirm = element('input'); confirm.type = 'checkbox'; confirm.dataset.confirmDelete = ''; confirmBox.prepend(confirm);
    box.append(confirmBox, button('Asset endgültig löschen', async () => {
      await showUsage(asset);
      if ($('[data-usage]').children.length) throw new Error('Asset wird verwendet. Zuerst die oben genannten Verweise entfernen.');
      if (!confirm.checked) throw new Error('Bitte die endgültige Löschung bestätigen.');
      await mutate({ op: 'delete', id: asset.id });
      selected = null; detail(); status('Asset gelöscht.');
    }, 'data-delete-asset'));
  }
  function render() {
    options($('[data-folder]')); $('[data-folder]').value = folder;
    options($('[data-parent]'));
    const current = state.folders.find(item => item.id === folder);
    $('[data-folder-name]').value = current?.name || '';
    $('[data-parent]').value = current?.parent || folder;
    $('[data-folder-save]').disabled = !current;
    $('[data-rmdir]').disabled = !current;
    const query = $('[data-search]').value.trim().toLocaleLowerCase('de');
    const box = $('[data-assets]'); box.replaceChildren();
    const assets = state.assets.filter(asset => (folder === 'root' || asset.folder === folder) && allowed(asset)
      && asset.name.toLocaleLowerCase('de').includes(query)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    for (const asset of assets) {
      const choose = element('button');
      choose.type = 'button'; choose.className = 'asset'; choose.dataset.assetId = asset.id;
      choose.setAttribute('aria-pressed', String(asset.id === selected));
      if (asset.image) {
        const image = element('img'); image.src = asset.href; image.alt = ''; choose.append(image);
      } else {
        const icon = element('span', '▤'); icon.className = 'document'; choose.append(icon);
      }
      choose.append(element('span', asset.name), element('small', sizeText(asset.bytes)));
      choose.addEventListener('click', () => { selected = asset.id; usage([]); render(); });
      box.append(choose);
    }
    if (!assets.length) box.append(element('p', 'Keine passenden Assets in dieser Ansicht.'));
    $('[data-types]').replaceChildren();
    for (const [ext, enabled] of Object.entries(state.policy.types).sort(([a], [b]) => a.localeCompare(b))) {
      const label = element('label', ext);
      const check = element('input'); check.type = 'checkbox'; check.checked = enabled; check.dataset.type = ext;
      label.prepend(check); $('[data-types]').append(label);
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
  $('[data-folder]').addEventListener('change', () => {
    folder = $('[data-folder]').value; selected = null; usage([]); render();
  });
  $('[data-search]').addEventListener('input', () => render());
  $('[data-mkdir]').addEventListener('click', () => operation(async () => {
    const name = $('[data-folder-name]').value;
    await mutate({ op: 'mkdir', name, parent: folder });
    folder = state.folders.find(item => item.name === name && item.parent === folder).id;
    render();
  }));
  $('[data-folder-save]').addEventListener('click', () => operation(() => mutate({
    op: 'folder', id: folder, name: $('[data-folder-name]').value, parent: $('[data-parent]').value,
  })));
  $('[data-rmdir]').addEventListener('click', () => operation(() => mutate({ op: 'rmdir', id: folder })));
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
  $('[data-upload]').addEventListener('change', () => {
    const files = [...$('[data-upload]').files]; $('[data-upload]').value = '';
    operation(async () => {
      uploadController = new AbortController();
      $('[data-abort]').hidden = false;
      try {
        for (const file of files) {
          if (uploadController.signal.aborted) throw new Error('Upload abgebrochen');
          const result = await services.uploadAsset(file, folder, state.token, {
            signal: uploadController.signal,
            onProgress: (done, total) => status(`${file.name}: ${Math.round(done / total * 100)} %`),
          });
          state = validateAssetState(result.state); selected = result.selected;
          render();
          status(result.duplicate ? 'Identische Datei bereits vorhanden; vorhandenes Asset ausgewählt.' : 'Upload abgeschlossen.');
        }
      } finally { $('[data-abort]').hidden = true; uploadController = null; }
    });
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
