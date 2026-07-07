import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import {
  axisToPixel,
  buildFastScatterBubbleAggregation,
  buildFastScatterHeatmapAggregation,
  createFastScatterBubbleRadiusPx,
  lookupFastScatterNearestPoint,
  type FastScatterPlotRect,
  type FastScatterPlotSpec,
  type FastScatterPointColumns,
  type FastScatterViewport,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';
import { lookupFastScatterAggregateHit } from '../../packages/m-charts/src/m-scatter/core/hoverLookup.ts';

const spec: FastScatterPlotSpec = {
  xLabel: 'x',
  plots: [
    { id: 'a', label: 'Metric A', yKey: 'a' },
    { id: 'b', label: 'Metric B', yKey: 'b' },
    { id: 'c', label: 'Metric C', yKey: 'c' },
  ],
};
const plotRects: FastScatterPlotRect[] = [
  { heightCssPx: 100, id: 'a', widthCssPx: 500, xCssPx: 40, yCssPx: 10 },
  { heightCssPx: 100, id: 'b', widthCssPx: 500, xCssPx: 40, yCssPx: 120 },
  { heightCssPx: 100, id: 'c', widthCssPx: 500, xCssPx: 40, yCssPx: 230 },
];
const viewport: FastScatterViewport = {
  x: { min: 0, max: 100 },
  yByPlot: {
    a: { min: 0, max: 10 },
    b: { min: 100, max: 110 },
    c: { min: -10, max: 0 },
  },
};
const columns: FastScatterPointColumns = {
  ids: ['id-0', 'id-1', 'id-2', 'id-3', 'id-4', 'id-5'],
  x: new Float64Array([0, 1, 1.01, 1.02, 50, 99]),
  y: {
    a: new Float64Array([0, 5, 5.05, 4.9, 8, 10]),
    b: new Float64Array([100, 101, 102, 103, 108, 110]),
    c: new Float64Array([-10, -8, -6, -4, -2, 0]),
  },
};

const densePointerX = axisToPixel(1.01, viewport.x, 40, 540);
const densePointerY = axisToPixel(5.05, viewport.yByPlot.a, 110, 10);
const denseHit = lookupFastScatterNearestPoint({
  columns,
  maxDistanceCssPx: 4,
  plotRects,
  pointerCssX: densePointerX,
  pointerCssY: densePointerY,
  spec,
  viewport,
});

assert.equal(denseHit.hit?.point.id, 'id-2');
assert.equal(denseHit.hit?.point.sourceIndex, 2);
assert.equal(denseHit.hit?.point.plotId, 'a');
assert.equal(denseHit.hit?.point.yKey, 'a');
assert.equal(denseHit.hit?.point.x, 1.01);
assert.equal(denseHit.hit?.point.y, 5.05);
assert.equal(denseHit.diagnostics.candidateCount, 3);
assert.equal(denseHit.diagnostics.plotId, 'a');
assert.equal(denseHit.diagnostics.yKey, 'a');

const sparsePointerX = axisToPixel(50, viewport.x, 40, 540);
const sparsePointerY = axisToPixel(108, viewport.yByPlot.b, 220, 120);
const sparseHit = lookupFastScatterNearestPoint({
  columns,
  maxDistanceCssPx: 6,
  plotRects,
  pointerCssX: sparsePointerX,
  pointerCssY: sparsePointerY,
  spec,
  viewport,
});

assert.equal(sparseHit.hit?.point.id, 'id-4');
assert.equal(sparseHit.hit?.point.plotId, 'b');
assert.equal(sparseHit.hit?.point.yKey, 'b');
assert.equal(sparseHit.hit?.point.y, 108);
assert.equal(sparseHit.diagnostics.candidateCount, 1);

const cPointerY = axisToPixel(-4, viewport.yByPlot.c, 330, 230);
const cHit = lookupFastScatterNearestPoint({
  columns,
  maxDistanceCssPx: 8,
  plotRects,
  pointerCssX: axisToPixel(1.02, viewport.x, 40, 540),
  pointerCssY: cPointerY,
  spec,
  viewport,
});

assert.equal(cHit.hit?.point.id, 'id-3');
assert.equal(cHit.hit?.point.plotId, 'c');
assert.equal(cHit.hit?.point.yKey, 'c');
assert.equal(cHit.hit?.point.y, -4);

const outsidePlot = lookupFastScatterNearestPoint({
  columns,
  maxDistanceCssPx: 20,
  plotRects,
  pointerCssX: 10,
  pointerCssY: 10,
  spec,
  viewport,
});

assert.equal(outsidePlot.hit, null);
assert.equal(outsidePlot.diagnostics.candidateCount, 0);
assert.equal(outsidePlot.diagnostics.plotId, null);

const outsideRadius = lookupFastScatterNearestPoint({
  columns,
  maxDistanceCssPx: 2,
  plotRects,
  pointerCssX: axisToPixel(75, viewport.x, 40, 540),
  pointerCssY: axisToPixel(5, viewport.yByPlot.a, 110, 10),
  spec,
  viewport,
});

assert.equal(outsideRadius.hit, null);
assert.equal(outsideRadius.diagnostics.candidateCount, 0);

const tieColumns: FastScatterPointColumns = {
  ids: ['source-0', 'source-1'],
  sourceIndex: new Uint32Array([1, 0]),
  x: new Float64Array([10, 10]),
  y: {
    a: new Float64Array([4, 6]),
  },
};
const tieViewport: FastScatterViewport = {
  x: { min: 0, max: 20 },
  yByPlot: {
    a: { min: 0, max: 10 },
  },
};
const tieHit = lookupFastScatterNearestPoint({
  columns: tieColumns,
  maxDistanceCssPx: 25,
  plotRects: [plotRects[0]!],
  pointerCssX: axisToPixel(10, tieViewport.x, 40, 540),
  pointerCssY: axisToPixel(5, tieViewport.yByPlot.a, 110, 10),
  spec: { xLabel: 'x', plots: [spec.plots[0]!] },
  viewport: tieViewport,
});

assert.equal(tieHit.hit?.pointIndex, 1);
assert.equal(tieHit.hit?.point.sourceIndex, 0);
assert.equal(tieHit.hit?.point.id, 'source-0');

const mixedTableColumns: FastScatterPointColumns = {
  ids: ['primary-0', 'primary-1', 'secondary-0', 'secondary-1'],
  x: new Float64Array([10, 30, 20, 40]),
  xOrder: new Uint32Array([0, 2, 1, 3]),
  y: {
    a: new Float64Array([1, 3, 2, 4]),
  },
};
const mixedTableViewport: FastScatterViewport = {
  x: { min: 0, max: 50 },
  yByPlot: {
    a: { min: 0, max: 5 },
  },
};
const mixedTableHit = lookupFastScatterNearestPoint({
  columns: mixedTableColumns,
  maxDistanceCssPx: 12,
  plotRects: [plotRects[0]!],
  pointerCssX: axisToPixel(20, mixedTableViewport.x, 40, 540),
  pointerCssY: axisToPixel(2, mixedTableViewport.yByPlot.a, 110, 10),
  spec: { xLabel: 'x', plots: [spec.plots[0]!] },
  viewport: mixedTableViewport,
});

assert.equal(mixedTableHit.hit?.point.id, 'secondary-0');
assert.equal(mixedTableHit.hit?.point.sourceIndex, 2);
assert.equal(mixedTableHit.hit?.pointIndex, 2);
assert.equal(mixedTableHit.diagnostics.candidateCount, 1);

const aggregatePlotRects: FastScatterPlotRect[] = [
  { heightCssPx: 100, id: 'a', widthCssPx: 100, xCssPx: 0, yCssPx: 0 },
];
const aggregateViewport: FastScatterViewport = {
  x: { min: 0, max: 100 },
  yByPlot: {
    a: { min: 0, max: 10 },
  },
};
const aggregateColumns: FastScatterPointColumns = {
  ids: ['agg-0', 'agg-1', 'agg-2', 'agg-3'],
  x: new Float64Array([10, 10, 75, 80]),
  y: {
    a: new Float64Array([4, 4, 8, 2]),
  },
};
const bubbleAggregation = buildFastScatterBubbleAggregation(aggregateColumns, {
  mode: 'bubble',
  subplots: [
    {
      plotHeightPx: 100,
      plotId: 'a',
      plotWidthPx: 100,
      yKey: 'a',
      yRange: aggregateViewport.yByPlot.a,
    },
  ],
  xRange: aggregateViewport.x,
});
const bubbleHit = lookupFastScatterAggregateHit({
  aggregation: bubbleAggregation,
  bubbleRadiusCssPx: ({ count }) => (count >= 2 ? 8 : 4),
  columns: aggregateColumns,
  plotRects: aggregatePlotRects,
  pointerCssX: axisToPixel(10, aggregateViewport.x, 0, 100) + 2,
  pointerCssY: axisToPixel(4, aggregateViewport.yByPlot.a, 100, 0) + 1,
  viewport: aggregateViewport,
});

assert.equal(bubbleHit.hit?.aggregateKind, 'bubble');
assert.equal(bubbleHit.hit?.plotId, 'a');
assert.equal(bubbleHit.hit?.count, 2);
assert.equal(bubbleHit.hit?.aggregateIndex, 0);
assert.deepEqual(bubbleHit.hit?.axis, {
  x: { center: 10, max: 10, min: 10 },
  y: { center: 4, max: 4, min: 4 },
});
assert.deepEqual(bubbleHit.hit?.sampleIds, ['agg-0', 'agg-1']);
assert.deepEqual(bubbleHit.hit?.membership, {
  count: 2,
  maxSourceIndex: 1,
  minSourceIndex: 0,
  offset: 0,
});

const narrowedBubbleColumns: FastScatterPointColumns = {
  ids: ['near-0', 'near-1', 'far-0', 'far-1', 'far-2', 'far-3'],
  x: new Float64Array([10, 10, 40, 40, 90, 90]),
  y: {
    a: new Float64Array([4, 4, 5, 5, 6, 6]),
  },
};
const narrowedBubbleAggregation = buildFastScatterBubbleAggregation(
  narrowedBubbleColumns,
  {
    mode: 'bubble',
    subplots: [
      {
        plotHeightPx: 100,
        plotId: 'a',
        plotWidthPx: 100,
        yKey: 'a',
        yRange: aggregateViewport.yByPlot.a,
      },
    ],
    xRange: aggregateViewport.x,
  },
);
const narrowedBubbleHit = lookupFastScatterAggregateHit({
  aggregation: narrowedBubbleAggregation,
  bubbleMaxRadiusCssPx: 6,
  bubbleRadiusCssPx: 6,
  columns: narrowedBubbleColumns,
  plotRects: aggregatePlotRects,
  pointerCssX: axisToPixel(10, aggregateViewport.x, 0, 100),
  pointerCssY: axisToPixel(4, aggregateViewport.yByPlot.a, 100, 0),
  viewport: aggregateViewport,
});

assert.equal(narrowedBubbleAggregation.subplots[0]?.aggregateCount, 3);
assert.equal(narrowedBubbleHit.diagnostics.candidateCount, 1);
assert.equal(narrowedBubbleHit.hit?.aggregateKind, 'bubble');
assert.equal(narrowedBubbleHit.hit?.aggregateIndex, 0);

const variableBubbleColumns: FastScatterPointColumns = {
  ids: [
    'large-0',
    'large-1',
    'large-2',
    'large-3',
    'large-4',
    'large-5',
    'large-6',
    'large-7',
    'large-8',
    'small-0',
  ],
  x: new Float64Array([20, 20, 20, 20, 20, 20, 20, 20, 20, 80]),
  y: {
    a: new Float64Array([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
  },
};
const variableBubbleAggregation = buildFastScatterBubbleAggregation(
  variableBubbleColumns,
  {
    mode: 'bubble',
    subplots: [
      {
        plotHeightPx: 100,
        plotId: 'a',
        plotWidthPx: 100,
        yKey: 'a',
        yRange: aggregateViewport.yByPlot.a,
      },
    ],
    xRange: aggregateViewport.x,
  },
);
const variableBubbleSubplot = variableBubbleAggregation.subplots[0]!;
const variableBubbleRadii = createFastScatterBubbleRadiusPx(
  variableBubbleSubplot.counts,
  100,
  100,
  1,
);
const uncappedVariableBubblePlotRects: FastScatterPlotRect[] = [
  { heightCssPx: 1000, id: 'a', widthCssPx: 1000, xCssPx: 0, yCssPx: 0 },
];
const uncappedVariableBubbleRadii = createFastScatterBubbleRadiusPx(
  variableBubbleSubplot.counts,
  1000,
  1000,
  1,
);
const scaledVariableBubbleRadii = createFastScatterBubbleRadiusPx(
  variableBubbleSubplot.counts,
  1000,
  1000,
  1.25,
);
const largeBubbleRadius = variableBubbleRadii[0] ?? 0;
const uncappedLargeBubbleRadius = uncappedVariableBubbleRadii[0] ?? 0;
const scaledLargeBubbleRadius = scaledVariableBubbleRadii[0] ?? 0;
assert.equal(variableBubbleSubplot.counts[0], 9);
assert.equal(largeBubbleRadius > 4, true);
assert.equal(
  scaledLargeBubbleRadius.toFixed(4),
  (uncappedLargeBubbleRadius * 1.25).toFixed(4),
);

const variableBubbleEdgeHit = lookupFastScatterAggregateHit({
  aggregation: variableBubbleAggregation,
  bubbleMaxRadiusCssPx: Math.max(...variableBubbleRadii),
  bubbleRadiusCssPx: ({ aggregateIndex }) => variableBubbleRadii[aggregateIndex] ?? 0,
  columns: variableBubbleColumns,
  plotRects: aggregatePlotRects,
  pointerCssX:
    axisToPixel(20, aggregateViewport.x, 0, 100) +
    Math.max(0, largeBubbleRadius - 0.5),
  pointerCssY: axisToPixel(5, aggregateViewport.yByPlot.a, 100, 0),
  viewport: aggregateViewport,
});

assert.equal(variableBubbleEdgeHit.hit?.aggregateKind, 'bubble');
assert.equal(variableBubbleEdgeHit.hit?.count, 9);
assert.equal(variableBubbleEdgeHit.hit?.aggregateIndex, 0);
assert.equal(variableBubbleEdgeHit.hit?.radiusCssPx, largeBubbleRadius);

const scaledVariableBubbleEdgeHit = lookupFastScatterAggregateHit({
  aggregation: variableBubbleAggregation,
  bubbleMaxRadiusCssPx: Math.max(...scaledVariableBubbleRadii),
  bubbleRadiusCssPx: ({ aggregateIndex }) =>
    scaledVariableBubbleRadii[aggregateIndex] ?? 0,
  columns: variableBubbleColumns,
  plotRects: uncappedVariableBubblePlotRects,
  pointerCssX:
    axisToPixel(20, aggregateViewport.x, 0, 1000) +
    Math.max(0, scaledLargeBubbleRadius - 0.5),
  pointerCssY: axisToPixel(5, aggregateViewport.yByPlot.a, 1000, 0),
  viewport: aggregateViewport,
});

assert.equal(scaledVariableBubbleEdgeHit.hit?.aggregateKind, 'bubble');
assert.equal(scaledVariableBubbleEdgeHit.hit?.count, 9);
assert.equal(scaledVariableBubbleEdgeHit.hit?.aggregateIndex, 0);
assert.equal(scaledVariableBubbleEdgeHit.hit?.radiusCssPx, scaledLargeBubbleRadius);

const heatmapAggregation = buildFastScatterHeatmapAggregation(aggregateColumns, {
  heatBinPx: 50,
  mode: 'heatmap',
  subplots: [
    {
      plotHeightPx: 100,
      plotId: 'a',
      plotWidthPx: 100,
      yKey: 'a',
      yRange: aggregateViewport.yByPlot.a,
    },
  ],
  xRange: aggregateViewport.x,
});
const heatmapHit = lookupFastScatterAggregateHit({
  aggregation: heatmapAggregation,
  columns: aggregateColumns,
  plotRects: aggregatePlotRects,
  pointerCssX: axisToPixel(20, aggregateViewport.x, 0, 100),
  pointerCssY: axisToPixel(4, aggregateViewport.yByPlot.a, 100, 0),
  viewport: aggregateViewport,
});

assert.equal(heatmapHit.hit?.aggregateKind, 'heatmap');
assert.equal(heatmapHit.diagnostics.candidateCount, 1);
assert.equal(heatmapHit.hit?.plotId, 'a');
assert.equal(heatmapHit.hit?.count, 2);
assert.equal(heatmapHit.hit?.cellIndex, 0);
assert.deepEqual(heatmapHit.hit?.axis, {
  x: { center: 25, max: 50, min: 0 },
  y: { center: 2.5, max: 5, min: 0 },
});
assert.deepEqual(heatmapHit.hit?.sampleIds, ['agg-0', 'agg-1']);
assert.deepEqual(heatmapHit.hit?.membership, {
  count: 2,
  maxSourceIndex: 1,
  minSourceIndex: 0,
  offset: 0,
});

const emptyHeatmapHit = lookupFastScatterAggregateHit({
  aggregation: heatmapAggregation,
  columns: aggregateColumns,
  plotRects: aggregatePlotRects,
  pointerCssX: axisToPixel(20, aggregateViewport.x, 0, 100),
  pointerCssY: axisToPixel(8, aggregateViewport.yByPlot.a, 100, 0),
  viewport: aggregateViewport,
});

assert.equal(emptyHeatmapHit.hit, null);
assert.equal(emptyHeatmapHit.diagnostics.candidateCount, 0);

const millionPointColumns = createMillionPointColumns();
const millionPointStartedAt = performance.now();
const millionPointHit = lookupFastScatterNearestPoint({
  columns: millionPointColumns,
  maxDistanceCssPx: 8,
  plotRects: [{ heightCssPx: 500, id: 'a', widthCssPx: 1000, xCssPx: 0, yCssPx: 0 }],
  pointerCssX: 500,
  pointerCssY: 250,
  spec: { xLabel: 'x', plots: [spec.plots[0]!] },
  viewport: {
    x: { min: 0, max: 1000 },
    yByPlot: {
      a: { min: 0, max: 100 },
    },
  },
});
const measuredDurationMs = performance.now() - millionPointStartedAt;

assert.notEqual(millionPointHit.hit, null);
assert.equal(millionPointHit.diagnostics.candidateCount <= 16_100, true);
assert.equal(millionPointHit.diagnostics.durationMs <= 16, true);
assert.equal(measuredDurationMs <= 16, true);

console.log('scatter-fast hover lookup tests passed');

function createMillionPointColumns(): FastScatterPointColumns {
  const count = 1_000_000;
  const ids = new Array<string>(count);
  const x = new Float64Array(count);
  const y = new Float64Array(count);

  for (let index = 0; index < count; index += 1) {
    ids[index] = `id-${index}`;
    x[index] = (index / (count - 1)) * 1000;
    y[index] = 50 + Math.sin(index * 0.01) * 0.25;
  }

  return {
    ids,
    x,
    y: {
      a: y,
    },
  };
}
