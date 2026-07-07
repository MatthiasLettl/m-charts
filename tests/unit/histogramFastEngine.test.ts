import assert from 'node:assert/strict';

import { createHistogramPlot } from '../../packages/m-charts/src/m-histogram/engine/index.ts';
import type {
  HistogramPlotOptions,
  HistogramRendererFactory,
  HistogramRendererLike,
} from '../../packages/m-charts/src/m-histogram/engine/index.ts';
import {
  histogramAxisToPixel,
  normalizeHistogramBarSeries,
  type HistogramBinSizeState,
  type HistogramColumns,
  type HistogramMetricsEvent,
  type HistogramPlotSpec,
  type HistogramRendererRenderMetrics,
  type HistogramRendererUpdate,
  type HistogramViewport,
  type HistogramWebglRendererOptions,
} from '../../packages/m-charts/src/m-histogram/core/index.ts';

interface ListenerRecord {
  listener: EventListener;
  type: string;
}

class FakeClassList {
  constructor(private readonly element: FakeElement) {}

  add(...tokens: string[]): void {
    const current = new Set(this.element.className.split(/\s+/).filter(Boolean));
    for (const token of tokens) {
      current.add(token);
    }
    this.element.className = [...current].join(' ');
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList(this);
  readonly dataset: Record<string, string> = {};
  readonly listeners: ListenerRecord[] = [];
  readonly ownerDocument: FakeDocument;
  readonly style: Record<string, string> = {};
  className = '';
  parentElement: FakeElement | null = null;
  private rect = { height: 0, width: 0 };

  constructor(ownerDocument: FakeDocument) {
    this.ownerDocument = ownerDocument;
  }

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.push({ listener, type });
  }

  append(...children: FakeElement[]): void {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  dispatchEvent(event: Event): boolean {
    for (const record of this.listeners.filter((item) => item.type === event.type)) {
      record.listener(event);
    }
    return !event.defaultPrevented;
  }

  getBoundingClientRect(): DOMRect {
    return {
      bottom: this.rect.height,
      height: this.rect.height,
      left: 0,
      right: this.rect.width,
      top: 0,
      width: this.rect.width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  }

  remove(): void {
    if (this.parentElement === null) {
      return;
    }
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) {
      this.parentElement.children.splice(index, 1);
    }
    this.parentElement = null;
  }

  removeEventListener(type: string, listener: EventListener): void {
    const index = this.listeners.findIndex(
      (record) => record.type === type && record.listener === listener,
    );
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  setAttribute(name: string, value: string): void {
    this.dataset[name] = value;
  }

  setRect(width: number, height: number): void {
    this.rect = { height, width };
  }
}

class FakeCanvasElement extends FakeElement {
  height = 0;
  width = 0;
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return tagName === 'canvas'
      ? new FakeCanvasElement(this)
      : new FakeElement(this);
  }
}

class MockRenderer implements HistogramRendererLike {
  readonly renders: HistogramRendererRenderMetrics[] = [];
  readonly updates: HistogramRendererUpdate[] = [];
  disposed = false;

  constructor(private readonly options: HistogramWebglRendererOptions) {}

  dispose(): void {
    this.disposed = true;
    this.options.onMetrics?.({ at: performance.now(), phase: 'dispose' });
  }

  render(): HistogramRendererRenderMetrics | null {
    if (this.disposed) {
      return null;
    }
    const metrics = {
      drawCalls: 1,
      durationMs: 2,
      gpuTimerSupported: false,
      instanceCount: 3,
      uploadBytes: 4,
      visibleBinCount: 2,
    };
    this.renders.push(metrics);
    this.options.onMetrics?.({
      at: performance.now(),
      drawCalls: metrics.drawCalls,
      durationMs: metrics.durationMs,
      phase: 'render',
      uploadBytes: metrics.uploadBytes,
      visibleBinCount: metrics.visibleBinCount,
    });
    return metrics;
  }

  update(update: HistogramRendererUpdate): void {
    if (this.disposed) {
      return;
    }
    this.updates.push(update);
  }
}

function installDomGlobals(): FakeDocument {
  const document = new FakeDocument();
  Object.assign(globalThis, {
    devicePixelRatio: 2,
    document,
    window: {
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
  return document;
}

const spec = {
  mode: 'histogram',
  parameters: [
    {
      domain: { max: 10, min: 0 },
      key: 'temperature',
      kind: 'numeric',
      label: 'Temperature',
      source: { datasetKey: 'demo', fieldKey: 'temperature_c', tableKey: 'samples' },
    },
    {
      categories: [
        { encoded: 0, label: 'Off', value: false },
        { encoded: 1, label: 'On', value: true },
      ],
      key: 'active',
      kind: 'boolean',
      label: 'Active',
      source: { fieldKey: 'is_active', tableKey: 'samples' },
    },
  ],
  subplots: [
    { id: 'temperature', label: 'Temperature', parameterKey: 'temperature' },
    { id: 'active', label: 'Active', parameterKey: 'active' },
  ],
} as const satisfies HistogramPlotSpec;

const columns: HistogramColumns = {
  ids: ['row-0', 'row-1', 'row-2', 'row-3'],
  sourceIndex: new Uint32Array([0, 1, 2, 3]),
  valuesByParameter: {
    active: [true, false, true, true],
    temperature: [1, 1.5, 5, 9],
  },
};

const binSizes: readonly HistogramBinSizeState[] = [
  {
    binSize: 2,
    mode: 'continuous',
    parameterKey: 'temperature',
    subplotId: 'temperature',
  },
];

function createOptions(rendererFactory: HistogramRendererFactory): HistogramPlotOptions {
  return {
    binSizes,
    columns,
    rendererFactory,
    spec,
  };
}

function pointInTemperatureBin(plot: ReturnType<typeof createHistogramPlot>): {
  x: number;
  y: number;
} {
  const snapshot = plot.commands.getStateSnapshot();
  const rect = snapshot.render.layout.plotRects.find((item) => item.id === 'temperature');
  const viewport = snapshot.viewport.subplotById.temperature;
  assert.ok(rect);
  assert.ok(viewport);
  return {
    x: histogramAxisToPixel(
      1,
      viewport.x,
      rect.xCssPx,
      rect.xCssPx + rect.widthCssPx,
    ),
    y: histogramAxisToPixel(
      1,
      viewport.y,
      rect.yCssPx + rect.heightCssPx,
      rect.yCssPx,
    ),
  };
}

const document = installDomGlobals();
const host = new FakeElement(document);
host.style.position = '';
host.setRect(420, 260);
const renderers: MockRenderer[] = [];
const metricsPhases: Array<HistogramMetricsEvent['phase']> = [];
const rendererFactory: HistogramRendererFactory = (rendererOptions) => {
  const renderer = new MockRenderer(rendererOptions);
  renderers.push(renderer);
  return renderer;
};

const plot = createHistogramPlot(
  host as unknown as HTMLElement,
  createOptions(rendererFactory),
);

assert.equal(host.children.length, 2);
assert.equal(host.style.position, 'relative');
assert.equal(plot.canvas, host.children[0] as unknown as HTMLCanvasElement);
assert.equal(plot.overlayElement, host.children[1] as unknown as HTMLDivElement);
assert.equal(renderers.length, 1);
assert.equal(plot.commands.getStateSnapshot().render.renderState, 'ready');

plot.on('metrics', (event) => metricsPhases.push(event.phase));
const renderMetrics = plot.commands.render();
assert.equal(renderMetrics?.drawCalls, 1);
assert.deepEqual(metricsPhases, ['render']);

const viewportEvents: Array<{ phase: string; reason: string; viewport: HistogramViewport }> = [];
plot.on('viewportchange', (event) => {
  viewportEvents.push(event);
});
const previewViewport: HistogramViewport = {
  subplotById: {
    active: {
      x: { max: 1.5, min: -0.5 },
      y: { max: 4, min: 0 },
    },
    temperature: {
      x: { max: 7, min: 1 },
      y: { max: 3, min: 0 },
    },
  },
};
const aggregationBeforePreview = plot.commands.getStateSnapshot().aggregation;
const renderCountBeforePreview = renderers[0]?.renders.length ?? 0;
plot.commands.setViewport(previewViewport, 'drag', 'preview');
assert.equal(viewportEvents.length, 1);
assert.equal(viewportEvents[0]?.reason, 'drag');
assert.equal(viewportEvents[0]?.phase, 'preview');
assert.equal(plot.commands.getStateSnapshot().aggregation, aggregationBeforePreview);
assert.equal(renderers[0]?.renders.length, renderCountBeforePreview + 1);
const nextViewport: HistogramViewport = {
  subplotById: {
    active: {
      x: { max: 1.5, min: -0.5 },
      y: { max: 4, min: 0 },
    },
    temperature: {
      x: { max: 8, min: 0 },
      y: { max: 3, min: 0 },
    },
  },
};
plot.commands.setViewport(nextViewport);
assert.equal(viewportEvents.length, 2);
assert.equal(viewportEvents[1]?.reason, 'programmatic');
assert.equal(viewportEvents[1]?.phase, 'commit');
assert.deepEqual(renderers[0]?.updates.at(-1)?.viewport, nextViewport);

const aggregationBeforeYOnlyViewport = plot.commands.getStateSnapshot().aggregation;
plot.commands.setViewport({
  subplotById: {
    ...nextViewport.subplotById,
    temperature: {
      ...nextViewport.subplotById.temperature,
      y: { max: 4, min: 1 },
    },
  },
});
assert.equal(plot.commands.getStateSnapshot().aggregation, aggregationBeforeYOnlyViewport);

const silentViewport: HistogramViewport = {
  subplotById: {
    active: nextViewport.subplotById.active!,
    temperature: {
      x: { max: 10, min: 2 },
      y: { max: 3, min: 0 },
    },
  },
};
plot.update({ viewport: silentViewport });
assert.equal(viewportEvents.length, 3);
assert.deepEqual(plot.commands.getStateSnapshot().viewport, silentViewport);

const aggregationBeforeThemeUpdate = plot.commands.getStateSnapshot().aggregation;
plot.update({
  theme: {
    axisColor: [0.1, 0.2, 0.3, 1],
    backgroundColor: [1, 1, 1, 1],
    gridColor: [0.8, 0.8, 0.8, 1],
    labelColor: [0.2, 0.2, 0.2, 1],
    measurementColor: [0.9, 0.2, 0.2, 1],
    selectionColor: [0.2, 0.4, 0.9, 1],
  },
});
assert.equal(plot.commands.getStateSnapshot().aggregation, aggregationBeforeThemeUpdate);
assert.deepEqual(plot.commands.getStateSnapshot().viewport, silentViewport);
plot.update({ axisMode: 'y' });
assert.equal(plot.commands.getStateSnapshot().aggregation, aggregationBeforeThemeUpdate);
assert.deepEqual(plot.commands.getStateSnapshot().viewport, silentViewport);

const hoverEvents: Array<HistogramMetricsEvent['phase'] | 'hover-event'> = [];
plot.on('hoverchange', (event) => {
  hoverEvents.push(event === null ? 'hover-event' : 'hover-event');
});
plot.commands.setViewport(nextViewport);
const pointer = pointInTemperatureBin(plot);
const hover = plot.commands.hoverAtPoint({
  pointerCssX: pointer.x,
  pointerCssY: pointer.y,
  source: 'shift-hover',
});
assert.equal(hover?.bin.bin.subplotId, 'temperature');
assert.deepEqual(hover?.bin.source, {
  datasetKey: 'demo',
  fieldKey: 'temperature_c',
  tableKey: 'samples',
});
assert.equal(plot.commands.getStateSnapshot().hover?.bin.bin.subplotId, 'temperature');
assert.deepEqual(renderers[0]?.updates.at(-1)?.hoverBin, {
  binIndex: 0,
  subplotId: 'temperature',
});
plot.commands.clearHover();
assert.equal(plot.commands.getStateSnapshot().hover, null);
assert.equal(renderers[0]?.updates.at(-1)?.hoverBin, null);
assert.equal(hoverEvents.length, 2);

const selectionEvents: number[] = [];
plot.on('selectionchange', (event) => {
  selectionEvents.push(event.selectedSourceCount);
});
const selection = plot.commands.selectBins({
  binIndices: [0],
  subplotId: 'temperature',
});
assert.deepEqual(Array.from(selection?.sourceIndices ?? []), [0, 1]);
assert.equal(selection?.filters.length, 1);
assert.equal(selection?.filters[0]?.shape, 'programmatic');
assert.equal(selection?.filters[0]?.parameterKey, 'temperature');
assert.deepEqual(selection?.filters[0]?.ranges.value, {
  max: selection?.binDescriptors[0]?.max,
  min: selection?.binDescriptors[0]?.min,
});
assert.equal(plot.commands.getStateSnapshot().selectedSourceIndices.length, 2);
assert.equal(plot.commands.getStateSnapshot().selectionFilters.length, 1);
plot.update({ selectedSourceIndices: selection!.sourceIndices });
assert.equal(plot.commands.getStateSnapshot().selectionFilters.length, 1);
assert.equal(selectionEvents.at(-1), 2);
assert.equal(
  renderers[0]?.updates.at(-1)?.aggregation?.metrics.totalCount,
  plot.commands.getStateSnapshot().aggregation.metrics.totalCount,
);
plot.commands.clearSelection();
assert.equal(selectionEvents.at(-1), 0);
assert.equal(plot.commands.getStateSnapshot().selectedSourceIndices.length, 0);

const booleanSelection = plot.commands.selectBins({
  binIndices: [1],
  subplotId: 'active',
});
assert.equal(booleanSelection?.filters[0]?.dimensions[0]?.valueType, 'boolean');
assert.deepEqual(booleanSelection?.filters[0]?.source, {
  fieldKey: 'is_active',
  tableKey: 'samples',
});
assert.deepEqual(booleanSelection?.filters[0]?.dimensions[0]?.source, {
  fieldKey: 'is_active',
  tableKey: 'samples',
});
assert.deepEqual(booleanSelection?.filters[0]?.dimensions[0]?.values, [
  { encoded: 1, label: 'On', value: true },
]);
plot.commands.clearSelection();

const rectangleSelection = plot.commands.selectRectangle({
  bounds: {
    maxX: pointer.x + 24,
    maxY: pointer.y + 18,
    minX: pointer.x - 24,
    minY: pointer.y - 18,
  },
  subplotId: 'temperature',
});
assert.equal(rectangleSelection?.sourceIndicesAvailable, false);
assert.equal(rectangleSelection?.sourceIndicesStatus, 'pending');
assert.equal(rectangleSelection?.filters.length, 1);
assert.equal(rectangleSelection?.filters[0]?.shape, 'rectangle');
assert.equal(rectangleSelection?.filters[0]?.parameterKey, 'temperature');
assert.notEqual(rectangleSelection?.filters[0]?.ranges.y, undefined);
assert.equal(plot.commands.getStateSnapshot().selectedSourceIndices.length, 0);
const materializedRectangleSelection = plot.commands.materializeSelectionSourceIndices();
assert.equal(materializedRectangleSelection?.sourceIndicesAvailable, true);
assert.equal(materializedRectangleSelection?.sourceIndicesStatus, 'available');
assert.deepEqual(
  Array.from(materializedRectangleSelection?.sourceIndices ?? []),
  [0, 1],
);
plot.commands.clearSelection();

const appendSelection = plot.commands.selectBins({
  binIndices: [0],
  subplotId: 'temperature',
});
assert.deepEqual(Array.from(appendSelection?.sourceIndices ?? []), [0, 1]);
plot.update({ selectedSourceIndices: appendSelection!.sourceIndices });
assert.equal(plot.commands.getStateSnapshot().selectionFilters.length, 1);
const appendedSelection = plot.commands.selectBins({
  binIndices: [1],
  kind: 'append',
  sourceIndices: [2],
  subplotId: 'temperature',
});
assert.equal(appendedSelection?.kind, 'append');
assert.deepEqual(Array.from(appendedSelection?.sourceIndices ?? []), [0, 1, 2]);
assert.equal(appendedSelection?.filters.length, 2);
assert.deepEqual(appendedSelection?.filters.map((filter) => filter.shape), [
  'programmatic',
  'programmatic',
]);
plot.update({ selectedSourceIndices: appendedSelection!.sourceIndices });
assert.equal(plot.commands.getStateSnapshot().selectionFilters.length, 2);
plot.update({ selectedSourceIndices: new Uint32Array([0]) });
assert.deepEqual(plot.commands.getStateSnapshot().selectionFilters, []);
plot.commands.clearSelection();

const activePlotEvents: Array<{ next: string | null; previous: string | null; reason: string }> =
  [];
plot.commands.setActivePlot(null);
plot.on('activeplotchange', (event) => {
  activePlotEvents.push({
    next: event.plotId,
    previous: event.previousPlotId,
    reason: event.reason,
  });
});
plot.commands.setActivePlot('temperature', 'pointer');
plot.commands.setActivePlot('temperature', 'pointer');
assert.deepEqual(activePlotEvents, [
  { next: 'temperature', previous: null, reason: 'pointer' },
]);

const cursorEvents: Array<{ cursor: string; previous: string; reason: string }> = [];
plot.on('cursorchange', (event) => {
  cursorEvents.push({
    cursor: event.cursor,
    previous: event.previousCursor,
    reason: event.reason,
  });
});
plot.commands.setCursorState('crosshair', 'binding');
plot.commands.setCursorState('crosshair', 'binding');
assert.deepEqual(cursorEvents, [
  { cursor: 'crosshair', previous: 'default', reason: 'binding' },
]);

const overlayEvents: Array<{ count: number; reason: string }> = [];
plot.on('overlaychange', (event) => {
  overlayEvents.push({ count: event.overlays.length, reason: event.reason });
});
plot.commands.setOverlays([
  {
    id: 'zoom-preview',
    kind: 'rectangle-zoom',
    rect: { heightCssPx: 40, widthCssPx: 50, xCssPx: 10, yCssPx: 20 },
    subplotId: 'temperature',
  },
  {
    anchor: { xCssPx: 32, yCssPx: 48 },
    id: 'tooltip',
    kind: 'cursor-tooltip',
  },
]);
assert.equal(plot.commands.getOverlays().length, 2);
plot.commands.clearOverlays('rectangle-zoom');
assert.equal(plot.commands.getOverlays().length, 1);
plot.commands.clearOverlays();
assert.deepEqual(overlayEvents, [
  { count: 2, reason: 'set' },
  { count: 1, reason: 'clear' },
  { count: 0, reason: 'clear' },
]);

const measurementEvents: Array<null | string> = [];
plot.on('measurementchange', (event) => {
  measurementEvents.push(event?.reference.bin.subplotId ?? null);
});
const binHit = plot.commands.getBinAtPoint(pointer.x, pointer.y);
assert.ok(binHit);
plot.commands.setMeasurement({
  current: null,
  reference: {
    ...binHit.binRef,
    canvasPoint: binHit.canvasPoint,
  },
});
assert.deepEqual(plot.commands.getStateSnapshot().measurement?.reference.source, {
  datasetKey: 'demo',
  fieldKey: 'temperature_c',
  tableKey: 'samples',
});
plot.commands.setMeasurement(null);
assert.deepEqual(measurementEvents, ['temperature', null]);

const requestEvents: string[] = [];
plot.on('binsizeadjustrequest', (event) => {
  requestEvents.push(`bin:${event.delta}:${event.source}:${event.subplotId}`);
});
plot.on('viewportundorequest', (event) => {
  requestEvents.push(`undo:${event.source}`);
});
plot.commands.requestBinSizeAdjust({
  delta: 1,
  source: 'wheel',
  subplotId: 'temperature',
});
plot.commands.requestViewportUndo('keyboard');
assert.deepEqual(requestEvents, ['bin:1:wheel:temperature', 'undo:keyboard']);

const previewAggregation = plot.commands.setBinSizes({
  binSizes: [
    {
      binSize: 4,
      mode: 'continuous',
      parameterKey: 'temperature',
      subplotId: 'temperature',
    },
  ],
  materializeMembership: false,
});
assert.equal(
  previewAggregation?.subplots.find((subplot) => subplot.subplotId === 'temperature')
    ?.sourceIndicesState,
  'pending',
);
const materializedAggregation = plot.commands.materializeVisibleMembership();
assert.equal(
  materializedAggregation?.subplots.find((subplot) => subplot.subplotId === 'temperature')
    ?.sourceIndicesState,
  'available',
);
plot.commands.setBinSizes({ binSizes, materializeMembership: true });

host.setRect(640, 320);
plot.commands.resize();
assert.equal(renderers[0]?.updates.at(-1)?.layout?.widthCssPx, 640);
assert.equal(renderers[0]?.updates.at(-1)?.layout?.heightCssPx, 320);

let bindingDisposed = false;
const binding = plot.use(() => () => {
  bindingDisposed = true;
});
binding.dispose();
assert.equal(bindingDisposed, true);

const contextEvents: string[] = [];
plot.on('contextlost', () => contextEvents.push('lost'));
plot.on('contextrestored', () => contextEvents.push('restored'));
const contextLost = new Event('webglcontextlost', { cancelable: true });
plot.canvas.dispatchEvent(contextLost);
assert.equal(contextLost.defaultPrevented, true);
assert.equal(renderers[0]?.disposed, true);
plot.canvas.dispatchEvent(new Event('webglcontextrestored'));
assert.equal(renderers.length, 2);
assert.deepEqual(contextEvents, ['lost', 'restored']);

const overlayEventsBeforeDispose = overlayEvents.length;
const requestEventsBeforeDispose = requestEvents.length;
plot.dispose();
assert.equal(host.children.length, 0);
assert.equal(host.style.position, '');
assert.equal(renderers[1]?.disposed, true);

plot.update({ selectedSourceIndices: new Uint32Array([1]) });
plot.commands.render();
plot.commands.resize();
plot.commands.setViewport(nextViewport);
plot.commands.setActivePlot('active');
plot.commands.setCursorState('grabbing');
plot.commands.setOverlays([
  {
    anchor: { xCssPx: 1, yCssPx: 2 },
    bin: binHit.bin.descriptor,
    id: 'disposed-hover',
    kind: 'hover-guide',
    subplotId: 'temperature',
  },
]);
plot.commands.clearOverlays();
plot.commands.requestBinSizeAdjust({ delta: 2 });
plot.commands.requestViewportUndo();
plot.use(() => {
  throw new Error('disposed plot should not attach bindings');
});
assert.equal(renderers[1]?.renders.length, 0);
assert.equal(renderers[1]?.updates.length, 0);
assert.equal(overlayEvents.length, overlayEventsBeforeDispose);
assert.equal(requestEvents.length, requestEventsBeforeDispose);
assert.equal(cursorEvents.length, 1);

const positionedHost = new FakeElement(document);
positionedHost.style.position = 'absolute';
positionedHost.setRect(320, 180);
const positionedPlot = createHistogramPlot(
  positionedHost as unknown as HTMLElement,
  createOptions((rendererOptions) => new MockRenderer(rendererOptions)),
);
positionedPlot.dispose();
assert.equal(positionedHost.style.position, 'absolute');

const barHost = new FakeElement(document);
barHost.setRect(420, 260);
const barAggregation = normalizeHistogramBarSeries({
  bins: [
    { count: 2, max: 10, min: 0, sourceIndices: [40, 41] },
    { count: 3, max: 20, min: 10 },
  ],
  parameterKey: 'temperature',
  subplotId: 'temperature',
});
const barCommandPlot = createHistogramPlot(barHost as unknown as HTMLElement, {
  aggregation: barAggregation,
  rendererFactory: (rendererOptions) => new MockRenderer(rendererOptions),
  spec: { ...spec, mode: 'bar' },
});
const mixedMembershipSelection = barCommandPlot.commands.selectBins({
  binIndices: [0, 1],
  subplotId: 'temperature',
});
assert.equal(mixedMembershipSelection?.selectedBinCount, 2);
assert.equal(mixedMembershipSelection?.sourceIndicesAvailable, false);
assert.equal(mixedMembershipSelection?.selectedSourceCount, 0);
assert.deepEqual(Array.from(mixedMembershipSelection?.sourceIndices ?? []), []);
assert.deepEqual(
  mixedMembershipSelection?.binDescriptors.map((descriptor) => [
    descriptor.min,
    descriptor.max,
  ]),
  [
    [0, 10],
    [10, 20],
  ],
);
const explicitSourceSelection = barCommandPlot.commands.selectBins({
  binIndices: [1],
  sourceIndices: [99],
  subplotId: 'temperature',
});
assert.equal(explicitSourceSelection?.sourceIndicesAvailable, true);
assert.deepEqual(Array.from(explicitSourceSelection?.sourceIndices ?? []), [99]);
barCommandPlot.dispose();

console.log('histogram-fast engine tests passed');
