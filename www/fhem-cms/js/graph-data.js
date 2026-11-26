function validPoints(points) {
  if (!Array.isArray(points)) throw new Error('Ungültige Graph-Datenreihe');
  return points.map(point => {
    if (!Array.isArray(point) || point.length < 2
      || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      throw new Error('Ungültiger Graph-Messwert');
    }
    return [point[0], point[1]];
  }).sort((a, b) => a[0] - b[0]);
}

export function stackGraphSeries(series, linear = false) {
  if (!Array.isArray(series)) throw new Error('Ungültige Graph-Datenreihen');
  const rows = series.map(validPoints);
  const crossings = rows.map(() => new Set());
  if (linear) rows.forEach((points, index) => {
    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1], next = points[i];
      if (previous[0] === next[0] || !((previous[1] < 0 && next[1] > 0) || (previous[1] > 0 && next[1] < 0))) continue;
      const scale = Math.max(Math.abs(previous[1]), Math.abs(next[1]));
      const a = Math.abs(previous[1]) / scale, b = Math.abs(next[1]) / scale;
      const time = previous[0] + (next[0] - previous[0]) * a / (a + b);
      if (time > previous[0] && time < next[0]) crossings[index].add(time);
    }
  });
  const times = [...new Set(rows.flatMap((points, index) =>
    [...points.map(point => point[0]), ...crossings[index]]))].sort((a, b) => a - b);
  const positions = rows.map(() => 0);
  const values = rows.map(() => null);
  const stacked = rows.map(() => []);
  for (const time of times) {
    let positive = 0;
    let negative = 0;
    rows.forEach((points, index) => {
      while (positions[index] < points.length && points[positions[index]][0] <= time) {
        values[index] = points[positions[index]++][1];
      }
      let value = values[index];
      if (linear && value !== null && positions[index] < points.length) {
        const previous = points[positions[index] - 1];
        const next = points[positions[index]];
        const ratio = (time - previous[0]) / (next[0] - previous[0]);
        value = previous[1] * (1 - ratio) + next[1] * ratio;
        if (!Number.isFinite(value)) throw new Error('Graph-Zwischenwert ist zu groß');
      }
      if (crossings[index].has(time)) value = 0;
      if (value === null) {
        stacked[index].push([time, null, null]);
      } else if (value >= 0) {
        const base = positive;
        positive += value;
        if (!Number.isFinite(positive)) throw new Error('Graph-Summe ist zu groß');
        stacked[index].push([time, base, positive]);
      } else {
        const base = negative;
        negative += value;
        if (!Number.isFinite(negative)) throw new Error('Graph-Summe ist zu groß');
        stacked[index].push([time, base, negative]);
      }
    });
  }
  return stacked;
}

export function linearStackBands(stacked, index) {
  const row = stacked[index];
  const bands = [];
  let band = [], sign = 0, zeros = [];
  const zeroPoint = (point, position, direction) => {
    let base = 0;
    for (let i = 0; i < index; i++) {
      const previous = stacked[i][position];
      if (previous[1] === null) continue;
      const value = previous[2] - previous[1];
      if (direction > 0 ? value > 0 : value < 0) base += value;
    }
    return [point[0], base, base];
  };
  row.forEach((point, position) => {
    if (point[1] === null) return;
    const direction = Math.sign(point[2] - point[1]);
    if (!direction) {
      zeros.push({point, position});
      return;
    }
    if (sign && direction !== sign) {
      band.push(...zeros.map(({point: p, position: pos}) => zeroPoint(p, pos, sign)));
      if (band.length) bands.push(band);
      band = [];
    }
    band.push(...zeros.map(({point: p, position: pos}) => zeroPoint(p, pos, direction)));
    zeros = [];
    band.push(point);
    sign = direction;
  });
  band.push(...zeros.map(({point, position}) => zeroPoint(point, position, sign || 1)));
  if (band.length) bands.push(band);
  return bands;
}

export function graphPieValues(results, aggregation) {
  if (!Array.isArray(results) || !['last', 'average', 'min', 'max'].includes(aggregation)) {
    throw new Error('Ungültige Torten-Auswertung');
  }
  return results.map(result => {
    if (result?.truncated) throw new Error('Gekürzte Daten können nicht als Tortendiagramm ausgewertet werden');
    if (!result?.summary) return null;
    const value = result.summary[aggregation];
    if (!Number.isFinite(value)) throw new Error('Tortenauswertung nicht verfügbar; aktuelles FHEMCMS-Backend erforderlich');
    return value;
  });
}
