import assert from 'node:assert/strict';

import {
  MAX_PINNED_HOVER_RECORDS,
  findNearestRecord,
  pinHoverRecord,
} from '../../apps/demo/src/data/hover.ts';
import type { ScatterRecord } from '../../apps/demo/src/data/types.ts';

const records: ScatterRecord[] = [
  makeRecord('alpha', 0, 0, 10, 100),
  makeRecord('bravo', 5, 2, 20, 200),
  makeRecord('charlie', 10, 10, 30, 300),
];

assert.deepEqual(
  findNearestRecord({
    attribute: 'a',
    axisPoint: { x: 5.1, y: 2.1 },
    maxDistancePx: 20,
    plotHeightPx: 100,
    plotWidthPx: 100,
    records,
    xRange: { min: 0, max: 10 },
    yRange: { min: 0, max: 10 },
  })?.record.id,
  'bravo',
);

assert.equal(
  findNearestRecord({
    attribute: 'a',
    axisPoint: { x: 8, y: 8 },
    maxDistancePx: 10,
    plotHeightPx: 100,
    plotWidthPx: 100,
    records,
    xRange: { min: 0, max: 10 },
    yRange: { min: 0, max: 10 },
  }),
  null,
);

assert.deepEqual(
  findNearestRecord({
    attribute: 'b',
    axisPoint: { x: 5, y: 20 },
    maxDistancePx: 1,
    plotHeightPx: 100,
    plotWidthPx: 100,
    records,
    xRange: { min: 0, max: 10 },
    yRange: { min: 10, max: 30 },
  }),
  {
    distancePx: 0,
    record: records[1],
  },
);

assert.equal(
  findNearestRecord({
    attribute: 'c',
    axisPoint: { x: Number.NaN, y: 100 },
    maxDistancePx: 20,
    plotHeightPx: 100,
    plotWidthPx: 100,
    records,
    xRange: { min: 0, max: 10 },
    yRange: { min: 100, max: 300 },
  }),
  null,
);

assert.deepEqual(
  pinHoverRecord(
    [
      { activeAttribute: 'a', record: records[0] },
      { activeAttribute: 'b', record: records[1] },
    ],
    { activeAttribute: 'c', record: records[2] },
  ).map((pin) => [pin.activeAttribute, pin.record.id]),
  [
    ['c', 'charlie'],
    ['a', 'alpha'],
    ['b', 'bravo'],
  ],
);

assert.deepEqual(
  pinHoverRecord(
    [
      { activeAttribute: 'a', record: records[0] },
      { activeAttribute: 'b', record: records[1] },
      { activeAttribute: 'c', record: records[2] },
    ],
    { activeAttribute: 'b', record: records[1] },
  ).map((pin) => [pin.activeAttribute, pin.record.id]),
  [
    ['b', 'bravo'],
    ['a', 'alpha'],
    ['c', 'charlie'],
  ],
);

assert.deepEqual(
  pinHoverRecord(
    [
      { activeAttribute: 'a', record: records[0] },
      { activeAttribute: 'b', record: records[1] },
      { activeAttribute: 'c', record: records[2] },
    ],
    { activeAttribute: 'a', record: makeRecord('delta', 15, 3, 40, 400) },
  ).map((pin) => pin.record.id),
  ['delta', 'alpha', 'bravo'],
);

assert.equal(MAX_PINNED_HOVER_RECORDS, 3);

console.log('hover tests passed');

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
