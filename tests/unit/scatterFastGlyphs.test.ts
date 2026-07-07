import assert from 'node:assert/strict';

import {
  analyzeFastScatterCanvasBands,
  analyzeFastScatterCanvasPixels,
  createFastScatterGlyphVisibilitySignatures,
  fastScatterGlyphSignaturesAreDistinct,
} from '../../packages/m-charts/src/m-scatter/testing/pixelChecks.ts';
import { createFastScatterGlyphFixture } from '../../packages/m-charts/src/m-scatter/testing/fixtures.ts';

const fixture = createFastScatterGlyphFixture();

assert.deepEqual(Array.from(fixture.columns.shape), [0, 1, 2, 3, 4]);
assert.deepEqual(Array.from(fixture.columns.color), [
  0,
  0,
  0,
  255,
  0,
  0,
  0,
  255,
  255,
  0,
  0,
  255,
  0,
  128,
  255,
  255,
  124,
  58,
  237,
  255,
]);
assert.deepEqual(Array.from(fixture.columns.opacity), [1, 1, 0.5, 0.75, 1]);
assert.deepEqual(Array.from(fixture.columns.size), [18, 18, 20, 22, 24]);
assert.equal(fixture.columns.rotationDegrees[2], 90);
assert.equal(fixture.columns.rotationDegrees[3], 45);
assertApproximatelyEqual(fixture.columns.rotationRadians[2], Math.PI / 2);
assert.deepEqual(fixture.columns.ids, ['circle', 'rectangle', 'triangle', 'pin', 'arrow']);
assert.equal(fixture.spec.plots.length, 1);
assert.equal(fixture.columns.x.length, 5);

const signatures = createFastScatterGlyphVisibilitySignatures().toSorted(
  (left, right) => left.code - right.code,
);
assert.equal(signatures.length, 5);
assert.equal(fastScatterGlyphSignaturesAreDistinct(signatures), true);
assert.deepEqual(
  signatures.map((signature) => signature.filledPixels),
  [197, 289, 145, 85, 99],
);

const pixelStats = analyzeFastScatterCanvasPixels(
  new Uint8ClampedArray([
    246, 249, 252, 255,
    246, 249, 252, 255,
    10, 20, 30, 255,
    246, 249, 252, 255,
  ]),
  2,
  2,
);
assert.equal(pixelStats.sampled, 4);
assert.equal(pixelStats.differentFromFirst, 1);

const bandStats = analyzeFastScatterCanvasBands(
  new Uint8ClampedArray([
    246, 249, 252, 255,
    246, 249, 252, 255,
    40, 40, 40, 255,
    246, 249, 252, 255,
    246, 249, 252, 255,
    60, 60, 60, 255,
  ]),
  2,
  3,
  3,
);
assert.deepEqual(
  bandStats.map((stats) => stats.differentFromPlotBackground),
  [0, 1, 1],
);

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
