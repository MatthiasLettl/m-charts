import assert from 'node:assert/strict';

import { getHistogramWebgpuRecordColor } from '../../apps/demo/src/data/histogramWebgpuDatasetAdapter.ts';

assert.deepEqual(
  [0, 1, 2, 3].map((phase) =>
    getHistogramWebgpuRecordColor(phase, true, phase),
  ),
  [0x6474_8bff, 0x2563_ebff, 0x0596_69ff, 0x7c3a_edff],
);
assert.equal(getHistogramWebgpuRecordColor(0, false, 0), 0xdc26_26ff);
assert.equal(getHistogramWebgpuRecordColor(3, false, 1), 0xea58_0cff);
assert.equal(getHistogramWebgpuRecordColor(2, false, 2), 0xdc26_26ff);

console.log('Histogram WebGPU demo color tests passed');
