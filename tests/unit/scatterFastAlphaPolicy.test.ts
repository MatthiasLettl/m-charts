import assert from 'node:assert/strict';

import { resolveFastScatterAlphaPolicy } from '../../packages/m-charts/src/m-scatter/core/index.ts';

const normal = resolveFastScatterAlphaPolicy({
  plotAreaPx: 10_000,
  pointCount: 5_000,
});
assert.equal(normal.mode, 'normal-alpha');
assert.equal(normal.alphaScale, 1);
assert.equal(normal.pointSizeScale, 1);
assert.equal(normal.blendMode, 'src-alpha-one-minus-src-alpha');
assert.equal(normal.densityPointsPerPixel, 0.5);
assert.equal(normal.requestedRenderingMode, 'points');
assert.equal(normal.effectiveRenderingMode, 'points');
assert.equal(normal.renderingPolicy, 'point-rendering');

const adaptive = resolveFastScatterAlphaPolicy({
  plotAreaPx: 10_000,
  pointCount: 40_000,
});
assert.equal(adaptive.mode, 'adaptive-alpha');
assert.equal(adaptive.blendMode, 'src-alpha-one-minus-src-alpha');
assert.equal(adaptive.pointSizeScale, 1);
assertApproximatelyEqual(adaptive.alphaScale, 0.425);
assert.equal(adaptive.densityPointsPerPixel, 4);

const adaptiveFloor = resolveFastScatterAlphaPolicy({
  plotAreaPx: 10_000,
  pointCount: 170_000,
});
assert.equal(adaptiveFloor.mode, 'adaptive-alpha');
assertApproximatelyEqual(adaptiveFloor.alphaScale, 0.1);

const performance = resolveFastScatterAlphaPolicy({
  plotAreaPx: 10_000,
  pointCount: 250_000,
});
assert.equal(performance.mode, 'performance');
assert.equal(performance.alphaScale, 0.035);
assert.equal(performance.pointSizeScale, 0.75);
assert.equal(performance.blendMode, 'src-alpha-one-minus-src-alpha');

const pointsRequested = resolveFastScatterAlphaPolicy({
  plotAreaPx: 10_000,
  pointCount: 250_000,
  requestedRenderingMode: 'points',
});
assert.equal(pointsRequested.requestedRenderingMode, 'points');
assert.equal(pointsRequested.effectiveRenderingMode, 'points');
assert.equal(pointsRequested.renderingPolicy, 'point-rendering');

function assertApproximatelyEqual(
  actual: number,
  expected: number,
  epsilon = 0.000001,
): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}
