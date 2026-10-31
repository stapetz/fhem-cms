// Rich-Text: strenger Allowlist-Cleaner und schlanker WYSIWYG-Editor auf contenteditable.
// Der Cleaner baut aus einem inerten DOM (DOMParser) ein neues Fragment und ist die einzige Quelle
// fuer Rendern und Speichern. Er muss zur Allowlist in FHEMCMS_ValidateHtml (01_FHEMCMS.pm) passen.

import { placeholderText, splitPlaceholders } from './freehtml.js';
import { openPlaceholderPicker } from './placeholder-picker.js';

export const MAX_HTML = 50000;
export const MAX_IMAGE_BYTES = 3145728;

const ALIGN = ['cms-align-left', 'cms-align-center', 'cms-align-right'];
// Bildbreiten in 5-%-Schritten (cms-w-5 bis cms-w-100).
const WIDTH_STEP = 5;
const WIDTH_CLASSES = Array.from({ length: 100 / WIDTH_STEP }, (_, i) => `cms-w-${(i + 1) * WIDTH_STEP}`);
const IMAGE_CLASSES = ['cms-img-left', 'cms-img-right', 'cms-img-center', 'cms-img-full', ...WIDTH_CLASSES];
const ALIGNABLE = new Set(['p', 'h1', 'h2', 'h3', 'blockquote', 'th', 'td']);
const TEXT_BLOCKS = new Set(['p', 'h1', 'h2', 'h3']);
const KEEP = new Set(['p', 'h1', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody',
  'tr', 'th', 'td', 'strong', 'em', 'u', 's', 'code', 'br', 'hr']);
const ALIAS = { b: 'strong', i: 'em', strike: 's', del: 's', ins: 'u', h4: 'h3', h5: 'h3', h6: 'h3',
  div: 'p', pre: 'p', tfoot: 'tbody' };
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math',
  'head', 'title', 'meta', 'link', 'textarea', 'select', 'button', 'input', 'audio', 'video', 'canvas',
  'applet', 'frame', 'frameset']);
const HREF = /^(?:https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{1,2000}|mailto:[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}|#\/[A-Za-z0-9_-]{1,64})$/;
const MEDIA_SRC = /^media\/[0-9a-f]{32}\.(?:png|jpg|gif)$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const COLORABLE = new Set(['p', 'h1', 'h2', 'h3', 'blockquote', 'li', 'th', 'td', 'strong', 'em', 'u', 's', 'code']);
const HEX_COLOR = /^#[0-9a-f]{6}$/;
const MAX_DEPTH = 25;
const MAX_NODES = 2500;

// Farben werden nur als #rrggbb gespeichert; alles andere (Namen, hsl, Verläufe) entfällt.
function toHex(value) {
  const text = String(value || '').trim().toLowerCase();
  let match = /^#([0-9a-f]{3})$/.exec(text);
  if (match) {
    return `#${[...match[1]].map((c) => c + c).join('')}`;
  }
  if (HEX_COLOR.test(text)) {
    return text;
  }
  match = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(text);
  if (match && match.slice(1, 4).every((part) => Number(part) <= 255) && match[4] !== '0') {
    return `#${match.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
  }
  return '';
}

function colorStyle(node) {
  const color = toHex(node.localName === 'font' ? node.getAttribute('color') : node.style && node.style.color);
  const background = toHex(node.style && node.style.backgroundColor);
  return [color && `color:${color}`, background && `background-color:${background}`].filter(Boolean).join(';');
}

function alignClass(node) {
  const fromClass = ALIGN.find((name) => node.classList && node.classList.contains(name));
  if (fromClass) {
    return fromClass;
  }
  const value = ((node.style && node.style.textAlign) || node.getAttribute('align') || '').toLowerCase();
  return { left: ALIGN[0], center: ALIGN[1], right: ALIGN[2] }[value] || '';
}

function convert(source, parent, state, depth) {
  for (const node of source.childNodes) {
    if (state.count > MAX_NODES) {
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.data.replace(CONTROL, '');
      if (text) {
        parent.append(document.createTextNode(text));
        state.count += 1;
      }
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }
    const original = node.localName;
    if (DROP.has(original)) {
      continue;
    }
    let tag = ALIAS[original] || original;
    const ownerTag = parent.localName || '';
    if (tag === 'p' && TEXT_BLOCKS.has(ownerTag)) {
      tag = '';
    }
    if (depth >= MAX_DEPTH) {
      tag = '';
    }

    if (tag === 'a') {
      const href = (node.getAttribute('href') || '').trim();
      if (HREF.test(href)) {
        const link = document.createElement('a');
        link.setAttribute('href', href);
        state.count += 1;
        convert(node, link, state, depth + 1);
        parent.append(link);
      } else {
        convert(node, parent, state, depth);
      }
      continue;
    }
    if (tag === 'img') {
      const src = (node.getAttribute('src') || '').trim();
      if (MEDIA_SRC.test(src)) {
        const image = document.createElement('img');
        image.setAttribute('src', src);
        const alt = (node.getAttribute('alt') || '').replace(CONTROL, '').slice(0, 200);
        if (alt) {
          image.setAttribute('alt', alt);
        }
        const classes = IMAGE_CLASSES.filter((name) => node.classList.contains(name));
        const position = classes.filter((name) => name.startsWith('cms-img-')).slice(0, 1);
        const width = classes.filter((name) => name.startsWith('cms-w-')).slice(0, 1);
        if (position.length + width.length) {
          image.setAttribute('class', [...position, ...width].join(' '));
        }
        parent.append(image);
        state.count += 1;
      }
      continue;
    }
    if (tag === 'span' || tag === 'font' || tag === 'mark') {
      const style = colorStyle(node) || (tag === 'mark' ? 'background-color:#ffe066' : '');
      if (style) {
        const span = document.createElement('span');
        span.setAttribute('style', style);
        state.count += 1;
        convert(node, span, state, depth + 1);
        parent.append(span);
      } else {
        convert(node, parent, state, depth);
      }
      continue;
    }
    if (tag === 'br' || tag === 'hr') {
      parent.append(document.createElement(tag));
      state.count += 1;
      continue;
    }
    if (tag && KEEP.has(tag)) {
      const element = document.createElement(tag);
      const align = ALIGNABLE.has(tag) ? alignClass(node) : '';
      if (align) {
        element.setAttribute('class', align);
      }
      state.count += 1;
      const style = COLORABLE.has(tag) ? colorStyle(node) : '';
      let inner = element;
      if (style) {
        inner = document.createElement('span');
        inner.setAttribute('style', style);
        element.append(inner);
        state.count += 1;
      }
      convert(node, inner, state, depth + (style ? 2 : 1));
      parent.append(element);
      continue;
    }
    convert(node, parent, state, depth);
  }
}

export function cleanToFragment(html) {
  const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
  const holder = document.createElement('div');
  convert(doc.body, holder, { count: 0 }, 0);
  const fragment = document.createDocumentFragment();
  fragment.append(...holder.childNodes);
  return fragment;
}

export function cleanHtml(html) {
  const holder = document.createElement('div');
  holder.append(cleanToFragment(html));
  return holder.innerHTML.trim();
}

export function renderHtml(html) {
  const fragment = cleanToFragment(html);
  for (const link of fragment.querySelectorAll('a')) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
  return fragment;
}

export function markdownToHtml(fragment) {
  const holder = document.createElement('div');
  holder.append(fragment.cloneNode(true));
  const levels = { H3: 'h1', H4: 'h2', H5: 'h3' };
  for (const heading of holder.querySelectorAll('h3, h4, h5')) {
    const replacement = document.createElement(levels[heading.tagName]);
    replacement.append(...heading.childNodes);
    heading.replaceWith(replacement);
  }
  return cleanHtml(holder.innerHTML);
}

export function detectImageType(bytes) {
  const starts = (...signature) => signature.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'png';
  }
  if (starts(0xff, 0xd8, 0xff)) {
    return 'jpg';
  }
  if (starts(0x47, 0x49, 0x46, 0x38)) {
    return 'gif';
  }
  return '';
}

// Gemeinsame Gestaltung fuer Anzeige (.body) und Editor (.editor-area).
export function contentCss(scope) {
  return `
    ${scope} { overflow-wrap: anywhere; line-height: 1.5; }
    ${scope} > :first-child { margin-top: 0; }
    ${scope} > :last-child { margin-bottom: 0; }
    ${scope}::after { content: ''; display: block; clear: both; }
    ${scope} h1 { font-size: 1.4rem; margin: 0.8rem 0 0.4rem; }
    ${scope} h2 { font-size: 1.2rem; margin: 0.8rem 0 0.4rem; }
    ${scope} h3 { font-size: 1.05rem; margin: 0.8rem 0 0.4rem; }
    ${scope} p { margin: 0.5rem 0; }
    ${scope} blockquote { margin: 0.5rem 0; padding-left: 0.75rem; border-left: 3px solid #43564a; color: #c5d8cc; }
    ${scope} a { color: #8fd0a8; }
    ${scope} code { background: #17211d; padding: 0 0.25rem; border-radius: 0.25rem; }
    ${scope} table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }
    ${scope} th, ${scope} td { border: 1px solid #43564a; padding: 0.3rem 0.5rem; vertical-align: top; min-width: 2rem; }
    ${scope} th { background: #2a3b32; text-align: left; }
    ${scope} img { max-width: 100%; height: auto; }
    ${scope} .cms-align-left { text-align: left; }
    ${scope} .cms-align-center { text-align: center; }
    ${scope} .cms-align-right { text-align: right; }
    ${scope} img.cms-img-left { float: left; margin: 0.25rem 0.75rem 0.5rem 0; }
    ${scope} img.cms-img-right { float: right; margin: 0.25rem 0 0.5rem 0.75rem; }
    ${scope} img.cms-img-center { display: block; margin: 0.5rem auto; }
    ${scope} img.cms-img-full { display: block; width: 100%; margin: 0.5rem 0; }
    ${WIDTH_CLASSES.map((name) => `${scope} img.${name} { width: ${name.slice(6)}%; }`).join('\n    ')}
  `;
}

export function editorCss() {
  return `
    .rt { display: grid; gap: 0.4rem; }
    .rt-bar { display: flex; flex-wrap: wrap; gap: 0.25rem; }
    .rt-bar button { padding: 0.25rem 0.5rem; min-width: 2rem; }
    .rt-bar button[aria-pressed="true"] { background: #3d5a49; border-color: #8fd0a8; }
    .rt-sep { width: 1px; background: #43564a; margin: 0 0.15rem; }
    .rt-panel { border: 1px solid #43564a; border-radius: 0.5rem; padding: 0.5rem; display: grid; gap: 0.5rem; background: #17211d; }
    .rt-panel[hidden] { display: none; }
    .rt-row { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
    .rt-row input[type="text"], .rt-row input[type="url"] { flex: 1 1 12rem; width: auto; }
    .rt-row input[type="number"] { width: 5rem; }
    .rt-row input[type="color"] { width: 3rem; height: 2rem; padding: 0; }
    .rt-media { display: flex; flex-wrap: wrap; gap: 0.4rem; max-height: 8rem; overflow: auto; }
    .rt-media button { padding: 0.15rem; }
    .rt-media img { display: block; width: 4rem; height: 3rem; object-fit: cover; }
    .editor-area { min-height: 12rem; max-height: 50vh; overflow: auto; padding: 0.5rem; background: #17211d;
      border: 1px solid #43564a; border-radius: 0.5rem; }
    .editor-area:focus-visible { outline: 2px solid #8fd0a8; outline-offset: 2px; }
    .editor-area img.rt-selected { outline: 2px solid #8fd0a8; }
    .rt { position: relative; }
    .rt-handle { position: absolute; width: 1.1rem; height: 1.1rem; padding: 0; min-width: 0; border-radius: 0.25rem;
      background: #8fd0a8; border: 2px solid #17211d; cursor: nwse-resize; touch-action: none; z-index: 2; }
    .rt-handle[hidden] { display: none; }
    .cms-ph { display: inline-block; padding: 0 0.45em; border-radius: 0.8em; background: #2f5a43; color: #d9f2e2;
      border: 1px solid #8fd0a8; font-size: 0.9em; cursor: pointer; user-select: all; white-space: nowrap; }
    .cms-ph:hover { background: #3d7157; }
    ${contentCss('.editor-area')}
  `;
}

const BUTTONS = [
  { label: 'B', title: 'Fett', cmd: 'bold', style: 'font-weight:700' },
  { label: 'K', title: 'Kursiv', cmd: 'italic', style: 'font-style:italic' },
  { label: 'U', title: 'Unterstrichen', cmd: 'underline', style: 'text-decoration:underline' },
  { label: 'S', title: 'Durchgestrichen', cmd: 'strikeThrough', style: 'text-decoration:line-through' },
  null,
  { label: 'H1', title: 'Überschrift 1', block: 'h1' },
  { label: 'H2', title: 'Überschrift 2', block: 'h2' },
  { label: 'H3', title: 'Überschrift 3', block: 'h3' },
  { label: '¶', title: 'Absatz', block: 'p' },
  { label: '❝', title: 'Zitat', block: 'blockquote' },
  null,
  { label: '• Liste', title: 'Aufzählung', cmd: 'insertUnorderedList' },
  { label: '1. Liste', title: 'Nummerierte Liste', cmd: 'insertOrderedList' },
  null,
  { label: 'Farbe', title: 'Textfarbe und Hervorhebung', panel: 'color' },
  null,
  { label: '⇤', title: 'Linksbündig', cmd: 'justifyLeft' },
  { label: '↔', title: 'Zentriert', cmd: 'justifyCenter' },
  { label: '⇥', title: 'Rechtsbündig', cmd: 'justifyRight' },
  null,
  { label: 'Link', title: 'Link einfügen', panel: 'link' },
  { label: 'Bild', title: 'Bild einfügen', panel: 'image' },
  { label: 'Tabelle', title: 'Tabelle', panel: 'table' },
  { label: '{{ }}', title: 'Platzhalter für einen FHEM-Wert einfügen (Device suchen, Reading wählen)', placeholder: true },
  null,
  { label: '↶', title: 'Rückgängig', cmd: 'undo' },
  { label: '↷', title: 'Wiederholen', cmd: 'redo' },
  { label: 'Tx', title: 'Formatierung entfernen', cmd: 'removeFormat' }
];

function button(label, title, onClick, extra = {}) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.title = title;
  element.setAttribute('aria-label', title);
  if (extra.style) {
    element.style.cssText = extra.style;
  }
  element.addEventListener('mousedown', (event) => event.preventDefault());
  element.addEventListener('click', onClick);
  return element;
}

function field(type, placeholder, label) {
  const input = document.createElement('input');
  input.type = type;
  input.placeholder = placeholder;
  input.setAttribute('aria-label', label);
  input.autocomplete = 'off';
  return input;
}

// Im Editor ist ein Platzhalter ein unteilbarer Baustein; gespeichert wird er als Text {{Device:reading|filter}}.
function makeChip({ device, reading, filter }) {
  const chip = document.createElement('span');
  chip.className = 'cms-ph';
  chip.contentEditable = 'false';
  chip.setAttribute('role', 'button');
  chip.dataset.device = device;
  chip.dataset.reading = reading;
  chip.dataset.filter = filter || '';
  chip.textContent = `${device}:${reading}${filter ? ` | ${filter}` : ''}`;
  chip.title = 'Klicken, um den Platzhalter zu bearbeiten';
  return chip;
}

function chipify(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.includes('{{')) {
      texts.push(walker.currentNode);
    }
  }
  for (const node of texts) {
    const parts = splitPlaceholders(node.nodeValue);
    if (parts.some((part) => typeof part !== 'string')) {
      node.replaceWith(...parts.map((part) => (typeof part === 'string' ? document.createTextNode(part) : makeChip(part))));
    }
  }
}

function serializeArea(area) {
  const copy = area.cloneNode(true);
  for (const chip of copy.querySelectorAll('.cms-ph')) {
    chip.replaceWith(document.createTextNode(placeholderText(chip.dataset.device, chip.dataset.reading, chip.dataset.filter)));
  }
  return cleanHtml(copy.innerHTML);
}

export function createEditor({ root, services, html, onError }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'rt';
  const bar = document.createElement('div');
  bar.className = 'rt-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Textformatierung');
  const area = document.createElement('div');
  area.className = 'editor-area';
  area.contentEditable = 'true';
  area.setAttribute('role', 'textbox');
  area.setAttribute('aria-multiline', 'true');
  area.setAttribute('aria-label', 'Text');
  area.append(cleanToFragment(html));
  chipify(area);
  let saved = null;
  let selectedImage = null;
  const panels = {};

  const selection = () => (typeof root.getSelection === 'function' ? root.getSelection() : document.getSelection());
  const remember = () => {
    const sel = selection();
    if (sel && sel.rangeCount && area.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      saved = sel.getRangeAt(0).cloneRange();
    }
  };
  const restore = () => {
    area.focus();
    if (saved) {
      const sel = selection();
      sel.removeAllRanges();
      sel.addRange(saved);
    }
  };
  const currentRange = () => {
    remember();
    return saved;
  };
  document.addEventListener('selectionchange', remember);

  const exec = (cmd, value) => {
    restore();
    document.execCommand('styleWithCSS', false, cmd === 'foreColor' || cmd === 'hiliteColor');
    document.execCommand(cmd, false, value);
    remember();
  };

  const insertNode = (node) => {
    restore();
    let range = saved;
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(area);
      range.collapse(false);
    }
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    const sel = selection();
    sel.removeAllRanges();
    sel.addRange(range);
    saved = range.cloneRange();
  };

  const insertBlock = (node) => {
    const range = currentRange();
    let top = range ? range.startContainer : null;
    while (top && top.parentNode !== area) {
      top = top.parentNode;
    }
    if (top) {
      top.after(node);
    } else {
      area.append(node);
    }
  };

  const showPanel = (name) => {
    remember();
    for (const [key, panel] of Object.entries(panels)) {
      panel.hidden = key !== name || !panel.hidden;
    }
    const open = panels[name];
    if (!open.hidden) {
      if (name === 'image') {
        loadMedia();
      } else if (name === 'link') {
        linkInput.focus();
      }
    }
  };

  for (const spec of BUTTONS) {
    if (!spec) {
      const sep = document.createElement('span');
      sep.className = 'rt-sep';
      bar.append(sep);
      continue;
    }
    bar.append(button(spec.label, spec.title, () => {
      if (spec.placeholder) {
        remember();
        openPlaceholderPicker({ services }).then((result) => {
          if (result) {
            insertNode(makeChip(result));
          }
        });
      } else if (spec.panel) {
        showPanel(spec.panel);
      } else if (spec.block) {
        exec('formatBlock', `<${spec.block}>`);
      } else {
        exec(spec.cmd);
      }
    }, spec));
  }

  // Link
  const linkPanel = document.createElement('div');
  linkPanel.className = 'rt-panel';
  linkPanel.hidden = true;
  const linkInput = field('url', 'https://… oder mailto:… oder #/seite', 'Link-Adresse');
  const linkRow = document.createElement('div');
  linkRow.className = 'rt-row';
  linkRow.append(linkInput,
    button('Setzen', 'Link setzen', () => {
      const href = linkInput.value.trim();
      if (!HREF.test(href)) {
        onError('Ungültiger Link: erlaubt sind http(s)://, mailto: und #/seitenname');
        return;
      }
      onError('');
      exec('createLink', href);
      linkPanel.hidden = true;
    }),
    button('Entfernen', 'Link entfernen', () => {
      exec('unlink');
      linkPanel.hidden = true;
    }));
  linkPanel.append(linkRow);
  panels.link = linkPanel;

  // Farben
  const colorPanel = document.createElement('div');
  colorPanel.className = 'rt-panel';
  colorPanel.hidden = true;
  const colorRow = (label, command, initial, resetTitle) => {
    const row = document.createElement('div');
    row.className = 'rt-row';
    const input = field('color', '', label);
    input.value = initial;
    const name = document.createElement('span');
    name.textContent = label;
    row.append(name, input,
      button('Anwenden', `${label} auf die Auswahl anwenden`, () => exec(command, input.value)),
      button('Entfernen', resetTitle, () => exec(command, command === 'foreColor' ? '#edf4ef' : 'transparent')));
    return row;
  };
  colorPanel.append(
    colorRow('Textfarbe', 'foreColor', '#ff6b6b', 'Textfarbe zurücksetzen'),
    colorRow('Hervorhebung', 'hiliteColor', '#ffe066', 'Hervorhebung entfernen'));
  panels.color = colorPanel;

  // Tabelle
  const tablePanel = document.createElement('div');
  tablePanel.className = 'rt-panel';
  tablePanel.hidden = true;
  const rowsInput = field('number', 'Zeilen', 'Zeilen');
  rowsInput.min = '1';
  rowsInput.max = '30';
  rowsInput.value = '3';
  const colsInput = field('number', 'Spalten', 'Spalten');
  colsInput.min = '1';
  colsInput.max = '10';
  colsInput.value = '3';
  const cellOf = () => {
    const range = currentRange();
    let node = range ? range.startContainer : null;
    while (node && node !== area) {
      if (node.nodeType === Node.ELEMENT_NODE && (node.localName === 'td' || node.localName === 'th')) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  };
  const makeCell = (tag) => {
    const cell = document.createElement(tag);
    cell.append(document.createElement('br'));
    return cell;
  };
  const tableAction = (action) => () => {
    const cell = cellOf();
    if (!cell) {
      onError('Cursor zuerst in eine Tabellenzelle setzen');
      return;
    }
    onError('');
    const row = cell.parentElement;
    const table = cell.closest('table');
    const index = [...row.children].indexOf(cell);
    if (action === 'row+') {
      const copy = document.createElement('tr');
      for (const _ of row.children) {
        copy.append(makeCell('td'));
      }
      const section = row.parentElement.localName === 'thead' && table.tBodies[0] ? table.tBodies[0] : row.parentElement;
      if (section === row.parentElement) {
        row.after(copy);
      } else {
        section.prepend(copy);
      }
    } else if (action === 'row-') {
      if (table.rows.length > 1) {
        row.remove();
      }
    } else if (action === 'col+') {
      for (const tr of table.rows) {
        const reference = tr.children[index];
        const added = makeCell(reference && reference.localName === 'th' ? 'th' : 'td');
        if (reference) {
          reference.after(added);
        } else {
          tr.append(added);
        }
      }
    } else if (action === 'col-') {
      if (row.children.length > 1) {
        for (const tr of table.rows) {
          if (tr.children[index]) {
            tr.children[index].remove();
          }
        }
      }
    } else if (action === 'delete') {
      table.remove();
    }
  };
  const tableRow1 = document.createElement('div');
  tableRow1.className = 'rt-row';
  tableRow1.append(rowsInput, colsInput, button('Tabelle einfügen', 'Tabelle einfügen', () => {
    const rows = Number.parseInt(rowsInput.value, 10);
    const cols = Number.parseInt(colsInput.value, 10);
    if (!(rows >= 1 && rows <= 30 && cols >= 1 && cols <= 10)) {
      onError('Tabelle: 1–30 Zeilen und 1–10 Spalten');
      return;
    }
    onError('');
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    for (let c = 0; c < cols; c += 1) {
      head.append(makeCell('th'));
    }
    const body = table.createTBody();
    for (let r = 1; r < rows; r += 1) {
      const tr = body.insertRow();
      for (let c = 0; c < cols; c += 1) {
        tr.append(makeCell('td'));
      }
    }
    const paragraph = document.createElement('p');
    paragraph.append(document.createElement('br'));
    insertBlock(table);
    table.after(paragraph);
    tablePanel.hidden = true;
  }));
  const tableRow2 = document.createElement('div');
  tableRow2.className = 'rt-row';
  tableRow2.append(
    button('Zeile +', 'Zeile darunter einfügen', tableAction('row+')),
    button('Zeile −', 'Zeile löschen', tableAction('row-')),
    button('Spalte +', 'Spalte rechts einfügen', tableAction('col+')),
    button('Spalte −', 'Spalte löschen', tableAction('col-')),
    button('Tabelle löschen', 'Ganze Tabelle löschen', tableAction('delete')));
  tablePanel.append(tableRow1, tableRow2);
  panels.table = tablePanel;

  // Bild
  const imagePanel = document.createElement('div');
  imagePanel.className = 'rt-panel';
  imagePanel.hidden = true;
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/png,image/jpeg,image/gif';
  fileInput.hidden = true;
  const mediaList = document.createElement('div');
  mediaList.className = 'rt-media';
  const insertImage = (src) => {
    const image = document.createElement('img');
    image.setAttribute('src', src);
    image.setAttribute('class', 'cms-img-left cms-w-25');
    insertNode(image);
    selectImage(image);
  };
  const loadMedia = async () => {
    mediaList.replaceChildren();
    try {
      for (const src of await services.listMedia()) {
        const thumb = document.createElement('img');
        thumb.src = src;
        thumb.alt = '';
        const choose = button('', 'Vorhandenes Bild einfügen', () => insertImage(src));
        choose.append(thumb);
        mediaList.append(choose);
      }
    } catch (error) {
      onError(error.message || 'Bilder konnten nicht geladen werden');
    }
  };
  const upload = async (file) => {
    if (file.size > MAX_IMAGE_BYTES) {
      onError('Das Bild darf höchstens 3 MiB groß sein');
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!detectImageType(bytes)) {
      onError('Nur PNG-, JPEG- und GIF-Bilder sind erlaubt');
      return;
    }
    try {
      onError('');
      const src = await services.uploadMedia(bytes);
      await loadMedia();
      insertImage(src);
    } catch (error) {
      onError(error.message || 'Upload fehlgeschlagen');
    }
  };
  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files;
    fileInput.value = '';
    if (file) {
      upload(file);
    }
  });
  const uploadRow = document.createElement('div');
  uploadRow.className = 'rt-row';
  uploadRow.append(fileInput, button('Bild hochladen …', 'Bild hochladen', () => fileInput.click()));
  const props = document.createElement('div');
  props.className = 'rt-row';
  props.hidden = true;
  const altInput = field('text', 'Alternativtext', 'Alternativtext');
  altInput.maxLength = 200;
  altInput.addEventListener('input', () => {
    if (selectedImage) {
      if (altInput.value) {
        selectedImage.setAttribute('alt', altInput.value);
      } else {
        selectedImage.removeAttribute('alt');
      }
    }
  });
  const setClass = (prefix, value) => () => {
    if (!selectedImage) {
      return;
    }
    const kept = [...selectedImage.classList].filter((name) => !name.startsWith(prefix));
    selectedImage.setAttribute('class', [...kept, value].join(' '));
    placeHandle();
  };
  const hint = document.createElement('span');
  hint.textContent = 'Größe: Ziehpunkt unten rechts ziehen oder fokussieren und Pfeiltasten nutzen.';
  hint.className = 'rt-hint';
  props.append(altInput, hint,
    button('Links', 'Bild links, Text umfließt', setClass('cms-img-', 'cms-img-left')),
    button('Mitte', 'Bild zentriert', setClass('cms-img-', 'cms-img-center')),
    button('Rechts', 'Bild rechts, Text umfließt', setClass('cms-img-', 'cms-img-right')),
    button('Voll', 'Bild in voller Breite', setClass('cms-img-', 'cms-img-full')),
    button('Bild entfernen', 'Bild entfernen', () => {
      if (selectedImage) {
        selectedImage.remove();
        selectImage(null);
      }
    }));
  imagePanel.append(uploadRow, mediaList, props);
  panels.image = imagePanel;

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'rt-handle';
  handle.hidden = true;
  handle.setAttribute('aria-label', 'Bildgröße ändern (Pfeiltasten: 5 Prozent)');
  handle.title = 'Bildgröße ziehen';

  const contentWidth = () => {
    const style = getComputedStyle(area);
    return area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  };
  const currentPercent = () => {
    const named = WIDTH_CLASSES.find((name) => selectedImage.classList.contains(name));
    if (named) {
      return Number(named.slice(6));
    }
    return Math.round((selectedImage.getBoundingClientRect().width / contentWidth()) * 100);
  };
  const applyPercent = (percent) => {
    const snapped = Math.min(100, Math.max(WIDTH_STEP, Math.round(percent / WIDTH_STEP) * WIDTH_STEP));
    const kept = [...selectedImage.classList].filter((name) => !name.startsWith('cms-w-'));
    selectedImage.setAttribute('class', [...kept, `cms-w-${snapped}`].join(' '));
    placeHandle();
  };
  function placeHandle() {
    if (!selectedImage || !selectedImage.isConnected) {
      handle.hidden = true;
      return;
    }
    const image = selectedImage.getBoundingClientRect();
    const view = area.getBoundingClientRect();
    const box = wrapper.getBoundingClientRect();
    const inside = image.bottom <= view.bottom + 1 && image.right <= view.right + 1 && image.top >= view.top - 1;
    handle.hidden = !inside;
    const size = handle.offsetWidth || 18;
    handle.style.left = `${image.right - box.left - size}px`;
    handle.style.top = `${image.bottom - box.top - size}px`;
  }
  handle.addEventListener('pointerdown', (event) => {
    if (!selectedImage) {
      return;
    }
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = selectedImage.getBoundingClientRect().width;
    const move = (moveEvent) => {
      applyPercent(((startWidth + moveEvent.clientX - startX) / contentWidth()) * 100);
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  });
  handle.addEventListener('keydown', (event) => {
    const delta = { ArrowRight: WIDTH_STEP, ArrowUp: WIDTH_STEP, ArrowLeft: -WIDTH_STEP, ArrowDown: -WIDTH_STEP }[event.key];
    if (delta && selectedImage) {
      event.preventDefault();
      applyPercent(currentPercent() + delta);
    }
  });
  area.addEventListener('scroll', placeHandle);
  area.addEventListener('input', placeHandle);
  window.addEventListener('resize', placeHandle);

  function selectImage(image) {
    if (selectedImage) {
      selectedImage.classList.remove('rt-selected');
    }
    selectedImage = image;
    props.hidden = !image;
    handle.hidden = !image;
    if (image) {
      image.classList.add('rt-selected');
      altInput.value = image.getAttribute('alt') || '';
      imagePanel.hidden = false;
      placeHandle();
    }
  }

  area.addEventListener('click', (event) => {
    const chip = event.target instanceof Element ? event.target.closest('.cms-ph') : null;
    if (chip) {
      openPlaceholderPicker({
        services,
        initial: { device: chip.dataset.device, reading: chip.dataset.reading, filter: chip.dataset.filter }
      }).then((result) => {
        if (result) {
          chip.replaceWith(makeChip(result));
        }
      });
      return;
    }
    selectImage(event.target instanceof HTMLImageElement ? event.target : null);
  });

  area.addEventListener('paste', (event) => {
    event.preventDefault();
    const data = event.clipboardData;
    if (!data) {
      return;
    }
    const clipped = data.getData('text/html');
    if (clipped) {
      exec('insertHTML', cleanHtml(clipped));
    } else {
      exec('insertText', data.getData('text/plain'));
    }
  });
  area.addEventListener('drop', (event) => event.preventDefault());

  wrapper.append(bar, linkPanel, colorPanel, tablePanel, imagePanel, area, handle);

  return {
    element: wrapper,
    getHtml() {
      return serializeArea(area);
    },
    destroy() {
      document.removeEventListener('selectionchange', remember);
      window.removeEventListener('resize', placeHandle);
    }
  };
}
