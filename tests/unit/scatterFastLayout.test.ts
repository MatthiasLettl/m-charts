import assert from 'node:assert/strict';

import {
  createFastScatterLayout,
  type FastScatterPlotSpec,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';

const singlePlotSpec: FastScatterPlotSpec = {
  plots: [{ id: 'a', label: 'Metric A', yKey: 'a' }],
  xLabel: 'Time',
};

const threePlotSpec: FastScatterPlotSpec = {
  plots: [
    { id: 'a', label: 'Metric A', yKey: 'a' },
    { id: 'b', label: 'Metric B', yKey: 'b' },
    { id: 'c', label: 'Metric C', yKey: 'c' },
  ],
  xLabel: 'Time',
};

const fivePlotSpec: FastScatterPlotSpec = {
  plots: Array.from({ length: 5 }, (_, index) => ({
    id: `p${index}`,
    label: `Metric ${index}`,
    yKey: `p${index}`,
  })),
  xLabel: 'Time',
};

const singleLayout = createFastScatterLayout(singlePlotSpec, {
  heightCssPx: 420,
  widthCssPx: 760,
});
assert.equal(singleLayout.plotRects.length, 1);
assert.equal(singleLayout.plotRects[0]?.xCssPx, singleLayout.chartRect.xCssPx);
assert.equal(singleLayout.navigatorRect?.heightCssPx, 28);
assert.equal(singleLayout.navigatorRect?.yCssPx, 384);
assert.equal(
  singleLayout.plotRects[0]!.yCssPx + singleLayout.plotRects[0]!.heightCssPx,
  singleLayout.navigatorRect!.yCssPx - singleLayout.xAxisReservedCssPx,
);

const threeLayout = createFastScatterLayout(threePlotSpec, {
  heightCssPx: 720,
  widthCssPx: 1200,
});
assert.equal(threeLayout.plotRects.length, 3);
assert.equal(threeLayout.plotRects.every((rect) => rect.widthCssPx === 1084), true);
assert.equal(
  threeLayout.plotRects[0]!.yCssPx < threeLayout.plotRects[1]!.yCssPx &&
    threeLayout.plotRects[1]!.yCssPx < threeLayout.plotRects[2]!.yCssPx,
  true,
);
assert.equal(
  threeLayout.navigatorRect!.yCssPx,
  threeLayout.plotRects[2]!.yCssPx +
    threeLayout.plotRects[2]!.heightCssPx +
    threeLayout.xAxisReservedCssPx,
);
assert.equal(threeLayout.navigatorRect!.heightCssPx, 28);

const focusedLayout = createFastScatterLayout(threePlotSpec, {
  focusedPlotId: 'b',
  heightCssPx: 720,
  widthCssPx: 1200,
});
assert.equal(focusedLayout.plotRects[1]?.id, 'b');
assert.equal(
  focusedLayout.plotRects[1]!.heightCssPx > focusedLayout.plotRects[0]!.heightCssPx,
  true,
);
assert.equal(
  focusedLayout.plotRects[1]!.heightCssPx > focusedLayout.plotRects[2]!.heightCssPx,
  true,
);

const fiveLayout = createFastScatterLayout(fivePlotSpec, {
  heightCssPx: 840,
  widthCssPx: 1100,
});
assert.equal(fiveLayout.plotRects.length, 5);
assert.equal(
  fiveLayout.plotRects.every((rect, index, rects) => {
    const next = rects[index + 1];
    return next === undefined || rect.yCssPx + rect.heightCssPx + 8 <= next.yCssPx;
  }),
  true,
);
assert.equal(
  fiveLayout.navigatorRect!.yCssPx >
    fiveLayout.plotRects[4]!.yCssPx + fiveLayout.plotRects[4]!.heightCssPx,
  true,
);

const narrowLayout = createFastScatterLayout(threePlotSpec, {
  heightCssPx: 360,
  leftAxisCssPx: 42,
  navigatorCssPx: 40,
  widthCssPx: 240,
  xAxisCssPx: 24,
});
assert.equal(narrowLayout.plotRects.every((rect) => rect.widthCssPx > 0), true);
assert.equal(narrowLayout.navigatorRect!.widthCssPx > 0, true);
assert.equal(narrowLayout.navigatorRect!.xCssPx, 56);
assert.equal(narrowLayout.navigatorRect!.heightCssPx, 28);

const shortLayout = createFastScatterLayout(fivePlotSpec, {
  heightCssPx: 128,
  navigatorCssPx: 32,
  widthCssPx: 420,
  xAxisCssPx: 18,
});
assert.equal(shortLayout.plotRects.length, 5);
assert.equal(shortLayout.plotRects.every((rect) => rect.heightCssPx > 0), true);
assert.equal(shortLayout.navigatorRect!.heightCssPx > 0, true);

console.log('scatter-fast layout tests passed');
