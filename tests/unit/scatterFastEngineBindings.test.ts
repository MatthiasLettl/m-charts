import assert from 'node:assert/strict';

import {
  createDefaultScatterBindings,
  createFastScatterPlot,
  type FastScatterPlotOptions,
  type FastScatterRendererFactory,
  type FastScatterRendererLike,
} from '../../packages/m-charts/src/m-scatter/engine/index.ts';
import type {
  FastScatterAggregationSet,
  FastScatterEasterEggPlaybackOptions,
  FastScatterMetricsEvent,
  FastScatterViewport,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';
import { axisToPixel } from '../../packages/m-charts/src/m-scatter/core/index.ts';

interface ListenerRecord {
  capture: boolean;
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
  readonly tagName: string;
  readonly listeners: ListenerRecord[] = [];
  readonly ownerDocument: FakeDocument;
  readonly style: Record<string, string> = {};
  isContentEditable = false;
  className = '';
  parentElement: FakeElement | null = null;
  private rect = { height: 0, left: 0, top: 0, width: 0 };

  constructor(ownerDocument: FakeDocument, tagName = 'div') {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
  }

  addEventListener(
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions | boolean,
  ): void {
    this.listeners.push({ capture: isCaptureListener(options), listener, type });
  }

  append(...children: FakeElement[]): void {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  contains(target: Node): boolean {
    if (target === (this as unknown as Node)) {
      return true;
    }
    return this.children.some((child) => child.contains(target));
  }

  dispatchEvent(event: Event): boolean {
    setEventTargetIfUnset(event, this);
    dispatchListenerRecords(this.listeners, event);
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
    if (name === 'aria-label') {
      this.dataset.ariaLabel = value;
    }
  }

  setPointerCapture(pointerId: number): void {
    void pointerId;
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
  readonly defaultView = {
    Node: FakeElement as unknown as typeof Node,
  };

  createElement(tagName: string): FakeElement {
    return tagName === 'canvas'
      ? new FakeCanvasElement(this)
      : new FakeElement(this, tagName);
  }
}

class FakeWindow {
  readonly listeners: ListenerRecord[] = [];

  addEventListener(
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions | boolean,
  ): void {
    this.listeners.push({ capture: isCaptureListener(options), listener, type });
  }

  dispatchEvent(event: Event): boolean {
    setEventTargetIfUnset(event, this);
    dispatchListenerRecords(this.listeners, event);
    return !event.defaultPrevented;
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

function dispatchListenerRecords(records: readonly ListenerRecord[], event: Event): void {
  for (const capture of [true, false]) {
    for (const record of records.filter(
      (item) => item.type === event.type && item.capture === capture,
    )) {
      record.listener(event);
    }
  }
}

function isCaptureListener(options: AddEventListenerOptions | boolean | undefined): boolean {
  return typeof options === 'boolean' ? options : options?.capture === true;
}

function setEventTargetIfUnset(event: Event, target: object): void {
  if (event.target !== null) {
    return;
  }
  Object.defineProperty(event, 'target', {
    configurable: true,
    value: target,
  });
}

class MockRenderer implements FastScatterRendererLike {
  aggregation: FastScatterAggregationSet | null = null;
  readonly easterEggRequests: FastScatterEasterEggPlaybackOptions[] = [];
  readonly updates: unknown[] = [];
  disposed = false;

  constructor(private readonly emitMetrics: (metrics: FastScatterMetricsEvent) => void) {}

  dispose(): void {
    this.disposed = true;
  }

  render(): void {
    this.emitMetrics({ at: performance.now(), drawCalls: 1, phase: 'render' });
  }

  getAggregation(): FastScatterAggregationSet | null {
    return this.aggregation;
  }

  playEasterEgg(options: FastScatterEasterEggPlaybackOptions = {}): boolean {
    if (this.disposed) {
      return false;
    }
    this.easterEggRequests.push(options);
    return true;
  }

  resize(): void {}

  update(options: unknown): void {
    if (!this.disposed) {
      this.updates.push(options);
    }
  }
}

function installDomGlobals(): { document: FakeDocument; window: FakeWindow } {
  const document = new FakeDocument();
  const window = new FakeWindow();
  Object.assign(globalThis, {
    devicePixelRatio: 1,
    document,
    window,
  });
  return { document, window };
}

function createOptions(
  rendererFactory: FastScatterRendererFactory,
): FastScatterPlotOptions {
  return {
    axisMode: 'xy',
    columns: {
      ids: ['a', 'b'],
      x: new Float32Array([0, 1]),
      xKey: 'x-metric',
      y: { y: new Float32Array([0, 1]) },
    },
    mode: 'zoom',
    rendererFactory,
    spec: {
      plots: [{ id: 'plot-y', label: 'Y', yKey: 'y' }],
      xLabel: 'X',
    },
    viewport: createViewport(0, 1),
    visualizationMode: 'points',
  };
}

function createViewport(min: number, max: number): FastScatterViewport {
  return {
    x: { max, min },
    yByPlot: { 'plot-y': { max, min } },
  };
}

function makeEvent<T extends object>(type: string, values: T): Event & T {
  const event = new Event(type, { cancelable: true }) as Event & T;
  return Object.assign(event, values);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function assertFiniteSelectionMetric(
  metrics: Record<string, unknown> | undefined,
  key: string,
): void {
  const value = metrics?.[key];
  assert.equal(typeof value, 'number');
  assert.ok(Number.isFinite(value));
}

const { document, window } = installDomGlobals();
const host = new FakeElement(document);
host.setRect(420, 280);
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
plot.use(createDefaultScatterBindings());

const pointer = { x: 120, y: 80 };
const pointerPlotRect = plot.commands.getPlotRectAtPoint(pointer.x, pointer.y);
assert.equal(pointerPlotRect?.id, 'plot-y');
assert.notEqual(pointerPlotRect, null);
const pointerViewport = plot.commands.getStateSnapshot().viewport;
const hoverPointer = {
  x: axisToPixel(
    0,
    pointerViewport.x,
    pointerPlotRect!.xCssPx,
    pointerPlotRect!.xCssPx + pointerPlotRect!.widthCssPx,
  ),
  y: axisToPixel(
    0,
    pointerViewport.yByPlot[pointerPlotRect!.id]!,
    pointerPlotRect!.yCssPx + pointerPlotRect!.heightCssPx,
    pointerPlotRect!.yCssPx,
  ),
};

const activePlotEvents: string[] = [];
const cursorEvents: string[] = [];
const pointRequests: number[] = [];
const pointRequestModes: string[] = [];
const heatmapRequests: number[] = [];
const undoRequests: string[] = [];
const viewportEvents: Array<{ phase: string; reason: string }> = [];
const interactionMetrics: string[] = [];
const overlayEvents: Array<{ count: number; reason: string }> = [];
const primaryHoverEvents: Array<number | null> = [];
const brushEvents: string[] = [];

plot.on('activeplotchange', (event) => activePlotEvents.push(`${event.plotId}:${event.reason}`));
plot.on('cursorchange', (event) => cursorEvents.push(`${event.cursor}:${event.reason}`));
plot.on('pointsizeadjustrequest', (event) => {
  pointRequests.push(event.delta);
  pointRequestModes.push(`${event.mode}:${event.source}`);
});
plot.on('heatmapbinsizeadjustrequest', (event) => heatmapRequests.push(event.delta));
plot.on('viewportundorequest', (event) => undoRequests.push(event.source));
plot.on('viewportchange', (event) =>
  viewportEvents.push({ phase: event.phase, reason: event.reason }),
);
plot.on('hoverchange', (event) => primaryHoverEvents.push(event?.point.sourceIndex ?? null));
plot.on('overlaychange', (event) => {
  overlayEvents.push({ count: event.overlays.length, reason: event.reason });
});
for (const eventName of ['brushstart', 'brushpreview', 'brushcommit', 'brushcancel'] as const) {
  plot.on(eventName, (event) => {
    brushEvents.push(
      `${event.phase}:${event.shape}:${event.defaultAction}:${event.target.parameterKey}:${Number.isFinite(event.range?.parameter?.min)}`,
    );
  });
}
plot.on('metrics', (event) => {
  if (event.phase === 'interaction' && event.detail) {
    interactionMetrics.push(JSON.parse(event.detail).operation);
  }
});

	host.dispatchEvent(
	  makeEvent('pointermove', {
	    altKey: false,
	    button: -1,
	    buttons: 0,
	    clientX: hoverPointer.x,
	    clientY: hoverPointer.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 1,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
	host.dispatchEvent(
	  makeEvent('pointermove', {
	    altKey: false,
	    button: -1,
	    buttons: 0,
	    clientX: hoverPointer.x,
	    clientY: hoverPointer.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 1,
    pointerType: 'mouse',
    shiftKey: true,
  }),
);
await wait(25);
assert.equal(plot.commands.getStateSnapshot().hoverSourceIndex, 0);
host.dispatchEvent(
  makeEvent('pointermove', {
    altKey: false,
    button: -1,
    buttons: 0,
    clientX: 4,
    clientY: 4,
    ctrlKey: false,
    metaKey: false,
    pointerId: 1,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
assert.deepEqual(activePlotEvents, ['plot-y:pointer']);
assert.deepEqual(cursorEvents, []);
assert.equal(plot.commands.getStateSnapshot().hoverSourceIndex, null);
assert.deepEqual(primaryHoverEvents, [0, null]);

	host.dispatchEvent(
	  makeEvent('pointermove', {
	    altKey: false,
	    button: -1,
	    buttons: 0,
	    clientX: hoverPointer.x,
	    clientY: hoverPointer.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 1,
    pointerType: 'mouse',
    shiftKey: true,
  }),
);
await wait(25);
assert.equal(plot.commands.getStateSnapshot().hoverSourceIndex, 0);
host.dispatchEvent(
  makeEvent('keyup', {
    altKey: false,
    code: 'ShiftLeft',
    ctrlKey: false,
    key: 'Shift',
    metaKey: false,
    repeat: false,
    shiftKey: false,
  }),
);
assert.equal(plot.commands.getStateSnapshot().hoverSourceIndex, null);
assert.deepEqual(primaryHoverEvents, [0, null, 0, null]);

host.dispatchEvent(
  makeEvent('pointermove', {
    altKey: false,
    button: -1,
    buttons: 0,
    clientX: pointer.x,
    clientY: pointer.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 1,
    pointerType: 'mouse',
    shiftKey: true,
  }),
);
host.dispatchEvent(makeEvent('blur', { relatedTarget: null }));
await wait(25);
assert.equal(plot.commands.getStateSnapshot().hoverSourceIndex, null);
assert.deepEqual(primaryHoverEvents, [0, null, 0, null]);

const pointWheel = makeEvent('wheel', {
  altKey: false,
  clientX: pointer.x,
  clientY: pointer.y,
  ctrlKey: false,
  deltaMode: 0,
  deltaX: 0,
  deltaY: -100,
  deltaZ: 0,
  metaKey: false,
  shiftKey: false,
});
host.dispatchEvent(pointWheel);
assert.equal(pointWheel.defaultPrevented, true);
assert.deepEqual(pointRequests, [1]);
assert.deepEqual(pointRequestModes, ['points:wheel']);

plot.update({ visualizationMode: 'bubble' });
const bubbleWheel = makeEvent('wheel', {
  altKey: false,
  clientX: pointer.x,
  clientY: pointer.y,
  ctrlKey: false,
  deltaMode: 0,
  deltaX: 0,
  deltaY: -100,
  deltaZ: 0,
  metaKey: false,
  shiftKey: false,
});
host.dispatchEvent(bubbleWheel);
assert.equal(bubbleWheel.defaultPrevented, true);
assert.deepEqual(pointRequests, [1, 1]);
assert.deepEqual(pointRequestModes, ['points:wheel', 'bubble:wheel']);

plot.update({ visualizationMode: 'heatmap' });
const heatmapWheel = makeEvent('wheel', {
  altKey: false,
  clientX: pointer.x,
  clientY: pointer.y,
  ctrlKey: false,
  deltaMode: 0,
  deltaX: 0,
  deltaY: 100,
  deltaZ: 0,
  metaKey: false,
  shiftKey: false,
});
host.dispatchEvent(heatmapWheel);
assert.equal(heatmapWheel.defaultPrevented, true);
assert.deepEqual(heatmapRequests, [1]);
assert.deepEqual(pointRequests, [1, 1]);

const zoomWheel = makeEvent('wheel', {
  altKey: false,
  clientX: pointer.x,
  clientY: pointer.y,
  ctrlKey: true,
  deltaMode: 0,
  deltaX: 0,
  deltaY: 120,
  deltaZ: 0,
  metaKey: false,
  shiftKey: false,
});
host.dispatchEvent(zoomWheel);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(zoomWheel.defaultPrevented, true);
assert.deepEqual(viewportEvents.at(-1), { phase: 'preview', reason: 'wheel' });
assert.equal(interactionMetrics.at(-1), 'wheel-zoom');
assert.equal((renderers[0]!.updates.at(-1) as { viewport?: FastScatterViewport }).viewport?.x.max, plot.commands.getStateSnapshot().viewport.x.max);

const shiftWheel = makeEvent('wheel', {
  altKey: false,
  clientX: pointer.x,
  clientY: pointer.y,
  ctrlKey: false,
  deltaMode: 0,
  deltaX: -80,
  deltaY: 0,
  deltaZ: 0,
  metaKey: false,
  shiftKey: true,
});
host.dispatchEvent(shiftWheel);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(shiftWheel.defaultPrevented, true);
assert.deepEqual(viewportEvents.at(-1), { phase: 'preview', reason: 'wheel' });
await new Promise((resolve) => setTimeout(resolve, 100));
assert.deepEqual(viewportEvents.at(-1), { phase: 'commit', reason: 'wheel' });

const keyQ = makeEvent('keydown', {
  altKey: false,
  code: 'KeyQ',
  ctrlKey: false,
  key: 'q',
  metaKey: false,
  repeat: false,
  shiftKey: false,
});
host.dispatchEvent(keyQ);
assert.equal(keyQ.defaultPrevented, true);

host.dispatchEvent(
  makeEvent('pointerdown', {
    altKey: false,
    button: 1,
    buttons: 4,
    clientX: pointer.x,
    clientY: pointer.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 2,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
assert.equal(plot.commands.getStateSnapshot().cursor, 'default');
const middleClickUp = makeEvent('pointerup', {
  altKey: false,
  button: 1,
  buttons: 0,
  clientX: pointer.x,
  clientY: pointer.y,
  ctrlKey: false,
  metaKey: false,
  pointerId: 2,
  pointerType: 'mouse',
  shiftKey: false,
});
host.dispatchEvent(middleClickUp);
assert.equal(middleClickUp.defaultPrevented, true);
assert.deepEqual(undoRequests, ['keyboard', 'pointer']);
assert.equal(plot.commands.getStateSnapshot().cursor, 'default');

host.dispatchEvent(
  makeEvent('pointerdown', {
    altKey: false,
    button: 1,
    buttons: 4,
    clientX: pointer.x,
    clientY: pointer.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 3,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
host.dispatchEvent(
  makeEvent('pointermove', {
    altKey: false,
    button: -1,
    buttons: 4,
    clientX: pointer.x + 12,
    clientY: pointer.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 3,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
host.dispatchEvent(
  makeEvent('pointerup', {
    altKey: false,
    button: 1,
    buttons: 0,
    clientX: pointer.x + 12,
    clientY: pointer.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 3,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
assert.deepEqual(undoRequests, ['keyboard', 'pointer']);

const panStartViewport = plot.commands.getStateSnapshot().viewport;
host.dispatchEvent(
  makeEvent('pointerdown', {
    altKey: false,
    button: 1,
    buttons: 4,
    clientX: pointer.x,
    clientY: pointer.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 4,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
const panMove = makeEvent('pointermove', {
  altKey: false,
  button: -1,
  buttons: 4,
  clientX: pointer.x + 36,
  clientY: pointer.y + 18,
  ctrlKey: false,
  metaKey: false,
  pointerId: 4,
  pointerType: 'mouse',
  shiftKey: false,
});
host.dispatchEvent(panMove);
assert.equal(panMove.defaultPrevented, true);
assert.equal(plot.commands.getStateSnapshot().cursor, 'default');
assert.notDeepEqual(plot.commands.getStateSnapshot().viewport, panStartViewport);
assert.deepEqual(viewportEvents.at(-1), { phase: 'preview', reason: 'drag' });
assert.equal(interactionMetrics.at(-1), 'drag-pan');
const viewportAfterInputPanMove = plot.commands.getStateSnapshot().viewport;
window.dispatchEvent(panMove);
assert.deepEqual(plot.commands.getStateSnapshot().viewport, viewportAfterInputPanMove);
const panUp = makeEvent('pointerup', {
  altKey: false,
  button: 1,
  buttons: 0,
  clientX: pointer.x + 36,
  clientY: pointer.y + 18,
  ctrlKey: false,
  metaKey: false,
  pointerId: 4,
  pointerType: 'mouse',
  shiftKey: false,
});
host.dispatchEvent(panUp);
assert.equal(panUp.defaultPrevented, true);
assert.equal(plot.commands.getStateSnapshot().cursor, 'default');
assert.deepEqual(viewportEvents.at(-1), { phase: 'commit', reason: 'drag' });
assert.deepEqual(undoRequests, ['keyboard', 'pointer']);

const outsidePanStartViewport = plot.commands.getStateSnapshot().viewport;
host.dispatchEvent(
  makeEvent('pointerdown', {
    altKey: false,
    button: 1,
    buttons: 4,
    clientX: pointer.x,
    clientY: pointer.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 12,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
const outsidePanMove = makeEvent('pointermove', {
  altKey: false,
  button: -1,
  buttons: 4,
  clientX: pointer.x + 48,
  clientY: pointer.y + 12,
  ctrlKey: false,
  metaKey: false,
  pointerId: 12,
  pointerType: 'mouse',
  shiftKey: false,
});
window.dispatchEvent(outsidePanMove);
assert.equal(outsidePanMove.defaultPrevented, true);
assert.notDeepEqual(plot.commands.getStateSnapshot().viewport, outsidePanStartViewport);
assert.deepEqual(viewportEvents.at(-1), { phase: 'preview', reason: 'drag' });
const outsidePanUp = makeEvent('pointerup', {
  altKey: false,
  button: 1,
  buttons: 0,
  clientX: pointer.x + 48,
  clientY: pointer.y + 12,
  ctrlKey: false,
  metaKey: false,
  pointerId: 12,
  pointerType: 'mouse',
  shiftKey: false,
});
window.dispatchEvent(outsidePanUp);
assert.equal(outsidePanUp.defaultPrevented, true);
assert.deepEqual(viewportEvents.at(-1), { phase: 'commit', reason: 'drag' });

const rectangleZoomDown = makeEvent('pointerdown', {
  altKey: false,
  button: 0,
  buttons: 1,
  clientX: pointer.x,
  clientY: pointer.y,
  ctrlKey: false,
  metaKey: false,
  pointerId: 5,
  pointerType: 'mouse',
  shiftKey: false,
});
host.dispatchEvent(rectangleZoomDown);
assert.equal(rectangleZoomDown.defaultPrevented, true);
assert.equal(plot.commands.getOverlays().at(-1)?.kind, 'rectangle-zoom');
const rectangleZoomMove = makeEvent('pointermove', {
  altKey: false,
  button: -1,
  buttons: 1,
  clientX: pointer.x + 120,
  clientY: pointer.y + 80,
  ctrlKey: false,
  metaKey: false,
  pointerId: 5,
  pointerType: 'mouse',
  shiftKey: false,
});
host.dispatchEvent(rectangleZoomMove);
assert.equal(rectangleZoomMove.defaultPrevented, true);
assert.equal(plot.commands.getOverlays().at(-1)?.kind, 'rectangle-zoom');
const rectangleZoomUp = makeEvent('pointerup', {
  altKey: false,
  button: 0,
  buttons: 0,
  clientX: pointer.x + 120,
  clientY: pointer.y + 80,
  ctrlKey: false,
  metaKey: false,
  pointerId: 5,
  pointerType: 'mouse',
  shiftKey: false,
});
host.dispatchEvent(rectangleZoomUp);
assert.equal(rectangleZoomUp.defaultPrevented, true);
assert.equal(
  plot.commands.getOverlays().some((overlay) => overlay.kind === 'rectangle-zoom'),
  false,
);
assert.deepEqual(viewportEvents.at(-1), { phase: 'commit', reason: 'rectangle-zoom' });
assert.equal(interactionMetrics.at(-1), 'rectangle-zoom');
assert.equal(overlayEvents.at(-1)?.reason, 'clear');
assert.deepEqual(brushEvents.slice(-3), [
  'start:rectangle:zoom:y:true',
  'preview:rectangle:zoom:y:true',
  'commit:rectangle:zoom:y:true',
]);

const forcedXYBefore = plot.commands.getStateSnapshot().viewport;
const forcedXYDown = makeEvent('pointerdown', {
  altKey: true,
  button: 0,
  buttons: 1,
  clientX: pointer.x,
  clientY: pointer.y,
  ctrlKey: false,
  metaKey: false,
  pointerId: 15,
  pointerType: 'mouse',
  shiftKey: true,
});
host.dispatchEvent(forcedXYDown);
assert.equal(forcedXYDown.defaultPrevented, true);
const forcedXYMove = makeEvent('pointermove', {
  altKey: true,
  button: -1,
  buttons: 1,
  clientX: pointer.x + 120,
  clientY: pointer.y + 30,
  ctrlKey: false,
  metaKey: false,
  pointerId: 15,
  pointerType: 'mouse',
  shiftKey: true,
});
host.dispatchEvent(forcedXYMove);
assert.equal(forcedXYMove.defaultPrevented, true);
const forcedXYUp = makeEvent('pointerup', {
  altKey: true,
  button: 0,
  buttons: 0,
  clientX: pointer.x + 120,
  clientY: pointer.y + 30,
  ctrlKey: false,
  metaKey: false,
  pointerId: 15,
  pointerType: 'mouse',
  shiftKey: true,
});
host.dispatchEvent(forcedXYUp);
assert.equal(forcedXYUp.defaultPrevented, true);
const forcedXYAfter = plot.commands.getStateSnapshot().viewport;
assert.notDeepEqual(forcedXYAfter.x, forcedXYBefore.x);
assert.notDeepEqual(forcedXYAfter.yByPlot['plot-y'], forcedXYBefore.yByPlot['plot-y']);
assert.deepEqual(viewportEvents.at(-1), { phase: 'commit', reason: 'rectangle-zoom' });

plot.dispose();

const parentOffsetContainer = new FakeElement(document);
parentOffsetContainer.setRect(460, 340, 10, 20);
const parentOffsetHeader = new FakeElement(document);
parentOffsetHeader.setRect(460, 40, 10, 20);
const parentOffsetHost = new FakeElement(document);
parentOffsetHost.setRect(420, 280, 10, 60);
parentOffsetContainer.append(parentOffsetHeader, parentOffsetHost);
const parentOffsetPlot = createFastScatterPlot(
  parentOffsetHost as unknown as HTMLElement,
  createOptions((rendererOptions) => new MockRenderer(rendererOptions.onMetrics ?? (() => {}))),
);
parentOffsetPlot.use(createDefaultScatterBindings());
const parentOffsetRect = parentOffsetPlot.commands.getPlotRectAtPoint(pointer.x, pointer.y);
assert.notEqual(parentOffsetRect, null);
const parentOffsetViewport = parentOffsetPlot.commands.getStateSnapshot().viewport;
const parentOffsetPoint = {
  x: axisToPixel(
    0,
    parentOffsetViewport.x,
    parentOffsetRect!.xCssPx,
    parentOffsetRect!.xCssPx + parentOffsetRect!.widthCssPx,
  ),
  y: axisToPixel(
    0,
    parentOffsetViewport.yByPlot[parentOffsetRect!.id]!,
    parentOffsetRect!.yCssPx + parentOffsetRect!.heightCssPx,
    parentOffsetRect!.yCssPx,
  ),
};
const parentOffsetHoverEvents: Array<number | null> = [];
parentOffsetPlot.on('hoverchange', (event) => {
  parentOffsetHoverEvents.push(event?.point.sourceIndex ?? null);
});
parentOffsetContainer.dispatchEvent(
  makeEvent('pointermove', {
    altKey: false,
    button: -1,
    buttons: 0,
    clientX: parentOffsetPoint.x + 10,
    clientY: parentOffsetPoint.y + 60,
    ctrlKey: false,
    metaKey: false,
    pointerId: 11,
    pointerType: 'mouse',
    shiftKey: true,
  }),
);
await wait(25);
assert.equal(parentOffsetPlot.commands.getStateSnapshot().hoverSourceIndex, 0);
assert.deepEqual(parentOffsetHoverEvents, [0]);
parentOffsetPlot.dispose();

const customBindingShell = new FakeElement(document);
const customBindingInput = new FakeElement(document);
const customBindingOutside = new FakeElement(document);
const customBindingHost = new FakeElement(document);
customBindingShell.setRect(560, 380, 20, 30);
customBindingInput.setRect(500, 340, 25, 35);
customBindingOutside.setRect(40, 40, 530, 35);
customBindingHost.setRect(420, 280, 45, 85);
customBindingShell.append(customBindingInput, customBindingOutside);
customBindingInput.append(customBindingHost);
const customBindingPlot = createFastScatterPlot(
  customBindingHost as unknown as HTMLElement,
  createOptions((rendererOptions) => new MockRenderer(rendererOptions.onMetrics ?? (() => {}))),
);
customBindingPlot.use(
  createDefaultScatterBindings({
    inputElement: customBindingInput as unknown as HTMLElement,
    suppressContextMenu: true,
  }),
);
const customBindingRect = customBindingPlot.commands.getPlotRectAtPoint(pointer.x, pointer.y);
assert.notEqual(customBindingRect, null);
const customBindingViewport = customBindingPlot.commands.getStateSnapshot().viewport;
const customBindingPoint = {
  x: axisToPixel(
    0,
    customBindingViewport.x,
    customBindingRect!.xCssPx,
    customBindingRect!.xCssPx + customBindingRect!.widthCssPx,
  ),
  y: axisToPixel(
    0,
    customBindingViewport.yByPlot[customBindingRect!.id]!,
    customBindingRect!.yCssPx + customBindingRect!.heightCssPx,
    customBindingRect!.yCssPx,
  ),
};
const customBindingUndoRequests: string[] = [];
customBindingPlot.on('viewportundorequest', (event) => {
  customBindingUndoRequests.push(event.source);
});
customBindingInput.dispatchEvent(
  makeEvent('pointermove', {
    altKey: false,
    button: -1,
    buttons: 0,
    clientX: customBindingPoint.x + 45,
    clientY: customBindingPoint.y + 85,
    ctrlKey: false,
    metaKey: false,
    pointerId: 13,
    pointerType: 'mouse',
    shiftKey: true,
  }),
);
await wait(25);
assert.equal(customBindingPlot.commands.getStateSnapshot().hoverSourceIndex, 0);
customBindingOutside.dispatchEvent(
  makeEvent('keydown', {
    altKey: false,
    code: 'KeyQ',
    ctrlKey: false,
    key: 'q',
    metaKey: false,
    repeat: false,
    shiftKey: false,
  }),
);
assert.deepEqual(customBindingUndoRequests, []);
const customBindingUndo = makeEvent('keydown', {
  altKey: false,
  code: 'KeyQ',
  ctrlKey: false,
  key: 'q',
  metaKey: false,
  repeat: false,
  shiftKey: false,
});
customBindingInput.dispatchEvent(customBindingUndo);
assert.equal(customBindingUndo.defaultPrevented, true);
assert.deepEqual(customBindingUndoRequests, ['keyboard']);
const outsideContextMenu = new Event('contextmenu', { cancelable: true });
customBindingOutside.dispatchEvent(outsideContextMenu);
assert.equal(outsideContextMenu.defaultPrevented, false);
const inputContextMenu = new Event('contextmenu', { cancelable: true });
customBindingInput.dispatchEvent(inputContextMenu);
assert.equal(inputContextMenu.defaultPrevented, true);
customBindingPlot.dispose();

const easterEggHost = new FakeElement(document);
easterEggHost.setRect(420, 280);
const easterEggRenderers: MockRenderer[] = [];
const easterEggPlot = createFastScatterPlot(
  easterEggHost as unknown as HTMLElement,
  createOptions((rendererOptions) => {
    const renderer = new MockRenderer(rendererOptions.onMetrics ?? (() => {}));
    easterEggRenderers.push(renderer);
    return renderer;
  }),
);
easterEggPlot.use(
  createDefaultScatterBindings({
    easterEgg: {
      holdDurationMs: 33,
      sequence: 'future',
    },
  }),
);
const easterEggKeys = [
  ['KeyF', 'f'],
  ['KeyU', 'u'],
  ['KeyT', 't'],
  ['KeyU', 'u'],
  ['KeyR', 'r'],
  ['KeyE', 'e'],
] as const;
let finalEasterEggKey: Event | null = null;
for (const [code, key] of easterEggKeys) {
  finalEasterEggKey = makeEvent('keydown', {
    altKey: false,
    code,
    ctrlKey: false,
    key,
    metaKey: false,
    repeat: false,
    shiftKey: false,
  });
  easterEggHost.dispatchEvent(finalEasterEggKey);
}
assert.equal(finalEasterEggKey?.defaultPrevented, true);
assert.equal(easterEggRenderers[0]!.easterEggRequests.length, 1);
assert.equal(easterEggRenderers[0]!.easterEggRequests[0]?.holdDurationMs, 33);
easterEggRenderers[0]!.easterEggRequests.length = 0;
const ignoredEasterEggInput = new FakeElement(document, 'input');
for (const [code, key] of easterEggKeys) {
  const event = makeEvent('keydown', {
    altKey: false,
    code,
    ctrlKey: false,
    key,
    metaKey: false,
    repeat: false,
    shiftKey: false,
  });
  setEventTargetIfUnset(event, ignoredEasterEggInput);
  easterEggHost.dispatchEvent(event);
}
assert.equal(easterEggRenderers[0]!.easterEggRequests.length, 0);
easterEggPlot.dispose();

const easterEggShortcutHost = new FakeElement(document);
easterEggShortcutHost.setRect(420, 280);
const easterEggShortcutRenderers: MockRenderer[] = [];
let routeShortcutCount = 0;
const routeShortcutListener = (event: Event) => {
  const keyboardEvent = event as KeyboardEvent;
  if (keyboardEvent.defaultPrevented || keyboardEvent.key.toLowerCase() !== 'r') {
    return;
  }
  routeShortcutCount += 1;
  keyboardEvent.preventDefault();
};
window.addEventListener('keydown', routeShortcutListener);
const easterEggShortcutPlot = createFastScatterPlot(
  easterEggShortcutHost as unknown as HTMLElement,
  createOptions((rendererOptions) => {
    const renderer = new MockRenderer(rendererOptions.onMetrics ?? (() => {}));
    easterEggShortcutRenderers.push(renderer);
    return renderer;
  }),
);
easterEggShortcutPlot.use(
  createDefaultScatterBindings({
    easterEgg: {
      sequence: 'future',
    },
  }),
);
let routeProtectedFinalKey: Event | null = null;
for (const [code, key] of easterEggKeys) {
  routeProtectedFinalKey = makeEvent('keydown', {
    altKey: false,
    code,
    ctrlKey: false,
    key,
    metaKey: false,
    repeat: false,
    shiftKey: false,
  });
  window.dispatchEvent(routeProtectedFinalKey);
}
assert.equal(routeProtectedFinalKey?.defaultPrevented, true);
assert.equal(routeShortcutCount, 0);
assert.equal(easterEggShortcutRenderers[0]!.easterEggRequests.length, 1);
easterEggShortcutPlot.dispose();
window.removeEventListener('keydown', routeShortcutListener);

const selectionHost = new FakeElement(document);
selectionHost.setRect(420, 280);
const selectionRenderers: MockRenderer[] = [];
const selectionPlot = createFastScatterPlot(
  selectionHost as unknown as HTMLElement,
  {
    ...createOptions((rendererOptions) => {
      const renderer = new MockRenderer(rendererOptions.onMetrics ?? (() => {}));
      selectionRenderers.push(renderer);
      return renderer;
    }),
    columns: {
      ids: ['a', 'b', 'c'],
      x: new Float32Array([0, 0.5, 1]),
      y: { y: new Float32Array([0, 2, 1]) },
    },
  },
);
selectionPlot.use(createDefaultScatterBindings());
const selectionEvents: Array<{
  count: number;
  durationMs: number;
  kind: string;
  tool: string;
}> = [];
const selectionMetrics: Record<string, unknown>[] = [];
const selectionBrushEvents: string[] = [];
selectionPlot.on('selectionchange', (event) => {
  selectionEvents.push({
    count: event.selectedCount,
    durationMs: event.durationMs,
    kind: event.kind,
    tool: event.tool,
  });
});
selectionPlot.on('metrics', (event) => {
  if (event.phase === 'selection' && event.detail !== undefined) {
    selectionMetrics.push(JSON.parse(event.detail) as Record<string, unknown>);
  }
});
for (const eventName of ['brushstart', 'brushpreview', 'brushcommit', 'brushcancel'] as const) {
  selectionPlot.on(eventName, (event) => {
    selectionBrushEvents.push(
      `${event.phase}:${event.shape}:${event.defaultAction}:${event.target.parameterKey}:${event.modifiers.ctrlKey}`,
    );
  });
}
const selectionRect = selectionPlot.commands.getPlotRectAtPoint(pointer.x, pointer.y);
assert.notEqual(selectionRect, null);
const selectionStart = {
  x: selectionRect!.xCssPx,
  y: selectionRect!.yCssPx,
};
const selectionEnd = {
  x: selectionRect!.xCssPx + selectionRect!.widthCssPx,
  y: selectionRect!.yCssPx + selectionRect!.heightCssPx,
};
selectionHost.dispatchEvent(
  makeEvent('pointerdown', {
    altKey: false,
    button: 2,
    buttons: 2,
    clientX: selectionStart.x,
    clientY: selectionStart.y,
    ctrlKey: true,
    metaKey: false,
    pointerId: 6,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
selectionHost.dispatchEvent(
  makeEvent('pointermove', {
    altKey: false,
    button: -1,
    buttons: 2,
    clientX: selectionEnd.x,
    clientY: selectionEnd.y,
    ctrlKey: true,
    metaKey: false,
    pointerId: 6,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
assert.equal(
  selectionPlot.commands.getOverlays().some((overlay) => overlay.kind === 'rectangle-selection'),
  true,
);
selectionHost.dispatchEvent(
  makeEvent('pointerup', {
    altKey: false,
    button: 2,
    buttons: 0,
    clientX: selectionEnd.x,
    clientY: selectionEnd.y,
    ctrlKey: true,
    metaKey: false,
    pointerId: 6,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
assert.deepEqual(selectionEvents.at(-1), {
  count: 2,
  durationMs: selectionEvents.at(-1)?.durationMs,
  kind: 'append',
  tool: 'rectangle',
});
assert.deepEqual(selectionBrushEvents.slice(-3), [
  'start:rectangle:select:y:true',
  'preview:rectangle:select:y:true',
  'commit:rectangle:select:y:true',
]);
const rectangleSelectionMetrics = selectionMetrics.at(-1);
assert.equal(rectangleSelectionMetrics?.operation, 'rectangle-selection');
assert.equal(rectangleSelectionMetrics?.mode, 'source-indices');
assert.equal(rectangleSelectionMetrics?.selectedCount, 2);
assert.equal(rectangleSelectionMetrics?.transferMs, 0);
assert.equal(rectangleSelectionMetrics?.candidateCount, 3);
assert.ok(
  Number(rectangleSelectionMetrics?.candidateCount) >
    Number(rectangleSelectionMetrics?.selectedCount),
);
assertFiniteSelectionMetric(rectangleSelectionMetrics, 'computeMs');
assertFiniteSelectionMetric(rectangleSelectionMetrics, 'observableMs');
assertFiniteSelectionMetric(rectangleSelectionMetrics, 'durationMs');
assert.ok(Number.isFinite(selectionEvents.at(-1)?.durationMs));
assert.equal(
  selectionPlot.commands.getOverlays().some((overlay) => overlay.kind === 'rectangle-selection'),
  false,
);
assert.equal(
  selectionPlot.commands.getOverlays().some((overlay) => overlay.kind === 'committed-selection'),
  false,
);

selectionPlot.update({ mode: 'lasso' });
const lassoPoints = [
  { x: selectionStart.x, y: selectionStart.y },
  { x: selectionEnd.x, y: selectionStart.y },
  { x: selectionEnd.x, y: selectionEnd.y },
  { x: selectionStart.x, y: selectionEnd.y },
];
selectionHost.dispatchEvent(
  makeEvent('pointerdown', {
    altKey: false,
    button: 2,
    buttons: 2,
    clientX: lassoPoints[0]!.x,
    clientY: lassoPoints[0]!.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 7,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
for (const point of lassoPoints.slice(1)) {
  selectionHost.dispatchEvent(
    makeEvent('pointermove', {
      altKey: false,
      button: -1,
      buttons: 2,
      clientX: point.x,
      clientY: point.y,
      ctrlKey: false,
      metaKey: false,
      pointerId: 7,
      pointerType: 'mouse',
      shiftKey: false,
    }),
  );
}
assert.equal(
  selectionPlot.commands.getOverlays().some((overlay) => overlay.kind === 'lasso'),
  true,
);
selectionHost.dispatchEvent(
  makeEvent('pointerup', {
    altKey: false,
    button: 2,
    buttons: 0,
    clientX: lassoPoints[0]!.x,
    clientY: lassoPoints[0]!.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 7,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
assert.deepEqual(selectionEvents.at(-1), {
  count: 2,
  durationMs: selectionEvents.at(-1)?.durationMs,
  kind: 'replace',
  tool: 'lasso',
});
assert.ok(selectionBrushEvents.includes('start:lasso:select:y:false'));
assert.ok(selectionBrushEvents.includes('preview:lasso:select:y:false'));
assert.equal(selectionBrushEvents.at(-1), 'commit:lasso:select:y:false');
const lassoSelectionMetrics = selectionMetrics.at(-1);
assert.equal(lassoSelectionMetrics?.operation, 'lasso-selection');
assert.equal(lassoSelectionMetrics?.mode, 'source-indices');
assert.equal(lassoSelectionMetrics?.lassoPointCount, lassoPoints.length);
assert.equal(lassoSelectionMetrics?.selectedCount, 2);
assert.equal(lassoSelectionMetrics?.candidateCount, 3);
assert.ok(
  Number(lassoSelectionMetrics?.candidateCount) >
    Number(lassoSelectionMetrics?.selectedCount),
);
assertFiniteSelectionMetric(lassoSelectionMetrics, 'computeMs');
assertFiniteSelectionMetric(lassoSelectionMetrics, 'observableMs');
assertFiniteSelectionMetric(lassoSelectionMetrics, 'durationMs');
assert.ok(Number.isFinite(selectionEvents.at(-1)?.durationMs));
assert.equal(
  selectionPlot.commands.getOverlays().some((overlay) => overlay.kind === 'lasso'),
  false,
);
assert.equal(
  selectionPlot.commands.getOverlays().some((overlay) => overlay.kind === 'committed-selection'),
  false,
);
assert.equal(
  (selectionRenderers[0]!.updates.at(-1) as { selectedSourceIndices?: Uint32Array })
    .selectedSourceIndices?.length,
  2,
);

selectionPlot.update({ mode: 'select' });
selectionHost.dispatchEvent(
  makeEvent('keydown', {
    altKey: false,
    code: 'Space',
    ctrlKey: false,
    key: ' ',
    metaKey: false,
    repeat: false,
    shiftKey: false,
  }),
);
selectionHost.dispatchEvent(
  makeEvent('pointerdown', {
    altKey: false,
    button: 2,
    buttons: 2,
    clientX: lassoPoints[0]!.x,
    clientY: lassoPoints[0]!.y,
    ctrlKey: true,
    metaKey: false,
    pointerId: 17,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
for (const point of lassoPoints.slice(1)) {
  selectionHost.dispatchEvent(
    makeEvent('pointermove', {
      altKey: false,
      button: -1,
      buttons: 2,
      clientX: point.x,
      clientY: point.y,
      ctrlKey: true,
      metaKey: false,
      pointerId: 17,
      pointerType: 'mouse',
      shiftKey: false,
    }),
  );
}
selectionHost.dispatchEvent(
  makeEvent('pointerup', {
    altKey: false,
    button: 2,
    buttons: 0,
    clientX: lassoPoints[0]!.x,
    clientY: lassoPoints[0]!.y,
    ctrlKey: true,
    metaKey: false,
    pointerId: 17,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
selectionHost.dispatchEvent(
  makeEvent('keyup', {
    altKey: false,
    code: 'Space',
    ctrlKey: false,
    key: ' ',
    metaKey: false,
    repeat: false,
    shiftKey: false,
  }),
);
assert.deepEqual(selectionEvents.at(-1), {
  count: 2,
  durationMs: selectionEvents.at(-1)?.durationMs,
  kind: 'append',
  tool: 'lasso',
});
assert.equal(selectionBrushEvents.at(-1), 'commit:lasso:select:y:true');

const inputSpaceKey = makeEvent('keydown', {
  altKey: false,
  code: 'Space',
  ctrlKey: false,
  key: ' ',
  metaKey: false,
  repeat: false,
  shiftKey: false,
});
Object.defineProperty(inputSpaceKey, 'target', {
  configurable: true,
  value: document.createElement('input'),
});
selectionHost.dispatchEvent(inputSpaceKey);
assert.equal(inputSpaceKey.defaultPrevented, false);
selectionHost.dispatchEvent(
  makeEvent('pointerdown', {
    altKey: false,
    button: 2,
    buttons: 2,
    clientX: selectionStart.x,
    clientY: selectionStart.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 18,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
selectionHost.dispatchEvent(
  makeEvent('pointermove', {
    altKey: false,
    button: -1,
    buttons: 2,
    clientX: selectionEnd.x,
    clientY: selectionEnd.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 18,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
assert.equal(
  selectionPlot.commands.getOverlays().some((overlay) => overlay.kind === 'rectangle-selection'),
  true,
);
selectionHost.dispatchEvent(
  makeEvent('pointerup', {
    altKey: false,
    button: 2,
    buttons: 0,
    clientX: selectionEnd.x,
    clientY: selectionEnd.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 18,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
assert.deepEqual(selectionEvents.at(-1), {
  count: 2,
  durationMs: selectionEvents.at(-1)?.durationMs,
  kind: 'replace',
  tool: 'rectangle',
});

const selectionEventCountBeforeRightClick = selectionEvents.length;
selectionHost.dispatchEvent(
  makeEvent('pointerdown', {
    altKey: false,
    button: 2,
    buttons: 2,
    clientX: selectionStart.x,
    clientY: selectionStart.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 19,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
selectionHost.dispatchEvent(
  makeEvent('pointerup', {
    altKey: false,
    button: 2,
    buttons: 0,
    clientX: selectionStart.x,
    clientY: selectionStart.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 19,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
assert.equal(selectionEvents.length, selectionEventCountBeforeRightClick);
assert.deepEqual(selectionBrushEvents.slice(-2), [
  'start:rectangle:select:y:false',
  'cancel:rectangle:select:y:false',
]);
assert.equal(
  (selectionRenderers[0]!.updates.at(-1) as { selectedSourceIndices?: Uint32Array })
    .selectedSourceIndices?.length,
  2,
);

const escapeSelection = makeEvent('keydown', {
  altKey: false,
  code: 'Escape',
  ctrlKey: false,
  key: 'Escape',
  metaKey: false,
  repeat: false,
  shiftKey: false,
});
selectionHost.dispatchEvent(escapeSelection);
assert.equal(escapeSelection.defaultPrevented, true);
assert.deepEqual(selectionEvents.at(-1), {
  count: 0,
  durationMs: selectionEvents.at(-1)?.durationMs,
  kind: 'replace',
  tool: 'programmatic',
});
assert.equal(
  selectionPlot.commands.getOverlays().some((overlay) => overlay.kind === 'committed-selection'),
  false,
);
assert.equal(
  (selectionRenderers[0]!.updates.at(-1) as { selectedSourceIndices?: Uint32Array })
    .selectedSourceIndices?.length,
  0,
);
const clearedSelection = selectionPlot.commands.clearSelection();
assert.equal(clearedSelection?.selectedCount, 0);
assert.equal(clearedSelection?.tool, 'programmatic');
assert.equal(
  (selectionRenderers[0]!.updates.at(-1) as { selectedSourceIndices?: Uint32Array })
    .selectedSourceIndices?.length,
  0,
);
selectionPlot.dispose();

const markerHost = new FakeElement(document);
markerHost.setRect(420, 280);
const markerPlot = createFastScatterPlot(
  markerHost as unknown as HTMLElement,
  createOptions((rendererOptions) => new MockRenderer(rendererOptions.onMetrics ?? (() => {}))),
);
markerPlot.use(createDefaultScatterBindings());
const markerRect = markerPlot.commands.getPlotRectAtPoint(pointer.x, pointer.y);
assert.notEqual(markerRect, null);
const markerViewport = markerPlot.commands.getStateSnapshot().viewport;
const markerPointer = {
  x: axisToPixel(
    0,
    markerViewport.x,
    markerRect!.xCssPx,
    markerRect!.xCssPx + markerRect!.widthCssPx,
  ),
  y: axisToPixel(
    0,
    markerViewport.yByPlot[markerRect!.id]!,
    markerRect!.yCssPx + markerRect!.heightCssPx,
    markerRect!.yCssPx,
  ),
};
const markerDoubleClick = makeEvent('dblclick', {
  altKey: false,
  button: 0,
  buttons: 0,
  clientX: markerPointer.x,
  clientY: markerPointer.y,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
});
markerHost.dispatchEvent(markerDoubleClick);
assert.equal(markerDoubleClick.defaultPrevented, true);
assert.deepEqual(markerPlot.commands.getStateSnapshot().pointMarkerSourceIndices, [0]);
assert.equal(
  markerPlot.commands.getOverlays().some((overlay) => overlay.kind === 'point-marker'),
  true,
);
markerHost.dispatchEvent(
  makeEvent('dblclick', {
    altKey: false,
    button: 0,
    buttons: 0,
    clientX: markerPointer.x,
    clientY: markerPointer.y,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  }),
);
assert.deepEqual(markerPlot.commands.getStateSnapshot().pointMarkerSourceIndices, []);
markerPlot.commands.togglePointMarker({ sourceIndex: 0 });
assert.deepEqual(markerPlot.commands.getStateSnapshot().pointMarkerSourceIndices, [0]);
const markerEscape = makeEvent('keydown', {
  altKey: false,
  code: 'Escape',
  ctrlKey: false,
  key: 'Escape',
  metaKey: false,
  repeat: false,
  shiftKey: false,
});
markerHost.dispatchEvent(markerEscape);
assert.equal(markerEscape.defaultPrevented, true);
assert.deepEqual(markerPlot.commands.getStateSnapshot().pointMarkerSourceIndices, []);
markerPlot.update({ visualizationMode: 'heatmap' });
markerHost.dispatchEvent(
  makeEvent('dblclick', {
    altKey: false,
    button: 0,
    buttons: 0,
    clientX: markerPointer.x,
    clientY: markerPointer.y,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  }),
);
assert.deepEqual(markerPlot.commands.getStateSnapshot().pointMarkerSourceIndices, []);
markerPlot.dispose();

const hoverHost = new FakeElement(document);
hoverHost.setRect(420, 280);
const hoverPlot = createFastScatterPlot(
  hoverHost as unknown as HTMLElement,
  createOptions((rendererOptions) => new MockRenderer(rendererOptions.onMetrics ?? (() => {}))),
);
hoverPlot.use(createDefaultScatterBindings());
const hoverRect = hoverPlot.commands.getPlotRectAtPoint(pointer.x, pointer.y);
assert.notEqual(hoverRect, null);
const hoverViewport = hoverPlot.commands.getStateSnapshot().viewport;
const pointA = {
  x: axisToPixel(
    0,
    hoverViewport.x,
    hoverRect!.xCssPx,
    hoverRect!.xCssPx + hoverRect!.widthCssPx,
  ),
  y: axisToPixel(
    0,
    hoverViewport.yByPlot[hoverRect!.id]!,
    hoverRect!.yCssPx + hoverRect!.heightCssPx,
    hoverRect!.yCssPx,
  ),
};
const pointB = {
  x: axisToPixel(
    1,
    hoverViewport.x,
    hoverRect!.xCssPx,
    hoverRect!.xCssPx + hoverRect!.widthCssPx,
  ),
  y: axisToPixel(
    1,
    hoverViewport.yByPlot[hoverRect!.id]!,
    hoverRect!.yCssPx + hoverRect!.heightCssPx,
    hoverRect!.yCssPx,
  ),
};
const hoverEvents: Array<number | null> = [];
const measurementEvents: Array<number | null> = [];
hoverPlot.on('hoverchange', (event) => {
  hoverEvents.push(event?.point.sourceIndex ?? null);
});
hoverPlot.on('measurementchange', (event) => {
  measurementEvents.push(event?.current?.sourceIndex ?? null);
});
hoverHost.dispatchEvent(
  makeEvent('pointermove', {
    altKey: false,
    button: -1,
    buttons: 0,
    clientX: pointA.x,
    clientY: pointA.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 8,
    pointerType: 'mouse',
    shiftKey: true,
  }),
);
await wait(25);
assert.equal(hoverEvents.at(-1), 0);
assert.equal(hoverPlot.commands.getStateSnapshot().cursor, 'default');
hoverHost.dispatchEvent(
  makeEvent('pointerdown', {
    altKey: false,
    button: 2,
    buttons: 2,
    clientX: pointA.x,
    clientY: pointA.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 9,
    pointerType: 'mouse',
    shiftKey: true,
  }),
);
assert.equal(measurementEvents.at(-1), 0);
assert.equal(hoverPlot.commands.getStateSnapshot().cursor, 'default');
hoverHost.dispatchEvent(
  makeEvent('pointermove', {
    altKey: false,
    button: -1,
    buttons: 2,
    clientX: pointB.x,
    clientY: pointB.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 9,
    pointerType: 'mouse',
    shiftKey: true,
  }),
);
assert.equal(measurementEvents.at(-1), 1);
assert.equal(hoverPlot.commands.getStateSnapshot().cursor, 'default');
hoverHost.dispatchEvent(
  makeEvent('pointerup', {
    altKey: false,
    button: 2,
    buttons: 0,
    clientX: pointB.x,
    clientY: pointB.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 9,
    pointerType: 'mouse',
    shiftKey: true,
  }),
);
assert.equal(measurementEvents.at(-1), null);
hoverPlot.dispose();

const heatmapHoverHost = new FakeElement(document);
heatmapHoverHost.setRect(420, 280);
const heatmapHoverRenderers: MockRenderer[] = [];
const heatmapHoverOptions: FastScatterPlotOptions = {
  ...createOptions((rendererOptions) => {
    const renderer = new MockRenderer(rendererOptions.onMetrics ?? (() => {}));
    heatmapHoverRenderers.push(renderer);
    return renderer;
  }),
  columns: {
    ids: ['heat-0', 'heat-1'],
    x: new Float32Array([0.5, 0.5]),
    xKey: 'x-metric',
    y: { y: new Float32Array([0.5, 0.5]) },
  },
  visualizationMode: 'heatmap',
};
const heatmapHoverPlot = createFastScatterPlot(
  heatmapHoverHost as unknown as HTMLElement,
  heatmapHoverOptions,
);
heatmapHoverPlot.use(createDefaultScatterBindings());
const heatmapHoverRect = heatmapHoverPlot.commands.getPlotRectAtPoint(pointer.x, pointer.y);
assert.notEqual(heatmapHoverRect, null);
assert.notEqual(heatmapHoverRenderers[0], undefined);
const heatmapHoverEvents: Array<number | null> = [];
heatmapHoverPlot.on('hoverchange', (event) => {
  heatmapHoverEvents.push(event?.point.sourceIndex ?? null);
});
const heatmapCellPointer = {
  x: heatmapHoverRect!.xCssPx + heatmapHoverRect!.widthCssPx / 2,
  y: heatmapHoverRect!.yCssPx + heatmapHoverRect!.heightCssPx / 2,
};
heatmapHoverPlot.commands.setHoverSourceIndex(0);
assert.equal(heatmapHoverPlot.commands.getStateSnapshot().hoverSourceIndex, 0);
assert.deepEqual(heatmapHoverEvents, [0]);
heatmapHoverHost.dispatchEvent(
  makeEvent('pointerdown', {
    altKey: false,
    button: 2,
    buttons: 2,
    clientX: heatmapCellPointer.x - 12,
    clientY: heatmapCellPointer.y - 12,
    ctrlKey: false,
    metaKey: false,
    pointerId: 22,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
assert.equal(heatmapHoverPlot.commands.getStateSnapshot().hoverSourceIndex, null);
assert.deepEqual(heatmapHoverEvents, [0, null]);
heatmapHoverHost.dispatchEvent(
  makeEvent('pointermove', {
    altKey: false,
    button: -1,
    buttons: 2,
    clientX: heatmapCellPointer.x + 12,
    clientY: heatmapCellPointer.y + 12,
    ctrlKey: false,
    metaKey: false,
    pointerId: 22,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
heatmapHoverHost.dispatchEvent(
  makeEvent('pointerup', {
    altKey: false,
    button: 2,
    buttons: 0,
    clientX: heatmapCellPointer.x + 12,
    clientY: heatmapCellPointer.y + 12,
    ctrlKey: false,
    metaKey: false,
    pointerId: 22,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
assert.equal(heatmapHoverPlot.commands.getStateSnapshot().hoverSourceIndex, null);
assert.deepEqual(heatmapHoverEvents, [0, null]);
heatmapHoverPlot.dispose();

const navigatorHost = new FakeElement(document);
navigatorHost.setRect(420, 280);
const navigatorPlot = createFastScatterPlot(
  navigatorHost as unknown as HTMLElement,
  createOptions((rendererOptions) => new MockRenderer(rendererOptions.onMetrics ?? (() => {}))),
);
navigatorPlot.use(createDefaultScatterBindings());
navigatorPlot.commands.setViewport(createViewport(0.25, 0.75));
const navigatorEvents: Array<{ phase: string; reason: string }> = [];
navigatorPlot.on('viewportchange', (event) =>
  navigatorEvents.push({ phase: event.phase, reason: event.reason }),
);
const navigatorRect = navigatorPlot.commands.getNavigatorRect();
assert.notEqual(navigatorRect, null);
const navigatorWindow = navigatorPlot.commands.getNavigatorWindowPixels(
  navigatorRect!.widthCssPx,
);
const navigatorStart = {
  x: navigatorRect!.xCssPx + navigatorWindow.leftCssPx + navigatorWindow.widthCssPx / 2,
  y: navigatorRect!.yCssPx + navigatorRect!.heightCssPx / 2,
};
navigatorHost.dispatchEvent(
  makeEvent('pointerdown', {
    altKey: false,
    button: 0,
    buttons: 1,
    clientX: navigatorStart.x,
    clientY: navigatorStart.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 10,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
assert.equal(navigatorPlot.commands.getStateSnapshot().cursor, 'default');
navigatorHost.dispatchEvent(
  makeEvent('pointermove', {
    altKey: false,
    button: -1,
    buttons: 1,
    clientX: navigatorStart.x + 24,
    clientY: navigatorStart.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 10,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
assert.equal(navigatorPlot.commands.getStateSnapshot().cursor, 'default');
assert.deepEqual(navigatorEvents.at(-1), { phase: 'preview', reason: 'navigator' });
navigatorHost.dispatchEvent(
  makeEvent('pointerup', {
    altKey: false,
    button: 0,
    buttons: 0,
    clientX: navigatorStart.x + 24,
    clientY: navigatorStart.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 10,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
assert.equal(navigatorPlot.commands.getStateSnapshot().cursor, 'default');
assert.deepEqual(navigatorEvents.at(-1), { phase: 'commit', reason: 'navigator' });
navigatorPlot.dispose();

const colorBrushHost = new FakeElement(document);
colorBrushHost.setRect(420, 280);
const colorBrushPlot = createFastScatterPlot(
  colorBrushHost as unknown as HTMLElement,
  createOptions((rendererOptions) => new MockRenderer(rendererOptions.onMetrics ?? (() => {}))),
);
colorBrushPlot.use(
  createDefaultScatterBindings({
    rectangleBrushGestures: [
      { axisMode: 'y', button: 0, defaultAction: 'none', modifiers: { ctrlKey: true } },
      { axisMode: 'y', button: 0, defaultAction: 'none', modifiers: { shiftKey: true } },
    ],
  }),
);
const colorBrushRect = colorBrushPlot.commands.getPlotRectAtPoint(pointer.x, pointer.y);
assert.notEqual(colorBrushRect, null);
const colorBrushEvents: string[] = [];
const colorBrushProjectionChecks: boolean[] = [];
colorBrushPlot.on('brushcommit', (brush) => {
  colorBrushEvents.push(
    `${brush.defaultAction}:${brush.target.axisMode}:${brush.target.parameterKey}:${brush.modifiers.ctrlKey}:${brush.modifiers.shiftKey}`,
  );
  if (brush.defaultAction === 'none') {
    const rect = brush.cssGeometry?.shape === 'rectangle' ? brush.cssGeometry.rect : null;
    colorBrushProjectionChecks.push(
      brush.range?.x?.min === colorBrushViewportBefore.x.min &&
        brush.range.x.max === colorBrushViewportBefore.x.max &&
        rect?.xCssPx === colorBrushRect?.xCssPx &&
        rect.widthCssPx === colorBrushRect?.widthCssPx,
    );
  }
});
const colorBrushViewportBefore = colorBrushPlot.commands.getStateSnapshot().viewport;
for (const [pointerId, modifiers] of [
  [15, { ctrlKey: true, shiftKey: false }],
  [16, { ctrlKey: false, shiftKey: true }],
] as const) {
  colorBrushHost.dispatchEvent(
    makeEvent('pointerdown', {
      altKey: false,
      button: 0,
      buttons: 1,
      clientX: pointer.x,
      clientY: pointer.y,
      ctrlKey: modifiers.ctrlKey,
      metaKey: false,
      pointerId,
      pointerType: 'mouse',
      shiftKey: modifiers.shiftKey,
    }),
  );
  colorBrushHost.dispatchEvent(
    makeEvent('pointermove', {
      altKey: false,
      button: -1,
      buttons: 1,
      clientX: pointer.x + 80,
      clientY: pointer.y + 40,
      ctrlKey: modifiers.ctrlKey,
      metaKey: false,
      pointerId,
      pointerType: 'mouse',
      shiftKey: modifiers.shiftKey,
    }),
  );
  colorBrushHost.dispatchEvent(
    makeEvent('pointerup', {
      altKey: false,
      button: 0,
      buttons: 0,
      clientX: pointer.x + 80,
      clientY: pointer.y + 40,
      ctrlKey: modifiers.ctrlKey,
      metaKey: false,
      pointerId,
      pointerType: 'mouse',
      shiftKey: modifiers.shiftKey,
    }),
  );
}
assert.deepEqual(colorBrushEvents, [
  'none:y:y:true:false',
  'none:y:y:false:true',
]);
assert.deepEqual(colorBrushProjectionChecks, [true, true]);
assert.deepEqual(
  colorBrushPlot.commands.getStateSnapshot().viewport,
  colorBrushViewportBefore,
);
colorBrushHost.dispatchEvent(
  makeEvent('pointerdown', {
    altKey: true,
    button: 0,
    buttons: 1,
    clientX: pointer.x,
    clientY: pointer.y,
    ctrlKey: false,
    metaKey: false,
    pointerId: 17,
    pointerType: 'mouse',
    shiftKey: true,
  }),
);
colorBrushHost.dispatchEvent(
  makeEvent('pointermove', {
    altKey: true,
    button: -1,
    buttons: 1,
    clientX: pointer.x + 80,
    clientY: pointer.y + 24,
    ctrlKey: false,
    metaKey: false,
    pointerId: 17,
    pointerType: 'mouse',
    shiftKey: true,
  }),
);
colorBrushHost.dispatchEvent(
  makeEvent('pointerup', {
    altKey: true,
    button: 0,
    buttons: 0,
    clientX: pointer.x + 80,
    clientY: pointer.y + 24,
    ctrlKey: false,
    metaKey: false,
    pointerId: 17,
    pointerType: 'mouse',
    shiftKey: true,
  }),
);
const colorBrushForcedViewport = colorBrushPlot.commands.getStateSnapshot().viewport;
assert.notDeepEqual(colorBrushForcedViewport.x, colorBrushViewportBefore.x);
assert.notDeepEqual(
  colorBrushForcedViewport.yByPlot['plot-y'],
  colorBrushViewportBefore.yByPlot['plot-y'],
);
assert.deepEqual(colorBrushEvents, [
  'none:y:y:true:false',
  'none:y:y:false:true',
  'zoom:xy:y:false:true',
]);
colorBrushPlot.dispose();

const xColorBrushHost = new FakeElement(document);
xColorBrushHost.setRect(420, 280);
const xColorBrushPlot = createFastScatterPlot(
  xColorBrushHost as unknown as HTMLElement,
  createOptions((rendererOptions) => new MockRenderer(rendererOptions.onMetrics ?? (() => {}))),
);
xColorBrushPlot.use(
  createDefaultScatterBindings({
    rectangleBrushGestures: [
      { axisMode: 'x', button: 0, defaultAction: 'none', modifiers: { ctrlKey: true } },
    ],
  }),
);
const xColorBrushRect = xColorBrushPlot.commands.getPlotRectAtPoint(pointer.x, pointer.y);
assert.notEqual(xColorBrushRect, null);
const xColorBrushCommits: string[] = [];
xColorBrushPlot.on('brushcommit', (brush) => {
  if (brush.defaultAction !== 'none') {
    return;
  }
  const rect = brush.cssGeometry?.shape === 'rectangle' ? brush.cssGeometry.rect : null;
  xColorBrushCommits.push(
    [
      brush.target.axisMode,
      brush.target.parameterKey,
      brush.target.xParameterKey,
      brush.range?.parameter?.min === brush.range?.x?.min,
      brush.range?.parameter?.max === brush.range?.x?.max,
      rect?.yCssPx === xColorBrushRect?.yCssPx,
      rect?.heightCssPx === xColorBrushRect?.heightCssPx,
    ].join(':'),
  );
});
xColorBrushHost.dispatchEvent(
  makeEvent('pointerdown', {
    altKey: false,
    button: 0,
    buttons: 1,
    clientX: pointer.x,
    clientY: pointer.y,
    ctrlKey: true,
    metaKey: false,
    pointerId: 18,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
xColorBrushHost.dispatchEvent(
  makeEvent('pointermove', {
    altKey: false,
    button: -1,
    buttons: 1,
    clientX: pointer.x + 80,
    clientY: pointer.y + 40,
    ctrlKey: true,
    metaKey: false,
    pointerId: 18,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
xColorBrushHost.dispatchEvent(
  makeEvent('pointerup', {
    altKey: false,
    button: 0,
    buttons: 0,
    clientX: pointer.x + 80,
    clientY: pointer.y + 40,
    ctrlKey: true,
    metaKey: false,
    pointerId: 18,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
assert.deepEqual(xColorBrushCommits, ['x:x-metric:x-metric:true:true:true:true']);
xColorBrushPlot.dispose();

for (const mode of ['points', 'bubble', 'heatmap'] as const) {
  const modeHost = new FakeElement(document);
  modeHost.setRect(420, 280);
  const modePlot = createFastScatterPlot(
    modeHost as unknown as HTMLElement,
    {
      ...createOptions((rendererOptions) => new MockRenderer(rendererOptions.onMetrics ?? (() => {}))),
      visualizationMode: mode,
    },
  );
  modePlot.use(
    createDefaultScatterBindings({
      rectangleBrushGestures: [
        { axisMode: 'y', button: 0, defaultAction: 'none', modifiers: { ctrlKey: true } },
      ],
    }),
  );
  const modeBrushCommits: string[] = [];
  modePlot.on('brushcommit', (brush) => {
    modeBrushCommits.push(
      `${mode}:${brush.target.parameterKey}:${Number.isFinite(brush.range?.parameter?.min)}:${brush.defaultAction}`,
    );
  });
  modeHost.dispatchEvent(
    makeEvent('pointerdown', {
      altKey: false,
      button: 0,
      buttons: 1,
      clientX: pointer.x,
      clientY: pointer.y,
      ctrlKey: true,
      metaKey: false,
      pointerId: 20,
      pointerType: 'mouse',
      shiftKey: false,
    }),
  );
  modeHost.dispatchEvent(
    makeEvent('pointermove', {
      altKey: false,
      button: -1,
      buttons: 1,
      clientX: pointer.x + 80,
      clientY: pointer.y + 40,
      ctrlKey: true,
      metaKey: false,
      pointerId: 20,
      pointerType: 'mouse',
      shiftKey: false,
    }),
  );
  modeHost.dispatchEvent(
    makeEvent('pointerup', {
      altKey: false,
      button: 0,
      buttons: 0,
      clientX: pointer.x + 80,
      clientY: pointer.y + 40,
      ctrlKey: true,
      metaKey: false,
      pointerId: 20,
      pointerType: 'mouse',
      shiftKey: false,
    }),
  );
  assert.deepEqual(modeBrushCommits, [`${mode}:y:true:none`]);
  modePlot.dispose();
}

console.log('scatter-fast engine default binding tests passed');
