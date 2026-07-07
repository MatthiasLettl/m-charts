import assert from 'node:assert/strict';

import {
  buildFastScatterBubbleAggregation,
  buildFastScatterHeatmapAggregation,
  getFastScatterAggregationByteLength,
  locateFastScatterHeatmapCellAtAxisValue,
  locateFastScatterHeatmapCellAtPixel,
  materializeFastScatterBubbleSourceIndices,
  materializeFastScatterHeatmapCellSourceIndices,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';
import {
  getFastScatterBubbleAggregateAxisBounds,
  getFastScatterBubbleAggregateMembershipSpan,
  getFastScatterHeatmapCellAxisBounds,
  getFastScatterHeatmapCellMembershipSpan,
} from '../../packages/m-charts/src/m-scatter/core/aggregation.ts';

const columns = {
  color: new Uint32Array([
    0x111111ff,
    0x222222ff,
    0x333333ff,
    0x444444ff,
    0x555555ff,
    0x666666ff,
  ]),
  colorFormat: 'rgba32' as const,
  sourceIndex: new Uint32Array([5, 1, 4, 0, 3, 2]),
  x: new Float64Array([0, 1, 1, 1, 2, 3]),
  y: {
    a: new Float64Array([10, 10, 10, 11, 20, Number.POSITIVE_INFINITY]),
    b: new Float64Array([100, 100, 101, 100, Number.NaN, 200]),
  },
};

const bubble = buildFastScatterBubbleAggregation(columns, {
  hoverSourceIndex: 1,
  mode: 'bubble',
  selectedSourceIndices: new Uint32Array([0, 1, 3, 4]),
  subplots: [
    {
      plotHeightPx: 20,
      plotId: 'plot-a',
      plotWidthPx: 20,
      yKey: 'a',
      yRange: { max: 20, min: 10 },
    },
    {
      plotHeightPx: 20,
      plotId: 'plot-b',
      plotWidthPx: 20,
      yKey: 'b',
      yRange: { max: 101, min: 100 },
    },
  ],
  xRange: { max: 2, min: 0 },
});

assert.equal(bubble.kind, 'bubble');
assert.equal(bubble.totalAggregateCount, 7);
assert.equal(bubble.metrics.resultBytes, getFastScatterAggregationByteLength(bubble));

const bubbleA = bubble.subplots[0];
assert.equal(bubbleA?.plotId, 'plot-a');
assert.equal(bubbleA?.aggregateCount, 4);
assert.equal(bubbleA?.singletonCount, 3);
assert.equal(bubbleA?.totalAggregateCount, 4);
assert.deepEqual(Array.from(bubbleA?.centerX ?? []), [0, 1, 1, 2]);
assert.deepEqual(Array.from(bubbleA?.centerY ?? []), [10, 10, 11, 20]);
assert.deepEqual(Array.from(bubbleA?.counts ?? []), [1, 2, 1, 1]);
assert.deepEqual(Array.from(bubbleA?.representativeColor ?? []), [
  0x111111ff,
  0x222222ff,
  0x444444ff,
  0x555555ff,
]);
assert.deepEqual(Array.from(bubbleA?.hovered ?? []), [0, 1, 0, 0]);
assert.deepEqual(Array.from(bubbleA?.selectedCounts ?? []), [0, 2, 1, 1]);
assert.deepEqual(getFastScatterBubbleAggregateMembershipSpan(bubbleA!, 1), {
  count: 2,
  maxSourceIndex: 4,
  minSourceIndex: 1,
  offset: 1,
});
assert.deepEqual(getFastScatterBubbleAggregateAxisBounds(bubbleA!, 1), {
  x: { center: 1, max: 1, min: 1 },
  y: { center: 10, max: 10, min: 10 },
});
assert.deepEqual(
  Array.from({ length: bubbleA?.aggregateCount ?? 0 }, (_, aggregateIndex) =>
    Array.from(materializeFastScatterBubbleSourceIndices(bubbleA!, aggregateIndex)),
  ),
  [[5], [1, 4], [0], [3]],
);

const bubbleB = bubble.subplots[1];
assert.equal(bubbleB?.plotId, 'plot-b');
assert.equal(bubbleB?.aggregateCount, 3);
assert.equal(bubbleB?.singletonCount, 2);
assert.equal(bubbleB?.totalAggregateCount, 3);
assert.deepEqual(Array.from(bubbleB?.centerX ?? []), [0, 1, 1]);
assert.deepEqual(Array.from(bubbleB?.centerY ?? []), [100, 100, 101]);
assert.deepEqual(Array.from(bubbleB?.counts ?? []), [1, 2, 1]);
assert.deepEqual(Array.from(bubbleB?.representativeColor ?? []), [
  0x111111ff,
  0x444444ff,
  0x333333ff,
]);
assert.deepEqual(Array.from(bubbleB?.hovered ?? []), [0, 1, 0]);
assert.deepEqual(Array.from(bubbleB?.selectedCounts ?? []), [0, 2, 1]);
assert.deepEqual(
  Array.from({ length: bubbleB?.aggregateCount ?? 0 }, (_, aggregateIndex) =>
    Array.from(materializeFastScatterBubbleSourceIndices(bubbleB!, aggregateIndex)),
  ),
  [[5], [0, 1], [4]],
);

const heatmap = buildFastScatterHeatmapAggregation(columns, {
  heatBinPx: 10,
  hoverSourceIndex: 1,
  mode: 'heatmap',
  selectedSourceIndices: new Uint32Array([0, 1, 3, 4]),
  subplots: [
    {
      plotHeightPx: 20,
      plotId: 'plot-a',
      plotWidthPx: 20,
      yKey: 'a',
      yRange: { max: 20, min: 10 },
    },
    {
      plotHeightPx: 20,
      plotId: 'plot-b',
      plotWidthPx: 20,
      yKey: 'b',
      yRange: { max: 102, min: 100 },
    },
  ],
  xRange: { max: 2, min: 0 },
});

assert.equal(heatmap.kind, 'heatmap');
assert.equal(heatmap.totalCellCount, 8);
assert.equal(heatmap.totalPopulatedCellCount, 6);
assert.equal(heatmap.metrics.resultBytes, getFastScatterAggregationByteLength(heatmap));

const heatmapA = heatmap.subplots[0];
assert.equal(heatmapA?.plotId, 'plot-a');
assert.equal(heatmapA?.xBinCount, 2);
assert.equal(heatmapA?.yBinCount, 2);
assert.deepEqual(Array.from(heatmapA?.counts ?? []), [1, 3, 0, 1]);
assert.deepEqual(Array.from(heatmapA?.hovered ?? []), [0, 1, 0, 0]);
assert.deepEqual(Array.from(heatmapA?.selectedCounts ?? []), [0, 3, 0, 1]);
assert.deepEqual(getFastScatterHeatmapCellMembershipSpan(heatmapA!, 1), {
  count: 3,
  maxSourceIndex: 4,
  minSourceIndex: 0,
  offset: 1,
});
assert.deepEqual(getFastScatterHeatmapCellMembershipSpan(heatmapA!, 2), {
  count: 0,
  maxSourceIndex: null,
  minSourceIndex: null,
  offset: 4,
});
assert.deepEqual(getFastScatterHeatmapCellAxisBounds(heatmapA!, 1), {
  cellIndex: 1,
  x: { center: 1.5, max: 2, min: 1 },
  xBin: 1,
  y: { center: 12.5, max: 15, min: 10 },
  yBin: 0,
});
assert.deepEqual(
  Array.from({ length: heatmapA?.cellCount ?? 0 }, (_, cellIndex) =>
    Array.from(materializeFastScatterHeatmapCellSourceIndices(heatmapA!, cellIndex)),
  ),
  [[5], [0, 1, 4], [], [3]],
);
assert.deepEqual(
  locateFastScatterHeatmapCellAtAxisValue(heatmapA!, 1.75, 19),
  { cellIndex: 3, xBin: 1, yBin: 1 },
);
assert.deepEqual(
  locateFastScatterHeatmapCellAtAxisValue(heatmapA!, 0, 10),
  { cellIndex: 0, xBin: 0, yBin: 0 },
);
assert.deepEqual(
  locateFastScatterHeatmapCellAtAxisValue(heatmapA!, 2, 20),
  { cellIndex: 3, xBin: 1, yBin: 1 },
);
assert.equal(locateFastScatterHeatmapCellAtAxisValue(heatmapA!, -0.001, 10), null);
assert.equal(locateFastScatterHeatmapCellAtAxisValue(heatmapA!, 0, 20.001), null);
assert.deepEqual(
  locateFastScatterHeatmapCellAtPixel(heatmapA!, 15, 2),
  { cellIndex: 3, xBin: 1, yBin: 1 },
);
assert.deepEqual(
  locateFastScatterHeatmapCellAtPixel(heatmapA!, 0, 20),
  { cellIndex: 0, xBin: 0, yBin: 0 },
);
assert.deepEqual(
  locateFastScatterHeatmapCellAtPixel(heatmapA!, 20, 0),
  { cellIndex: 3, xBin: 1, yBin: 1 },
);
assert.equal(locateFastScatterHeatmapCellAtPixel(heatmapA!, -0.1, 10), null);
assert.equal(locateFastScatterHeatmapCellAtPixel(heatmapA!, 10, 20.1), null);

const heatmapB = heatmap.subplots[1];
assert.equal(heatmapB?.plotId, 'plot-b');
assert.deepEqual(Array.from(heatmapB?.counts ?? []), [1, 2, 0, 1]);
assert.deepEqual(Array.from(heatmapB?.hovered ?? []), [0, 1, 0, 0]);
assert.deepEqual(Array.from(heatmapB?.selectedCounts ?? []), [0, 2, 0, 1]);
assert.deepEqual(
  Array.from({ length: heatmapB?.cellCount ?? 0 }, (_, cellIndex) =>
    Array.from(materializeFastScatterHeatmapCellSourceIndices(heatmapB!, cellIndex)),
  ),
  [[5], [0, 1], [], [4]],
);

console.log('scatter-fast aggregation tests passed');
