import assert from 'node:assert/strict';

import {
  createFastScatterRectangleZoomFeedback,
  createFastScatterPlotRects,
  zoomFastScatterViewportAtPointer,
  zoomFastScatterViewportToRectangle,
  type FastScatterPlotSpec,
  type FastScatterViewport,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';
import { resolveFastScatterRectangleZoomAxisMode } from '../../packages/m-charts/src/m-scatter/core/zoom.ts';

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
const pointerCssX = plotB.xCssPx + plotB.widthCssPx * 0.25;
const pointerCssY = plotB.yCssPx + plotB.heightCssPx * 0.75;

const xOnly = zoomFastScatterViewportAtPointer({
  axisMode: 'x',
  deltaMode: 0,
  deltaY: -120,
  plotRects,
  pointerCssX,
  pointerCssY,
  viewport,
});
assert.notEqual(xOnly, null);
assert.equal(xOnly?.plotId, 'b');
assert.equal(xOnly?.viewport.x.max - xOnly!.viewport.x.min < viewport.x.max - viewport.x.min, true);
assert.deepEqual(xOnly?.viewport.yByPlot, viewport.yByPlot);

const yOnly = zoomFastScatterViewportAtPointer({
  axisMode: 'y',
  deltaMode: 0,
  deltaY: -120,
  plotRects,
  pointerCssX,
  pointerCssY,
  viewport,
});
assert.notEqual(yOnly, null);
assert.deepEqual(yOnly?.viewport.x, viewport.x);
assert.deepEqual(yOnly?.viewport.yByPlot.a, viewport.yByPlot.a);
assert.equal(
  yOnly!.viewport.yByPlot.b.max - yOnly!.viewport.yByPlot.b.min <
    viewport.yByPlot.b.max - viewport.yByPlot.b.min,
  true,
);
assert.deepEqual(yOnly?.viewport.yByPlot.c, viewport.yByPlot.c);

const xy = zoomFastScatterViewportAtPointer({
  axisMode: 'xy',
  deltaMode: 0,
  deltaY: 120,
  plotRects,
  pointerCssX,
  pointerCssY,
  viewport,
});
assert.notEqual(xy, null);
assert.equal(xy!.viewport.x.max - xy!.viewport.x.min > viewport.x.max - viewport.x.min, true);
assert.equal(
  xy!.viewport.yByPlot.b.max - xy!.viewport.yByPlot.b.min >
    viewport.yByPlot.b.max - viewport.yByPlot.b.min,
  true,
);
assert.deepEqual(xy?.viewport.yByPlot.a, viewport.yByPlot.a);
assert.deepEqual(xy?.viewport.yByPlot.c, viewport.yByPlot.c);

const outside = zoomFastScatterViewportAtPointer({
  axisMode: 'xy',
  deltaMode: 0,
  deltaY: -120,
  plotRects,
  pointerCssX: 0,
  pointerCssY: 0,
  viewport,
});
assert.equal(outside, null);

const rectangleX = zoomFastScatterViewportToRectangle({
  axisMode: 'x',
  currentPointerCssX: plotB.xCssPx + plotB.widthCssPx * 0.75,
  currentPointerCssY: plotB.yCssPx + plotB.heightCssPx * 0.9,
  plotRect: plotB,
  startPointerCssX: plotB.xCssPx + plotB.widthCssPx * 0.25,
  startPointerCssY: plotB.yCssPx + plotB.heightCssPx * 0.1,
  viewport,
});
assert.notEqual(rectangleX, null);
assert.equal(rectangleX?.plotId, 'b');
assert.deepEqual(rectangleX?.viewport.x, { min: 25, max: 75 });
assert.deepEqual(rectangleX?.viewport.yByPlot, viewport.yByPlot);

const rectangleY = zoomFastScatterViewportToRectangle({
  axisMode: 'y',
  currentPointerCssX: plotB.xCssPx + plotB.widthCssPx * 0.8,
  currentPointerCssY: plotB.yCssPx + plotB.heightCssPx * 0.25,
  plotRect: plotB,
  startPointerCssX: plotB.xCssPx + plotB.widthCssPx * 0.2,
  startPointerCssY: plotB.yCssPx + plotB.heightCssPx * 0.75,
  viewport,
});
assert.notEqual(rectangleY, null);
assert.deepEqual(rectangleY?.viewport.x, viewport.x);
assert.deepEqual(rectangleY?.viewport.yByPlot.a, viewport.yByPlot.a);
assertRangesNearlyEqual(rectangleY!.viewport.yByPlot.b, { min: -25, max: 25 });
assert.deepEqual(rectangleY?.viewport.yByPlot.c, viewport.yByPlot.c);

const rectangleXy = zoomFastScatterViewportToRectangle({
  axisMode: 'xy',
  currentPointerCssX: plotB.xCssPx + plotB.widthCssPx * 0.9,
  currentPointerCssY: plotB.yCssPx + plotB.heightCssPx * 0.2,
  plotRect: plotB,
  startPointerCssX: plotB.xCssPx + plotB.widthCssPx * 0.1,
  startPointerCssY: plotB.yCssPx + plotB.heightCssPx * 0.8,
  viewport,
});
assert.notEqual(rectangleXy, null);
assertRangesNearlyEqual(rectangleXy!.viewport.x, { min: 10, max: 90 });
assert.deepEqual(rectangleXy?.viewport.yByPlot.b, viewport.yByPlot.b);
assert.deepEqual(rectangleXy?.viewport.yByPlot.a, viewport.yByPlot.a);
assert.deepEqual(rectangleXy?.viewport.yByPlot.c, viewport.yByPlot.c);

const rectangleXyVertical = zoomFastScatterViewportToRectangle({
  axisMode: 'xy',
  currentPointerCssX: plotB.xCssPx + plotB.widthCssPx * 0.55,
  currentPointerCssY: plotB.yCssPx + plotB.heightCssPx * 0.1,
  plotRect: plotB,
  startPointerCssX: plotB.xCssPx + plotB.widthCssPx * 0.45,
  startPointerCssY: plotB.yCssPx + plotB.heightCssPx * 0.9,
  viewport,
});
assert.notEqual(rectangleXyVertical, null);
assert.deepEqual(rectangleXyVertical?.viewport.x, viewport.x);
assertRangesNearlyEqual(rectangleXyVertical!.viewport.yByPlot.b, { min: -40, max: 40 });

const rectangleTooSmall = zoomFastScatterViewportToRectangle({
  axisMode: 'xy',
  currentPointerCssX: plotB.xCssPx + 2,
  currentPointerCssY: plotB.yCssPx + 2,
  plotRect: plotB,
  startPointerCssX: plotB.xCssPx,
  startPointerCssY: plotB.yCssPx,
  viewport,
});
assert.equal(rectangleTooSmall, null);

const constrainedFeedback = createFastScatterRectangleZoomFeedback({
  axisMode: 'xy',
  currentPointerCssX: plotB.xCssPx + plotB.widthCssPx * 0.75,
  currentPointerCssY: plotB.yCssPx + plotB.heightCssPx * 0.75,
  plotRect: plotB,
  startPointerCssX: plotB.xCssPx + plotB.widthCssPx * 0.25,
  startPointerCssY: plotB.yCssPx + plotB.heightCssPx * 0.25,
});
assert.deepEqual(constrainedFeedback, {
  heightCssPx: plotB.heightCssPx,
  plotId: 'b',
  widthCssPx: plotB.widthCssPx * 0.5,
  xCssPx: plotB.xCssPx + plotB.widthCssPx * 0.25,
  yCssPx: plotB.yCssPx,
});

assert.equal(
  resolveFastScatterRectangleZoomAxisMode({
    currentPointerCssX: plotB.xCssPx + plotB.widthCssPx * 0.9,
    currentPointerCssY: plotB.yCssPx + plotB.heightCssPx * 0.55,
    startPointerCssX: plotB.xCssPx + plotB.widthCssPx * 0.1,
    startPointerCssY: plotB.yCssPx + plotB.heightCssPx * 0.45,
  }),
  'x',
);
assert.equal(
  resolveFastScatterRectangleZoomAxisMode({
    currentPointerCssX: plotB.xCssPx + plotB.widthCssPx * 0.55,
    currentPointerCssY: plotB.yCssPx + plotB.heightCssPx * 0.9,
    startPointerCssX: plotB.xCssPx + plotB.widthCssPx * 0.45,
    startPointerCssY: plotB.yCssPx + plotB.heightCssPx * 0.1,
  }),
  'y',
);

function assertRangesNearlyEqual(
  actual: { max: number; min: number },
  expected: { max: number; min: number },
): void {
  assert.equal(Math.abs(actual.min - expected.min) < 1e-9, true);
  assert.equal(Math.abs(actual.max - expected.max) < 1e-9, true);
}

console.log('scatter-fast zoom tests passed');
