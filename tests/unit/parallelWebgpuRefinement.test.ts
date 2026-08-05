import assert from 'node:assert/strict';

import {
  calculateParallelWebgpuRefinementStride,
} from '../../packages/m-charts/src/m-parallel-webgpu/core/renderer.ts';
import {
  filterParallelWebgpuRefinedSourceIndices,
  packParallelWebgpuRefinedViewportValues,
} from '../../packages/m-charts/src/m-parallel-webgpu/core/refinedValues.ts';

const buffers = {
  axisOrder: ['time', 'signal'],
  domainsByAxis: {
    signal: { max: 100, min: 0, span: 100 },
    time: { max: 1_000, min: 0, span: 1_000 },
  },
  recordCount: 10_000_000,
};

assert.equal(
  calculateParallelWebgpuRefinementStride(
    buffers,
    { signal: { max: 80, min: 60 } },
    120_000,
  ),
  19,
  'wide viewports retain a bounded deterministic detail sample',
);
assert.equal(
  calculateParallelWebgpuRefinementStride(
    buffers,
    { signal: { max: 67.7, min: 67.5 } },
    120_000,
  ),
  1,
  'sufficiently narrow viewports promote every qualifying record',
);
assert.equal(
  calculateParallelWebgpuRefinementStride(
    buffers,
    {
      signal: { max: 80, min: 60 },
      time: { max: 100, min: 0 },
    },
    120_000,
  ),
  2,
  'multiple active axes compound their viewport-qualified population',
);

const precisionBuffers = {
  axisCount: 2,
  axisOrder: ['time', 'signal'],
  domainsByAxis: {
    signal: { max: 100, min: 0, span: 100 },
    time: { max: 1_000_000_000, min: 0, span: 1_000_000_000 },
  },
  rawValuesByAxis: {
    signal: new Float64Array([67.49, 67.5025, 67.6975, 67.71]),
    time: new Float64Array([
      499_999_999.75,
      500_000_000.125,
      500_000_000.375,
      500_000_001.25,
    ]),
  },
};
const precisionViewports = {
  signal: { max: 67.7, min: 67.5 },
  time: { max: 500_000_001, min: 500_000_000 },
};
const refinedSources = filterParallelWebgpuRefinedSourceIndices(
  precisionBuffers,
  new Uint32Array([0, 1, 2, 3]),
  precisionViewports,
);
assert.deepEqual(
  [...refinedSources],
  [1, 2],
  'raw values, rather than full-domain quantized candidates, decide the final detail population',
);
const refinedValues = packParallelWebgpuRefinedViewportValues(
  precisionBuffers,
  refinedSources,
  precisionViewports,
);
assert.ok(Math.abs(refinedValues[0]! - 0.125) < 1e-7);
assert.ok(Math.abs(refinedValues[2]! - 0.375) < 1e-7);
assert.ok(Math.abs(refinedValues[1]! - 0.0125) < 1e-6);
assert.ok(Math.abs(refinedValues[3]! - 0.9875) < 1e-6);
const quantizeFullDomain = (raw: number) =>
  Math.round(raw / precisionBuffers.domainsByAxis.time.span * 65_534);
assert.equal(
  quantizeFullDomain(precisionBuffers.rawValuesByAxis.time[1]!),
  quantizeFullDomain(precisionBuffers.rawValuesByAxis.time[2]!),
  'the former full-domain u16 detail encoding collapses distinguishable deep-zoom values',
);
assert.notEqual(
  refinedValues[0],
  refinedValues[2],
  'viewport-relative Float32 detail coordinates preserve those distinguishable values',
);

console.log('parallel WebGPU refinement tests passed');
