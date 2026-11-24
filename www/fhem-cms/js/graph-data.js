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

export function stackGraphSeries(series) {
  if (!Array.isArray(series)) throw new Error('Ungültige Graph-Datenreihen');
  const rows = series.map(validPoints);
  const times = [...new Set(rows.flatMap(points => points.map(point => point[0])))].sort((a, b) => a - b);
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
      const value = values[index];
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

export function graphPieValues(results, aggregation) {
  if (!Array.isArray(results) || !['last', 'average'].includes(aggregation)) {
    throw new Error('Ungültige Torten-Auswertung');
  }
  return results.map(result => {
    if (result?.truncated) throw new Error('Gekürzte Daten können nicht als Tortendiagramm ausgewertet werden');
    if (!result?.summary) return null;
    const value = result.summary[aggregation];
    if (!Number.isFinite(value) || value < 0) throw new Error('Tortendiagramme benötigen nichtnegative Werte');
    return value;
  });
}
