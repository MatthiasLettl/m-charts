import assert from 'node:assert/strict';

import {
  getSelectionPolygonBounds,
  isPointInPolygon,
  normalizeSelectionBounds,
  sampleRecordIds,
  serializeRecordIdsForExport,
  selectRecordIdsInBounds,
  selectRecordIdsInPolygon,
  type SelectionBounds,
} from '../../apps/demo/src/data/selection.ts';
import type { ScatterRecord } from '../../apps/demo/src/data/types.ts';

const records: ScatterRecord[] = [
  makeRecord('alpha', 0, -1, 10, 100),
  makeRecord('bravo', 5, 0, 20, 200),
  makeRecord('charlie', 10, 1, 30, 300),
  makeRecord('delta', 15, 2, 40, 400),
];

const reversedBounds: SelectionBounds = {
  attribute: 'a',
  x: { min: 12, max: 4 },
  y: { min: 1.5, max: -0.5 },
};

assert.deepEqual(normalizeSelectionBounds(reversedBounds), {
  attribute: 'a',
  x: { min: 4, max: 12 },
  y: { min: -0.5, max: 1.5 },
});

assert.deepEqual(selectRecordIdsInBounds(records, reversedBounds).ids, [
  'bravo',
  'charlie',
]);

assert.deepEqual(
  selectRecordIdsInBounds(records, {
    attribute: 'b',
    x: { min: 0, max: 10 },
    y: { min: 10, max: 20 },
  }).ids,
  ['alpha', 'bravo'],
);

assert.deepEqual(
  selectRecordIdsInBounds(records, {
    attribute: 'c',
    x: { min: 10, max: 20 },
    y: { min: 250, max: 350 },
  }).ids,
  ['charlie'],
);

const polygon = {
  attribute: 'a',
  points: [
    { x: 2, y: -0.5 },
    { x: 12, y: -0.5 },
    { x: 12, y: 1.5 },
    { x: 2, y: 1.5 },
  ],
} as const;

assert.deepEqual(getSelectionPolygonBounds(polygon), {
  attribute: 'a',
  x: { min: 2, max: 12 },
  y: { min: -0.5, max: 1.5 },
});
assert.equal(isPointInPolygon({ x: 5, y: 0 }, polygon.points), true);
assert.equal(isPointInPolygon({ x: 2, y: -0.5 }, polygon.points), true);
assert.equal(isPointInPolygon({ x: 15, y: 0 }, polygon.points), false);
assert.equal(isPointInPolygon({ x: Number.NaN, y: 0 }, polygon.points), false);
assert.deepEqual(selectRecordIdsInPolygon(records, polygon).ids, [
  'bravo',
  'charlie',
]);
assert.deepEqual(
  selectRecordIdsInPolygon(records, {
    attribute: 'b',
    points: [
      { x: -1, y: 9 },
      { x: 7, y: 9 },
      { x: 7, y: 25 },
      { x: -1, y: 25 },
    ],
  }).ids,
  ['alpha', 'bravo'],
);
assert.deepEqual(
  selectRecordIdsInPolygon(records, {
    attribute: 'a',
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  }).ids,
  [],
);

assert.deepEqual(sampleRecordIds(['a', 'b', 'c'], 2), ['a', 'b']);
assert.deepEqual(sampleRecordIds(['a', 'b', 'c'], 0), []);
assert.equal(serializeRecordIdsForExport(['a', 'b', 'c']), 'a\nb\nc');
assert.equal(serializeRecordIdsForExport(new Set(['alpha', 'bravo'])), 'alpha\nbravo');
assert.equal(serializeRecordIdsForExport([]), '');

console.log('selection tests passed');

function makeRecord(
  id: string,
  x: number,
  a: number,
  b: number,
  c: number,
): ScatterRecord {
  return {
    a,
    b,
    c,
    category: 'core',
    color: '#2563EB',
    id,
    opacity: 0.72,
    rotation: 45,
    shape: 'circle',
    size: 3,
    styleGroup: 'default',
    x,
  };
}
