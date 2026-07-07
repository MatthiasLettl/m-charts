import assert from 'node:assert/strict';

import { createParallelFastBuffers } from '../../packages/m-charts/src/m-parallel/core/index.ts';
import { applyParallelColorRules } from '../../packages/m-charts/src/m-parallel/react/colorRules.ts';

const buffers = createParallelFastBuffers({
  axisOrder: ['temp', 'pressure'],
  color: new Uint8Array([
    10, 20, 30, 255,
    40, 50, 60, 200,
    70, 80, 90, 180,
  ]),
  colorFormat: 'rgba8',
  ids: ['a', 'b', 'c'],
  valuesByAxis: {
    pressure: new Float64Array([100, 110, 120]),
    temp: new Float64Array([0, 5, 10]),
  },
});

const fixed = applyParallelColorRules(buffers, [
  {
    axis: 'temp',
    color: '#112233',
    id: 'fixed',
    kind: 'fixed',
    range: { max: 6, min: 4 },
  },
]);

assert.notEqual(fixed, buffers);
assert.deepEqual(Array.from(fixed.styleBuffers?.color ?? []), [
  10, 20, 30, 255,
  17, 34, 51, 200,
  70, 80, 90, 180,
]);
assert.deepEqual(Array.from(buffers.styleBuffers?.color ?? []), [
  10, 20, 30, 255,
  40, 50, 60, 200,
  70, 80, 90, 180,
]);

const gradient = applyParallelColorRules(buffers, [
  {
    axis: 'temp',
    endColor: '#ffffff',
    id: 'gradient',
    kind: 'gradient',
    range: { max: 10, min: 0 },
    startColor: '#000000',
  },
]);

assert.deepEqual(Array.from(gradient.styleBuffers?.color ?? []), [
  0, 0, 0, 255,
  128, 128, 128, 200,
  255, 255, 255, 180,
]);

console.log('parallel-fast color rule tests passed');
