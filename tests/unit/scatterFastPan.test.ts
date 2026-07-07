import assert from 'node:assert/strict';

import {
  createFastScatterPlotRects,
  panFastScatterViewportFromDrag,
  startFastScatterDragPan,
  type FastScatterPlotSpec,
  type FastScatterViewport,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';
import {
  panFastScatterViewportByFrame,
  panFastScatterViewportByStep,
} from '../../packages/m-charts/src/m-scatter/core/pan.ts';

const spec: FastScatterPlotSpec = {
  plots: [
    { id: 'a', label: 'Metric A', yKey: 'a' },
    { id: 'b', label: 'Metric B', yKey: 'b' },
    { id: 'c', label: 'Metric C', yKey: 'c' },
  ],
  xLabel: 'x',
};
const plotRects = createFastScatterPlotRects(spec, {
  heightCssPx: 600,
  widthCssPx: 900,
});
const viewport: FastScatterViewport = {
  x: { min: 0, max: 100 },
  yByPlot: {
    a: { min: 0, max: 10 },
    b: { min: -50, max: 50 },
    c: { min: 100, max: 200 },
  },
};
const plotB = plotRects[1]!;
const plotC = plotRects[2]!;
const startPointerCssX = plotB.xCssPx + plotB.widthCssPx * 0.5;
const startPointerCssY = plotB.yCssPx + plotB.heightCssPx * 0.5;
const plotCStartPointerCssX = plotC.xCssPx + plotC.widthCssPx * 0.5;
const plotCStartPointerCssY = plotC.yCssPx + plotC.heightCssPx * 0.5;

const hitRect = startFastScatterDragPan(
  plotRects,
  startPointerCssX,
  startPointerCssY,
);
assert.equal(hitRect?.id, 'b');
assert.equal(startFastScatterDragPan(plotRects, 0, 0), null);

const xOnly = panFastScatterViewportFromDrag({
  axisMode: 'x',
  currentPointerCssX: startPointerCssX + plotB.widthCssPx * 0.1,
  currentPointerCssY: startPointerCssY + plotB.heightCssPx * 0.1,
  plotId: 'b',
  plotRects,
  startPointerCssX,
  startPointerCssY,
  startViewport: viewport,
});
assert.notEqual(xOnly, null);
assert.equal(xOnly?.plotId, 'b');
assert.equal(xOnly!.deltaX < 0, true);
assert.equal(xOnly!.viewport.x.min < viewport.x.min, true);
assert.equal(xOnly!.viewport.x.max < viewport.x.max, true);
assert.deepEqual(xOnly?.viewport.yByPlot, viewport.yByPlot);

const yOnly = panFastScatterViewportFromDrag({
  axisMode: 'y',
  currentPointerCssX: startPointerCssX + plotB.widthCssPx * 0.1,
  currentPointerCssY: startPointerCssY + plotB.heightCssPx * 0.1,
  plotId: 'b',
  plotRects,
  startPointerCssX,
  startPointerCssY,
  startViewport: viewport,
});
assert.notEqual(yOnly, null);
assert.deepEqual(yOnly?.viewport.x, viewport.x);
assert.deepEqual(yOnly?.viewport.yByPlot.a, viewport.yByPlot.a);
assert.equal(yOnly!.deltaY > 0, true);
assert.equal(yOnly!.viewport.yByPlot.b.min > viewport.yByPlot.b.min, true);
assert.equal(yOnly!.viewport.yByPlot.b.max > viewport.yByPlot.b.max, true);
assert.deepEqual(yOnly?.viewport.yByPlot.c, viewport.yByPlot.c);

const xy = panFastScatterViewportFromDrag({
  axisMode: 'xy',
  currentPointerCssX: plotCStartPointerCssX - plotC.widthCssPx * 0.1,
  currentPointerCssY: plotCStartPointerCssY - plotC.heightCssPx * 0.1,
  plotId: 'c',
  plotRects,
  startPointerCssX: plotCStartPointerCssX,
  startPointerCssY: plotCStartPointerCssY,
  startViewport: viewport,
});
assert.notEqual(xy, null);
assert.equal(xy!.viewport.x.min > viewport.x.min, true);
assert.deepEqual(xy?.viewport.yByPlot.a, viewport.yByPlot.a);
assert.deepEqual(xy?.viewport.yByPlot.b, viewport.yByPlot.b);
assert.equal(xy!.viewport.yByPlot.c.min < viewport.yByPlot.c.min, true);
assert.equal(xy!.viewport.yByPlot.c.max < viewport.yByPlot.c.max, true);

const missingPlot = panFastScatterViewportFromDrag({
  axisMode: 'xy',
  currentPointerCssX: startPointerCssX,
  currentPointerCssY: startPointerCssY,
  plotId: 'missing',
  plotRects,
  startPointerCssX,
  startPointerCssY,
  startViewport: viewport,
});
assert.equal(missingPlot, null);

const keyboardPanX = panFastScatterViewportByStep({
  axisMode: 'x',
  fraction: 0.25,
  plotId: 'b',
  viewport,
});
assert.notEqual(keyboardPanX, null);
assert.deepEqual(keyboardPanX?.yByPlot, viewport.yByPlot);
assert.deepEqual(keyboardPanX?.x, { min: 25, max: 125 });

const keyboardPanY = panFastScatterViewportByStep({
  axisMode: 'y',
  fraction: -0.5,
  plotId: 'c',
  viewport,
});
assert.notEqual(keyboardPanY, null);
assert.deepEqual(keyboardPanY?.x, viewport.x);
assert.deepEqual(keyboardPanY?.yByPlot.a, viewport.yByPlot.a);
assert.deepEqual(keyboardPanY?.yByPlot.b, viewport.yByPlot.b);
assert.deepEqual(keyboardPanY?.yByPlot.c, { min: 50, max: 150 });

const framePan = panFastScatterViewportByFrame({
  fraction: -1,
  viewport,
});
assert.deepEqual(framePan?.x, { min: -100, max: 0 });
assert.deepEqual(framePan?.yByPlot, viewport.yByPlot);

console.log('scatter-fast pan tests passed');
