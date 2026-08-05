import assert from 'node:assert/strict';

import {
  createParallelWebgpuBuffers,
  selectParallelRecordIdsByBrushes,
  type ParallelFastColumns,
} from '../../packages/m-charts/src/m-parallel-webgpu/index.ts';
import { selectParallelRecordsFromCandidateMask } from '../../packages/m-charts/src/m-parallel-webgpu/core/selectionCandidates.ts';

const x = new Float64Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const category = new Uint8Array([0, 1, 1, 2, 1, 2, 1, 0, 1, 2]);
const columns: ParallelFastColumns = {
  axes: [
    { key: 'x', kind: 'numeric' },
    { key: 'category', kind: 'numeric' },
  ],
  axisOrder: ['x', 'category'],
  ids: new Array<string>(x.length),
  valuesByAxis: { category, x },
};
const buffers = createParallelWebgpuBuffers(columns);
const brushes = {
  category: { max: 1, min: 1 },
  x: [
    { max: 3, min: 1 },
    { max: 8, min: 6 },
  ],
};
const expected = selectParallelRecordIdsByBrushes(buffers, brushes);
const candidateMask = new Uint32Array([0xffff_ffff]);
const actual = selectParallelRecordsFromCandidateMask(
  buffers,
  brushes,
  candidateMask,
);

assert.deepEqual([...actual.sourceIndices], [...expected.sourceIndices]);
assert.equal(actual.selectedCount, expected.selectedCount);
assert.equal(actual.activeBrushes.length, expected.activeBrushes.length);
assert.equal(typeof actual.sourceIndexCreationMs, 'number');

console.log('parallel WebGPU selection candidate tests passed');
