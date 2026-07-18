import assert from 'node:assert/strict';

import {
  FAST_SCATTER_WEBGPU_AGGREGATION_BACKEND_PARAM,
  parseFastScatterWebgpuAggregationBackend,
} from '../../apps/demo/src/state/webgpuAggregationBackend.ts';

assert.equal(parseFastScatterWebgpuAggregationBackend(new URLSearchParams()), 'auto');
assert.equal(
  parseFastScatterWebgpuAggregationBackend(
    new URLSearchParams(`${FAST_SCATTER_WEBGPU_AGGREGATION_BACKEND_PARAM}=rust-wasm`),
  ),
  'rust-wasm',
);
assert.equal(
  parseFastScatterWebgpuAggregationBackend(
    new URLSearchParams(`${FAST_SCATTER_WEBGPU_AGGREGATION_BACKEND_PARAM}=typescript`),
  ),
  'typescript',
);
assert.equal(
  parseFastScatterWebgpuAggregationBackend(
    new URLSearchParams(`${FAST_SCATTER_WEBGPU_AGGREGATION_BACKEND_PARAM}=invalid`),
  ),
  'auto',
);

console.log('scatter WebGPU aggregation backend search param tests passed');
