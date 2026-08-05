import assert from 'node:assert/strict';

import {
  createParallelWebgpuBuffers,
  selectParallelRecordIdsByBrushes,
  type ParallelFastColumns,
} from '../../packages/m-charts/src/m-parallel-webgpu/index.ts';

const count = 1_001;
const timestamp = new Float32Array(count);
const phase = new Uint8Array(count);
const accepted = new Uint8Array(count);
const signal = new Float32Array(count);
const color = new Uint8Array(count * 4);
for (let index = 0; index < count; index += 1) {
  timestamp[index] = index / (count - 1);
  phase[index] = index % 4;
  accepted[index] = index % 2;
  signal[index] = index * 0.25;
  color[index * 4] = index % 256;
  color[index * 4 + 3] = 255;
}
const columns: ParallelFastColumns = {
  axes: [
    { key: 'timestamp', kind: 'numeric' },
    {
      categories: [0, 1, 2, 3].map((value) => ({ value })),
      key: 'phase',
      kind: 'categorical',
    },
    { key: 'accepted', kind: 'boolean' },
    { key: 'signal', kind: 'numeric' },
  ],
  axisOrder: ['timestamp', 'phase', 'accepted', 'signal'],
  color,
  colorFormat: 'rgba8',
  ids: { length: count } as readonly string[],
  valuesByAxis: { accepted, phase, signal, timestamp },
};

const buffers = createParallelWebgpuBuffers(columns);

assert.equal(buffers.lineSeriesBuffers.sampleCount, 0);
assert.strictEqual(buffers.rawValuesByAxis.timestamp, timestamp);
assert.strictEqual(buffers.rawValuesByAxis.phase, phase);
assert.strictEqual(buffers.rawValuesByAxis.accepted, accepted);
assert.strictEqual(buffers.rawValuesByAxis.signal, signal);
assert.equal(buffers.normalizedValuesDerivedFromRaw, true);
assert.equal(buffers.normalizedValuesByAxis.timestamp.length, 0);
assert.equal(buffers.normalizedValuesByAxis.phase.length, 0);
assert.strictEqual(buffers.styleBuffers?.color, color);
assert.equal(buffers.styleBuffers?.opacity.length, 0);

const packedData = {
  async *createPages() {
    yield {
      count,
      densityStyles: new Uint32Array(Math.ceil(count / 2)),
      start: 0,
      values: new Uint32Array(Math.ceil((count * 4) / 2)),
    };
  },
};
const prepared = createParallelWebgpuBuffers(columns, {
  packedData,
  preparedDomainsByAxis: {
    accepted: { max: 1.5, min: -0.5, span: 2 },
    phase: { max: 3.5, min: -0.5, span: 4 },
    signal: { max: 999, min: -1, span: 1_000 },
    timestamp: { max: 1, min: 0, span: 1 },
  },
  preparedMissingValueCountByAxis: {
    accepted: 0,
    phase: 0,
    signal: 7,
    timestamp: 0,
  },
  trustedEncodedTypedColumns: true,
});
assert.strictEqual(prepared.webgpuPackedData, packedData);
assert.deepEqual(prepared.domainsByAxis.signal, { max: 999, min: -1, span: 1_000 });
assert.equal(prepared.missingValueCountByAxis?.signal, 7);

const selected = selectParallelRecordIdsByBrushes(buffers, {
  accepted: { min: 1, max: 1 },
  phase: { min: 2, max: 2 },
});
assert.equal(selected.selectedCount, 0);
const matching = selectParallelRecordIdsByBrushes(buffers, {
  accepted: { min: 0, max: 0 },
  phase: { min: 2, max: 2 },
});
assert.ok(matching.selectedCount > 0);
for (const sourceIndex of matching.sourceIndices) {
  assert.equal(accepted[sourceIndex], 0);
  assert.equal(phase[sourceIndex], 2);
}

console.log('parallel WebGPU compact buffer tests passed');
