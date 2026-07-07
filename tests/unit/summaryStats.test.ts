import assert from 'node:assert/strict';

import {
  createCompareSummaries,
  createSelectedCompareSummary,
  createVisibleCompareSummary,
  summarizeMetricValues,
} from '../../apps/demo/src/data/summaryStats.ts';
import type { ScatterRecord } from '../../apps/demo/src/data/types.ts';
import type { ViewportState } from '../../apps/demo/src/state/viewSearchParams.ts';

const records: ScatterRecord[] = [
  makeRecord('alpha', 0, -2, 10, 100),
  makeRecord('bravo', 5, 0, 20, 200),
  makeRecord('charlie', 10, 2, 30, 300),
  makeRecord('delta', 15, 4, 40, 400),
];

const viewport: ViewportState = {
  a: { min: -1, max: 3 },
  b: { min: 15, max: 35 },
  c: { min: 0, max: 250 },
  x: { min: 3, max: 12 },
};

assert.deepEqual(summarizeMetricValues([1, 2, 3, Number.NaN]), {
  count: 3,
  max: 3,
  mean: 2,
  min: 1,
});

assert.deepEqual(summarizeMetricValues([]), {
  count: 0,
  max: null,
  mean: null,
  min: null,
});

assert.deepEqual(createVisibleCompareSummary(records, viewport), {
  a: { count: 2, max: 2, mean: 1, min: 0 },
  b: { count: 2, max: 30, mean: 25, min: 20 },
  c: { count: 1, max: 200, mean: 200, min: 200 },
});

assert.deepEqual(
  createSelectedCompareSummary(records, new Set(['alpha', 'delta'])),
  {
    a: { count: 2, max: 4, mean: 1, min: -2 },
    b: { count: 2, max: 40, mean: 25, min: 10 },
    c: { count: 2, max: 400, mean: 250, min: 100 },
  },
);

assert.deepEqual(createSelectedCompareSummary(records, new Set()), {
  a: { count: 0, max: null, mean: null, min: null },
  b: { count: 0, max: null, mean: null, min: null },
  c: { count: 0, max: null, mean: null, min: null },
});

const combined = createCompareSummaries(records, viewport, new Set(['bravo']));

assert.deepEqual(combined.selected.a, { count: 1, max: 0, mean: 0, min: 0 });
assert.deepEqual(combined.visible.b, { count: 2, max: 30, mean: 25, min: 20 });

console.log('summary stats tests passed');

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
