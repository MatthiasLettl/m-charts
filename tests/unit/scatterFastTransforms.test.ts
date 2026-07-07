import assert from 'node:assert/strict';

import {
  axisToClip,
  axisToPixel,
  calculateFastScatterDomain,
  clipToAxis,
  createDefaultFastScatterViewport,
  createFastScatterPlotRects,
  createPaddedFastScatterDomainRange,
  encodeFastScatterSchemaRows,
  normalizeFastScatterViewport,
  pixelToAxis,
  rectToDevicePixels,
  type FastScatterDatasetSchema,
  type FastScatterPlotSpec,
  type FastScatterPointColumns,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';

const spec: FastScatterPlotSpec = {
  xLabel: 'x',
  plots: [
    { id: 'a', label: 'Metric A', yKey: 'a' },
    { id: 'b', label: 'Metric B', yKey: 'b' },
    { id: 'c', label: 'Metric C', yKey: 'c' },
  ],
};

const columns: FastScatterPointColumns = {
  ids: ['one', 'two', 'three'],
  x: new Float64Array([5, 10, 15]),
  y: {
    a: new Float64Array([1, 1, 1]),
    b: new Float64Array([-2, 0, 2]),
    c: new Float64Array([100, 100.0000000001, 100.0000000002]),
  },
};

const domain = calculateFastScatterDomain(columns, spec);
assert.deepEqual(domain.x, { min: 4.5, max: 15.5 });
assert.deepEqual(domain.yByPlot.b, { min: -2.2, max: 2.2 });
assert.deepEqual(domain.yByPlot.a, { min: -0.1, max: 2.1 });

const viewport = createDefaultFastScatterViewport(domain);
assert.deepEqual(viewport.x, { min: 4.5, max: 15.5 });
assert.deepEqual(viewport.yByPlot.a, { min: -0.1, max: 2.1 });

const normalized = normalizeFastScatterViewport(
  {
    x: { min: Number.NaN, max: 2 },
    yByPlot: {
      a: { min: 2, max: 2 },
      b: { min: 5, max: 4 },
    },
  },
  domain,
);
assert.deepEqual(normalized.x, domain.x);
assert.deepEqual(normalized.yByPlot.a, { min: 1, max: 3 });
assert.deepEqual(normalized.yByPlot.b, domain.yByPlot.b);

const explicitViewport = normalizeFastScatterViewport(
  {
    x: { min: 5, max: 15 },
    yByPlot: {
      a: { min: 0, max: 2 },
      b: { min: -2, max: 2 },
      c: { min: 100, max: 101 },
    },
  },
  domain,
);
assert.deepEqual(explicitViewport.x, { min: 5, max: 15 });
assert.deepEqual(explicitViewport.yByPlot.a, { min: 0, max: 2 });
assert.deepEqual(explicitViewport.yByPlot.b, { min: -2, max: 2 });

for (const value of [5, 7.5, 10, 15]) {
  const pixel = axisToPixel(value, domain.x, 20, 220);
  assertApproximatelyEqual(pixelToAxis(pixel, domain.x, 20, 220), value);
  const invertedPixel = axisToPixel(value, domain.x, 220, 20);
  assertApproximatelyEqual(pixelToAxis(invertedPixel, domain.x, 220, 20), value);
  const clip = axisToClip(value, domain.x);
  assertApproximatelyEqual(clipToAxis(clip, domain.x), value);
}

const smallRangePixel = axisToPixel(100.0000000001, domain.yByPlot.c, 0, 100);
assert.equal(Number.isFinite(smallRangePixel), true);

const paddedDegenerate = createPaddedFastScatterDomainRange(
  { min: 42, max: 42 },
  undefined,
);
assertApproximatelyEqual(paddedDegenerate.min, 39.69);
assertApproximatelyEqual(paddedDegenerate.max, 44.31);

const schema: FastScatterDatasetSchema = {
  columns: [
    { axisType: 'datetime-ns', key: 'time' },
    { axisType: 'categorical', key: 'stage' },
    { axisType: 'boolean', key: 'accepted' },
    { axisType: 'numeric', key: 'signalValue' },
  ],
  plots: [
    { id: 'stage', y: { column: 'stage' } },
    { id: 'accepted', y: { column: 'accepted' } },
    { id: 'signal', y: { column: 'signalValue' } },
  ],
  version: 1,
  x: { column: 'time' },
};
const encoded = encodeFastScatterSchemaRows(
  [
    {
      accepted: false,
      signalValue: 10,
      stage: 'idle',
      time: '1717200000000000000',
    },
    {
      accepted: true,
      signalValue: 25,
      stage: 'run',
      time: '1717200001000000000',
    },
    {
      accepted: true,
      signalValue: 15,
      stage: 'done',
      time: '1717200002500000000',
    },
  ],
  schema,
);
const schemaDomain = calculateFastScatterDomain(encoded.columns, encoded.spec);
assert.deepEqual(schemaDomain.x, { min: -125, max: 2625 });
assert.deepEqual(schemaDomain.yByPlot.stage, { min: -0.5, max: 2.5 });
assert.deepEqual(schemaDomain.yByPlot.accepted, { min: -0.5, max: 1.5 });
assert.deepEqual(schemaDomain.yByPlot.signal, { min: 9.25, max: 25.75 });

const desktopRects = createFastScatterPlotRects(spec, {
  heightCssPx: 720,
  widthCssPx: 1200,
});
assert.equal(desktopRects.length, 3);
assert.equal(desktopRects[0]?.xCssPx, 104);
assert.equal(desktopRects[0]?.widthCssPx, 1084);
assert.equal(desktopRects[1]?.yCssPx, (desktopRects[0]?.heightCssPx ?? 0) + 20);

const mobileRects = createFastScatterPlotRects(spec, {
  gapCssPx: 6,
  heightCssPx: 360,
  leftAxisCssPx: 42,
  navigatorCssPx: 32,
  widthCssPx: 320,
  xAxisCssPx: 24,
});
assert.equal(mobileRects.length, 3);
assert.equal(mobileRects.every((rect) => rect.widthCssPx > 0 && rect.heightCssPx > 0), true);
assert.equal(mobileRects[0]?.widthCssPx, 266);

const deviceRect = rectToDevicePixels(mobileRects[0]!, 2);
assert.equal(deviceRect.xCssPx, 84);
assert.equal(deviceRect.widthCssPx, 532);

function assertApproximatelyEqual(
  actual: number,
  expected: number,
  epsilon = 0.000001,
): void {
  assert.equal(
    Math.abs(actual - expected) <= epsilon,
    true,
    `${actual} should be within ${epsilon} of ${expected}`,
  );
}
