import assert from 'node:assert/strict';

import {
  formatOpacityScaleParam,
  getNextOpacityScale,
  getPreviousOpacityScale,
  normalizeFastScatterOpacityScale,
  parseOpacityScaleSearchParam,
  snapOpacityScaleToStep,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';

assert.equal(normalizeFastScatterOpacityScale(undefined), 1);
assert.equal(normalizeFastScatterOpacityScale(Number.NaN), 1);
assert.equal(normalizeFastScatterOpacityScale(0), 1);
assert.equal(normalizeFastScatterOpacityScale(-1), 1);
assert.equal(normalizeFastScatterOpacityScale(0.01), 0.05);
assert.equal(normalizeFastScatterOpacityScale(10), 8);
assert.equal(normalizeFastScatterOpacityScale(1.25), 1.25);

assert.equal(parseOpacityScaleSearchParam(new URLSearchParams('')), 1);
assert.equal(parseOpacityScaleSearchParam(new URLSearchParams('opacityScale=bad')), 1);
assert.equal(parseOpacityScaleSearchParam(new URLSearchParams('opacityScale=-1')), 1);
assert.equal(parseOpacityScaleSearchParam(new URLSearchParams('opacityScale=1.26')), 1.25);
assert.equal(parseOpacityScaleSearchParam(new URLSearchParams('opacityScale=2.45')), 2.5);
assert.equal(parseOpacityScaleSearchParam(new URLSearchParams('opacityScale=3.6')), 3.5);
assert.equal(parseOpacityScaleSearchParam(new URLSearchParams('opacityScale=4.6')), 5);
assert.equal(parseOpacityScaleSearchParam(new URLSearchParams('opacityScale=7.2')), 8);
assert.equal(parseOpacityScaleSearchParam(new URLSearchParams('opacityScale=4')), 4);
assert.equal(parseOpacityScaleSearchParam(new URLSearchParams('opacityScale=8')), 8);

assert.equal(snapOpacityScaleToStep(0.07), 0.05);
assert.equal(snapOpacityScaleToStep(0.14), 0.15);
assert.equal(snapOpacityScaleToStep(1.4), 1.5);
assert.equal(snapOpacityScaleToStep(1.8), 1.75);
assert.equal(snapOpacityScaleToStep(3.4), 3.5);
assert.equal(snapOpacityScaleToStep(4.7), 5);
assert.equal(snapOpacityScaleToStep(6.8), 6);

assert.equal(getPreviousOpacityScale(0.05), 0.05);
assert.equal(getPreviousOpacityScale(1), 0.75);
assert.equal(getNextOpacityScale(1), 1.25);
assert.equal(getNextOpacityScale(1.5), 1.75);
assert.equal(getNextOpacityScale(4), 5);
assert.equal(getNextOpacityScale(6), 8);
assert.equal(getNextOpacityScale(8), 8);

assert.equal(formatOpacityScaleParam(1), '1');
assert.equal(formatOpacityScaleParam(1.25), '1.25');
assert.equal(formatOpacityScaleParam(0.05), '0.05');
assert.equal(formatOpacityScaleParam(4), '4');
assert.equal(formatOpacityScaleParam(8), '8');

console.log('scatter-fast opacity scale tests passed');
