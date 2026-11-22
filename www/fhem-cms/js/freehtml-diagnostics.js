import { checkSource, extraAttributeAllowed, isSafeCss, isSafeHtmlUrl, MAX_FREE_HTML, normalizeFreeHtmlCss } from './freehtml.js';
import { validateCssStructureDetailed } from './freehtml-css.js';

const NUMERIC_PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.-]+):(@?[A-Za-z0-9_.-]+)((?:\s*\|\s*(?:int|round\([0-6]\)|default\(-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)\)))*)\s*\}\}/g;
const ENTITY_CACHE = new Map();
let entityDecodeBudget = 0;

function positionDetails(source, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > source.length) return null;
  let line = 1;
  let column = 1;
  for (let index = 0; index < start; index++) {
    const code = source.charCodeAt(index);
    if (code === 13) {
      if (source.charCodeAt(index + 1) === 10) index++;
      line++;
      column = 1;
    } else if (code === 10) {
      line++;
      column = 1;
    } else if (code >= 0xD800 && code <= 0xDBFF && source.charCodeAt(index + 1) >= 0xDC00
      && source.charCodeAt(index + 1) <= 0xDFFF) {
      column++;
      index++;
    } else column++;
  }

  let lineStart = start;
  while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') lineStart--;
  let lineEnd = start;
  while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') lineEnd++;
  const maxContext = 180;
  let contextStart = lineStart;
  let contextEnd = lineEnd;
  if (contextEnd - contextStart > maxContext) {
    const focus = Math.min(start, Math.max(start, end - 1));
    contextStart = Math.max(lineStart, Math.min(focus - Math.floor(maxContext / 2), lineEnd - maxContext));
    contextEnd = Math.min(lineEnd, contextStart + maxContext);
  }
  return {
    start,
    end,
    line,
    column,
    context: source.slice(contextStart, contextEnd),
    contextStart,
    contextEnd,
  };
}

function result(source, message, start, end, reason = 'source') {
  const position = positionDetails(source, start, end);
  return position
    ? { message, reason, ...position }
    : { message, reason: 'unlocated', start: null, end: null, line: null, column: null, context: '', contextStart: null, contextEnd: null };
}

function fallback(message) {
  return { message, reason: 'unlocated', start: null, end: null, line: null, column: null, context: '', contextStart: null, contextEnd: null };
}

function trimmedOffsets(value, offsets) {
  const leading = value.length - value.trimStart().length;
  const trimmed = value.trim();
  return {
    value: trimmed,
    start: offsets[leading]?.[0] ?? offsets[0]?.[0],
    end: offsets[leading + trimmed.length - 1] ? offsets[leading + trimmed.length - 1][1] : offsets.at(-1)?.[1],
  };
}

function decodeEntity(entity) {
  if (ENTITY_CACHE.has(entity)) return ENTITY_CACHE.get(entity);
  if (entityDecodeBudget >= 32) return null;
  entityDecodeBudget++;
  const document = new DOMParser().parseFromString(`<textarea>${entity.replace(/</g, '&lt;')}</textarea>`, 'text/html');
  const decoded = document.querySelector('textarea')?.value ?? entity;
  if (ENTITY_CACHE.size < 256) ENTITY_CACHE.set(entity, decoded);
  return decoded;
}

function decodeAttribute(raw, start, expectedValue) {
  const value = [];
  const offsets = [];
  for (let index = 0; index < raw.length;) {
    if (raw[index] === '&') {
      const match = /^&(?:#[xX][0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]+);?/.exec(raw.slice(index));
      if (match) {
        const decoded = decodeEntity(match[0]);
        if (decoded === null) return null;
        if (decoded !== match[0]) {
          value.push(decoded);
          for (let out = 0; out < decoded.length; out++) offsets.push([start + index, start + index + match[0].length]);
          index += match[0].length;
          continue;
        }
      }
    }
    const char = raw[index];
    if (char === '\r' || char === '\n' || char === '\t' || char === '\f') {
      value.push(' ');
      if (char === '\r' && raw[index + 1] === '\n') {
        offsets.push([start + index, start + index + 2]);
        index += 2;
      } else {
        offsets.push([start + index, start + index + 1]);
        index++;
      }
    } else {
      value.push(char);
      offsets.push([start + index, start + index + 1]);
      index++;
    }
  }
  return value.join('') === expectedValue ? { value: expectedValue, offsets } : null;
}

function appendRange(target, source, start, end) {
  for (let index = start; index < end; index++) target.push(source[index]);
}

function scanHtml(source) {
  const tags = [];
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf('<', index);
    if (start < 0) break;
    if (source.startsWith('<!--', start)) {
      const close = source.indexOf('-->', start + 4);
      if (close >= 0) {
        index = close + 3;
        continue;
      }
    }
    if (source[start + 1] === '/' || !/[A-Za-z]/.test(source[start + 1] || '')) {
      index = start + 1;
      continue;
    }
    let cursor = start + 1;
    while (cursor < source.length && !/[\t\n\f\r />]/.test(source[cursor])) cursor++;
    const name = source.slice(start + 1, cursor).toLowerCase();
    const attrs = [];
    let quote = '';
    let tagEnd = -1;
    for (let scan = cursor; scan < source.length; scan++) {
      const char = source[scan];
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '>') {
        tagEnd = scan;
        break;
      }
    }
    if (tagEnd < 0) break;
    cursor = start + 1 + name.length;
    while (cursor < tagEnd) {
      while (cursor < tagEnd && /[\t\n\f\r />]/.test(source[cursor])) cursor++;
      if (cursor >= tagEnd) break;
      const nameStart = cursor;
      while (cursor < tagEnd && !/[\t\n\f\r />=]/.test(source[cursor])) cursor++;
      if (cursor === nameStart) {
        cursor++;
        continue;
      }
      const attrName = source.slice(nameStart, cursor).toLowerCase();
      const nameEnd = cursor;
      while (cursor < tagEnd && /[\t\n\f\r ]/.test(source[cursor])) cursor++;
      let valueStart = cursor;
      let valueEnd = cursor;
      if (source[cursor] === '=') {
        cursor++;
        while (cursor < tagEnd && /[\t\n\f\r ]/.test(source[cursor])) cursor++;
        if (source[cursor] === '"' || source[cursor] === "'") {
          const attrQuote = source[cursor++];
          valueStart = cursor;
          while (cursor < tagEnd && source[cursor] !== attrQuote) cursor++;
          valueEnd = cursor;
          if (cursor < tagEnd) cursor++;
        } else {
          valueStart = cursor;
          while (cursor < tagEnd && !/[\t\n\f\r >]/.test(source[cursor])) cursor++;
          valueEnd = cursor;
        }
      }
      const rawValue = source.slice(valueStart, valueEnd);
      attrs.push({
        name: attrName,
        nameStart,
        nameEnd,
        valueStart,
        valueEnd,
        value: rawValue,
        offsets: Array.from({ length: rawValue.length }, (_, offset) => [valueStart + offset, valueStart + offset + 1]),
      });
    }
    const token = { name, start, nameStart: start + 1, nameEnd: start + 1 + name.length, end: tagEnd + 1, attrs };
    if (name === 'style') {
      const close = /<\/style\s*>/ig;
      close.lastIndex = token.end;
      const closing = close.exec(source);
      token.contentStart = token.end;
      token.contentEnd = closing ? closing.index : source.length;
      token.content = source.slice(token.contentStart, token.contentEnd);
      tags.push(token);
      index = closing ? close.lastIndex : source.length;
      continue;
    }
    tags.push(token);
    index = tagEnd + 1;
  }
  return tags;
}

function withoutComments(value, offsets) {
  let resultText = value;
  let resultOffsets = offsets;
  for (const expression of [/<!--(?:(?!-->).)*-->/gs, /\/\*[\s\S]*?\*\//g]) {
    let output = '';
    const mapped = [];
    let cursor = 0;
    for (const match of resultText.matchAll(expression)) {
      output += resultText.slice(cursor, match.index);
      appendRange(mapped, resultOffsets, cursor, match.index);
      cursor = match.index + match[0].length;
    }
    output += resultText.slice(cursor);
    appendRange(mapped, resultOffsets, cursor, resultOffsets.length);
    resultText = output;
    resultOffsets = mapped;
  }
  return { text: resultText, offsets: resultOffsets };
}

function replaceNumericPlaceholders(value, offsets) {
  let text = '';
  const mapped = [];
  let cursor = 0;
  for (const match of value.matchAll(NUMERIC_PLACEHOLDER)) {
    text += value.slice(cursor, match.index);
    appendRange(mapped, offsets, cursor, match.index);
    text += '0';
    const first = offsets[match.index];
    const last = offsets[match.index + match[0].length - 1];
    mapped.push(first && last ? [first[0], last[1]] : first);
    cursor = match.index + match[0].length;
  }
  text += value.slice(cursor);
  appendRange(mapped, offsets, cursor, offsets.length);
  return { text, offsets: mapped };
}

function locateCssProblem(source, css, offsets, message) {
  const filtered = withoutComments(css, offsets);
  if (normalizeFreeHtmlCss(css) !== filtered.text) return null;
  const templated = replaceNumericPlaceholders(filtered.text, filtered.offsets);
  const structure = validateCssStructureDetailed(templated.text);
  if (structure) {
    const original = templated.offsets[structure.start];
    const last = templated.offsets[Math.max(structure.start, structure.end - 1)];
    if (original && last) {
      return result(source, message, original[0], last[1], structure.reason);
    }
  }

  const remaining = withoutComments(css, offsets);
  const placeholder = /\{\{[^{}]*\}\}/.exec(remaining.text);
  if (placeholder && message.includes('<style>')) {
    const first = remaining.offsets[placeholder.index];
    const last = remaining.offsets[placeholder.index + placeholder[0].length - 1];
    if (first && last) return result(source, message, first[0], last[1], 'placeholder');
  }

  const tokenCandidates = [
    /expression\s*\(/ig,
    /(?:^|[;{])\s*(?:behavior|-moz-binding)\s*:/ig,
    /javascript\s*:/ig,
    /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^()\s"']+))\s*\)/ig,
    /@import\s+(?:"([^"]*)"|'([^']*)')/ig,
    /\/\*|\*\//g,
    /[<\\]/g,
  ];
  for (const pattern of tokenCandidates) {
    for (const match of templated.text.matchAll(pattern)) {
      let start = match.index;
      let end = start + match[0].length;
      if (/^url/i.test(match[0])) {
        const url = match[1] ?? match[2] ?? match[3] ?? '';
        if (isSafeHtmlUrl(url)) continue;
        const urlStart = match[0].indexOf(url);
        start += Math.max(0, urlStart);
        end = start + url.length;
      } else if (/^@import/i.test(match[0])) {
        const url = match[1] ?? match[2] ?? '';
        if (url === 'cms-validated-resource' || isSafeHtmlUrl(url)) continue;
        const urlStart = match[0].indexOf(url);
        start += Math.max(0, urlStart);
        end = start + url.length;
      }
      const first = templated.offsets[start];
      const last = templated.offsets[Math.max(start, end - 1)];
      if (first && last) return result(source, message, first[0], last[1], 'css-policy-token');
    }
  }
  return null;
}

function htmlTextOffsetMap(value, start) {
  let text = '';
  const offsets = [];
  for (let index = 0; index < value.length;) {
    if (value[index] === '\r') {
      const end = value[index + 1] === '\n' ? index + 2 : index + 1;
      text += '\n';
      offsets.push([start + index, start + end]);
      index = end;
    } else {
      text += value[index];
      offsets.push([start + index, start + index + 1]);
      index++;
    }
  }
  return { text, offsets };
}

function sourceAttr(token, name) {
  return token.attrs.find((attribute) => attribute.name === name);
}

function locateKnownFailure(source, message) {
  const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.exec(source);
  if (message === 'Der Code enthält Steuerzeichen' && control) {
    return result(source, message, control.index, control.index + 1, 'control-character');
  }
  if (message.startsWith('Der Code darf höchstens ')) {
    const excessIndex = [...source].slice(0, MAX_FREE_HTML).join('').length;
    return result(source, message, excessIndex, Math.min(source.length, excessIndex + 1), 'length-limit');
  }
  if (message === 'Unvollständige Kommentare oder Sonderkonstrukte sind nicht erlaubt') {
    let index = 0;
    const comments = /<!--(?:(?!-->).)*-->/gs;
    for (const comment of source.matchAll(comments)) {
      const marker = /<(!|\?)/.exec(source.slice(index, comment.index));
      if (marker) return result(source, message, index + marker.index, index + marker.index + 2, 'special-markup');
      index = comment.index + comment[0].length;
    }
    const marker = /<(!|\?)/.exec(source.slice(index));
    if (marker) return result(source, message, index + marker.index, index + marker.index + 2, 'special-markup');
  }

  const document = new DOMParser().parseFromString(`<body>${source}</body>`, 'text/html');
  const tokens = scanHtml(source);
  let tokenIndex = 0;
  const findToken = (element) => {
    for (let index = tokenIndex; index < tokens.length; index++) {
      const token = tokens[index];
      if (token.name !== element.localName.toLowerCase()) continue;
      const matches = [...element.attributes].every((attribute) => sourceAttr(token, attribute.name.toLowerCase()));
      if (!matches) continue;
      tokenIndex = index + 1;
      return token;
    }
    return null;
  };

  for (const element of document.body.querySelectorAll('*')) {
    const tag = element.localName.toLowerCase();
    const token = findToken(element);
    if (!token) continue;
    if (message === `Das Element <${tag}> ist nicht erlaubt`) {
      return result(source, message, token.nameStart, token.nameEnd, 'html-element');
    }
    for (const attribute of element.attributes) {
      const name = attribute.name;
      const sourceAttribute = sourceAttr(token, name.toLowerCase());
      if (!sourceAttribute) continue;
      if (tag === 'iframe' && name === 'src' && message === 'Die Einbettung benötigt eine HTTP-/HTTPS-URL oder einen lokalen Pfad.'
        && !extraAttributeAllowed(tag, name, attribute.value)) {
        return result(source, message, sourceAttribute.valueStart, sourceAttribute.valueEnd, 'html-attribute-value');
      }
      if (message === `Das Attribut „${name}“ ist nicht erlaubt (Element <${tag}>)`
        && !extraAttributeAllowed(tag, name, attribute.value)) {
        return result(source, message, sourceAttribute.nameStart, sourceAttribute.nameEnd, 'html-attribute');
      }
      if (name === 'style' && message === 'Das style-Attribut enthält nicht erlaubte CSS-Eigenschaften oder Werte (z-index maximal 100).'
        && !isSafeCss(attribute.value)) {
        const decoded = decodeAttribute(source.slice(sourceAttribute.valueStart, sourceAttribute.valueEnd),
          sourceAttribute.valueStart, attribute.value);
        const detail = decoded && locateCssProblem(source, attribute.value, decoded.offsets, message);
        if (detail) return detail;
        return result(source, message, sourceAttribute.valueStart, sourceAttribute.valueEnd, 'css-block');
      }
      if (name === 'class' && message === 'Das class-Attribut enthält ungültige Zeichen'
        && !/^[A-Za-z0-9_\- ]{0,200}$/.test(attribute.value)) {
        return result(source, message, sourceAttribute.valueStart, sourceAttribute.valueEnd, 'html-attribute-value');
      }
      if (name === 'data-cms-class' && message.startsWith('Ungültige Bedingung in data-cms-class: „')) {
        const invalid = message.slice('Ungültige Bedingung in data-cms-class: „'.length, -1);
        let cursor = 0;
        for (const part of attribute.value.split(';')) {
          const offset = attribute.value.indexOf(part, cursor);
          cursor = offset + part.length + 1;
          if (part.trim() !== invalid) continue;
          if (sourceAttribute.value.length !== attribute.value.length) {
            return result(source, message, sourceAttribute.valueStart, sourceAttribute.valueEnd, 'html-attribute-value');
          }
          const mapped = trimmedOffsets(part, sourceAttribute.offsets.slice(offset, offset + part.length));
          if (mapped.start !== undefined && mapped.end !== undefined) {
            return result(source, message, mapped.start, mapped.end, 'html-attribute-value');
          }
        }
      }
      const matchesBadValue = (name === 'device' && message === `Ungültiger Device-Name im Attribut device: „${attribute.value}“`)
        || (name === 'reading' && message === `Ungültiger Reading-Name im Attribut reading: „${attribute.value}“`)
        || (name === 'filter' && message === `Ungültiger Filter im Attribut filter: „${attribute.value}“`);
      if (matchesBadValue) {
        return result(source, message, sourceAttribute.valueStart, sourceAttribute.valueEnd, 'html-attribute-value');
      }
    }
    if (element.hasAttribute('device') !== element.hasAttribute('reading')
      && message === `Die Attribute device und reading gehören zusammen (Element <${tag}>)`) {
      return result(source, message, token.start, token.end, 'html-element');
    }
    if (tag === 'style' && message === 'Das <style>-Element enthält nicht erlaubte CSS-Regeln, Eigenschaften oder Werte (z-index maximal 100).'
      && (!isSafeCss(element.textContent) || element.textContent.includes('{{'))) {
      const content = htmlTextOffsetMap(token.content, token.contentStart);
      if (content.text !== element.textContent) return result(source, message, token.start, token.end, 'html-element');
      const detail = locateCssProblem(source, content.text, content.offsets, message);
      if (detail) return detail;
      return result(source, message, token.contentStart, token.contentEnd, 'css-block');
    }
  }
  return null;
}

export function diagnoseFreeHtml(source) {
  entityDecodeBudget = 0;
  const message = checkSource(source);
  if (!message) return null;
  if (typeof source !== 'string') return fallback(message);
  return locateKnownFailure(source, message) ?? fallback(message);
}
