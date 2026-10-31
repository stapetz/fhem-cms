// Freies HTML mit Platzhaltern (S31): strikte Allowlist, kein Skript, Werte werden nur als Text eingesetzt.
export const MAX_FREE_HTML = 20000;
export const MAX_FREE_DEVICES = 20;

const TAGS = new Set(['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 'small', 'br', 'hr',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'style']);
const NAME = '[A-Za-z0-9_.-]+';
const READING = '@?[A-Za-z0-9_.-]+';
const CLASS_NAME = /^[A-Za-z0-9_-]{1,40}$/;
const PLACEHOLDER = new RegExp(`\\{\\{\\s*(${NAME}):(${READING})((?:\\s*\\|\\s*[a-z]+(?:\\([^()|{}]{0,80}\\))?)*)\\s*\\}\\}`, 'g');
const CONDITION = new RegExp(`^\\s*(${NAME}):(${READING})\\s*(>=|<=|!=|=|>|<)\\s*([^:;]{0,40}?)\\s*:\\s*([A-Za-z0-9_-]{1,40})\\s*$`);
const DEVICE_ATTR = /^[A-Za-z0-9_.-]{1,64}$/;
const READING_ATTR = /^@?[A-Za-z0-9_.-]{1,64}$/;
const FILTER_ATTR = /^\s*(?:[a-z]+(?:\([^()|{}"<>]{0,80}\))?(?:\s*\|\s*[a-z]+(?:\([^()|{}"<>]{0,80}\))?)*)?\s*$/;
const FORBIDDEN_CSS = /@import|url\s*\(|expression|behavior|binding|javascript:|position\s*:\s*(?:fixed|sticky)|[<>\\]/i;

export function isSafeCss(text) {
  return typeof text === 'string' && !FORBIDDEN_CSS.test(text);
}

// Prüft den Quelltext auf Dinge, die die Bereinigung ohnehin entfernt; so bekommt der Autor eine klare Meldung statt stiller Verluste.
export function checkSource(html) {
  if (typeof html !== 'string') {
    return 'Kein Text';
  }
  if (html.length > MAX_FREE_HTML) {
    return `Der Code darf höchstens ${MAX_FREE_HTML} Zeichen lang sein (aktuell ${html.length})`;
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(html)) {
    return 'Der Code enthält Steuerzeichen';
  }
  const doc = new DOMParser().parseFromString(`<body>${html}`, 'text/html');
  for (const element of doc.body.querySelectorAll('*')) {
    const tag = element.localName;
    if (!TAGS.has(tag)) {
      return `Das Element <${tag}> ist nicht erlaubt`;
    }
    for (const attribute of element.attributes) {
      const name = attribute.name;
      if (!['class', 'style', 'title', 'colspan', 'rowspan', 'data-cms-class', 'device', 'reading', 'filter'].includes(name)) {
        return `Das Attribut „${name}“ ist nicht erlaubt (Element <${tag}>)`;
      }
      if (name === 'style' && !isSafeCss(attribute.value)) {
        return 'Das style-Attribut enthält nicht erlaubte Angaben (url(), @import, position: fixed, …)';
      }
      if (name === 'class' && !/^[A-Za-z0-9_\- ]{0,200}$/.test(attribute.value)) {
        return 'Das class-Attribut enthält ungültige Zeichen';
      }
      if (name === 'data-cms-class') {
        for (const part of attribute.value.split(';').filter((item) => item.trim() !== '')) {
          if (!CONDITION.test(part)) {
            return `Ungültige Bedingung in data-cms-class: „${part.trim()}“`;
          }
        }
      }
      if (name === 'device' && !DEVICE_ATTR.test(attribute.value)) {
        return `Ungültiger Device-Name im Attribut device: „${attribute.value}“`;
      }
      if (name === 'reading' && !READING_ATTR.test(attribute.value)) {
        return `Ungültiger Reading-Name im Attribut reading: „${attribute.value}“`;
      }
      if (name === 'filter' && !FILTER_ATTR.test(attribute.value)) {
        return `Ungültiger Filter im Attribut filter: „${attribute.value}“`;
      }
    }
    if (element.hasAttribute('device') !== element.hasAttribute('reading')) {
      return `Die Attribute device und reading gehören zusammen (Element <${tag}>)`;
    }
    if (tag === 'style' && !isSafeCss(element.textContent)) {
      return 'Das <style>-Element enthält nicht erlaubte Angaben (url(), @import, position: fixed, …)';
    }
  }
  return null;
}

// Liefert die Devices, die der Code über Platzhalter und Bedingungen verwendet.
export function extractDevices(html) {
  const names = new Set();
  for (const match of String(html).matchAll(PLACEHOLDER)) {
    names.add(match[1]);
  }
  for (const match of String(html).matchAll(/\sdevice\s*=\s*"([^"]*)"/g)) {
    if (DEVICE_ATTR.test(match[1])) {
      names.add(match[1]);
    }
  }
  for (const match of String(html).matchAll(/data-cms-class\s*=\s*"([^"]*)"/g)) {
    for (const part of match[1].split(';')) {
      const condition = CONDITION.exec(part);
      if (condition) {
        names.add(condition[1]);
      }
    }
  }
  return [...names].sort();
}

function cleanChildren(source, target) {
  for (const node of source.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      target.append(document.createTextNode(node.nodeValue));
    } else if (node.nodeType === Node.ELEMENT_NODE && TAGS.has(node.localName)) {
      const element = document.createElement(node.localName);
      for (const attribute of node.attributes) {
        const { name, value } = attribute;
        if (name === 'class' && /^[A-Za-z0-9_\- ]{0,200}$/.test(value)) {
          element.setAttribute('class', value);
        } else if (name === 'style' && isSafeCss(value)) {
          element.setAttribute('style', value);
        } else if (name === 'title') {
          element.setAttribute('title', value.slice(0, 200));
        } else if ((name === 'colspan' || name === 'rowspan') && /^[1-9][0-9]?$/.test(value)) {
          element.setAttribute(name, value);
        } else if (name === 'device' && DEVICE_ATTR.test(value)) {
          element.setAttribute(name, value);
        } else if (name === 'reading' && READING_ATTR.test(value)) {
          element.setAttribute(name, value);
        } else if (name === 'filter' && FILTER_ATTR.test(value)) {
          element.setAttribute(name, value);
        } else if (name === 'data-cms-class') {
          element.setAttribute(name, value.split(';').filter((part) => CONDITION.test(part)).join(';'));
        }
      }
      if (node.localName === 'style') {
        element.textContent = isSafeCss(node.textContent) ? node.textContent : '';
      } else {
        cleanChildren(node, element);
      }
      target.append(element);
    }
  }
}

// Baut aus dem Quelltext ein bereinigtes Template; Platzhalter bleiben als Text stehen.
export function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<body>${String(html)}`, 'text/html');
  const fragment = document.createDocumentFragment();
  cleanChildren(doc.body, fragment);
  return fragment;
}

function splitArguments(text) {
  return text.split(',').map((part) => part.trim());
}

function applyFilter(value, filter) {
  const match = /^([a-z]+)(?:\(([^)]*)\))?$/.exec(filter);
  if (!match) {
    return value;
  }
  const [, name, argument = ''] = match;
  const number = Number.parseFloat(value);
  switch (name) {
    case 'round': {
      const digits = Math.min(6, Math.max(0, Number.parseInt(argument || '0', 10) || 0));
      return Number.isFinite(number) ? number.toFixed(digits) : value;
    }
    case 'int':
      return Number.isFinite(number) ? String(Math.trunc(number)) : value;
    case 'upper':
      return value.toUpperCase();
    case 'lower':
      return value.toLowerCase();
    case 'default':
      return value === '' ? argument : value;
    case 'prefix':
      return value === '' ? value : argument + value;
    case 'suffix':
      return value === '' ? value : value + argument;
    case 'map': {
      for (const pair of splitArguments(argument)) {
        const index = pair.indexOf('=');
        if (index > 0 && pair.slice(0, index).trim() === value) {
          return pair.slice(index + 1).trim();
        }
      }
      return value;
    }
    default:
      return value;
  }
}

export function isValidDeviceName(text) {
  return DEVICE_ATTR.test(text);
}

export function isValidReadingName(text) {
  return READING_ATTR.test(text);
}

export function isValidFilter(text) {
  return FILTER_ATTR.test(text);
}

export function placeholderText(device, reading, filter = '') {
  const chain = String(filter).trim();
  return `{{${device}:${reading}${chain ? `|${chain}` : ''}}}`;
}

export function elementText(device, reading, filter = '') {
  const chain = String(filter).trim();
  return `<span device="${device}" reading="${reading}"${chain ? ` filter="${chain}"` : ''}></span>`;
}

// Zerlegt Text in Textstücke und Platzhalter: Strings oder { device, reading, filter }.
export function splitPlaceholders(text) {
  const parts = [];
  let last = 0;
  for (const match of String(text).matchAll(PLACEHOLDER)) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    parts.push({ device: match[1], reading: match[2], filter: match[3].trim().replace(/^\|\s*/, '') });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts;
}

// Sucht ein Reading in einer Gruppe [Hauptdevice, Kanäle …]; Pseudo-Readings @alias, @name, @type.
export function lookupValue(groups, device, reading) {
  const group = groups?.get(device);
  if (!group) {
    return null;
  }
  if (reading.startsWith('@')) {
    const field = reading.slice(1);
    return ['alias', 'name', 'type'].includes(field) ? (group[0][field] ?? null) : null;
  }
  for (const item of group) {
    if (item.readings && Object.prototype.hasOwnProperty.call(item.readings, reading)) {
      return item.readings[reading];
    }
  }
  return null;
}

// Ersetzt Platzhalter in allen Textknoten (außer in <style>).
export function substituteIn(root, lookup) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) {
    if (walker.currentNode.parentNode?.localName !== 'style' && walker.currentNode.nodeValue.includes('{{')) {
      texts.push(walker.currentNode);
    }
  }
  for (const node of texts) {
    node.nodeValue = substitute(node.nodeValue, lookup);
  }
}

export function formatValue(found, filters) {
  let value = found === null || found === undefined ? '' : String(found);
  for (const filter of filters.split('|').map((part) => part.trim()).filter(Boolean)) {
    value = applyFilter(value, filter);
  }
  return value === '' ? '–' : value;
}

export function substitute(text, lookup) {
  return text.replace(PLACEHOLDER, (_all, device, reading, filters) => formatValue(lookup(device, reading), filters));
}

function compare(actual, operator, expected) {
  const a = Number.parseFloat(actual);
  const b = Number.parseFloat(expected);
  const numeric = Number.isFinite(a) && Number.isFinite(b) && actual !== '' && expected !== '';
  switch (operator) {
    case '=': return numeric ? a === b : actual === expected;
    case '!=': return numeric ? a !== b : actual !== expected;
    case '>': return numeric && a > b;
    case '<': return numeric && a < b;
    case '>=': return numeric && a >= b;
    case '<=': return numeric && a <= b;
    default: return false;
  }
}

// Erzeugt aus dem Template eine Kopie mit eingesetzten Werten und gesetzten Bedingungsklassen.
export function renderTemplate(template, lookup) {
  const copy = template.cloneNode(true);
  substituteIn(copy, lookup);
  const container = document.createElement('div');
  container.append(copy);
  // FTUI-Schreibweise: <span device="X" reading="Y" filter="round(1)"></span> wird durch den Wert ersetzt.
  for (const element of container.querySelectorAll('[device][reading]')) {
    element.textContent = formatValue(lookup(element.getAttribute('device'), element.getAttribute('reading')), element.getAttribute('filter') || '');
  }
  for (const element of container.querySelectorAll('[title], [data-cms-class]')) {
    if (element.hasAttribute('title')) {
      element.setAttribute('title', substitute(element.getAttribute('title'), lookup));
    }
    for (const part of (element.getAttribute('data-cms-class') || '').split(';')) {
      const condition = CONDITION.exec(part);
      if (!condition || !CLASS_NAME.test(condition[5])) {
        continue;
      }
      const [, device, reading, operator, expected, className] = condition;
      const actual = lookup(device, reading);
      element.classList.toggle(className, actual !== null && actual !== undefined && compare(String(actual), operator, expected));
    }
  }
  return container;
}
