export function sliderCommands(sets) {
  if (typeof sets !== 'string') return [];
  const result = [];
  const pattern = /(?:^|\s)([A-Za-z0-9_.-]+):slider,([-+]?(?:\d+(?:\.\d*)?|\.\d+)),([-+]?(?:\d+(?:\.\d*)?|\.\d+)),([-+]?(?:\d+(?:\.\d*)?|\.\d+))(?=\s|$)/g;
  for (const match of sets.matchAll(pattern)) {
    const [min, step, max] = match.slice(2).map(Number);
    const count = (max - min) / step;
    if (![min, step, max].every(Number.isFinite) || step <= 0 || max <= min
      || !Number.isFinite(count) || count > 10000) continue;
    result.push({ command: match[1], min, step, max });
  }
  return result;
}
