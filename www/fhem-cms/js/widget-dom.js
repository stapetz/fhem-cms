const sameNode = (current, next) => current && current.nodeType === next.nodeType
  && current.namespaceURI === next.namespaceURI && current.nodeName === next.nodeName
  && (current.nodeType !== 1 || current.id === next.id);

// Replacing live subtrees can reset scroll/focus in Safari and reload embedded frames.
export function updateWidgetDom(target, source, preserveState = true) {
  let cursor = target.firstChild;
  for (const next of [...source.childNodes]) {
    let current = cursor;
    if (!sameNode(current, next)) {
      current = next.nodeType === 1 && next.id
        ? [...target.childNodes].find(child => sameNode(child, next)) : null;
    }
    if (!current) {
      current = next.cloneNode(true);
      target.insertBefore(current, cursor);
    } else {
      if (current !== cursor) target.insertBefore(current, cursor);
      if (current.nodeType === 1) {
        const keepOpen = preserveState && current.localName === 'details';
        for (const attribute of [...current.attributes]) {
          if (keepOpen && attribute.name === 'open') continue;
          if (!next.hasAttributeNS(attribute.namespaceURI, attribute.localName)) {
            current.removeAttributeNS(attribute.namespaceURI, attribute.localName);
          }
        }
        for (const attribute of [...next.attributes]) {
          if (keepOpen && attribute.name === 'open') continue;
          if (current.getAttributeNS(attribute.namespaceURI, attribute.localName) !== attribute.value) {
            current.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
          }
        }
        updateWidgetDom(current, next, preserveState);
      } else if (current.nodeValue !== next.nodeValue) {
        current.nodeValue = next.nodeValue;
      }
    }
    cursor = current.nextSibling;
  }
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }
}
