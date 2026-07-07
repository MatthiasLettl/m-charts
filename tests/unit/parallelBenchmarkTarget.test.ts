import assert from 'node:assert/strict';

import {
  createBrushScenario,
  createParallelFastBenchmarkUrl,
  PARALLEL_FAST_ROUTE_DATASET_URL,
  parseArgs,
} from '../../scripts/benchmark-parallel-performance-gate.ts';

const customOptions = parseArgs(['--target', 'custom', '--runs=2', '--port', '5199']);

assert.deepEqual(customOptions, {
  port: 5199,
  runs: 2,
});

const benchmarkUrl = new URL(createParallelFastBenchmarkUrl('http://127.0.0.1:5186'));

assert.equal(benchmarkUrl.pathname, '/m-parallel');
assert.equal(
  benchmarkUrl.searchParams.get('__e2eParallelFastDataset'),
  PARALLEL_FAST_ROUTE_DATASET_URL,
);
assert.equal(PARALLEL_FAST_ROUTE_DATASET_URL, '/data/parallel-sample.json');

const scenario = createBrushScenario(
  Array.from({ length: 120 }, (_, index) => ({
    cpuLoad: index,
    errorRate: index % 30,
    id: `parallel-${index}`,
    latency: index % 40,
    memoryUsage: 120 - index,
    throughput: index,
  })),
  2,
);

assert.equal(scenario.selectors.length, 2);
assert.equal(scenario.expectedCount, 70);

console.log('parallel benchmark target tests passed');
