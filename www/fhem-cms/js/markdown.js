// Kleiner, sicherer Markdown-Renderer: baut ausschliesslich DOM-Knoten per createElement/textContent.
// HTML im Quelltext bleibt Text, Links sind auf http(s) und relative Ziele beschraenkt.

const INLINE = /\*\*([^*]+?)\*\*|\*([^*\s][^*]*?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/;

export function safeUrl(url) {
  if (/^https?:\/\/[^\s<>"']+$/i.test(url)) {
    return url;
  }
  if (/^(#|\/(?!\/)|\.\.?\/)[^\s<>"':]*$/.test(url)) {
    return url;
  }
  return null;
}

function appendInline(parent, text) {
  let rest = text;
  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (!match) {
      parent.append(document.createTextNode(rest));
      return;
    }
    if (match.index > 0) {
      parent.append(document.createTextNode(rest.slice(0, match.index)));
    }
    if (match[1] !== undefined) {
      const el = document.createElement('strong');
      appendInline(el, match[1]);
      parent.append(el);
    } else if (match[2] !== undefined) {
      const el = document.createElement('em');
      appendInline(el, match[2]);
      parent.append(el);
    } else if (match[3] !== undefined) {
      const el = document.createElement('code');
      el.textContent = match[3];
      parent.append(el);
    } else {
      const href = safeUrl(match[5]);
      if (href) {
        const el = document.createElement('a');
        el.href = href;
        el.rel = 'noopener noreferrer';
        if (/^https?:/i.test(href)) {
          el.target = '_blank';
        }
        el.textContent = match[4];
        parent.append(el);
      } else {
        parent.append(document.createTextNode(match[0]));
      }
    }
    rest = rest.slice(match.index + match[0].length);
  }
}

export function renderMarkdown(source) {
  const fragment = document.createDocumentFragment();
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      const p = document.createElement('p');
      appendInline(p, paragraph.join(' '));
      fragment.append(p);
      paragraph = [];
    }
  };
  const flushList = () => {
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d{1,9}[.)]\s+(.+)$/.exec(line);

    if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      const h = document.createElement(`h${heading[1].length + 2}`);
      appendInline(h, heading[2]);
      fragment.append(h);
    } else if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = document.createElement(tag);
        fragment.append(list);
      }
      const li = document.createElement('li');
      appendInline(li, (bullet || numbered)[1]);
      list.append(li);
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  return fragment;
}
