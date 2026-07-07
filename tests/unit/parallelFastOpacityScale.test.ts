import assert from 'node:assert/strict';

import {
  formatLineOpacityScaleParam,
  getNextLineOpacityScale,
  getPreviousLineOpacityScale,
  parseLineOpacityScaleSearchParam,
  snapLineOpacityScaleToStep,
} from '../../packages/m-charts/src/m-parallel/core/index.ts';

assert.equal(parseLineOpacityScaleSearchParam(new URLSearchParams('')), 1);
assert.equal(
  parseLineOpacityScaleSearchParam(new URLSearchParams('lineOpacityScale=bad')),
  1,
);
assert.equal(
  parseLineOpacityScaleSearchParam(new URLSearchParams('lineOpacityScale=-1')),
  1,
);
assert.equal(
  parseLineOpacityScaleSearchParam(new URLSearchParams('lineOpacityScale=1.26')),
  1.25,
);
assert.equal(
  parseLineOpacityScaleSearchParam(new URLSearchParams('lineOpacityScale=2.45')),
  2.5,
);
assert.equal(
  parseLineOpacityScaleSearchParam(new URLSearchParams('lineOpacityScale=3.6')),
  3.5,
);
assert.equal(
  parseLineOpacityScaleSearchParam(new URLSearchParams('lineOpacityScale=4')),
  4,
);
assert.equal(
  parseLineOpacityScaleSearchParam(new URLSearchParams('lineOpacityScale=7.4')),
  8,
);

assert.equal(snapLineOpacityScaleToStep(0.07), 0.05);
assert.equal(snapLineOpacityScaleToStep(0.14), 0.15);
assert.equal(snapLineOpacityScaleToStep(1.4), 1.5);
assert.equal(snapLineOpacityScaleToStep(1.8), 1.75);
assert.equal(snapLineOpacityScaleToStep(3.4), 3.5);
assert.equal(snapLineOpacityScaleToStep(7.2), 8);

assert.equal(getPreviousLineOpacityScale(0.05), 0.05);
assert.equal(getPreviousLineOpacityScale(1), 0.75);
assert.equal(getNextLineOpacityScale(1), 1.25);
assert.equal(getPreviousLineOpacityScale(5), 4);
assert.equal(getNextLineOpacityScale(4), 5);
assert.equal(getNextLineOpacityScale(8), 8);

assert.equal(formatLineOpacityScaleParam(1), '1');
assert.equal(formatLineOpacityScaleParam(1.25), '1.25');
assert.equal(formatLineOpacityScaleParam(0.05), '0.05');
assert.equal(formatLineOpacityScaleParam(8), '8');

console.log('parallel-fast opacity scale tests passed');
