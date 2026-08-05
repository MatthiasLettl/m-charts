import assert from 'node:assert/strict';

import {
  createParallelFastBuffers,
  selectParallelRecordIdsByBrushes,
  type ParallelFastColumns,
} from '../../packages/m-charts/src/m-parallel/index.ts';
import {
  ParallelWebgpuWasmSelectionSession,
} from '../../packages/m-charts/src/m-parallel-webgpu/index.ts';

const count = 10_000;
const x = new Float32Array(count);
const y = new Float64Array(count);
const category = new Uint8Array(count);
const bucket = new Uint16Array(count);
const counter = new Uint32Array(count);
for (let index = 0; index < count; index += 1) {
  x[index] = index % 101;
  y[index] = (index * 17) % 211;
  category[index] = index % 4;
  bucket[index] = index % 400;
  counter[index] = index;
}
const columns: ParallelFastColumns = {
  axisOrder: ['x', 'y', 'category', 'bucket', 'counter'],
  axes: [
    { key: 'x', kind: 'numeric' },
    { key: 'y', kind: 'numeric' },
    { key: 'category', kind: 'numeric' },
    { key: 'bucket', kind: 'numeric' },
    { key: 'counter', kind: 'numeric' },
  ],
  ids: new Array<string>(count),
  valuesByAxis: { bucket, category, counter, x, y },
};
const buffers = createParallelFastBuffers(columns, {
  compactTypedColumns: true,
  includeLineSeriesBuffers: false,
});
const brushes = {
  bucket: { max: 300, min: 100 },
  category: { max: 3, min: 1 },
  counter: { max: 8_000, min: 2_000 },
  x: [
    { max: 20, min: 10 },
    { max: 80, min: 70 },
  ],
  y: { max: 150, min: 50 },
};
const session = ParallelWebgpuWasmSelectionSession.create(buffers);
assert.notEqual(session, null);
const wasm = session!.select(brushes);
const typescript = selectParallelRecordIdsByBrushes(buffers, brushes);
assert.deepEqual([...wasm.sourceIndices], [...typescript.sourceIndices]);
assert.equal(wasm.selectedCount, typescript.selectedCount);
assert.ok(session!.residentBytes > 0);

console.log('parallel WebGPU WASM selection tests passed');
