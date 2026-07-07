import assert from 'node:assert/strict';

import {
  calculateFastScatterNavigatorWindowPixels,
  clampFastScatterNavigatorWindow,
  createFastScatterNavigatorSummary,
  dragFastScatterNavigatorWindow,
  resizeFastScatterNavigatorWindow,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';

const domain = { min: 0, max: 100 };
const summary = createFastScatterNavigatorSummary({
  binCount: 5,
  domain,
  x: new Float64Array([0, 5, 19, 21, 39, 40, 41, 99, 100]),
});

assert.equal(summary.bins.length, 5);
assert.deepEqual(
  summary.bins.map((bin) => bin.count),
  [3, 2, 2, 0, 2],
);
assert.equal(summary.maxCount, 3);
assert.equal(summary.bins[0]?.maxY, 1);

assert.deepEqual(
  calculateFastScatterNavigatorWindowPixels({ min: 25, max: 75 }, domain, 400),
  { leftCssPx: 100, widthCssPx: 200 },
);

assert.deepEqual(
  clampFastScatterNavigatorWindow({ min: 80, max: 140 }, domain),
  { min: 40, max: 100 },
);
assert.deepEqual(
  clampFastScatterNavigatorWindow({ min: -20, max: 20 }, domain),
  { min: 0, max: 40 },
);

const dragged = dragFastScatterNavigatorWindow({
  currentPointerCssX: 260,
  domain,
  startPointerCssX: 200,
  startWindow: { min: 20, max: 50 },
  widthCssPx: 300,
});
assertApproximatelyEqual(dragged.min, 40);
assertApproximatelyEqual(dragged.max, 70);

const draggedToEnd = dragFastScatterNavigatorWindow({
  currentPointerCssX: 600,
  domain,
  startPointerCssX: 200,
  startWindow: { min: 20, max: 50 },
  widthCssPx: 300,
});
assert.deepEqual(draggedToEnd, { min: 70, max: 100 });

const resizedMin = resizeFastScatterNavigatorWindow({
  currentPointerCssX: 150,
  domain,
  edge: 'min',
  minSpan: 10,
  startPointerCssX: 120,
  startWindow: { min: 20, max: 60 },
  widthCssPx: 300,
});
assertApproximatelyEqual(resizedMin.min, 30);
assert.equal(resizedMin.max, 60);

const resizedMax = resizeFastScatterNavigatorWindow({
  currentPointerCssX: 90,
  domain,
  edge: 'max',
  minSpan: 10,
  startPointerCssX: 150,
  startWindow: { min: 20, max: 60 },
  widthCssPx: 300,
});
assert.deepEqual(resizedMax, { min: 20, max: 40 });

const minimumSpan = resizeFastScatterNavigatorWindow({
  currentPointerCssX: 0,
  domain,
  edge: 'max',
  minSpan: 10,
  startPointerCssX: 150,
  startWindow: { min: 20, max: 60 },
  widthCssPx: 300,
});
assert.deepEqual(minimumSpan, { min: 20, max: 30 });

console.log('scatter-fast navigator tests passed');

function assertApproximatelyEqual(
  actual: number,
  expected: number,
  epsilon = 0.000001,
): void {
  assert.equal(
    Math.abs(actual - expected) <= epsilon,
    true,
    `${actual} should be within ${epsilon} of ${expected}`,
  );
}
