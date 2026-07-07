import assert from 'node:assert/strict';

import {
  buildHistogramAggregation,
  buildHistogramRendererBuffers,
  createDefaultHistogramViewport,
  createHistogramLayout,
  normalizeHistogramBarSeries,
  resolveHistogramRendererTheme,
  type HistogramBarSeries,
  type HistogramColumns,
  type HistogramPlotSpec,
} from '../../packages/m-charts/src/m-histogram/core/index.ts';

const rawSpec = {
  mode: 'histogram',
  parameters: [
    {
      domain: { max: 10, min: 0 },
      key: 'temperature',
      kind: 'numeric',
      label: 'Temperature',
    },
  ],
  subplots: [
    {
      id: 'temperature',
      label: 'Temperature',
      parameterKey: 'temperature',
    },
  ],
} as const satisfies HistogramPlotSpec;

const rawColumns: HistogramColumns = {
  color: new Uint32Array([
    0xff0000ff,
    0xff0000ff,
    0x00ff00ff,
    0x0000ffff,
    0x0000ffff,
  ]),
  colorFormat: 'rgba32',
  ids: ['a', 'b', 'c', 'd', 'e'],
  sourceIndex: new Uint32Array([10, 4, 7, 8, 2]),
  valuesByParameter: {
    temperature: [0, 1.999, 2, 3.5, 10],
  },
};

const rawAggregation = buildHistogramAggregation(rawColumns, {
  binSizes: [
    {
      binSize: 2,
      mode: 'continuous',
      parameterKey: 'temperature',
      subplotId: 'temperature',
    },
  ],
  hoverSourceIndex: 7,
  plotSpec: rawSpec,
  selectedSourceIndices: new Uint32Array([4, 2]),
});
const rawLayout = createHistogramLayout(rawSpec, {
  heightCssPx: 220,
  widthCssPx: 360,
});
const rawViewport = createDefaultHistogramViewport(rawAggregation);

const rawBuffers = buildHistogramRendererBuffers({
  aggregation: rawAggregation,
  layout: rawLayout,
  viewport: rawViewport,
});

assert.equal(rawBuffers.metrics.backgroundInstanceCount, 1);
assert.equal(rawBuffers.metrics.gridInstanceCount, 5);
assert.equal(rawBuffers.metrics.visibleBinCount, 3);
assert.equal(rawBuffers.metrics.stackSegmentCount, 4);
assert.equal(rawBuffers.metrics.barInstanceCount, 4);
assert.equal(rawBuffers.metrics.separatorInstanceCount, 8);
assert.equal(rawBuffers.metrics.overlayInstanceCount, 3);
assert.equal(rawBuffers.metrics.outOfRangeMarkerInstanceCount, 0);
assert.equal(rawBuffers.metrics.selectedBinCount, 2);
assert.equal(rawBuffers.metrics.selectedSourceCount, 2);
assert.equal(rawBuffers.metrics.instanceCount, 21);
assert.equal(rawBuffers.rects.length, rawBuffers.metrics.instanceCount * 4);
assert.equal(rawBuffers.colors.length, rawBuffers.metrics.instanceCount * 4);
assert.equal(
  rawBuffers.metrics.uploadBytes,
  rawBuffers.rects.byteLength + rawBuffers.colors.byteLength,
);

const rawPlotRect = rawLayout.plotRects[0]!;
assert.deepEqual(Array.from(rawBuffers.rects.subarray(0, 4)), [
  rawPlotRect.xCssPx,
  rawPlotRect.yCssPx,
  rawPlotRect.widthCssPx,
  rawPlotRect.heightCssPx,
]);

const firstBarColorOffset =
  (rawBuffers.metrics.backgroundInstanceCount + rawBuffers.metrics.gridInstanceCount) *
  4;
assert.deepEqual(
  Array.from(rawBuffers.colors.subarray(firstBarColorOffset, firstBarColorOffset + 4)),
  [1, 0, 0, 1],
);

const barRectOffset =
  (rawBuffers.metrics.backgroundInstanceCount + rawBuffers.metrics.gridInstanceCount) *
  4;
const barRectLength = rawBuffers.metrics.barInstanceCount * 4;
let minBarX = Number.POSITIVE_INFINITY;
let maxBarX = Number.NEGATIVE_INFINITY;
for (let index = barRectOffset; index < barRectOffset + barRectLength; index += 4) {
  const x = rawBuffers.rects[index];
  const width = rawBuffers.rects[index + 2];
  assert.ok(x !== undefined);
  assert.ok(width !== undefined);
  minBarX = Math.min(minBarX, x);
  maxBarX = Math.max(maxBarX, x + width);
}
assert.ok(minBarX > rawPlotRect.xCssPx);
assert.ok(maxBarX < rawPlotRect.xCssPx + rawPlotRect.widthCssPx);

const clippedBuffers = buildHistogramRendererBuffers({
  aggregation: rawAggregation,
  layout: rawLayout,
  viewport: {
    subplotById: {
      temperature: {
        x: { max: 4, min: 0 },
        y: rawViewport.subplotById.temperature!.y,
      },
    },
  },
});
assert.equal(clippedBuffers.metrics.visibleBinCount, 2);
assert.equal(clippedBuffers.metrics.stackSegmentCount, 3);
assert.equal(clippedBuffers.metrics.separatorInstanceCount, 6);
assert.equal(clippedBuffers.metrics.outOfRangeMarkerInstanceCount, 1);

const xCenteredBuffers = buildHistogramRendererBuffers({
  aggregation: rawAggregation,
  layout: rawLayout,
  viewport: {
    subplotById: {
      temperature: {
        x: { max: 4, min: 2 },
        y: rawViewport.subplotById.temperature!.y,
      },
    },
  },
});
assert.equal(xCenteredBuffers.metrics.visibleBinCount, 1);
assert.equal(xCenteredBuffers.metrics.outOfRangeMarkerInstanceCount, 2);

const xCenteredViewport = {
  subplotById: {
    temperature: {
      x: { max: 4, min: 2 },
      y: rawViewport.subplotById.temperature!.y,
    },
  },
};
const viewportAwareRawAggregation = buildHistogramAggregation(rawColumns, {
  binSizes: [
    {
      binSize: 2,
      mode: 'continuous',
      parameterKey: 'temperature',
      subplotId: 'temperature',
    },
  ],
  plotSpec: rawSpec,
  viewport: xCenteredViewport,
});
const viewportAwareRawBuffers = buildHistogramRendererBuffers({
  aggregation: viewportAwareRawAggregation,
  layout: rawLayout,
  viewport: xCenteredViewport,
});
assert.equal(viewportAwareRawBuffers.metrics.visibleBinCount, 1);
assert.equal(viewportAwareRawBuffers.metrics.outOfRangeMarkerInstanceCount, 2);

const wideDomainSpec = {
  mode: 'histogram',
  parameters: [
    {
      domain: { max: 100, min: 0 },
      key: 'signal',
      kind: 'numeric',
      label: 'Signal',
    },
  ],
  subplots: [{ id: 'signal', label: 'Signal', parameterKey: 'signal' }],
} as const satisfies HistogramPlotSpec;
const wideDomainColumns: HistogramColumns = {
  ids: ['signal-0', 'signal-1'],
  valuesByParameter: {
    signal: [40, 45],
  },
};
const wideDomainLayout = createHistogramLayout(wideDomainSpec, {
  heightCssPx: 160,
  widthCssPx: 260,
});
const wideDomainViewport = {
  subplotById: {
    signal: {
      x: { max: 50, min: 20 },
      y: { max: 3, min: 0 },
    },
  },
};
const wideDomainAggregation = buildHistogramAggregation(wideDomainColumns, {
  binSizes: [
    {
      binSize: 10,
      mode: 'continuous',
      parameterKey: 'signal',
      subplotId: 'signal',
    },
  ],
  plotSpec: wideDomainSpec,
  viewport: wideDomainViewport,
});
const wideDomainBuffers = buildHistogramRendererBuffers({
  aggregation: wideDomainAggregation,
  layout: wideDomainLayout,
  viewport: wideDomainViewport,
});
assert.equal(wideDomainBuffers.metrics.visibleBinCount, 1);
assert.equal(wideDomainBuffers.metrics.outOfRangeMarkerInstanceCount, 0);

const clippedEdgeViewport = {
  subplotById: {
    signal: {
      x: { max: 50, min: 42 },
      y: { max: 3, min: 0 },
    },
  },
};
const clippedEdgeAggregation = buildHistogramAggregation(wideDomainColumns, {
  binSizes: [
    {
      binSize: 10,
      mode: 'continuous',
      parameterKey: 'signal',
      subplotId: 'signal',
    },
  ],
  plotSpec: wideDomainSpec,
  viewport: clippedEdgeViewport,
});
const clippedEdgeBuffers = buildHistogramRendererBuffers({
  aggregation: clippedEdgeAggregation,
  layout: wideDomainLayout,
  viewport: clippedEdgeViewport,
});
assert.equal(clippedEdgeBuffers.metrics.visibleBinCount, 1);
assert.equal(clippedEdgeBuffers.metrics.outOfRangeMarkerInstanceCount, 1);

const yClippedBuffers = buildHistogramRendererBuffers({
  aggregation: rawAggregation,
  layout: rawLayout,
  viewport: {
    subplotById: {
      temperature: {
        x: rawViewport.subplotById.temperature!.x,
        y: { max: 1, min: 0 },
      },
    },
  },
});
assert.equal(yClippedBuffers.metrics.visibleBinCount, 3);
assert.equal(yClippedBuffers.metrics.outOfRangeMarkerInstanceCount, 2);

const barSeries: HistogramBarSeries = {
  bins: [
    {
      colorStack: [
        { color: 0x102030ff, count: 3 },
        { color: 0xa0b0c0ff, count: 2 },
      ],
      max: 1,
      min: 0,
      sourceIndexRange: { count: 5, start: 100 },
      totalCount: 5,
    },
    {
      count: 4,
      max: 2,
      min: 1,
    },
  ],
  parameterKey: 'bucket',
  subplotId: 'bucket',
};
const barAggregation = normalizeHistogramBarSeries(barSeries);
const barSpec = {
  mode: 'bar',
  parameters: [
    {
      domain: { max: 2, min: 0 },
      key: 'bucket',
      kind: 'numeric',
      label: 'Bucket',
    },
  ],
  subplots: [{ id: 'bucket', label: 'Bucket', parameterKey: 'bucket' }],
} as const satisfies HistogramPlotSpec;
const barLayout = createHistogramLayout(barSpec, {
  heightCssPx: 160,
  widthCssPx: 260,
});
const barBuffers = buildHistogramRendererBuffers({
  aggregation: barAggregation,
  layout: barLayout,
  viewport: createDefaultHistogramViewport(barAggregation),
});

assert.equal(barBuffers.metrics.visibleBinCount, 2);
assert.equal(barBuffers.metrics.stackSegmentCount, 3);
assert.equal(barBuffers.metrics.barInstanceCount, 3);
assert.equal(barBuffers.metrics.separatorInstanceCount, 6);
assert.equal(barBuffers.metrics.backgroundInstanceCount, 1);

assert.deepEqual(resolveHistogramRendererTheme({ defaultBarColor: [2, -1, 0.4, 5] }).defaultBarColor, [
  1,
  0,
  0.4,
  1,
]);
assert.deepEqual(resolveHistogramRendererTheme(undefined).selectedOverlayColor, [
  0.98,
  0.72,
  0.08,
  0.95,
]);

console.log('histogram-fast renderer buffer tests passed');
