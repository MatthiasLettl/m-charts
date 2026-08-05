import assert from 'node:assert/strict';

import { createParallelWebgpuBuffers } from '../../packages/m-charts/src/m-parallel-webgpu/index.ts';
import {
  createParallelRepresentativeSourceIndices,
  ParallelRepresentativeAccumulator,
} from '../../packages/m-charts/src/m-parallel-webgpu/core/representativeSampling.ts';

const count = 20_000;
const ordered = new Float32Array(count);
const signal = new Float32Array(count);
const category = new Uint8Array(count);
for (let index = 0; index < count; index += 1) {
  ordered[index] = index;
  signal[index] = 100 + Math.sin(index / 17);
  category[index] = index % 3;
}
signal[777] = -1_000;
signal[17_777] = 1_000;
category[12_345] = 3;

const buffers = createParallelWebgpuBuffers({
  axes: [
    { key: 'ordered', kind: 'numeric' },
    { key: 'signal', kind: 'numeric' },
    {
      categories: [0, 1, 2, 3].map((value) => ({ value })),
      key: 'category',
      kind: 'categorical',
    },
  ],
  axisOrder: ['ordered', 'signal', 'category'],
  ids: { length: count } as readonly string[],
  valuesByAxis: { category, ordered, signal },
});

const representatives = await createParallelRepresentativeSourceIndices(buffers, 128);
const repeated = await createParallelRepresentativeSourceIndices(buffers, 128);
const accumulator = new ParallelRepresentativeAccumulator(
  [{}, {}, { categories: [0, 1, 2, 3] }],
  count,
  128,
);
for (let sourceIndex = 0; sourceIndex < count; sourceIndex += 1) {
  accumulator.add(sourceIndex, [
    ordered[sourceIndex]!,
    signal[sourceIndex]!,
    category[sourceIndex]!,
  ]);
}
assert.deepEqual(
  accumulator.finish(),
  representatives,
  'incremental worker collection matches the compatibility scan',
);
assert.equal(representatives.length, 128);
assert.deepEqual(representatives, repeated);
assert.deepEqual(
  representatives,
  Uint32Array.from(representatives).sort(),
  'representatives remain in source order',
);
assert.equal(new Set(representatives).size, representatives.length);

const representativeSet = new Set(representatives);
assert.equal(representativeSet.has(0), true, 'ordered minimum is retained');
assert.equal(representativeSet.has(count - 1), true, 'ordered maximum is retained');
assert.equal(representativeSet.has(777), true, 'signal minimum is retained');
assert.equal(representativeSet.has(17_777), true, 'signal maximum is retained');
assert.equal(representativeSet.has(12_345), true, 'rare category is retained');
for (const value of [0, 1, 2, 3]) {
  assert.equal(
    representatives.some((sourceIndex) => category[sourceIndex] === value),
    true,
    `category ${value} is represented`,
  );
}
assert.equal(
  representatives.some((sourceIndex) => sourceIndex % Math.floor(count / 128) !== 0),
  true,
  'the fill sample is not a fixed source-order stride',
);
for (let quarter = 0; quarter < 4; quarter += 1) {
  assert.equal(
    representatives.some((sourceIndex) => {
      return sourceIndex >= quarter * 5_000 && sourceIndex < (quarter + 1) * 5_000;
    }),
    true,
    `source-order quarter ${quarter} is covered`,
  );
}

const bounded = await createParallelRepresentativeSourceIndices(buffers, 3);
assert.equal(bounded.length, 3);
assert.deepEqual(bounded, await createParallelRepresentativeSourceIndices(buffers, 3));
assert.equal(
  (await createParallelRepresentativeSourceIndices(buffers, count - 1)).length,
  count - 1,
);
const complete = await createParallelRepresentativeSourceIndices(buffers, count + 1);
assert.equal(complete.length, count);
assert.equal(complete[0], 0);
assert.equal(complete[count - 1], count - 1);
assert.equal((await createParallelRepresentativeSourceIndices(buffers, 0)).length, 0);

console.log('parallel WebGPU representative sampling tests passed');
