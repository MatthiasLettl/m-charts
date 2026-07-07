import assert from 'node:assert/strict';

import {
  createHistogramFastBenchmarkUrl,
  HISTOGRAM_FAST_BAR_DATASET_URL,
  HISTOGRAM_FAST_MIXED_TABLE_URL,
  HISTOGRAM_FAST_SCATTER_DATASET_URL,
  HISTOGRAM_FAST_SCATTER_SCHEMA_URL,
  parseArgs,
} from '../../scripts/benchmark-histogram-performance-gate.ts';

const options = parseArgs(['--runs=2', '--port', '5198']);

assert.deepEqual(options, {
  port: 5198,
  runs: 2,
});

const rawSingleUrl = new URL(
  createHistogramFastBenchmarkUrl('http://127.0.0.1:5188', 'rawSingleTable'),
);
assert.equal(rawSingleUrl.pathname, '/m-histogram');
assert.equal(
  rawSingleUrl.searchParams.get('__e2eScatterFastSchemaDataUrl'),
  HISTOGRAM_FAST_SCATTER_DATASET_URL,
);
assert.equal(
  rawSingleUrl.searchParams.get('__e2eScatterFastSchemaUrl'),
  HISTOGRAM_FAST_SCATTER_SCHEMA_URL,
);
assert.equal(rawSingleUrl.searchParams.get('histMode'), null);
assert.equal(rawSingleUrl.searchParams.get('tables'), null);

const rawMixedUrl = new URL(
  createHistogramFastBenchmarkUrl('http://127.0.0.1:5188', 'rawMixedTable'),
);
assert.equal(rawMixedUrl.pathname, '/m-histogram');
assert.equal(rawMixedUrl.searchParams.get('tables'), 'multi');
assert.equal(
  rawMixedUrl.searchParams.get('__e2eFastTableFixture'),
  HISTOGRAM_FAST_MIXED_TABLE_URL,
);

const barModeUrl = new URL(
  createHistogramFastBenchmarkUrl('http://127.0.0.1:5188', 'barMode'),
);
assert.equal(barModeUrl.pathname, '/m-histogram');
assert.equal(barModeUrl.searchParams.get('histMode'), 'bar');
assert.equal(HISTOGRAM_FAST_BAR_DATASET_URL, '/data/histogram-bars-sample.json');

console.log('histogram benchmark target tests passed');
