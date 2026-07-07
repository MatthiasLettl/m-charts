import assert from 'node:assert/strict';

import {
  createFastScatterAggregationRequest,
  createFastScatterBubbleRadiusPx,
  createFastScatterHeatmapColors,
  normalizeFastScatterHeatmapBinSizePx,
  normalizeFastScatterVisualizationMode,
  resolveFastScatterHeatmapBorderAlpha,
  type FastScatterSubplotRenderPlan,
  type FastScatterTheme,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';

const renderPlan: FastScatterSubplotRenderPlan = {
  items: [
    {
      bufferIndex: 0,
      cssRect: { heightCssPx: 80, id: 'plot-a', widthCssPx: 120, xCssPx: 0, yCssPx: 0 },
      deviceRect: { heightCssPx: 160, id: 'plot-a', widthCssPx: 240, xCssPx: 0, yCssPx: 0 },
      plotId: 'plot-a',
      sharedXRange: { min: 0, max: 10 },
      yKey: 'a',
      yRange: { min: -5, max: 5 },
    },
  ],
  plotAreaPx: 19_200,
  sharedSourceBuffers: true,
  subplotCount: 1,
};

const lightTheme: FastScatterTheme = {
  backgroundColor: [1, 1, 1, 1],
  defaultPointColor: [10, 80, 160, 255],
  selectedOverlayColor: [1, 0.7, 0.1, 0.95],
  subplotBackgroundColor: [0.965, 0.975, 0.988, 1],
};

const darkTheme: FastScatterTheme = {
  backgroundColor: [0.08, 0.1, 0.12, 1],
  defaultPointColor: [90, 180, 255, 255],
  selectedOverlayColor: [1, 0.7, 0.1, 0.95],
  subplotBackgroundColor: [0.12, 0.14, 0.18, 1],
};

assert.equal(normalizeFastScatterVisualizationMode(undefined), 'points');
assert.equal(normalizeFastScatterVisualizationMode('bubble'), 'bubble');
assert.equal(normalizeFastScatterHeatmapBinSizePx(undefined), 12);
assert.equal(normalizeFastScatterHeatmapBinSizePx(18.9), 18);

const bubbleRequest = createFastScatterAggregationRequest({
  displayMode: 'bubble',
  heatmapBinSizePx: undefined,
  hoverSourceIndex: 4,
  renderPlan,
  selectedSourceIndices: new Uint32Array([1, 4]),
  viewport: {
    x: { min: 0, max: 10 },
    yByPlot: { 'plot-a': { min: -5, max: 5 } },
  },
});

assert.deepEqual(bubbleRequest, {
  hoverSourceIndex: 4,
  mode: 'bubble',
  selectedSourceIndices: new Uint32Array([1, 4]),
  subplots: [
    {
      plotHeightPx: 80,
      plotId: 'plot-a',
      plotWidthPx: 120,
      yKey: 'a',
      yRange: { min: -5, max: 5 },
    },
  ],
  xRange: { min: 0, max: 10 },
});

const heatmapRequest = createFastScatterAggregationRequest({
  displayMode: 'heatmap',
  heatmapBinSizePx: undefined,
  hoverSourceIndex: null,
  renderPlan,
  selectedSourceIndices: undefined,
  viewport: {
    x: { min: 0, max: 10 },
    yByPlot: { 'plot-a': { min: -5, max: 5 } },
  },
});

assert.equal(heatmapRequest.mode, 'heatmap');
assert.equal(heatmapRequest.heatBinPx, 12);

const radii = createFastScatterBubbleRadiusPx(new Uint32Array([1, 4, 16]), 120, 80, 2);
assert.equal(radii.length, 3);
assert.equal(radii[0]!.toFixed(4), '8.0000');
assert.equal(radii[1]!.toFixed(4), '12.1600');
assert.equal(radii[2]!.toFixed(4), '28.8000');

const sameCountRadii = createFastScatterBubbleRadiusPx(
  new Uint32Array([2, 2, 9]),
  1000,
  1000,
  1,
);
assert.equal(sameCountRadii[0]!.toFixed(4), '5.0859');
assert.equal(sameCountRadii[1]!.toFixed(4), '5.0859');

const globalMaxRadii = createFastScatterBubbleRadiusPx(
  new Uint32Array([2, 2]),
  1000,
  1000,
  1,
  { maxCount: 9 },
);
assert.equal(globalMaxRadii[0]!.toFixed(4), sameCountRadii[0]!.toFixed(4));
assert.equal(globalMaxRadii[1]!.toFixed(4), sameCountRadii[1]!.toFixed(4));

const proportionalCounts = new Uint32Array([1, 4, 16]);
const baseRadii = createFastScatterBubbleRadiusPx(proportionalCounts, 1000, 1000, 1);
const largerRadii = createFastScatterBubbleRadiusPx(proportionalCounts, 1000, 1000, 1.25);
const smallerRadii = createFastScatterBubbleRadiusPx(proportionalCounts, 1000, 1000, 0.75);
for (let index = 0; index < proportionalCounts.length; index += 1) {
  assert.equal(largerRadii[index]!.toFixed(4), (baseRadii[index]! * 1.25).toFixed(4));
  assert.equal(smallerRadii[index]!.toFixed(4), (baseRadii[index]! * 0.75).toFixed(4));
}
assert.equal(
  (largerRadii[2]! / largerRadii[0]!).toFixed(4),
  (baseRadii[2]! / baseRadii[0]!).toFixed(4),
);
assert.equal(
  (smallerRadii[2]! / smallerRadii[0]!).toFixed(4),
  (baseRadii[2]! / baseRadii[0]!).toFixed(4),
);

assert.equal(resolveFastScatterHeatmapBorderAlpha(10, 24, lightTheme), 0);
assert.equal(resolveFastScatterHeatmapBorderAlpha(24, 24, lightTheme), 0.16);
assert.equal(resolveFastScatterHeatmapBorderAlpha(24, 24, darkTheme), 0.22);

const colors = createFastScatterHeatmapColors(
  new Uint32Array([0, 1, 9]),
  [1, 2],
  lightTheme,
);
assert.equal(colors.length, 8);
assert.ok(colors[3]! < colors[7]!);
assert.notDeepEqual(Array.from(colors.subarray(0, 4)), Array.from(colors.subarray(4, 8)));

console.log('scatter-fast renderer aggregate helper tests passed');
