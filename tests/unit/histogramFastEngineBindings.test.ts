import assert from 'node:assert/strict';

import {
  createDefaultHistogramBindings,
  createHistogramPlot,
  type HistogramPlotOptions,
  type HistogramRendererFactory,
  type HistogramRendererLike,
} from '../../packages/m-charts/src/m-histogram/engine/index.ts';
import {
  histogramAxisToPixel,
  type HistogramBinSizeState,
  type HistogramColumns,
  type HistogramPlotSpec,
  type HistogramRendererRenderMetrics,
  type HistogramRendererUpdate,
  type HistogramWebglRendererOptions,
} from '../../packages/m-charts/src/m-histogram/core/index.ts';

interface ListenerRecord {
  listener: EventListener;
  type: string;
}

interface FakeDomEvent {
  altKey: boolean;
  button: number;
  buttons: number;
  cancelBubble: boolean;
  clientX: number;
  clientY: number;
  code: string;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  key: string;
  metaKey: boolean;
  pointerId: number;
  pointerType: string;
  repeat: boolean;
  shiftKey: boolean;
  target: FakeElement | null;
  timeStamp: number;
  type: string;
  currentTarget?: FakeElement | FakeWindow;
  preventDefault(): void;
  stopImmediatePropagation(): void;
  stopPropagation(): void;
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
  readonly tagName: string;
  readonly listeners: ListenerRecord[] = [];
  readonly ownerDocument: FakeDocument;
  readonly style: Record<string, string> = {};
  readonly pointerCaptures: number[] = [];
  className = '';
  isContentEditable = false;
  parentElement: FakeElement | null = null;
  private rect = { height: 0, left: 0, top: 0, width: 0 };

  constructor(ownerDocument: FakeDocument, tagName = 'div') {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
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

  contains(target: FakeElement): boolean {
    if (target === this) {
      return true;
    }
    return this.children.some((child) => child.contains(target));
  }

  dispatchEvent(event: FakeDomEvent): boolean {
    event.currentTarget = this;
    event.target ??= this;
    for (const record of this.listeners.filter((item) => item.type === event.type)) {
      record.listener(event as unknown as Event);
    }
    return !event.defaultPrevented;
  }

  getBoundingClientRect(): DOMRect {
    return {
      bottom: this.rect.top + this.rect.height,
      height: this.rect.height,
      left: this.rect.left,
      right: this.rect.left + this.rect.width,
      top: this.rect.top,
      width: this.rect.width,
      x: this.rect.left,
      y: this.rect.top,
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

  setPointerCapture(pointerId: number): void {
    this.pointerCaptures.push(pointerId);
  }

  setRect(width: number, height: number, left = 0, top = 0): void {
    this.rect = { height, left, top, width };
  }
}

class FakeCanvasElement extends FakeElement {
  height = 0;
  width = 0;
}

class FakeDocument {
  readonly defaultView = { Node: FakeElement };

  createElement(tagName: string): FakeElement {
    return tagName === 'canvas'
      ? new FakeCanvasElement(this)
      : new FakeElement(this, tagName);
  }
}

class FakeWindow {
  readonly listeners: ListenerRecord[] = [];

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.push({ listener, type });
  }

  dispatchEvent(event: FakeDomEvent): void {
    event.currentTarget = this;
    for (const record of this.listeners.filter((item) => item.type === event.type)) {
      record.listener(event as unknown as Event);
    }
  }

  removeEventListener(type: string, listener: EventListener): void {
    const index = this.listeners.findIndex(
      (record) => record.type === type && record.listener === listener,
    );
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }
}

class MockRenderer implements HistogramRendererLike {
  readonly updates: HistogramRendererUpdate[] = [];
  disposed = false;

  constructor(private readonly options: HistogramWebglRendererOptions) {}

  dispose(): void {
    this.disposed = true;
  }

  render(): HistogramRendererRenderMetrics | null {
    if (this.disposed) {
      return null;
    }
    const metrics = {
      drawCalls: 1,
      durationMs: 1,
      gpuTimerSupported: false,
      instanceCount: 1,
      uploadBytes: 1,
      visibleBinCount: 1,
    };
    this.options.onMetrics?.({ at: performance.now(), phase: 'render' });
    return metrics;
  }

  update(update: HistogramRendererUpdate): void {
    if (!this.disposed) {
      this.updates.push(update);
    }
  }
}

function installDomGlobals(): { document: FakeDocument; window: FakeWindow } {
  const document = new FakeDocument();
  const window = new FakeWindow();
  Object.assign(globalThis, {
    Node: FakeElement,
    cancelAnimationFrame: () => {},
    devicePixelRatio: 1,
    document,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    },
    window,
  });
  return { document, window };
}

const spec = {
  mode: 'histogram',
  parameters: [
    {
      domain: { max: 10, min: 0 },
      key: 'temperature',
      kind: 'numeric',
      label: 'Temperature',
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
    { id: 'active', label: 'Active', parameterKey: 'active' },
  ],
} as const satisfies HistogramPlotSpec;

const barSpec = {
  ...spec,
  mode: 'bar',
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

function createOptions(
  rendererFactory: HistogramRendererFactory,
  plotSpec: HistogramPlotSpec = spec,
  options: Partial<HistogramPlotOptions> = {},
): HistogramPlotOptions {
  return {
    binSizes,
    columns,
    ...options,
    rendererFactory,
    spec: plotSpec,
  };
}

function event(type: string, init: Partial<FakeDomEvent> = {}): FakeDomEvent {
  return {
    altKey: false,
    button: 0,
    buttons: 0,
    cancelBubble: false,
    clientX: 0,
    clientY: 0,
    code: '',
    ctrlKey: false,
    defaultPrevented: false,
    deltaMode: 0,
    deltaX: 0,
    deltaY: 0,
    deltaZ: 0,
    key: '',
    metaKey: false,
    pointerId: 1,
    pointerType: 'mouse',
    repeat: false,
    shiftKey: false,
    target: null,
    timeStamp: performance.now(),
    type,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {
      this.cancelBubble = true;
    },
    stopPropagation() {
      this.cancelBubble = true;
    },
    ...init,
  };
}

function createBoundPlot(
  plotSpec: HistogramPlotSpec = spec,
  options: Partial<HistogramPlotOptions> = {},
  bindingOptions: Parameters<typeof createDefaultHistogramBindings>[0] = {},
): {
  host: FakeElement;
  input: FakeElement;
  plot: ReturnType<typeof createHistogramPlot>;
  renderers: MockRenderer[];
  window: FakeWindow;
} {
  const { document, window } = installDomGlobals();
  const input = new FakeElement(document);
  const host = new FakeElement(document);
  input.setRect(500, 340, 0, 0);
  host.setRect(420, 260, 40, 30);
  input.append(host);
  const renderers: MockRenderer[] = [];
  const plot = createHistogramPlot(
    host as unknown as HTMLElement,
    createOptions(
      (rendererOptions) => {
        const renderer = new MockRenderer(rendererOptions);
        renderers.push(renderer);
        return renderer;
      },
      plotSpec,
      options,
    ),
  );
  plot.use(
    createDefaultHistogramBindings({
      ...bindingOptions,
      inputElement: input as unknown as HTMLElement,
    }),
  );
  return { host, input, plot, renderers, window };
}

function pointInTemperatureBin(plot: ReturnType<typeof createHistogramPlot>): {
  clientX: number;
  clientY: number;
  hostX: number;
  hostY: number;
} {
  const snapshot = plot.commands.getStateSnapshot();
  const rect = snapshot.render.layout.plotRects.find((item) => item.id === 'temperature');
  const viewport = snapshot.viewport.subplotById.temperature;
  assert.ok(rect);
  assert.ok(viewport);
  const hostX = histogramAxisToPixel(
    1,
    viewport.x,
    rect.xCssPx,
    rect.xCssPx + rect.widthCssPx,
  );
  const hostY = histogramAxisToPixel(
    1,
    viewport.y,
    rect.yCssPx + rect.heightCssPx,
    rect.yCssPx,
  );
  return {
    clientX: hostX + 40,
    clientY: hostY + 30,
    hostX,
    hostY,
  };
}

const coordinatePlot = createBoundPlot();
const coordinateEvents: string[] = [];
coordinatePlot.plot.on('binsizeadjustrequest', (request) => {
  coordinateEvents.push(`${request.subplotId}:${request.delta}:${request.source}`);
});
const coordinatePoint = pointInTemperatureBin(coordinatePlot.plot);
const coordinateViewportBefore = coordinatePlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature;
assert.ok(coordinateViewportBefore);
const coordinateWheel = event('wheel', {
  clientX: coordinatePoint.clientX,
  clientY: coordinatePoint.clientY,
  deltaY: -100,
});
coordinatePlot.input.dispatchEvent(coordinateWheel);
assert.deepEqual(coordinateEvents, ['temperature:-1:wheel']);
assert.equal(coordinateWheel.defaultPrevented, true);
assert.deepEqual(
  coordinatePlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature,
  coordinateViewportBefore,
);
coordinatePlot.input.dispatchEvent(
  event('wheel', {
    clientX: Number.NaN,
    clientY: coordinatePoint.clientY,
    deltaY: -100,
  }),
);
coordinatePlot.input.dispatchEvent(
  event('pointermove', {
    clientX: Number.POSITIVE_INFINITY,
    clientY: coordinatePoint.clientY,
    shiftKey: true,
  }),
);
assert.deepEqual(coordinateEvents, ['temperature:-1:wheel']);
coordinatePlot.plot.dispose();

const tinyPlot = createBoundPlot();
tinyPlot.host.setRect(0, 0, 40, 30);
tinyPlot.plot.commands.resize();
assert.doesNotThrow(() => {
  tinyPlot.input.dispatchEvent(event('wheel', { clientX: 40, clientY: 30, deltaY: -80 }));
  tinyPlot.input.dispatchEvent(
    event('pointerdown', {
      button: 0,
      buttons: 1,
      clientX: 40,
      clientY: 30,
      pointerId: 5,
    }),
  );
});
tinyPlot.plot.dispose();

const dragPlot = createBoundPlot();
const zoomBrushEvents: string[] = [];
for (const eventName of ['brushstart', 'brushpreview', 'brushcommit', 'brushcancel'] as const) {
  dragPlot.plot.on(eventName, (brush) => {
    zoomBrushEvents.push(
      `${brush.phase}:${brush.shape}:${brush.defaultAction}:${brush.target.parameterKey}:${Number.isFinite(brush.range?.value?.min)}`,
    );
  });
}
const beforeDrag = dragPlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature;
assert.ok(beforeDrag);
const dragStart = pointInTemperatureBin(dragPlot.plot);
dragPlot.input.dispatchEvent(
  event('pointerdown', {
    button: 0,
    buttons: 1,
    clientX: dragStart.clientX,
    clientY: dragStart.clientY,
    pointerId: 7,
  }),
);
dragPlot.window.dispatchEvent(
  event('pointermove', {
    buttons: 1,
    clientX: dragStart.clientX + 120,
    clientY: dragStart.clientY + 40,
    pointerId: 7,
    target: new FakeElement(dragPlot.host.ownerDocument),
  }),
);
dragPlot.window.dispatchEvent(
  event('pointerup', {
    button: 0,
    clientX: dragStart.clientX + 120,
    clientY: dragStart.clientY + 40,
    pointerId: 7,
  }),
);
const afterDrag = dragPlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature;
assert.ok(afterDrag);
assert.notDeepEqual(afterDrag.x, beforeDrag.x);
assert.equal(dragPlot.input.pointerCaptures.at(-1), 7);
assert.deepEqual(zoomBrushEvents.slice(-3), [
  'start:rectangle:zoom:temperature:true',
  'preview:rectangle:zoom:temperature:true',
  'commit:rectangle:zoom:temperature:true',
]);
dragPlot.plot.dispose();

const wheelZoomPlot = createBoundPlot();
const wheelPoint = pointInTemperatureBin(wheelZoomPlot.plot);
const beforeAltZoom = wheelZoomPlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature;
assert.ok(beforeAltZoom);
wheelZoomPlot.input.dispatchEvent(
  event('wheel', {
    altKey: true,
    clientX: wheelPoint.clientX,
    clientY: wheelPoint.clientY,
    deltaY: 80,
  }),
);
const afterAltZoom = wheelZoomPlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature;
assert.ok(afterAltZoom);
assert.notDeepEqual(afterAltZoom.x, beforeAltZoom.x);
assert.deepEqual(afterAltZoom.y, beforeAltZoom.y);
const beforeShiftZoom = afterAltZoom;
wheelZoomPlot.input.dispatchEvent(
  event('wheel', {
    clientX: wheelPoint.clientX,
    clientY: wheelPoint.clientY,
    deltaX: 70,
    shiftKey: true,
  }),
);
const afterShiftZoom = wheelZoomPlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature;
assert.ok(afterShiftZoom);
assert.deepEqual(afterShiftZoom.x, beforeShiftZoom.x);
assert.notDeepEqual(afterShiftZoom.y, beforeShiftZoom.y);
const beforeCtrlZoom = afterShiftZoom;
wheelZoomPlot.input.dispatchEvent(
  event('wheel', {
    clientX: wheelPoint.clientX,
    clientY: wheelPoint.clientY,
    ctrlKey: true,
    deltaY: -90,
  }),
);
const afterCtrlZoom = wheelZoomPlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature;
assert.ok(afterCtrlZoom);
assert.notDeepEqual(afterCtrlZoom.x, beforeCtrlZoom.x);
assert.notDeepEqual(afterCtrlZoom.y, beforeCtrlZoom.y);
wheelZoomPlot.plot.dispose();

const barWheelPlot = createBoundPlot(barSpec);
barWheelPlot.plot.update({
  aggregation: {
    ...barWheelPlot.plot.commands.getStateSnapshot().aggregation,
    mode: 'bar',
  },
});
const barRequests: string[] = [];
barWheelPlot.plot.on('binsizeadjustrequest', (request) => {
  barRequests.push(`${request.subplotId}:${request.delta}`);
});
const barPoint = pointInTemperatureBin(barWheelPlot.plot);
barWheelPlot.input.dispatchEvent(
  event('wheel', {
    clientX: barPoint.clientX,
    clientY: barPoint.clientY,
    deltaY: -100,
  }),
);
assert.deepEqual(barRequests, []);
barWheelPlot.plot.dispose();

const appendPlot = createBoundPlot();
const appendSelections: Array<{ count: number; kind: string; tool: string }> = [];
const appendBrushEvents: string[] = [];
appendPlot.plot.on('selectionchange', (selection) => {
  appendSelections.push({
    count: selection.selectedSourceCount,
    kind: selection.kind,
    tool: selection.tool,
  });
});
for (const eventName of ['brushstart', 'brushpreview', 'brushcommit', 'brushcancel'] as const) {
  appendPlot.plot.on(eventName, (brush) => {
    appendBrushEvents.push(
      `${brush.phase}:${brush.shape}:${brush.defaultAction}:${brush.target.parameterKey}:${brush.modifiers.ctrlKey}:${Number.isFinite(brush.range?.value?.min)}`,
    );
  });
}
const appendPoint = pointInTemperatureBin(appendPlot.plot);
appendPlot.input.dispatchEvent(
  event('pointerdown', {
    button: 2,
    buttons: 2,
    clientX: appendPoint.clientX,
    clientY: appendPoint.clientY,
    pointerId: 12,
  }),
);
appendPlot.input.dispatchEvent(
  event('pointermove', {
    buttons: 2,
    clientX: appendPoint.clientX + 80,
    clientY: appendPoint.clientY + 40,
    pointerId: 12,
  }),
);
assert.equal(
  appendPlot.plot.commands.getOverlays().some((overlay) => overlay.kind === 'rectangle-selection'),
  true,
);
appendPlot.input.dispatchEvent(
  event('pointerup', {
    button: 2,
    clientX: appendPoint.clientX + 80,
    clientY: appendPoint.clientY + 40,
    pointerId: 12,
  }),
);
assert.equal(appendSelections[0]?.kind, 'replace');
assert.equal(appendSelections[0]?.tool, 'rectangle');
assert.deepEqual(appendBrushEvents.slice(-3), [
  'start:rectangle:select:temperature:false:true',
  'preview:rectangle:select:temperature:false:true',
  'commit:rectangle:select:temperature:false:true',
]);
assert.equal(
  appendPlot.plot.commands.getOverlays().some((overlay) => overlay.kind === 'rectangle-selection'),
  false,
);
assert.equal(
  appendPlot.plot.commands.getOverlays().some((overlay) => overlay.kind === 'committed-selection'),
  false,
);
appendPlot.input.dispatchEvent(
  event('pointerdown', {
    button: 2,
    buttons: 2,
    clientX: appendPoint.clientX,
    clientY: appendPoint.clientY,
    ctrlKey: true,
    pointerId: 13,
  }),
);
appendPlot.input.dispatchEvent(
  event('pointermove', {
    buttons: 2,
    clientX: appendPoint.clientX + 80,
    clientY: appendPoint.clientY + 40,
    ctrlKey: true,
    pointerId: 13,
  }),
);
appendPlot.input.dispatchEvent(
  event('pointerup', {
    button: 2,
    clientX: appendPoint.clientX + 80,
    clientY: appendPoint.clientY + 40,
    ctrlKey: true,
    pointerId: 13,
  }),
);
assert.equal(appendSelections.at(-1)?.kind, 'append');
assert.equal(appendSelections.at(-1)?.tool, 'rectangle');
assert.deepEqual(appendBrushEvents.slice(-3), [
  'start:rectangle:select:temperature:true:true',
  'preview:rectangle:select:temperature:true:true',
  'commit:rectangle:select:temperature:true:true',
]);
assert.ok((appendSelections.at(-1)?.count ?? 0) >= (appendSelections[0]?.count ?? 0));
assert.equal(
  appendPlot.plot.commands.getOverlays().some((overlay) => overlay.kind === 'rectangle-selection'),
  false,
);
assert.equal(
  appendPlot.plot.commands.getOverlays().some((overlay) => overlay.kind === 'committed-selection'),
  false,
);

appendPlot.plot.update({ mode: 'lasso' });
const lassoPoints = [
  { x: appendPoint.clientX, y: appendPoint.clientY },
  { x: appendPoint.clientX + 80, y: appendPoint.clientY },
  { x: appendPoint.clientX + 80, y: appendPoint.clientY + 40 },
  { x: appendPoint.clientX, y: appendPoint.clientY + 40 },
];
appendPlot.input.dispatchEvent(
  event('pointerdown', {
    button: 2,
    buttons: 2,
    clientX: lassoPoints[0]!.x,
    clientY: lassoPoints[0]!.y,
    pointerId: 14,
  }),
);
for (const point of lassoPoints.slice(1)) {
  appendPlot.input.dispatchEvent(
    event('pointermove', {
      buttons: 2,
      clientX: point.x,
      clientY: point.y,
      pointerId: 14,
    }),
  );
}
assert.equal(
  appendPlot.plot.commands.getOverlays().some((overlay) => overlay.kind === 'lasso'),
  true,
);
appendPlot.input.dispatchEvent(
  event('pointerup', {
    button: 2,
    clientX: lassoPoints[0]!.x,
    clientY: lassoPoints[0]!.y,
    pointerId: 14,
  }),
);
assert.equal(appendSelections.at(-1)?.kind, 'replace');
assert.equal(appendSelections.at(-1)?.tool, 'lasso');
assert.ok(appendBrushEvents.includes('start:lasso:select:temperature:false:true'));
assert.ok(appendBrushEvents.includes('preview:lasso:select:temperature:false:true'));
assert.equal(
  appendBrushEvents.at(-1),
  'commit:lasso:select:temperature:false:true',
);
assert.equal(
  appendPlot.plot.commands.getOverlays().some((overlay) => overlay.kind === 'lasso'),
  false,
);
assert.equal(
  appendPlot.plot.commands.getOverlays().some((overlay) => overlay.kind === 'committed-selection'),
  false,
);

appendPlot.plot.update({ mode: 'select' });
appendPlot.input.dispatchEvent(event('keydown', { code: 'Space', key: ' ' }));
appendPlot.input.dispatchEvent(
  event('pointerdown', {
    button: 2,
    buttons: 2,
    clientX: lassoPoints[0]!.x,
    clientY: lassoPoints[0]!.y,
    ctrlKey: true,
    pointerId: 15,
  }),
);
for (const point of lassoPoints.slice(1)) {
  appendPlot.input.dispatchEvent(
    event('pointermove', {
      buttons: 2,
      clientX: point.x,
      clientY: point.y,
      ctrlKey: true,
      pointerId: 15,
    }),
  );
}
appendPlot.input.dispatchEvent(
  event('pointerup', {
    button: 2,
    clientX: lassoPoints[0]!.x,
    clientY: lassoPoints[0]!.y,
    ctrlKey: true,
    pointerId: 15,
  }),
);
appendPlot.input.dispatchEvent(event('keyup', { code: 'Space', key: ' ' }));
assert.equal(appendSelections.at(-1)?.kind, 'append');
assert.equal(appendSelections.at(-1)?.tool, 'lasso');
assert.equal(
  appendBrushEvents.at(-1),
  'commit:lasso:select:temperature:true:true',
);

const inputSpaceKey = event('keydown', {
  code: 'Space',
  key: ' ',
  target: new FakeElement(appendPlot.host.ownerDocument, 'input'),
});
appendPlot.input.dispatchEvent(inputSpaceKey);
assert.equal(inputSpaceKey.defaultPrevented, false);
appendPlot.input.dispatchEvent(
  event('pointerdown', {
    button: 2,
    buttons: 2,
    clientX: appendPoint.clientX,
    clientY: appendPoint.clientY,
    pointerId: 16,
  }),
);
appendPlot.input.dispatchEvent(
  event('pointermove', {
    buttons: 2,
    clientX: appendPoint.clientX + 80,
    clientY: appendPoint.clientY + 40,
    pointerId: 16,
  }),
);
assert.equal(
  appendPlot.plot.commands.getOverlays().some((overlay) => overlay.kind === 'rectangle-selection'),
  true,
);
appendPlot.input.dispatchEvent(
  event('pointerup', {
    button: 2,
    clientX: appendPoint.clientX + 80,
    clientY: appendPoint.clientY + 40,
    pointerId: 16,
  }),
);
assert.equal(appendSelections.at(-1)?.kind, 'replace');
assert.equal(appendSelections.at(-1)?.tool, 'rectangle');

const appendSelectionCountBeforeRightClick = appendSelections.length;
appendPlot.input.dispatchEvent(
  event('pointerdown', {
    button: 2,
    buttons: 2,
    clientX: appendPoint.clientX,
    clientY: appendPoint.clientY,
    pointerId: 17,
  }),
);
appendPlot.input.dispatchEvent(
  event('pointerup', {
    button: 2,
    clientX: appendPoint.clientX,
    clientY: appendPoint.clientY,
    pointerId: 17,
  }),
);
assert.equal(appendSelections.length, appendSelectionCountBeforeRightClick);
assert.deepEqual(appendBrushEvents.slice(-2), [
  'start:rectangle:select:temperature:false:true',
  'cancel:rectangle:select:temperature:false:true',
]);

const appendEscape = event('keydown', { code: 'Escape', key: 'Escape' });
appendPlot.input.dispatchEvent(appendEscape);
assert.equal(appendEscape.defaultPrevented, true);
assert.equal(appendPlot.plot.commands.getOverlays().some((overlay) => overlay.kind === 'committed-selection'), false);
assert.equal(appendSelections.at(-1)?.count, 0);
appendPlot.plot.dispose();

const colorBrushPlot = createBoundPlot(
  spec,
  {},
  {
    rectangleBrushGestures: [
      { axisMode: 'x', button: 0, defaultAction: 'none', modifiers: { ctrlKey: true } },
      { axisMode: 'x', button: 0, defaultAction: 'none', modifiers: { shiftKey: true } },
    ],
  },
);
const colorBrushPoint = pointInTemperatureBin(colorBrushPlot.plot);
const colorBrushRect = colorBrushPlot.plot.commands.getPlotRectAtPoint(
  colorBrushPoint.clientX,
  colorBrushPoint.clientY,
);
assert.notEqual(colorBrushRect, null);
const colorBrushEvents: string[] = [];
const colorBrushProjectionChecks: boolean[] = [];
const colorBrushBinCounts: number[] = [];
colorBrushPlot.plot.on('brushcommit', (brush) => {
  colorBrushEvents.push(
    `${brush.defaultAction}:${brush.target.parameterKey}:${brush.modifiers.ctrlKey}:${brush.modifiers.shiftKey}`,
  );
  if (brush.defaultAction === 'none') {
    colorBrushBinCounts.push(brush.range?.bins?.length ?? 0);
    const rect = brush.cssGeometry?.shape === 'rectangle' ? brush.cssGeometry.rect : null;
    colorBrushProjectionChecks.push(
      brush.range?.y?.min === colorBrushViewportBefore.subplotById.temperature?.y.min &&
        brush.range.y.max === colorBrushViewportBefore.subplotById.temperature?.y.max &&
        rect?.yCssPx === colorBrushRect?.yCssPx &&
        rect.heightCssPx === colorBrushRect?.heightCssPx,
    );
  }
});
const colorBrushViewportBefore =
  colorBrushPlot.plot.commands.getStateSnapshot().viewport;
for (const [pointerId, modifiers] of [
  [21, { ctrlKey: true, shiftKey: false }],
  [22, { ctrlKey: false, shiftKey: true }],
] as const) {
  colorBrushPlot.input.dispatchEvent(
    event('pointerdown', {
      button: 0,
      buttons: 1,
      clientX: colorBrushPoint.clientX,
      clientY: colorBrushPoint.clientY,
      ctrlKey: modifiers.ctrlKey,
      pointerId,
      shiftKey: modifiers.shiftKey,
    }),
  );
  colorBrushPlot.input.dispatchEvent(
    event('pointermove', {
      buttons: 1,
      clientX: colorBrushPoint.clientX + 80,
      clientY: colorBrushPoint.clientY + 30,
      ctrlKey: modifiers.ctrlKey,
      pointerId,
      shiftKey: modifiers.shiftKey,
    }),
  );
  colorBrushPlot.input.dispatchEvent(
    event('pointerup', {
      button: 0,
      clientX: colorBrushPoint.clientX + 80,
      clientY: colorBrushPoint.clientY + 30,
      ctrlKey: modifiers.ctrlKey,
      pointerId,
      shiftKey: modifiers.shiftKey,
    }),
  );
}
assert.deepEqual(colorBrushEvents, [
  'none:temperature:true:false',
  'none:temperature:false:true',
]);
assert.deepEqual(colorBrushProjectionChecks, [true, true]);
assert.ok(colorBrushBinCounts.every((count) => count > 0));
assert.deepEqual(
  colorBrushPlot.plot.commands.getStateSnapshot().viewport,
  colorBrushViewportBefore,
);
colorBrushPlot.input.dispatchEvent(
  event('pointerdown', {
    altKey: true,
    button: 0,
    buttons: 1,
    clientX: colorBrushPoint.clientX,
    clientY: colorBrushPoint.clientY,
    ctrlKey: false,
    pointerId: 23,
    shiftKey: true,
  }),
);
colorBrushPlot.input.dispatchEvent(
  event('pointermove', {
    altKey: true,
    buttons: 1,
    clientX: colorBrushPoint.clientX + 80,
    clientY: colorBrushPoint.clientY + 24,
    ctrlKey: false,
    pointerId: 23,
    shiftKey: true,
  }),
);
colorBrushPlot.input.dispatchEvent(
  event('pointerup', {
    altKey: true,
    button: 0,
    clientX: colorBrushPoint.clientX + 80,
    clientY: colorBrushPoint.clientY + 24,
    ctrlKey: false,
    pointerId: 23,
    shiftKey: true,
  }),
);
const colorBrushForcedViewport =
  colorBrushPlot.plot.commands.getStateSnapshot().viewport;
assert.notDeepEqual(
  colorBrushForcedViewport.subplotById.temperature?.x,
  colorBrushViewportBefore.subplotById.temperature?.x,
);
assert.notDeepEqual(
  colorBrushForcedViewport.subplotById.temperature?.y,
  colorBrushViewportBefore.subplotById.temperature?.y,
);
assert.deepEqual(colorBrushEvents, [
  'none:temperature:true:false',
  'none:temperature:false:true',
  'zoom:temperature:false:true',
]);
colorBrushPlot.plot.dispose();

const xyColorBrushPlot = createBoundPlot(
  spec,
  {},
  {
    rectangleBrushGestures: [
      { axisMode: 'xy', button: 0, defaultAction: 'none', modifiers: { ctrlKey: true } },
    ],
  },
);
const xyColorBrushPoint = pointInTemperatureBin(xyColorBrushPlot.plot);
const xyColorBrushRect = xyColorBrushPlot.plot.commands.getPlotRectAtPoint(
  xyColorBrushPoint.clientX,
  xyColorBrushPoint.clientY,
);
assert.notEqual(xyColorBrushRect, null);
const xyColorBrushChecks: string[] = [];
xyColorBrushPlot.plot.on('brushcommit', (brush) => {
  if (brush.defaultAction !== 'none') {
    return;
  }
  const rect = brush.cssGeometry?.shape === 'rectangle' ? brush.cssGeometry.rect : null;
  xyColorBrushChecks.push(
    [
      (brush.range?.bins?.length ?? 0) > 0,
      rect?.yCssPx !== xyColorBrushRect?.yCssPx,
      rect?.heightCssPx !== xyColorBrushRect?.heightCssPx,
      brush.range?.y?.min !== xyColorBrushViewportBefore.subplotById.temperature?.y.min,
      brush.range?.y?.max !== xyColorBrushViewportBefore.subplotById.temperature?.y.max,
    ].join(':'),
  );
});
const xyColorBrushViewportBefore =
  xyColorBrushPlot.plot.commands.getStateSnapshot().viewport;
xyColorBrushPlot.input.dispatchEvent(
  event('pointerdown', {
    button: 0,
    buttons: 1,
    clientX: xyColorBrushPoint.clientX,
    clientY: xyColorBrushPoint.clientY,
    ctrlKey: true,
    pointerId: 24,
  }),
);
xyColorBrushPlot.input.dispatchEvent(
  event('pointermove', {
    buttons: 1,
    clientX: xyColorBrushPoint.clientX + 80,
    clientY: xyColorBrushPoint.clientY + 30,
    ctrlKey: true,
    pointerId: 24,
  }),
);
xyColorBrushPlot.input.dispatchEvent(
  event('pointerup', {
    button: 0,
    clientX: xyColorBrushPoint.clientX + 80,
    clientY: xyColorBrushPoint.clientY + 30,
    ctrlKey: true,
    pointerId: 24,
  }),
);
assert.deepEqual(xyColorBrushChecks, ['true:true:true:true:true']);
assert.deepEqual(
  xyColorBrushPlot.plot.commands.getStateSnapshot().viewport,
  xyColorBrushViewportBefore,
);
xyColorBrushPlot.plot.dispose();

const leftSelectPlot = createBoundPlot(spec, { mode: 'select' });
const leftSelectEvents: Array<{ count: number; kind: string }> = [];
leftSelectPlot.plot.on('selectionchange', (selection) => {
  leftSelectEvents.push({
    count: selection.selectedSourceCount,
    kind: selection.kind,
  });
});
const leftSelectPoint = pointInTemperatureBin(leftSelectPlot.plot);
leftSelectPlot.input.dispatchEvent(
  event('pointerdown', {
    button: 0,
    buttons: 1,
    clientX: leftSelectPoint.clientX,
    clientY: leftSelectPoint.clientY,
    pointerId: 17,
  }),
);
const leftSelectBefore = leftSelectPlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature;
assert.ok(leftSelectBefore);
leftSelectPlot.input.dispatchEvent(
  event('pointermove', {
    buttons: 1,
    clientX: leftSelectPoint.clientX + 90,
    clientY: leftSelectPoint.clientY + 40,
    pointerId: 17,
  }),
);
leftSelectPlot.input.dispatchEvent(
  event('pointerup', {
    button: 0,
    clientX: leftSelectPoint.clientX + 90,
    clientY: leftSelectPoint.clientY + 40,
    pointerId: 17,
  }),
);
const leftSelectAfter = leftSelectPlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature;
assert.ok(leftSelectAfter);
assert.notDeepEqual(leftSelectAfter.x, leftSelectBefore.x);
assert.equal(leftSelectEvents.length, 0);
leftSelectPlot.plot.dispose();

const leftZoomPlot = createBoundPlot(spec, { axisMode: 'x', mode: 'zoom' });
const leftZoomBefore = leftZoomPlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature;
assert.ok(leftZoomBefore);
const leftZoomPoint = pointInTemperatureBin(leftZoomPlot.plot);
leftZoomPlot.input.dispatchEvent(
  event('pointerdown', {
    button: 0,
    buttons: 1,
    clientX: leftZoomPoint.clientX,
    clientY: leftZoomPoint.clientY,
    pointerId: 18,
  }),
);
leftZoomPlot.input.dispatchEvent(
  event('pointermove', {
    buttons: 1,
    clientX: leftZoomPoint.clientX + 120,
    clientY: leftZoomPoint.clientY + 50,
    pointerId: 18,
  }),
);
leftZoomPlot.input.dispatchEvent(
  event('pointerup', {
    button: 0,
    clientX: leftZoomPoint.clientX + 120,
    clientY: leftZoomPoint.clientY + 50,
    pointerId: 18,
  }),
);
const leftZoomAfter = leftZoomPlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature;
assert.ok(leftZoomAfter);
assert.notDeepEqual(leftZoomAfter.x, leftZoomBefore.x);
assert.deepEqual(leftZoomAfter.y, leftZoomBefore.y);
assert.equal(
  leftZoomPlot.plot.commands
    .getOverlays()
    .filter((overlay) => overlay.kind === 'rectangle-zoom').length,
  0,
);
leftZoomPlot.plot.dispose();

const verticalZoomPlot = createBoundPlot(spec, { axisMode: 'x', mode: 'zoom' });
const verticalZoomBefore =
  verticalZoomPlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature;
assert.ok(verticalZoomBefore);
const verticalZoomPoint = pointInTemperatureBin(verticalZoomPlot.plot);
verticalZoomPlot.input.dispatchEvent(
  event('pointerdown', {
    button: 0,
    buttons: 1,
    clientX: verticalZoomPoint.clientX,
    clientY: verticalZoomPoint.clientY + 40,
    pointerId: 180,
  }),
);
verticalZoomPlot.input.dispatchEvent(
  event('pointermove', {
    buttons: 1,
    clientX: verticalZoomPoint.clientX + 20,
    clientY: verticalZoomPoint.clientY - 80,
    pointerId: 180,
  }),
);
verticalZoomPlot.input.dispatchEvent(
  event('pointerup', {
    button: 0,
    clientX: verticalZoomPoint.clientX + 20,
    clientY: verticalZoomPoint.clientY - 80,
    pointerId: 180,
  }),
);
const verticalZoomAfter =
  verticalZoomPlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature;
assert.ok(verticalZoomAfter);
assert.deepEqual(verticalZoomAfter.x, verticalZoomBefore.x);
assert.notDeepEqual(verticalZoomAfter.y, verticalZoomBefore.y);
verticalZoomPlot.plot.dispose();

const yZoomPlot = createBoundPlot(spec, { axisMode: 'y', mode: 'zoom' });
const yZoomBefore = yZoomPlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature;
assert.ok(yZoomBefore);
const yZoomPoint = pointInTemperatureBin(yZoomPlot.plot);
yZoomPlot.input.dispatchEvent(
  event('pointerdown', {
    button: 0,
    buttons: 1,
    clientX: yZoomPoint.clientX,
    clientY: yZoomPoint.clientY + 40,
    pointerId: 181,
  }),
);
yZoomPlot.input.dispatchEvent(
  event('pointermove', {
    buttons: 1,
    clientX: yZoomPoint.clientX + 20,
    clientY: yZoomPoint.clientY - 80,
    pointerId: 181,
  }),
);
yZoomPlot.input.dispatchEvent(
  event('pointerup', {
    button: 0,
    clientX: yZoomPoint.clientX + 20,
    clientY: yZoomPoint.clientY - 80,
    pointerId: 181,
  }),
);
const yZoomAfter = yZoomPlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature;
assert.ok(yZoomAfter);
assert.deepEqual(yZoomAfter.x, yZoomBefore.x);
assert.notDeepEqual(yZoomAfter.y, yZoomBefore.y);
yZoomPlot.plot.dispose();

const hoverPlot = createBoundPlot();
const hoverEvents: string[] = [];
hoverPlot.plot.on('hoverchange', (hover) => {
  hoverEvents.push(hover?.source ?? 'clear');
});
const hoverPoint = pointInTemperatureBin(hoverPlot.plot);
hoverPlot.input.dispatchEvent(
  event('pointermove', {
    clientX: hoverPoint.clientX,
    clientY: hoverPoint.clientY,
    shiftKey: true,
  }),
);
assert.equal(hoverEvents.at(-1), 'shift-hover');
assert.equal(hoverPlot.plot.commands.getStateSnapshot().cursor, 'default');
hoverPlot.window.dispatchEvent(event('keyup', { code: 'ShiftLeft', key: 'Shift' }));
assert.equal(hoverEvents.at(-1), 'clear');
hoverPlot.plot.dispose();

const hoverModePlot = createBoundPlot(spec, { mode: 'hover' });
const hoverModeEvents: string[] = [];
hoverModePlot.plot.on('hoverchange', (hover) => {
  hoverModeEvents.push(hover?.source ?? 'clear');
});
const hoverModePoint = pointInTemperatureBin(hoverModePlot.plot);
hoverModePlot.input.dispatchEvent(
  event('pointermove', {
    clientX: hoverModePoint.clientX,
    clientY: hoverModePoint.clientY,
  }),
);
assert.deepEqual(hoverModeEvents, []);
hoverModePlot.input.dispatchEvent(
  event('pointermove', {
    clientX: hoverModePoint.clientX,
    clientY: hoverModePoint.clientY,
    shiftKey: true,
  }),
);
assert.equal(hoverModeEvents.at(-1), 'shift-hover');
hoverModePlot.plot.dispose();

const measurePlot = createBoundPlot();
const measurementEvents: string[] = [];
measurePlot.plot.on('measurementchange', (measurement) => {
  measurementEvents.push(measurement?.reference.bin.subplotId ?? 'clear');
});
const measurePoint = pointInTemperatureBin(measurePlot.plot);
measurePlot.input.dispatchEvent(
  event('pointerdown', {
    button: 2,
    buttons: 2,
    clientX: measurePoint.clientX,
    clientY: measurePoint.clientY,
    pointerId: 22,
    shiftKey: true,
  }),
);
assert.equal(measurePlot.plot.commands.getStateSnapshot().cursor, 'default');
measurePlot.input.dispatchEvent(
  event('pointermove', {
    buttons: 2,
    clientX: measurePoint.clientX + 40,
    clientY: measurePoint.clientY,
    pointerId: 22,
    shiftKey: true,
  }),
);
assert.equal(measurePlot.plot.commands.getStateSnapshot().cursor, 'default');
measurePlot.input.dispatchEvent(
  event('pointerup', {
    button: 2,
    clientX: measurePoint.clientX + 40,
    clientY: measurePoint.clientY,
    pointerId: 22,
    shiftKey: true,
  }),
);
assert.deepEqual(measurementEvents, ['temperature', 'temperature', 'clear']);
assert.equal(measurePlot.plot.commands.getStateSnapshot().cursor, 'default');
measurePlot.plot.dispose();

const keyPlot = createBoundPlot();
const keyEvents: string[] = [];
keyPlot.plot.commands.selectBins({ binIndices: [0], subplotId: 'temperature' });
keyPlot.plot.on('selectionchange', (selection) => {
  keyEvents.push(`selection:${selection.selectedSourceCount}`);
});
keyPlot.plot.on('viewportundorequest', (request) => {
  keyEvents.push(`undo:${request.source}`);
});
keyPlot.input.dispatchEvent(event('keydown', { code: 'Escape', key: 'Escape' }));
keyPlot.input.dispatchEvent(event('keydown', { code: 'KeyQ', key: 'q' }));
assert.deepEqual(keyEvents, ['selection:0', 'undo:keyboard']);
keyPlot.plot.dispose();

const middlePlot = createBoundPlot();
const middleEvents: string[] = [];
middlePlot.plot.on('viewportundorequest', (request) => {
  middleEvents.push(request.source);
});
const middleZoomViewport = middlePlot.plot.commands.getStateSnapshot().viewport;
const middleZoomSubplot = middleZoomViewport.subplotById.temperature;
assert.ok(middleZoomSubplot);
middlePlot.plot.commands.setViewport(
  {
    subplotById: {
      ...middleZoomViewport.subplotById,
      temperature: {
        ...middleZoomSubplot,
        x: { max: 5, min: 0 },
      },
    },
  },
  'rectangle-zoom',
);
const middlePoint = pointInTemperatureBin(middlePlot.plot);
const middleAggregationBefore =
  middlePlot.plot.commands.getStateSnapshot().aggregation;
const middleBefore = middlePlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature;
assert.ok(middleBefore);
middlePlot.input.dispatchEvent(
  event('pointerdown', {
    button: 1,
    buttons: 4,
    clientX: middlePoint.clientX,
    clientY: middlePoint.clientY,
    pointerId: 31,
  }),
);
assert.equal(middlePlot.plot.commands.getStateSnapshot().cursor, 'default');
middlePlot.input.dispatchEvent(
  event('pointermove', {
    buttons: 4,
    clientX: middlePoint.clientX + 40,
    clientY: middlePoint.clientY + 20,
    pointerId: 31,
  }),
);
assert.equal(middlePlot.plot.commands.getStateSnapshot().cursor, 'default');
middlePlot.input.dispatchEvent(
  event('pointerup', {
    button: 1,
    clientX: middlePoint.clientX + 40,
    clientY: middlePoint.clientY + 20,
    pointerId: 31,
  }),
);
const middleAfter = middlePlot.plot.commands.getStateSnapshot().viewport.subplotById.temperature;
assert.equal(middlePlot.plot.commands.getStateSnapshot().cursor, 'default');
assert.ok(middleAfter);
assert.notDeepEqual(middleAfter.x, middleBefore.x);
assert.notDeepEqual(middleAfter.y, middleBefore.y);
assert.notEqual(
  middlePlot.plot.commands.getStateSnapshot().aggregation,
  middleAggregationBefore,
);
assert.deepEqual(middleEvents, []);

middlePlot.input.dispatchEvent(
  event('pointerdown', {
    button: 1,
    buttons: 4,
    clientX: middlePoint.clientX,
    clientY: middlePoint.clientY,
    pointerId: 32,
  }),
);
middlePlot.input.dispatchEvent(
  event('pointerup', {
    button: 1,
    clientX: middlePoint.clientX + 1,
    clientY: middlePoint.clientY + 1,
    pointerId: 32,
  }),
);
assert.deepEqual(middleEvents, ['pointer']);
middlePlot.plot.dispose();

console.log('histogram-fast engine default binding tests passed');
