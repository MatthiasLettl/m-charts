import assert from 'node:assert/strict';

import { buildFastScatterSelectedMask } from '../../packages/m-charts/src/m-scatter/core/index.ts';

const mask = new Uint8Array(12);
const result = buildFastScatterSelectedMask(
  mask,
  new Uint32Array([0, 3, 3, 9, 12, 99]),
  10,
);

assert.equal(result.selectedPointCount, 3);
assert.deepEqual(Array.from(mask), [255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 0]);

const clearedResult = buildFastScatterSelectedMask(mask, new Uint32Array(0), 10);

assert.equal(clearedResult.selectedPointCount, 0);
assert.deepEqual(Array.from(mask), new Array<number>(12).fill(0));

console.log('scatter-fast selected mask tests passed');
