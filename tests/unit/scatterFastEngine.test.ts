import assert from 'node:assert/strict';

import { createFastScatterPlot } from '../../packages/m-charts/src/m-scatter/engine/index.ts';
import { createFastScatterEngine } from '../../packages/m-charts/src/m-scatter/engine/createScatterEngine.ts';
import type {
  FastScatterEngineRendererLifecycleHandlers,
  FastScatterPlotOptions,
  FastScatterRendererFactory,
  FastScatterRendererLike,
} from '../../packages/m-charts/src/m-scatter/engine/index.ts';
import type {
  FastScatterEasterEggPlaybackOptions,
  FastScatterAggregationSet,
  FastScatterMetricsEvent,
  FastScatterViewport,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';
import {
  FAST_SCATTER_SHAPE_CODES,
  axisToPixel,
  buildFastScatterBubbleAggregation,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';

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
    if (name === 'aria-label') {
      this.dataset.ariaLabel = value;
    }
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

class MockRenderer implements FastScatterRendererLike {
  aggregation: FastScatterAggregationSet | null = null;
  readonly metrics: FastScatterMetricsEvent[] = [];
  readonly easterEggRequests: FastScatterEasterEggPlaybackOptions[] = [];
  readonly resizes: Array<{ dpr: number; height: number; width: number }> = [];
  readonly updates: unknown[] = [];
  disposed = false;
  renderedPointIndices: ReadonlySet<number> | null = null;
  renderCount = 0;

  constructor(private readonly emitMetrics: (metrics: FastScatterMetricsEvent) => void) {}

  dispose(): void {
    this.disposed = true;
    this.emitMetrics({ at: performance.now(), phase: 'dispose' });
  }

  getAggregation(): FastScatterAggregationSet | null {
    return this.aggregation;
  }

  isPointRendered(pointIndex: number): boolean {
    return this.renderedPointIndices?.has(pointIndex) ?? true;
  }

  playEasterEgg(options: FastScatterEasterEggPlaybackOptions = {}): boolean {
    if (this.disposed) {
      return false;
    }
    this.easterEggRequests.push(options);
    return true;
  }

  render(): void {
    if (this.disposed) {
      return;
    }
    this.renderCount += 1;
    const metrics: FastScatterMetricsEvent = {
      at: performance.now(),
      drawCalls: 1,
      phase: 'render',
    };
    this.metrics.push(metrics);
    this.emitMetrics(metrics);
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.disposed) {
      return;
    }
    this.resizes.push({ dpr, height, width });
  }

  update(options: unknown): void {
    if (this.disposed) {
      return;
    }
    this.updates.push(options);
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

function createOptions(
  rendererFactory: FastScatterRendererFactory,
): FastScatterPlotOptions {
  return {
    axisMode: 'xy',
    columns: {
      axisByColumn: {
        x: {
          columnKey: 'x',
          kind: 'numeric',
          parameterName: 'x',
          source: { fieldKey: 'x_ms', tableKey: 'samples' },
          title: 'X',
        },
        y: {
          categories: [
            { encoded: 2, label: 'Two', value: 'two' },
            { encoded: 3, label: 'Three', value: 'three' },
          ],
          columnKey: 'y',
          kind: 'categorical',
          parameterName: 'y',
          source: { datasetKey: 'demo', fieldKey: 'phase', tableKey: 'samples' },
          title: 'Y',
        },
      },
      ids: ['a', 'b'],
      recordIdentityBySourceIndex: [
        { id: 'a', sourceIndex: 0, table: 'samples-a', tableKey: 'samples-a' },
        { id: 'b', sourceIndex: 1, table: 'samples-b', tableKey: 'samples-b' },
      ],
      tableBySourceIndex: ['samples-a', 'samples-b'],
      x: new Float32Array([0, 1]),
      xKey: 'x',
      y: { y: new Float32Array([2, 3]) },
    },
    mode: 'zoom',
    rendererFactory,
    spec: {
      plots: [{ id: 'plot-y', label: 'Y', yKey: 'y' }],
      xLabel: 'X',
    },
    viewport: createViewport(0, 1),
  };
}

function createViewport(min: number, max: number): FastScatterViewport {
  return {
    x: { max, min },
    yByPlot: { 'plot-y': { max, min } },
  };
}

const document = installDomGlobals();
const host = new FakeElement(document);
host.style.position = '';
host.setRect(320, 180);
const renderers: MockRenderer[] = [];
const rendererFactory: FastScatterRendererFactory = (rendererOptions) => {
  const renderer = new MockRenderer(rendererOptions.onMetrics ?? (() => {}));
  renderers.push(renderer);
  return renderer;
};

const plot = createFastScatterPlot(
  host as unknown as HTMLElement,
  createOptions(rendererFactory),
);

assert.equal(host.children.length, 2);
assert.equal(host.style.position, 'relative');
assert.equal(plot.canvas, host.children[0] as unknown as HTMLCanvasElement);
assert.equal(plot.overlayElement, host.children[1] as unknown as HTMLDivElement);
assert.equal(renderers.length, 1);
assert.deepEqual(renderers[0]!.resizes, [{ dpr: 2, height: 180, width: 320 }]);

const renderStates: string[] = [];
const metricsPhases: string[] = [];
plot.on('renderstate', (event) => renderStates.push(event.state));
plot.on('metrics', (event) => metricsPhases.push(event.phase));

plot.commands.render();
assert.equal(renderers[0]!.renderCount, 1);
assert.deepEqual(renderStates, []);
assert.deepEqual(metricsPhases, ['render']);

const nextViewport = createViewport(0.25, 0.75);
let viewportEventReason = '';
let viewportEventPhase = '';
plot.on('viewportchange', (event) => {
  viewportEventPhase = event.phase;
  viewportEventReason = event.reason;
  assert.deepEqual(event.viewport, nextViewport);
});
plot.commands.setViewport(nextViewport);
assert.equal(viewportEventReason, 'programmatic');
assert.equal(viewportEventPhase, 'commit');
assert.deepEqual(renderers[0]!.updates.at(-1), { viewport: nextViewport });
assert.deepEqual(plot.commands.getStateSnapshot().viewport, nextViewport);

plot.commands.setHoverSourceIndex(1);
assert.deepEqual(renderers[0]!.updates.at(-1), { hoverSourceIndex: 1 });
assert.equal(plot.commands.getStateSnapshot().hoverSourceIndex, 1);
const hoverEvents: Array<number | null> = [];
const hoverSources: Array<string | null> = [];
const hoverTables: Array<string | null> = [];
let lastHoverEvent: Parameters<NonNullable<FastScatterPlotOptions['onHoverChange']>>[0] | null = null;
plot.on('hoverchange', (hover) => {
  lastHoverEvent = hover;
  hoverEvents.push(hover?.point.sourceIndex ?? null);
  hoverSources.push(hover?.source ?? null);
  hoverTables.push(hover?.point.record?.table ?? null);
});
plot.update({ hoverSourceIndex: 0 });
assert.equal(renderers[0]!.updates.at(-1)?.hoverSourceIndex, 0);
assert.equal(plot.commands.getStateSnapshot().hoverSourceIndex, 0);
assert.deepEqual(hoverEvents, []);
plot.commands.clearHover();
assert.deepEqual(renderers[0]!.updates.at(-1), { hoverSourceIndex: null });
assert.equal(plot.commands.getStateSnapshot().hoverSourceIndex, null);
assert.deepEqual(hoverEvents, [null]);
plot.commands.setHoverSourceIndex(1);
assert.deepEqual(renderers[0]!.updates.at(-1), { hoverSourceIndex: 1 });
assert.equal(plot.commands.getStateSnapshot().hoverSourceIndex, 1);
assert.deepEqual(hoverEvents, [null, 1]);
assert.deepEqual(hoverSources, [null, 'programmatic']);
assert.deepEqual(hoverTables, [null, 'samples-b']);
assert.equal(plot.commands.playEasterEgg({ holdDurationMs: 12, word: 'Future' }), true);
assert.deepEqual(renderers[0]!.easterEggRequests, [{ holdDurationMs: 12, word: 'Future' }]);
const measurementReference = lastHoverEvent;
assert.equal(measurementReference?.point.record?.tableKey, 'samples-b');
plot.commands.setMeasurement(
  measurementReference === null
    ? null
    : {
        current: {
          ...measurementReference.point,
          canvasPoint: measurementReference.canvasPoint,
        },
        reference: {
          ...measurementReference.point,
          canvasPoint: measurementReference.canvasPoint,
        },
      },
);
assert.equal(
  plot.commands.getStateSnapshot().measurement?.reference.record?.table,
  'samples-b',
);
plot.commands.setMeasurement(null);
plot.commands.setHoverSourceIndex(1);
assert.deepEqual(hoverEvents, [null, 1]);
plot.commands.setHoverSourceIndex(100);
assert.deepEqual(renderers[0]!.updates.at(-1), { hoverSourceIndex: null });
assert.equal(plot.commands.getStateSnapshot().hoverSourceIndex, null);
assert.deepEqual(hoverEvents, [null, 1, null]);
assert.equal(plot.commands.getStateSnapshot().selectedSourceIndices.length, 0);
const selectedSourceIndices = new Uint32Array([1]);
plot.update({ selectedSourceIndices });
assert.equal(plot.commands.getStateSnapshot().selectedSourceIndices, selectedSourceIndices);
assert.deepEqual(plot.commands.getStateSnapshot().selectionFilters, []);
plot.commands.clearSelection();
assert.equal(plot.commands.getStateSnapshot().selectedSourceIndices.length, 0);
const rectangleFilterSelection = plot.commands.selectRectangle({
  bounds: {
    x: { max: 0.25, min: 0 },
    y: { max: 2.25, min: 1.75 },
    yKey: 'y',
  },
  plotId: 'plot-y',
});
assert.equal(rectangleFilterSelection?.filters.length, 1);
plot.update({ selectedSourceIndices: rectangleFilterSelection!.sourceIndices });
assert.equal(plot.commands.getStateSnapshot().selectionFilters.length, 1);
assert.deepEqual(rectangleFilterSelection?.filters[0], {
  dimensions: [
    {
      axis: 'x',
      parameterKey: 'x',
      range: { max: 0.25, min: 0 },
      source: { fieldKey: 'x_ms', tableKey: 'samples' },
      valueType: 'numeric',
    },
    {
      axis: 'y',
      parameterKey: 'y',
      range: { max: 2.25, min: 1.75 },
      source: { datasetKey: 'demo', fieldKey: 'phase', tableKey: 'samples' },
      valueType: 'categorical',
      values: [{ encoded: 2, label: 'Two', value: 'two' }],
    },
  ],
  parameterKey: 'y',
  plotId: 'plot-y',
  ranges: {
    parameter: { max: 2.25, min: 1.75 },
    x: { max: 0.25, min: 0 },
    y: { max: 2.25, min: 1.75 },
  },
  shape: 'rectangle',
  source: { datasetKey: 'demo', fieldKey: 'phase', tableKey: 'samples' },
  yKey: 'y',
});
const appendedRectangleFilterSelection = plot.commands.selectRectangle({
  bounds: {
    x: { max: 1, min: 0.75 },
    y: { max: 3.25, min: 2.75 },
    yKey: 'y',
  },
  kind: 'append',
  plotId: 'plot-y',
});
assert.equal(appendedRectangleFilterSelection?.filters.length, 2);
assert.deepEqual(appendedRectangleFilterSelection?.filters.map((filter) => filter.ranges.x), [
  { max: 0.25, min: 0 },
  { max: 1, min: 0.75 },
]);
assert.equal(plot.commands.getStateSnapshot().selectionFilters.length, 2);
plot.update({ selectedSourceIndices: appendedRectangleFilterSelection!.sourceIndices });
assert.equal(plot.commands.getStateSnapshot().selectionFilters.length, 2);
plot.update({ selectedSourceIndices: new Uint32Array([0]) });
assert.deepEqual(plot.commands.getStateSnapshot().selectionFilters, []);
plot.commands.clearSelection();

const aggregateHost = new FakeElement(document);
aggregateHost.setRect(240, 200);
const aggregateRenderers: MockRenderer[] = [];
const aggregateRendererFactory: FastScatterRendererFactory = (rendererOptions) => {
  const renderer = new MockRenderer(rendererOptions.onMetrics ?? (() => {}));
  aggregateRenderers.push(renderer);
  return renderer;
};
const aggregateOptions: FastScatterPlotOptions = {
  ...createOptions(aggregateRendererFactory),
  columns: {
    ids: ['agg-0', 'agg-1'],
    x: new Float64Array([0.5, 0.5]),
    y: { y: new Float64Array([0.5, 0.5]) },
  },
  mode: 'hover',
  viewport: createViewport(0, 1),
  visualizationMode: 'bubble',
};
const aggregatePlot = createFastScatterPlot(
  aggregateHost as unknown as HTMLElement,
  aggregateOptions,
);
const aggregatePlotRect = aggregatePlot.commands.getPlotRectAtPoint(120, 80);
assert.notEqual(aggregatePlotRect, null);
const aggregatePointer = {
  xCssPx: aggregatePlotRect!.xCssPx + aggregatePlotRect!.widthCssPx / 2,
  yCssPx: aggregatePlotRect!.yCssPx + aggregatePlotRect!.heightCssPx / 2,
};
const aggregateHoverEvents: Array<ReturnType<typeof aggregatePlot.commands.hoverAtPoint>> = [];
aggregatePlot.on('hoverchange', (hover) => {
  aggregateHoverEvents.push(hover);
});

aggregateRenderers[0]!.aggregation = null;
aggregateRenderers[0]!.renderedPointIndices = new Set([1]);
const sampledPointHover = aggregatePlot.commands.hoverAtPoint({
  pointerCssX: aggregatePointer.xCssPx,
  pointerCssY: aggregatePointer.yCssPx,
  source: 'shift-hover',
});
assert.equal(sampledPointHover?.point.sourceIndex, 1);
aggregateRenderers[0]!.renderedPointIndices = null;
const pointHover = aggregatePlot.commands.hoverAtPoint({
  pointerCssX: aggregatePointer.xCssPx,
  pointerCssY: aggregatePointer.yCssPx,
  source: 'shift-hover',
});
assert.equal(pointHover?.point.sourceIndex, 0);
assert.equal(pointHover?.aggregate, undefined);

aggregateRenderers[0]!.aggregation = buildFastScatterBubbleAggregation(
  aggregateOptions.columns,
  {
    mode: 'bubble',
    subplots: [
      {
        plotHeightPx: aggregatePlotRect!.heightCssPx,
        plotId: 'plot-y',
        plotWidthPx: aggregatePlotRect!.widthCssPx,
        yKey: 'y',
        yRange: aggregateOptions.viewport.yByPlot['plot-y']!,
      },
    ],
    xRange: aggregateOptions.viewport.x,
  },
);
const bubbleHover = aggregatePlot.commands.hoverAtPoint({
  pointerCssX: aggregatePointer.xCssPx,
  pointerCssY: aggregatePointer.yCssPx,
  source: 'shift-hover',
});

assert.equal(bubbleHover?.point.sourceIndex, pointHover?.point.sourceIndex);
assert.equal(bubbleHover?.aggregate?.kind, 'bubble');
assert.equal(bubbleHover?.aggregate?.count, 2);
assert.equal(aggregateHoverEvents.length, 3);
assert.equal(aggregateHoverEvents.at(-1)?.aggregate?.kind, 'bubble');
assert.equal(aggregateHoverEvents.at(-1)?.aggregate?.count, 2);
assert.deepEqual(aggregateRenderers[0]!.updates.at(-1), { hoverSourceIndex: 0 });

aggregatePlot.update({ visualizationMode: 'points' });
const pointModeHover = aggregatePlot.commands.hoverAtPoint({
  pointerCssX: aggregatePointer.xCssPx,
  pointerCssY: aggregatePointer.yCssPx,
  source: 'shift-hover',
});
assert.equal(pointModeHover?.point.sourceIndex, pointHover?.point.sourceIndex);
assert.equal(pointModeHover?.aggregate, undefined);
assert.equal(aggregateHoverEvents.length, 4);
assert.equal(aggregateHoverEvents.at(-1)?.aggregate, undefined);

aggregatePlot.dispose();

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
plot.commands.setActivePlot('plot-y', 'pointer');
plot.commands.setActivePlot('plot-y', 'pointer');
assert.deepEqual(activePlotEvents, [
  { next: 'plot-y', previous: null, reason: 'pointer' },
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
    plotId: 'plot-y',
    rect: { heightCssPx: 40, widthCssPx: 50, xCssPx: 10, yCssPx: 20 },
  },
  {
    anchor: { xCssPx: 32, yCssPx: 48 },
    id: 'tooltip',
    kind: 'cursor-tooltip',
    sourceIndex: 1,
  },
]);
assert.equal(plot.commands.getOverlays().length, 3);
plot.commands.clearOverlays('rectangle-zoom');
assert.equal(plot.commands.getOverlays().length, 2);
plot.commands.clearOverlays();
assert.equal(plot.commands.getOverlays().length, 0);
assert.deepEqual(overlayEvents, [
  { count: 3, reason: 'set' },
  { count: 2, reason: 'clear' },
  { count: 0, reason: 'clear' },
]);

const adjustEvents: string[] = [];
plot.on('pointsizeadjustrequest', (event) => {
  adjustEvents.push(`point:${event.delta}:${event.mode}:${event.source}`);
});
plot.on('heatmapbinsizeadjustrequest', (event) => {
  adjustEvents.push(`heatmap:${event.delta}:${event.heatmapBinSizePx}:${event.source}`);
});
plot.on('viewportundorequest', (event) => {
  adjustEvents.push(`undo:${event.source}`);
});
plot.commands.requestPointSizeAdjust({ delta: 1, source: 'wheel' });
plot.commands.requestHeatmapBinSizeAdjust({ delta: -2, heatmapBinSizePx: 16 });
plot.commands.requestViewportUndo('keyboard');
assert.deepEqual(adjustEvents, [
  'point:1:points:wheel',
  'heatmap:-2:16:command',
  'undo:keyboard',
]);

const snapshot = plot.commands.getStateSnapshot();
assert.equal(snapshot.activePlotId, 'plot-y');
assert.equal(snapshot.cursor, 'crosshair');
assert.equal(snapshot.render.renderState, 'ready');

const markerHost = new FakeElement(document);
markerHost.setRect(360, 240);
const markerPlot = createFastScatterPlot(
  markerHost as unknown as HTMLElement,
  {
    ...createOptions((rendererOptions) => new MockRenderer(rendererOptions.onMetrics ?? (() => {}))),
    columns: {
      ids: ['marker-0', 'marker-1'],
      x: new Float64Array([0.25, 0.75]),
      rotation: new Float32Array([0, (Math.PI * 3) / 2]),
      shape: new Uint8Array([
        FAST_SCATTER_SHAPE_CODES.circle,
        FAST_SCATTER_SHAPE_CODES.pin,
      ]),
      size: new Float32Array([4, 10]),
      sourceIndex: new Uint32Array([1, 0]),
      y: {
        y: new Float64Array([0.5, 0.75]),
        z: new Float64Array([0.25, Number.NaN]),
      },
    },
    spec: {
      plots: [
        { id: 'plot-y', label: 'Y', yKey: 'y' },
        { id: 'plot-z', label: 'Z', yKey: 'z' },
      ],
      xLabel: 'X',
    },
    viewport: {
      x: { max: 1, min: 0 },
      yByPlot: {
        'plot-y': { max: 1, min: 0 },
        'plot-z': { max: 1, min: 0 },
      },
    },
    visualizationMode: 'points',
  },
);
assert.equal(markerPlot.commands.togglePointMarker({ sourceIndex: 0 }), true);
assert.deepEqual(markerPlot.commands.getStateSnapshot().pointMarkerSourceIndices, [0]);
assert.equal(
  markerPlot.commands.getOverlays().filter((overlay) => overlay.kind === 'point-marker').length,
  1,
);
const firstMarker = markerPlot.commands
  .getOverlays()
  .find((overlay) => overlay.kind === 'point-marker');
assert.equal(firstMarker?.sourceIndex, 0);
assert.equal(firstMarker?.plotId, 'plot-y');
assert.equal(firstMarker?.label, '0.75');
const markerPlotRect = markerPlot.commands.getPlotRectAtPoint(
  firstMarker?.line.xCssPx ?? 0,
  firstMarker?.point.yCssPx ?? 0,
);
assert.notEqual(markerPlotRect, null);
const markerDataX = axisToPixel(
  0.75,
  markerPlot.commands.getStateSnapshot().viewport.x,
  markerPlotRect!.xCssPx,
  markerPlotRect!.xCssPx + markerPlotRect!.widthCssPx,
);
assert.ok(
  firstMarker !== undefined && firstMarker.line.xCssPx > markerDataX,
  'pin marker should align to the visual center to the right of the data anchor',
);
const firstMarkerX = firstMarker?.line.xCssPx;
markerPlot.commands.setViewport(
  {
    x: { max: 0.5, min: 0 },
    yByPlot: {
      'plot-y': { max: 1, min: 0 },
      'plot-z': { max: 1, min: 0 },
    },
  },
  'programmatic',
);
const movedMarker = markerPlot.commands
  .getOverlays()
  .find((overlay) => overlay.kind === 'point-marker');
assert.notEqual(movedMarker?.line.xCssPx, firstMarkerX);
assert.equal(markerPlot.commands.togglePointMarker({ sourceIndex: 0 }), false);
assert.deepEqual(markerPlot.commands.getStateSnapshot().pointMarkerSourceIndices, []);
assert.equal(
  markerPlot.commands.getOverlays().some((overlay) => overlay.kind === 'point-marker'),
  false,
);
markerPlot.update({ visualizationMode: 'heatmap' });
assert.equal(markerPlot.commands.togglePointMarker({ sourceIndex: 1 }), false);
assert.deepEqual(markerPlot.commands.getStateSnapshot().pointMarkerSourceIndices, []);
markerPlot.dispose();

plot.update({ pointSizeScale: 2 });
assert.equal(
  (renderers[0]!.updates.at(-1) as { pointSizeScale?: number }).pointSizeScale,
  2,
);

plot.update({ focusedPlotId: null });
assert.deepEqual(activePlotEvents, [
  { next: 'plot-y', previous: null, reason: 'pointer' },
]);

host.setRect(640, 240);
plot.commands.resize();
assert.deepEqual(renderers[0]!.resizes.at(-1), { dpr: 2, height: 240, width: 640 });

let bindingDisposed = false;
const binding = plot.use(() => () => {
  bindingDisposed = true;
});
binding.dispose();
assert.equal(bindingDisposed, true);

const contextLost = new Event('webglcontextlost', { cancelable: true });
plot.canvas.dispatchEvent(contextLost);
assert.equal(contextLost.defaultPrevented, true);
assert.equal(renderers[0]!.disposed, true);
assert.deepEqual(metricsPhases.slice(-2), ['context-lost', 'dispose']);

plot.canvas.dispatchEvent(new Event('webglcontextrestored'));
assert.equal(renderers.length, 2);
assert.equal(metricsPhases.at(-1), 'context-restored');

const overlayEventsBeforeDispose = overlayEvents.length;
plot.dispose();
assert.equal(host.children.length, 0);
assert.equal(host.style.position, '');
assert.equal(renderers[1]!.disposed, true);

plot.update({ pointSizeScale: 3 });
plot.commands.render();
plot.commands.resize();
plot.commands.setViewport(createViewport(0, 2));
plot.commands.setActivePlot('plot-y');
plot.commands.setCursorState('grabbing');
plot.commands.setOverlays([
  {
    id: 'disposed-overlay',
    kind: 'hover-guide',
    anchor: { xCssPx: 1, yCssPx: 2 },
  },
]);
plot.commands.clearOverlays();
plot.commands.requestPointSizeAdjust({ delta: 4 });
plot.commands.requestHeatmapBinSizeAdjust({ delta: 4 });
plot.commands.requestViewportUndo();
plot.use(() => {
  throw new Error('disposed plot should not attach bindings');
});
assert.equal(renderers[1]!.renderCount, 0);
assert.equal(renderers[1]!.updates.length, 0);
assert.equal(adjustEvents.length, 3);
assert.equal(overlayEvents.length, overlayEventsBeforeDispose);
assert.equal(cursorEvents.length, 1);

const positionedHost = new FakeElement(document);
positionedHost.style.position = 'absolute';
positionedHost.setRect(320, 180);
const positionedPlot = createFastScatterPlot(
  positionedHost as unknown as HTMLElement,
  createOptions((rendererOptions) => new MockRenderer(rendererOptions.onMetrics ?? (() => {}))),
);
assert.equal(positionedHost.style.position, 'absolute');
positionedPlot.dispose();
assert.equal(positionedHost.style.position, 'absolute');

const asynchronousHost = new FakeElement(document);
asynchronousHost.setRect(320, 180);
let asynchronousLifecycle: FastScatterEngineRendererLifecycleHandlers | null = null;
const asynchronousMetrics: string[] = [];
const asynchronousEvents: string[] = [];
const asynchronousPlot = createFastScatterEngine(
  asynchronousHost as unknown as HTMLElement,
  createOptions(rendererFactory),
  {
    asynchronousReady: true,
    canvasClassName: 'scatter-fast-engine-canvas scatter-fast-webgpu-canvas',
    canvasLabel: 'Asynchronous renderer canvas',
    canvasRenderer: 'test-async',
    createRenderer(rendererOptions, _plotOptions, lifecycle) {
      asynchronousLifecycle = lifecycle;
      return new MockRenderer(rendererOptions.onMetrics ?? (() => {}));
    },
    hostClassName: 'scatter-fast-engine-host scatter-fast-webgpu-host',
  },
);
asynchronousPlot.on('contextlost', () => asynchronousEvents.push('lost'));
asynchronousPlot.on('contextrestored', () => asynchronousEvents.push('restored'));
asynchronousPlot.on('metrics', (event) => asynchronousMetrics.push(event.phase));
assert.equal(asynchronousPlot.commands.getRenderSnapshot().renderState, 'rendering');
assert.equal(
  asynchronousPlot.canvas.className,
  'scatter-fast-engine-canvas scatter-fast-webgpu-canvas',
);
assert.equal(
  asynchronousHost.className,
  'scatter-fast-engine-host scatter-fast-webgpu-host',
);

assert.notEqual(asynchronousLifecycle, null);
const activeAsynchronousLifecycle = asynchronousLifecycle as unknown as FastScatterEngineRendererLifecycleHandlers;
activeAsynchronousLifecycle.onReady();
assert.equal(asynchronousPlot.commands.getRenderSnapshot().renderState, 'ready');
activeAsynchronousLifecycle.onContextLost();
assert.equal(asynchronousPlot.commands.getRenderSnapshot().renderState, 'rendering');
activeAsynchronousLifecycle.onContextRestored();
assert.equal(asynchronousPlot.commands.getRenderSnapshot().renderState, 'ready');
assert.deepEqual(asynchronousEvents, ['lost', 'restored']);
assert.deepEqual(asynchronousMetrics, ['context-lost', 'context-restored']);
activeAsynchronousLifecycle.onError(new Error('asynchronous renderer failed'));
assert.equal(asynchronousPlot.commands.getRenderSnapshot().renderState, 'error');
assert.equal(
  asynchronousPlot.commands.getRenderSnapshot().renderStateMessage,
  'asynchronous renderer failed',
);
asynchronousPlot.dispose();

console.log('scatter-fast engine lifecycle tests passed');
