export function widgetIds(config) {
  return new Set(config.pages.flatMap((page) => page.widgets.map((widget) => widget.id)));
}

export function uniqueWidgetId(id, used) {
  let candidate = id;
  for (let number = 2; used.has(candidate); number += 1) {
    const suffix = `-${number}`;
    candidate = `${id.slice(0, 64 - suffix.length)}${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

export function normalizeWidgetIds(config) {
  const result = structuredClone(config);
  const reserved = widgetIds(result);
  const seen = new Set();
  for (const page of result.pages) for (const widget of page.widgets) {
    if (seen.has(widget.id)) widget.id = uniqueWidgetId(widget.id, reserved);
    seen.add(widget.id);
  }
  return result;
}
