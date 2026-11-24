import assert from 'node:assert/strict';
import { test } from 'node:test';
import { graphPieValues, stackGraphSeries } from '../www/fhem-cms/js/graph-data.js';
import { blueprintDevices, remapBlueprintDevice } from '../www/fhem-cms/js/fcui-schema5-blueprints.js';

test('graph blueprints discover and remap devices in all series', () => {
  const graph = {type: 'fhem-graph', series: [
    {device: 'Solar1', reading: 'power'}, {device: 'Solar2', reading: 'energy'},
    {device: 'Solar1', reading: 'energy'},
  ]};
  assert.deepEqual(blueprintDevices(graph), ['Solar1', 'Solar2']);
  const remapped = remapBlueprintDevice(graph, 'Solar1', 'Solar3');
  assert.deepEqual(remapped.series.map(row => row.device), ['Solar3', 'Solar2', 'Solar3']);
  assert.equal(graph.series[0].device, 'Solar1');
});

test('stack carries values forward only after their first observation', () => {
  assert.deepEqual(stackGraphSeries([
    [[3, 5], [1, 2], [3, 7]],
    [[2, 4], [4, 1]],
  ]), [
    [[1, 0, 2], [2, 0, 2], [3, 0, 7], [4, 0, 7]],
    [[1, null, null], [2, 2, 6], [3, 7, 11], [4, 7, 8]],
  ]);
});

test('stack separates positive and negative values and retains missing series', () => {
  assert.deepEqual(stackGraphSeries([[[1, -3]], [[1, 5]], [[1, -2]], []]), [
    [[1, 0, -3]], [[1, 0, 5]], [[1, -3, -5]], [[1, null, null]],
  ]);
  assert.deepEqual(stackGraphSeries([]), []);
  assert.throws(() => stackGraphSeries([[[1, NaN]]]), /Messwert/);
  assert.throws(() => stackGraphSeries([[[1, Number.MAX_VALUE]], [[1, Number.MAX_VALUE]]]), /zu groß/);
});

test('pie uses raw summaries, preserving missing and zero values', () => {
  const data = [
    {summary: {last: 8, average: 2}},
    {summary: {last: 0, average: 1}},
    {summary: null},
  ];
  assert.deepEqual(graphPieValues(data, 'last'), [8, 0, null]);
  assert.deepEqual(graphPieValues(data, 'average'), [2, 1, null]);
  assert.throws(() => graphPieValues(data, 'sum'), /Auswertung/);
  assert.throws(() => graphPieValues([{summary: {last: -1}}], 'last'), /nichtnegative/);
  assert.throws(() => graphPieValues([{truncated: true, summary: {last: 1}}], 'last'), /Gekürzte/);
  assert.throws(() => graphPieValues([{summary: {last: Infinity}}], 'last'), /nichtnegative/);
});
