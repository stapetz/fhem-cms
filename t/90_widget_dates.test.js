import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDateDisplay } from '../www/fhem-cms/js/date-display.js';
import { formatValue, substitute } from '../www/fhem-cms/js/freehtml.js';

test('widget dates use German calendar dates and Berlin timestamps without changing raw values', () => {
  for (const [raw, expected] of [
    ['2024-02-29','29.02.2024'],
    ['2026-01-01','01.01.2026'],
    ['2026-11-14 08:09:10','14.11.2026 08:09:10'],
    ['2026-11-14T08:09','14.11.2026 08:09:00'],
    ['2026-11-14T23:30:00Z','15.11.2026 00:30:00'],
    ['2026-06-01T22:30:00.123456Z','02.06.2026 00:30:00'],
    ['2026-11-14T23:30:00-03:00','15.11.2026 03:30:00'],
    ['2026-11-14T23:30:00+0530','14.11.2026 19:00:00'],
    ['2026-03-29T01:30:00Z','29.03.2026 03:30:00'],
    ['2026-10-25T01:30:00Z','25.10.2026 02:30:00'],
    ['14.11.2026 08:09','14.11.2026 08:09:00'],
    ['29.02.2024','29.02.2024'],
  ]) {
    assert.equal(formatDateDisplay(raw), expected, raw);
    assert.equal(formatValue(raw, ''), expected, `placeholder ${raw}`);
    assert.equal(substitute('Zeit: {{Car:time}}', () => raw), `Zeit: ${expected}`);
  }
  assert.equal(formatDateDisplay(new Date('2026-11-14T23:30:00Z')), '15.11.2026');
});

test('date formatting leaves invalid dates, unknown formats, numbers, durations and labels intact', () => {
  for (const raw of ['2025-02-29','2026-02-30','2026-00-01','2026-13-01','0000-01-01',
    '2026-11-14T24:00:00','2026-11-14T23:60:00Z','2026-11-14T23:30:60Z',
    '2026-11-14T23:30:00+24:00','2026-11-14T23:30:00+02:60',
    '31.02.2026','2026','14.11.26','01:05 h','1234','x 2026-11-14', '', 0, null, undefined]) {
    assert.equal(formatDateDisplay(raw), raw);
  }
  assert.equal(formatValue('12.345', 'round(1)'), '12.3');
  assert.equal(formatDateDisplay(new Date(NaN)), 'Invalid Date');
});
