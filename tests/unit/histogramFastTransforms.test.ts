import assert from 'node:assert/strict';

import {
  buildHistogramAggregation,
  calculateHistogramDomain,
  compareHistogramMeasurementReferences,
  createDefaultHistogramViewport,
  createHistogramLayout,
  createHistogramMeasurementReference,
  histogramAxisToPixel,
  histogramPixelToAxis,
  locateHistogramBinAtPixel,
  lookupHistogramHoverAtPixel,
  normalizeHistogramViewport,
  panHistogramViewportFromDrag,
  resolveHistogramRectangleZoomAxisMode,
  zoomHistogramViewportAtPointer,
  zoomHistogramViewportToRectangle,
  type HistogramPlotSpec,
  type HistogramSubplotId,
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
      domain: { max: 4_000, min: 0 },
      key: 'timestampNs',
      kind: 'datetime-ns',
      label: 'Timestamp',
    },
    {
      categories: [
        { encoded: 0, label: 'Critical', value: 'critical' },
        { encoded: 1, label: 'Normal', value: 'normal' },
      ],
      key: 'status',
      kind: 'categorical',
      label: 'Status',
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
    { id: 'timestampNs', label: 'Timestamp', parameterKey: 'timestampNs' },
    { id: 'status', label: 'Status', parameterKey: 'status' },
    { id: 'active', label: 'Active', parameterKey: 'active' },
  ],
} as const satisfies HistogramPlotSpec;

const aggregation = buildHistogramAggregation(
  {
    ids: ['row-0', 'row-1', 'row-2', 'row-3', 'row-4'],
    valuesByParameter: {
      active: [true, false, true, true, false],
      status: ['critical', 'normal', 'critical', 'normal', 'critical'],
      temperature: [1, 5, 9, null, Number.NaN],
      timestampNs: [500n, 1_500n, 2_500n, 3_500n, null],
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
      {
        binSize: 1_000,
        mode: 'continuous',
        parameterKey: 'timestampNs',
        subplotId: 'timestampNs',
      },
    ],
    plotSpec,
  },
);

const layout = createHistogramLayout(plotSpec, {
  focusedSubplotId: 'timestampNs',
  heightCssPx: 520,
  widthCssPx: 640,
});
const viewport = createDefaultHistogramViewport(aggregation);

assert.equal(layout.plotRects.length, 4);
const temperatureRect = requiredRect('temperature');
const timestampRect = requiredRect('timestampNs');
assert.ok(timestampRect.heightCssPx > temperatureRect.heightCssPx);
for (let index = 1; index < layout.plotRects.length; index += 1) {
  const previous = layout.plotRects[index - 1]!;
  const current = layout.plotRects[index]!;
  assert.ok(current.yCssPx - (previous.yCssPx + previous.heightCssPx) >= 24);
}

assert.deepEqual(viewport.subplotById.temperature?.x, { max: 11, min: -1 });
assert.deepEqual(viewport.subplotById.status?.x, { max: 2, min: -1 });
assert.deepEqual(viewport.subplotById.active?.x, { max: 2, min: -1 });
assert.equal(viewport.subplotById.temperature?.y.min, 0);
assert.equal(viewport.subplotById.status?.y.min, 0);
assert.ok(Math.abs((viewport.subplotById.temperature?.y.max ?? 0) - 1.1) < 1e-9);
assert.ok(Math.abs((viewport.subplotById.status?.y.max ?? 0) - 3.3) < 1e-9);

assert.deepEqual(
  calculateHistogramDomain(
    { valuesByParameter: { constant: new Float32Array([7, 7, 7]) } },
    { key: 'constant', kind: 'numeric', label: 'Constant' },
  ),
  {
    excludedValueCount: 0,
    invalidValueCount: 0,
    missingValueCount: 0,
    outOfDomainValueCount: 0,
    range: { max: 8, min: 7 },
  },
);
assert.deepEqual(
  calculateHistogramDomain(
    { valuesByParameter: { missing: [null, undefined, Number.NaN, 'bad'] } },
    { key: 'missing', kind: 'numeric', label: 'Missing' },
  ),
  {
    excludedValueCount: 4,
    invalidValueCount: 2,
    missingValueCount: 2,
    outOfDomainValueCount: 0,
    range: { max: 1, min: 0 },
  },
);

assertRoundTrip('temperature', 5, 0.5);
assertRoundTrip('timestampNs', 2_500, 0.5);
assertRoundTrip('status', 1, 1.5);
assertRoundTrip('active', 0, 2);

const temperatureHit = locateHistogramBinAtPixel({
  aggregation,
  canvasX: xPixel('temperature', 1),
  canvasY: yPixel('temperature', 0.5),
  ids: ['row-0', 'row-1', 'row-2', 'row-3', 'row-4'],
  layout,
  viewport,
});
assert.equal(temperatureHit?.subplot.subplotId, 'temperature');
assert.equal(temperatureHit?.bin.descriptor.index, 0);
assert.deepEqual(temperatureHit?.binRef.sampleIds, ['row-0']);
assert.ok((temperatureHit?.canvasPoint.canvasX ?? 0) >= temperatureRect.xCssPx);
assert.ok(
  (temperatureHit?.canvasPoint.canvasX ?? 0) <=
    temperatureRect.xCssPx + temperatureRect.widthCssPx,
);
assert.ok((temperatureHit?.canvasPoint.canvasY ?? 0) >= temperatureRect.yCssPx);
assert.ok(
  (temperatureHit?.canvasPoint.canvasY ?? 0) <=
    temperatureRect.yCssPx + temperatureRect.heightCssPx,
);

assert.equal(
  locateHistogramBinAtPixel({
    aggregation,
    canvasX: temperatureRect.xCssPx + 1,
    canvasY: yPixel('temperature', 0.5),
    layout,
    viewport,
  }),
  null,
);
assert.equal(
  locateHistogramBinAtPixel({
    aggregation,
    canvasX: xPixel('temperature', 1),
    canvasY: temperatureRect.yCssPx + 1,
    layout,
    viewport,
  }),
  null,
);

assert.equal(
  locateHistogramBinAtPixel({
    aggregation,
    canvasX: xPixel('temperature', 3),
    canvasY: yPixel('temperature', 0.5),
    layout,
    viewport,
  }),
  null,
);

const statusHit = locateHistogramBinAtPixel({
  aggregation,
  canvasX: xPixel('status', 1),
  canvasY: yPixel('status', 1),
  layout,
  viewport,
});
assert.equal(statusHit?.subplot.subplotId, 'status');
assert.equal(statusHit?.bin.descriptor.category?.label, 'Normal');
const statusRect = requiredRect('status');
assert.ok((statusHit?.canvasPoint.canvasX ?? 0) >= statusRect.xCssPx);
assert.ok(
  (statusHit?.canvasPoint.canvasX ?? 0) <= statusRect.xCssPx + statusRect.widthCssPx,
);
assert.ok((statusHit?.canvasPoint.canvasY ?? 0) >= statusRect.yCssPx);
assert.ok(
  (statusHit?.canvasPoint.canvasY ?? 0) <= statusRect.yCssPx + statusRect.heightCssPx,
);

const hover = lookupHistogramHoverAtPixel({
  aggregation,
  canvasX: xPixel('active', 1),
  canvasY: yPixel('active', 1),
  ids: ['row-0', 'row-1', 'row-2', 'row-3', 'row-4'],
  layout,
  viewport,
});
assert.equal(hover?.source, 'shift-hover');
assert.equal(hover?.bin.count, 3);
assert.deepEqual(hover?.bin.sampleIds, ['row-0', 'row-2', 'row-3']);

const normalized = normalizeHistogramViewport(
  {
    subplotById: {
      active: { x: { max: 1, min: Number.NaN }, y: { max: 0, min: 0 } },
      temperature: { x: { max: 2, min: 8 }, y: { max: 5, min: 1 } },
    },
  },
  viewport,
);
assert.deepEqual(normalized.subplotById.temperature?.x, { max: 8, min: 2 });
assert.deepEqual(normalized.subplotById.active?.x, viewport.subplotById.active?.x);
assert.deepEqual(normalized.subplotById.timestampNs, viewport.subplotById.timestampNs);
assert.equal(normalized.subplotById.unknown, undefined);

const zeroSpanNormalized = normalizeHistogramViewport(
  {
    subplotById: {
      temperature: { x: { max: 4, min: 4 }, y: { max: 2, min: 2 } },
    },
  },
  viewport,
);
assert.deepEqual(zeroSpanNormalized.subplotById.temperature?.x, {
  max: 5,
  min: 3,
});
assert.deepEqual(zeroSpanNormalized.subplotById.temperature?.y, {
  max: 3,
  min: 1,
});

const pan = panHistogramViewportFromDrag({
  currentPointerCssX: xPixel('temperature', 6),
  currentPointerCssY: yPixel('temperature', 0.75),
  layout,
  startPointerCssX: xPixel('temperature', 5),
  startPointerCssY: yPixel('temperature', 0.5),
  startViewport: viewport,
  subplotId: 'temperature',
});
assert.ok(pan !== null);
assert.ok(pan.viewport.subplotById.temperature.x.min < viewport.subplotById.temperature!.x.min);
assert.ok(pan.viewport.subplotById.temperature.y.min < viewport.subplotById.temperature!.y.min);
assert.deepEqual(pan.viewport.subplotById.active, viewport.subplotById.active);

const wheelZoom = zoomHistogramViewportAtPointer({
  axisMode: 'x',
  deltaMode: 0,
  deltaY: -120,
  layout,
  pointerCssX: xPixel('timestampNs', 2_000),
  pointerCssY: yPixel('timestampNs', 0.5),
  viewport,
});
assert.ok(wheelZoom !== null);
assert.equal(wheelZoom.subplotId, 'timestampNs');
assert.ok(
  span(wheelZoom.viewport.subplotById.timestampNs.x) <
    span(viewport.subplotById.timestampNs!.x),
);
assert.deepEqual(
  wheelZoom.viewport.subplotById.timestampNs.y,
  viewport.subplotById.timestampNs?.y,
);

const rectangleZoom = zoomHistogramViewportToRectangle({
  currentPointerCssX: xPixel('temperature', 6),
  currentPointerCssY: yPixel('temperature', 0.25),
  plotRect: temperatureRect,
  startPointerCssX: xPixel('temperature', 2),
  startPointerCssY: yPixel('temperature', 0.9),
  viewport,
});
assert.deepEqual(rectangleZoom?.viewport.subplotById.temperature.x, {
  max: 6,
  min: 2,
});
assert.deepEqual(
  rectangleZoom?.viewport.subplotById.temperature.y,
  viewport.subplotById.temperature?.y,
);

const xyVerticalRectangleZoom = zoomHistogramViewportToRectangle({
  axisMode: 'xy',
  currentPointerCssX: xPixel('temperature', 5.8),
  currentPointerCssY: yPixel('temperature', 0.1),
  plotRect: temperatureRect,
  startPointerCssX: xPixel('temperature', 5.2),
  startPointerCssY: yPixel('temperature', 1),
  viewport,
});
assert.deepEqual(
  xyVerticalRectangleZoom?.viewport.subplotById.temperature.x,
  viewport.subplotById.temperature?.x,
);
assert.ok(xyVerticalRectangleZoom?.viewport.subplotById.temperature.y.max ?? 0 <= 1);
assert.ok(xyVerticalRectangleZoom?.viewport.subplotById.temperature.y.min ?? 1 >= 0.1);

const yOnlyRectangleZoom = zoomHistogramViewportToRectangle({
  axisMode: 'y',
  currentPointerCssX: xPixel('temperature', 5.8),
  currentPointerCssY: yPixel('temperature', 0.1),
  plotRect: temperatureRect,
  startPointerCssX: xPixel('temperature', 5.2),
  startPointerCssY: yPixel('temperature', 1),
  viewport,
});
assert.deepEqual(
  yOnlyRectangleZoom?.viewport.subplotById.temperature.x,
  viewport.subplotById.temperature?.x,
);
assert.ok(yOnlyRectangleZoom?.viewport.subplotById.temperature.y.max ?? 0 <= 1);
assert.ok(yOnlyRectangleZoom?.viewport.subplotById.temperature.y.min ?? 1 >= 0.1);
assert.equal(
  resolveHistogramRectangleZoomAxisMode({
    currentPointerCssX: xPixel('temperature', 7),
    currentPointerCssY: yPixel('temperature', 0.5),
    startPointerCssX: xPixel('temperature', 2),
    startPointerCssY: yPixel('temperature', 0.4),
  }),
  'x',
);
assert.equal(
  resolveHistogramRectangleZoomAxisMode({
    currentPointerCssX: xPixel('temperature', 5.8),
    currentPointerCssY: yPixel('temperature', 0.1),
    startPointerCssX: xPixel('temperature', 5.2),
    startPointerCssY: yPixel('temperature', 1),
  }),
  'y',
);

const reference = createHistogramMeasurementReference(temperatureHit!);
const current = createHistogramMeasurementReference(statusHit!);
assert.ok(reference !== null);
assert.ok(current !== null);
assert.deepEqual(compareHistogramMeasurementReferences(reference, current), {
  countDelta: 1,
  countRatio: 2,
  rangeCenterDelta: 0,
  rangeMaxDelta: -0.5,
  rangeMinDelta: 0.5,
  rangeWidthDelta: -1,
});

const tinyLayout = createHistogramLayout(plotSpec, {
  heightCssPx: 0,
  widthCssPx: 0,
});
assert.equal(tinyLayout.widthCssPx, 0);
assert.equal(tinyLayout.heightCssPx, 0);
assert.equal(
  tinyLayout.plotRects.every(
    (rect) =>
      Number.isFinite(rect.xCssPx) &&
      Number.isFinite(rect.yCssPx) &&
      rect.widthCssPx >= 1 &&
      rect.heightCssPx >= 1,
  ),
  true,
);
assert.equal(
  locateHistogramBinAtPixel({
    aggregation,
    canvasX: Number.NaN,
    canvasY: yPixel('temperature', 0.5),
    layout,
    viewport,
  }),
  null,
);
assert.equal(
  zoomHistogramViewportAtPointer({
    deltaMode: 0,
    deltaY: 0,
    layout,
    pointerCssX: xPixel('temperature', 1),
    pointerCssY: yPixel('temperature', 0.5),
    viewport,
  }),
  null,
);
assert.equal(
  panHistogramViewportFromDrag({
    currentPointerCssX: Number.POSITIVE_INFINITY,
    currentPointerCssY: yPixel('temperature', 0.75),
    layout,
    startPointerCssX: xPixel('temperature', 5),
    startPointerCssY: yPixel('temperature', 0.5),
    startViewport: viewport,
    subplotId: 'temperature',
  }),
  null,
);

function assertRoundTrip(
  subplotId: HistogramSubplotId,
  axisValue: number,
  countValue: number,
): void {
  const subplotViewport = viewport.subplotById[subplotId];
  const rect = requiredRect(subplotId);
  assert.ok(subplotViewport !== undefined);

  const xPixelValue = histogramAxisToPixel(
    axisValue,
    subplotViewport.x,
    rect.xCssPx,
    rect.xCssPx + rect.widthCssPx,
  );
  assert.ok(
    Math.abs(
      histogramPixelToAxis(
        xPixelValue,
        subplotViewport.x,
        rect.xCssPx,
        rect.xCssPx + rect.widthCssPx,
      ) - axisValue,
    ) < 1e-9,
  );

  const yPixelValue = histogramAxisToPixel(
    countValue,
    subplotViewport.y,
    rect.yCssPx + rect.heightCssPx,
    rect.yCssPx,
  );
  assert.ok(
    Math.abs(
      histogramPixelToAxis(
        yPixelValue,
        subplotViewport.y,
        rect.yCssPx + rect.heightCssPx,
        rect.yCssPx,
      ) - countValue,
    ) < 1e-9,
  );
}

function xPixel(subplotId: HistogramSubplotId, value: number): number {
  const subplotViewport = viewport.subplotById[subplotId];
  const rect = requiredRect(subplotId);
  assert.ok(subplotViewport !== undefined);

  return histogramAxisToPixel(
    value,
    subplotViewport.x,
    rect.xCssPx,
    rect.xCssPx + rect.widthCssPx,
  );
}

function yPixel(subplotId: HistogramSubplotId, count: number): number {
  const subplotViewport = viewport.subplotById[subplotId];
  const rect = requiredRect(subplotId);
  assert.ok(subplotViewport !== undefined);

  return histogramAxisToPixel(
    count,
    subplotViewport.y,
    rect.yCssPx + rect.heightCssPx,
    rect.yCssPx,
  );
}

function requiredRect(subplotId: HistogramSubplotId) {
  const rect = layout.plotRects.find((plotRect) => plotRect.id === subplotId);
  assert.ok(rect !== undefined);

  return rect;
}

function span(range: { readonly max: number; readonly min: number }): number {
  return range.max - range.min;
}

console.log('histogram-fast transform tests passed');
