import assert from 'node:assert/strict';

import {
  createHistogramWebgpuStreamingPlot,
  type HistogramPlotSpec,
} from '../../packages/m-charts/src/m-histogram-webgpu/index.ts';
import {
  createParallelWebgpuStreamingPlot,
} from '../../packages/m-charts/src/m-parallel-webgpu/index.ts';

const host = null as unknown as HTMLElement;

type HistogramUpdateOptions = Parameters<
  Awaited<ReturnType<typeof createHistogramWebgpuStreamingPlot>>['update']
>[0];
const histogramStreamingUpdate: HistogramUpdateOptions = {
  binSizes: [],
  focusedSubplotId: null,
};
assert.deepEqual(histogramStreamingUpdate, {
  binSizes: [],
  focusedSubplotId: null,
});

await assert.rejects(
  createParallelWebgpuStreamingPlot(host, {
    dataSource: {
      batches: (async function* () {})(),
      domainsByAxis: {},
      expectedCount: -1,
    },
  }),
  /expectedCount must be a non-negative safe integer/u,
);

await assert.rejects(
  createParallelWebgpuStreamingPlot(host, {
    dataSource: {
      batches: (async function* () {})(),
      domainsByAxis: {},
    },
  }),
  /ended before supplying a non-empty batch/u,
);

await assert.rejects(
  createParallelWebgpuStreamingPlot(host, {
    dataSource: {
      batches: (async function* () {
        yield {
          columns: {
            axisOrder: ['value'],
            ids: ['row-0'],
            valuesByAxis: { value: new Float32Array([0.5]) },
          },
          packedPage: {
            count: 1,
            densityStyles: new Uint32Array(1),
            start: 1,
            values: new Uint32Array(1),
          },
        };
      })(),
      domainsByAxis: { value: { max: 1, min: 0, span: 1 } },
    },
  }),
  /packed page starts at 1.*expected 0/u,
);

const barSpec: HistogramPlotSpec = {
  mode: 'bar',
  parameters: [],
  subplots: [],
};
await assert.rejects(
  createHistogramWebgpuStreamingPlot(host, {
    dataSource: {
      batches: (async function* () {})(),
      spec: barSpec,
    },
  }),
  /requires histogram mode/u,
);

const histogramSpec: HistogramPlotSpec = {
  mode: 'histogram',
  parameters: [],
  subplots: [],
};
await assert.rejects(
  createHistogramWebgpuStreamingPlot(host, {
    dataSource: {
      batches: (async function* () {})(),
      spec: histogramSpec,
    },
  }),
  /ended before supplying a non-empty batch/u,
);

await assert.rejects(
  createHistogramWebgpuStreamingPlot(host, {
    dataSource: {
      batches: (async function* () {
        yield {
          columns: {
            ids: ['row-0'],
            sourceIndex: new Uint32Array([1]),
            valuesByParameter: {},
          },
        };
      })(),
      spec: histogramSpec,
    },
  }),
  /source indices must be contiguous global row indices/u,
);

await assert.rejects(
  createHistogramWebgpuStreamingPlot(host, {
    dataSource: {
      batches: (async function* () {
        yield {
          columns: {
            ids: ['row-0'],
            recordIdentityBySourceIndex: [],
            valuesByParameter: {},
          },
        };
      })(),
      spec: histogramSpec,
    },
  }),
  /record identities do not match the batch count/u,
);

console.log('WebGPU streaming contract tests passed');
