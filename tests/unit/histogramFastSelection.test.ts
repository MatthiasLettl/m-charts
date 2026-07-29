import assert from 'node:assert/strict';

import {
  buildHistogramAggregation,
  createDefaultHistogramViewport,
  createHistogramLayout,
  histogramAxisToPixel,
  normalizeHistogramBarSeries,
  selectHistogramBinsInBounds,
  selectHistogramBinsInPolygon,
  type HistogramPlotRect,
  type HistogramPlotSpec,
  type HistogramSubplotId,
  type HistogramViewport,
} from '../../packages/m-charts/src/m-histogram/core/index.ts';

const plotSpec = {
  mode: 'histogram',
  parameters: [
    {
      domain: { max: 10, min: 0 },
      key: 'temperature',
      kind: 'numeric',
      label: 'Temperature',
    },
    {
      categories: [
        { encoded: 0, label: 'Off', value: false },
        { encoded: 1, label: 'On', value: true },
      ],
      key: 'active',
      kind: 'boolean',
      label: 'Active',
    },
  ],
  subplots: [
    { id: 'temperature', label: 'Temperature', parameterKey: 'temperature' },
    { id: 'active', label: 'Active', parameterKey: 'active' },
  ],
} as const satisfies HistogramPlotSpec;

const rawAggregation = buildHistogramAggregation(
  {
    ids: ['row-0', 'row-1', 'row-2', 'row-3', 'row-4'],
    sourceIndex: new Uint32Array([10, 11, 12, 13, 14]),
    valuesByParameter: {
      active: [true, false, true, true, false],
      temperature: [1, 5, 9, null, Number.NaN],
    },
  },
  {
    binSizes: [
      {
        binSize: 2,
        mode: 'continuous',
        parameterKey: 'temperature',
        subplotId: 'temperature',
      },
    ],
    plotSpec,
  },
);
const rawLayout = createHistogramLayout(plotSpec, {
  heightCssPx: 300,
  widthCssPx: 520,
});
const rawViewport = createDefaultHistogramViewport(rawAggregation);

const rectangleSelection = selectHistogramBinsInBounds({
  aggregation: rawAggregation,
  bounds: axisBoundsToPixels(
    rawViewport,
    requiredRect(rawLayout.plotRects, 'temperature'),
    'temperature',
    { max: 6, min: 0 },
    { max: 1, min: 0.1 },
  ),
  currentSourceIndices: new Uint32Array([99]),
  kind: 'append',
  layout: rawLayout,
  subplotId: 'temperature',
  viewport: rawViewport,
});

assert.equal(rectangleSelection.tool, 'rectangle');
assert.equal(rectangleSelection.kind, 'append');
assert.equal(rectangleSelection.selectedBinCount, 2);
assert.deepEqual(
  rectangleSelection.binDescriptors.map((descriptor) => descriptor.index),
  [0, 2],
);
assert.deepEqual(Array.from(rectangleSelection.sourceIndices), [10, 11, 99]);
assert.equal(rectangleSelection.sourceIndicesAvailable, true);
assert.equal(rectangleSelection.selectedSourceCount, 3);

const emptyBinSelection = selectHistogramBinsInBounds({
  aggregation: rawAggregation,
  bounds: axisBoundsToPixels(
    rawViewport,
    requiredRect(rawLayout.plotRects, 'temperature'),
    'temperature',
    { max: 3.9, min: 2.1 },
    { max: 1, min: 0.1 },
  ),
  layout: rawLayout,
  subplotId: 'temperature',
  viewport: rawViewport,
});
assert.equal(emptyBinSelection.selectedBinCount, 0);
assert.deepEqual(Array.from(emptyBinSelection.sourceIndices), []);

const lassoSelection = selectHistogramBinsInPolygon({
  aggregation: rawAggregation,
  layout: rawLayout,
  points: axisPolygonToPixels(
    rawViewport,
    requiredRect(rawLayout.plotRects, 'temperature'),
    'temperature',
    [
      { x: 8.1, y: 0.1 },
      { x: 9.9, y: 0.1 },
      { x: 9.9, y: 1 },
      { x: 8.1, y: 1 },
    ],
  ),
  subplotId: 'temperature',
  viewport: rawViewport,
});
assert.equal(lassoSelection.tool, 'lasso');
assert.equal(lassoSelection.selectedBinCount, 1);
assert.deepEqual(
  lassoSelection.binDescriptors.map((descriptor) => descriptor.index),
  [4],
);
assert.deepEqual(Array.from(lassoSelection.sourceIndices), [12]);

const multiSubplotSelection = selectHistogramBinsInBounds({
  aggregation: rawAggregation,
  bounds: {
    maxX: 1_000,
    maxY: 1_000,
    minX: 0,
    minY: 0,
  },
  layout: rawLayout,
  viewport: rawViewport,
});
assert.equal(multiSubplotSelection.selectedBinCount, 5);
assert.equal(multiSubplotSelection.subplotId, undefined);
assert.deepEqual(
  multiSubplotSelection.binDescriptors.map((descriptor) => descriptor.subplotId),
  ['temperature', 'temperature', 'temperature', 'active', 'active'],
);

const barAggregation = normalizeHistogramBarSeries({
  bins: [
    {
      count: 3,
      max: 10,
      min: 0,
      sourceIndices: new Uint32Array([0, 1, 2]),
    },
    {
      count: 4,
      max: 20,
      min: 10,
    },
    {
      count: 0,
      max: 30,
      min: 20,
      sourceIndices: [],
    },
  ],
  parameterKey: 'latency',
  subplotId: 'latency',
});
const barSpec = {
  mode: 'bar',
  parameters: [
    {
      domain: { max: 30, min: 0 },
      key: 'latency',
      kind: 'numeric',
      label: 'Latency',
    },
  ],
  subplots: [{ id: 'latency', label: 'Latency', parameterKey: 'latency' }],
} as const satisfies HistogramPlotSpec;
const barLayout = createHistogramLayout(barSpec, {
  heightCssPx: 220,
  widthCssPx: 420,
});
const barViewport = createDefaultHistogramViewport(barAggregation);
const barRect = requiredRect(barLayout.plotRects, 'latency');

const membershipSelection = selectHistogramBinsInBounds({
  aggregation: barAggregation,
  bounds: axisBoundsToPixels(
    barViewport,
    barRect,
    'latency',
    { max: 9, min: 1 },
    { max: 3, min: 0.5 },
  ),
  layout: barLayout,
  viewport: barViewport,
});
assert.equal(membershipSelection.selectedBinCount, 1);
assert.equal(membershipSelection.sourceIndicesAvailable, true);
assert.deepEqual(Array.from(membershipSelection.sourceIndices), [0, 1, 2]);

const missingMembershipSelection = selectHistogramBinsInBounds({
  aggregation: barAggregation,
  bounds: axisBoundsToPixels(
    barViewport,
    barRect,
    'latency',
    { max: 19, min: 11 },
    { max: 4, min: 0.5 },
  ),
  layout: barLayout,
  viewport: barViewport,
});
assert.equal(missingMembershipSelection.selectedBinCount, 1);
assert.equal(missingMembershipSelection.sourceIndicesAvailable, false);
assert.equal(missingMembershipSelection.selectedSourceCount, 4);
assert.deepEqual(Array.from(missingMembershipSelection.sourceIndices), []);
assert.deepEqual(
  missingMembershipSelection.binDescriptors.map((descriptor) => [
    descriptor.min,
    descriptor.max,
  ]),
  [[10, 20]],
);

const barEmptySelection = selectHistogramBinsInBounds({
  aggregation: barAggregation,
  bounds: axisBoundsToPixels(
    barViewport,
    barRect,
    'latency',
    { max: 29, min: 21 },
    { max: 4, min: 0.5 },
  ),
  layout: barLayout,
  viewport: barViewport,
});
assert.equal(barEmptySelection.selectedBinCount, 0);

function axisBoundsToPixels(
  viewport: HistogramViewport,
  rect: HistogramPlotRect,
  subplotId: HistogramSubplotId,
  x: { readonly max: number; readonly min: number },
  y: { readonly max: number; readonly min: number },
) {
  return {
    maxX: axisXToPixel(viewport, rect, subplotId, x.max),
    maxY: axisYToPixel(viewport, rect, subplotId, y.min),
    minX: axisXToPixel(viewport, rect, subplotId, x.min),
    minY: axisYToPixel(viewport, rect, subplotId, y.max),
  };
}

function axisPolygonToPixels(
  viewport: HistogramViewport,
  rect: HistogramPlotRect,
  subplotId: HistogramSubplotId,
  points: readonly { readonly x: number; readonly y: number }[],
) {
  return points.map((point) => ({
    x: axisXToPixel(viewport, rect, subplotId, point.x),
    y: axisYToPixel(viewport, rect, subplotId, point.y),
  }));
}

function axisXToPixel(
  viewport: HistogramViewport,
  rect: HistogramPlotRect,
  subplotId: HistogramSubplotId,
  value: number,
): number {
  const subplotViewport = viewport.subplotById[subplotId];
  assert.ok(subplotViewport !== undefined);

  return histogramAxisToPixel(
    value,
    subplotViewport.x,
    rect.xCssPx,
    rect.xCssPx + rect.widthCssPx,
  );
}

function axisYToPixel(
  viewport: HistogramViewport,
  rect: HistogramPlotRect,
  subplotId: HistogramSubplotId,
  value: number,
): number {
  const subplotViewport = viewport.subplotById[subplotId];
  assert.ok(subplotViewport !== undefined);

  return histogramAxisToPixel(
    value,
    subplotViewport.y,
    rect.yCssPx + rect.heightCssPx,
    rect.yCssPx,
  );
}

function requiredRect(
  plotRects: readonly HistogramPlotRect[],
  subplotId: HistogramSubplotId,
): HistogramPlotRect {
  const rect = plotRects.find((plotRect) => plotRect.id === subplotId);
  assert.ok(rect !== undefined);

  return rect;
}

console.log('histogram-fast selection tests passed');
