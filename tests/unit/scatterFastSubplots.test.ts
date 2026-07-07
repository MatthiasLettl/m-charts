import assert from 'node:assert/strict';

import {
  createFastScatterPlotRects,
  createFastScatterSubplotRenderPlan,
  type FastScatterPlotSpec,
  type FastScatterViewport,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';

const spec: FastScatterPlotSpec = {
  plots: [
    { id: 'a', label: 'Metric A', yKey: 'a' },
    { id: 'b', label: 'Metric B', yKey: 'b' },
    { id: 'c', label: 'Metric C', yKey: 'c' },
  ],
  xLabel: 'Time',
};
const plotBuffers = spec.plots.map((plot) => ({
  plotId: plot.id,
  yKey: plot.yKey,
}));
const plotRects = createFastScatterPlotRects(spec, {
  heightCssPx: 600,
  widthCssPx: 900,
});
const focusedPlotRects = createFastScatterPlotRects(spec, {
  focusedPlotId: 'b',
  heightCssPx: 600,
  widthCssPx: 900,
});
const invalidFocusedPlotRects = createFastScatterPlotRects(spec, {
  focusedPlotId: 'missing',
  heightCssPx: 600,
  widthCssPx: 900,
});
const viewport: FastScatterViewport = {
  x: { min: 10, max: 20 },
  yByPlot: {
    a: { min: 0, max: 1 },
    b: { min: 100, max: 200 },
    c: { min: -50, max: 50 },
  },
};

const plan = createFastScatterSubplotRenderPlan({
  pixelRatio: 2,
  plotBuffers,
  plotRects,
  viewport,
});

assert.equal(plan.subplotCount, 3);
assert.equal(plan.sharedSourceBuffers, true);
assert.deepEqual(
  plan.items.map((item) => item.plotId),
  ['a', 'b', 'c'],
);
assert.deepEqual(
  plan.items.map((item) => item.yKey),
  ['a', 'b', 'c'],
);
assert.equal(plan.items.every((item) => item.sharedXRange === viewport.x), true);
assert.deepEqual(
  plan.items.map((item) => item.yRange),
  [viewport.yByPlot.a, viewport.yByPlot.b, viewport.yByPlot.c],
);
assert.equal(plan.items[0]?.deviceRect.widthCssPx, plotRects[0]!.widthCssPx * 2);
assert.notEqual(plan.items[0]?.deviceRect.yCssPx, plan.items[1]?.deviceRect.yCssPx);
assert.equal(focusedPlotRects.length, 3);
assert.equal(focusedPlotRects[1]?.id, 'b');
assert.equal(
  focusedPlotRects[1]!.heightCssPx > focusedPlotRects[0]!.heightCssPx,
  true,
);
assert.equal(
  focusedPlotRects[1]!.heightCssPx > focusedPlotRects[2]!.heightCssPx,
  true,
);
assert.deepEqual(
  focusedPlotRects.map((rect) => rect.id),
  plotRects.map((rect) => rect.id),
);
assert.equal(
  focusedPlotRects[0]!.yCssPx < focusedPlotRects[1]!.yCssPx &&
    focusedPlotRects[1]!.yCssPx < focusedPlotRects[2]!.yCssPx,
  true,
);
assert.deepEqual(
  invalidFocusedPlotRects.map((rect) => rect.heightCssPx),
  plotRects.map((rect) => rect.heightCssPx),
);

const changedYViewport: FastScatterViewport = {
  ...viewport,
  yByPlot: {
    ...viewport.yByPlot,
    b: { min: 120, max: 140 },
  },
};
const changedYPlan = createFastScatterSubplotRenderPlan({
  pixelRatio: 2,
  plotBuffers,
  plotRects,
  viewport: changedYViewport,
});
assert.deepEqual(changedYPlan.items[0]?.yRange, viewport.yByPlot.a);
assert.deepEqual(changedYPlan.items[1]?.yRange, changedYViewport.yByPlot.b);
assert.deepEqual(changedYPlan.items[2]?.yRange, viewport.yByPlot.c);
assert.equal(changedYPlan.items.every((item) => item.sharedXRange === viewport.x), true);

const changedXViewport: FastScatterViewport = {
  ...viewport,
  x: { min: 12, max: 18 },
};
const changedXPlan = createFastScatterSubplotRenderPlan({
  pixelRatio: 2,
  plotBuffers,
  plotRects,
  viewport: changedXViewport,
});
assert.equal(
  changedXPlan.items.every((item) => item.sharedXRange === changedXViewport.x),
  true,
);
assert.deepEqual(
  changedXPlan.items.map((item) => item.yRange),
  plan.items.map((item) => item.yRange),
);
