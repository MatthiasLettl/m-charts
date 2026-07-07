import assert from 'node:assert/strict';

import {
  createFastScatterViewportWithSharedX,
  summarizeFastScatterViewportSync,
  type FastScatterPlotSpec,
  type FastScatterViewport,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';

const spec: FastScatterPlotSpec = {
  plots: [
    { id: 'a', label: 'Metric A', yKey: 'a' },
    { id: 'b', label: 'Metric B', yKey: 'b' },
    { id: 'c', label: 'Metric C', yKey: 'c' },
  ],
  xLabel: 'x',
};

const viewport: FastScatterViewport = {
  x: { min: 0, max: 100 },
  yByPlot: {
    a: { min: 0, max: 10 },
    b: { min: -50, max: 50 },
    c: { min: 100, max: 200 },
  },
};

const sharedXOnly = createFastScatterViewportWithSharedX(viewport, {
  min: 20,
  max: 80,
});
assert.deepEqual(sharedXOnly, {
  x: { min: 20, max: 80 },
  yByPlot: viewport.yByPlot,
});
assert.deepEqual(summarizeFastScatterViewportSync(viewport, sharedXOnly, spec), {
  changedYPlotIds: [],
  unchangedYPlotIds: ['a', 'b', 'c'],
  xChanged: true,
});

const singleYOnly: FastScatterViewport = {
  x: viewport.x,
  yByPlot: {
    ...viewport.yByPlot,
    b: { min: -10, max: 10 },
  },
};
assert.deepEqual(summarizeFastScatterViewportSync(viewport, singleYOnly, spec), {
  changedYPlotIds: ['b'],
  unchangedYPlotIds: ['a', 'c'],
  xChanged: false,
});

const sharedXAndSingleY: FastScatterViewport = {
  x: { min: 10, max: 90 },
  yByPlot: {
    ...viewport.yByPlot,
    c: { min: 120, max: 180 },
  },
};
assert.deepEqual(
  summarizeFastScatterViewportSync(viewport, sharedXAndSingleY, spec),
  {
    changedYPlotIds: ['c'],
    unchangedYPlotIds: ['a', 'b'],
    xChanged: true,
  },
);

console.log('scatter-fast viewport sync tests passed');
