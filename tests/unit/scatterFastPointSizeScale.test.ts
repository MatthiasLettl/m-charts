import assert from 'node:assert/strict';

import {
  formatPointSizeScaleParam,
  getNextPointSizeScale,
  getPreviousPointSizeScale,
  normalizeFastScatterPointSizeScale,
  parsePointSizeScaleSearchParam,
  snapPointSizeScaleToStep,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';

assert.equal(normalizeFastScatterPointSizeScale(undefined), 1);
assert.equal(normalizeFastScatterPointSizeScale(Number.NaN), 1);
assert.equal(normalizeFastScatterPointSizeScale(0), 1);
assert.equal(normalizeFastScatterPointSizeScale(-1), 1);
assert.equal(normalizeFastScatterPointSizeScale(0.01), 0.1);
assert.equal(normalizeFastScatterPointSizeScale(20), 10);
assert.equal(normalizeFastScatterPointSizeScale(1.25), 1.25);

assert.equal(parsePointSizeScaleSearchParam(new URLSearchParams('')), 1);
assert.equal(parsePointSizeScaleSearchParam(new URLSearchParams('sizeScale=bad')), 1);
assert.equal(parsePointSizeScaleSearchParam(new URLSearchParams('sizeScale=-1')), 1);
assert.equal(parsePointSizeScaleSearchParam(new URLSearchParams('sizeScale=1.26')), 1.25);
assert.equal(parsePointSizeScaleSearchParam(new URLSearchParams('sizeScale=9')), 8);
assert.equal(parsePointSizeScaleSearchParam(new URLSearchParams('sizeScale=10')), 10);

assert.equal(snapPointSizeScaleToStep(0.11), 0.1);
assert.equal(snapPointSizeScaleToStep(0.14), 0.15);
assert.equal(snapPointSizeScaleToStep(1.4), 1.5);
assert.equal(snapPointSizeScaleToStep(7), 6);

assert.equal(getPreviousPointSizeScale(0.1), 0.1);
assert.equal(getPreviousPointSizeScale(1), 0.75);
assert.equal(getNextPointSizeScale(1), 1.25);
assert.equal(getNextPointSizeScale(10), 10);

assert.equal(formatPointSizeScaleParam(1), '1');
assert.equal(formatPointSizeScaleParam(1.25), '1.25');
assert.equal(formatPointSizeScaleParam(0.1), '0.1');
assert.equal(formatPointSizeScaleParam(10), '10');

console.log('scatter-fast point-size scale tests passed');
