import { strict as assert } from 'node:assert';

import {
  calculatePointsPerPixel,
  createDensityGrid,
  decideEffectiveRenderingMode,
  findVisibleRecordIndexRange,
} from '../../apps/demo/src/data/density.ts';
import type { ScatterRecord } from '../../apps/demo/src/data/types.ts';

const records = Array.from({ length: 10 }, (_, index): ScatterRecord => ({
  a: index,
  b: index % 2 === 0 ? index : -index,
  c: 10 - index,
  category: 'core',
  color: '#2563EB',
  id: `pt-${index}`,
  opacity: 0.7,
  rotation: null,
  shape: 'circle',
  size: 3,
  styleGroup: 'default',
  x: index,
}));

assert.deepEqual(findVisibleRecordIndexRange(records, { min: 2, max: 6 }), {
  count: 5,
  end: 7,
  start: 2,
});

assert.deepEqual(findVisibleRecordIndexRange(records, { min: 6, max: 2 }), {
  count: 5,
  end: 7,
  start: 2,
});

assert.equal(
  decideEffectiveRenderingMode({
    plotWidthPx: 1000,
    requestedMode: 'points',
    visiblePointCount: 10_000,
  }),
  'points',
);

assert.equal(
  decideEffectiveRenderingMode({
    plotWidthPx: 1000,
    requestedMode: 'density',
    visiblePointCount: 10,
  }),
  'density',
);

assert.equal(
  decideEffectiveRenderingMode({
    plotWidthPx: 1000,
    requestedMode: 'auto',
    visiblePointCount: 100,
  }),
  'points',
);

assert.equal(
  decideEffectiveRenderingMode({
    plotWidthPx: 1000,
    requestedMode: 'auto',
    visiblePointCount: 750,
  }),
  'density',
);

assert.equal(
  decideEffectiveRenderingMode({
    plotWidthPx: 100,
    requestedMode: 'auto',
    visiblePointCount: 80,
    visiblePointThreshold: 10_000,
  }),
  'density',
);

assert.equal(calculatePointsPerPixel(50, 0), 50);
assert.equal(calculatePointsPerPixel(50, 100), 0.5);

const exactGrid = createDensityGrid(
  records,
  'a',
  { min: 0, max: 9 },
  { min: 0, max: 9 },
  { columns: 3, rows: 3, maxBinnedRecords: 100 },
);

assert.equal(exactGrid.columns, 3);
assert.equal(exactGrid.rows, 3);
assert.equal(exactGrid.visiblePointCount, 10);
assert.equal(exactGrid.sampledPointCount, 10);
assert.equal(exactGrid.stride, 1);
assert.equal(exactGrid.maxBinCount, 4);
assert.equal(exactGrid.values.length, 9);
assertApproximatelyEqual(exactGrid.values[0], Math.log1p(3));
assertApproximatelyEqual(exactGrid.values[4], Math.log1p(3));
assertApproximatelyEqual(exactGrid.values[8], Math.log1p(4));

const boundedGrid = createDensityGrid(
  records,
  'a',
  { min: 0, max: 9 },
  { min: 0, max: 9 },
  { columns: 3, rows: 3, maxBinnedRecords: 4 },
);

assert.equal(boundedGrid.visiblePointCount, 10);
assert.equal(boundedGrid.sampledPointCount, 4);
assert.equal(boundedGrid.stride, 3);
assert.equal(boundedGrid.maxBinCount, 4);

const yClippedGrid = createDensityGrid(
  records,
  'a',
  { min: 0, max: 9 },
  { min: 20, max: 30 },
  { columns: 3, rows: 3, maxBinnedRecords: 100 },
);

assert.equal(yClippedGrid.visiblePointCount, 10);
assert.equal(yClippedGrid.sampledPointCount, 0);
assert.equal(yClippedGrid.maxBinCount, 0);

function assertApproximatelyEqual(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `Expected ${actual} to be within 1e-6 of ${expected}`,
  );
}
