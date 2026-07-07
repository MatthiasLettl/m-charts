import assert from 'node:assert/strict';

import {
  createDefaultParallelBindings,
  createParallelFastPlot,
} from '../../packages/m-charts/src/m-parallel/engine/index.ts';
import type {
  DomInputAdapter,
  NormalizedKeyEvent,
  NormalizedPointerEvent,
  PlotInputEvents,
  Unsubscribe,
} from '../../packages/m-charts/src/plot-engine/core/index.ts';
import type {
  ParallelFastHoverRendererFactory,
  ParallelFastHoverRendererLike,
  ParallelFastRendererFactory,
  ParallelFastRendererLike,
  ParallelFastRendererMetricsEvent,
} from '../../packages/m-charts/src/m-parallel/engine/index.ts';
import type {
  ParallelBuffers,
  NumericRange,
  ParallelWebgl2HoverDrawMetrics,
  ParallelWebgl2HoverUpdateMetrics,
  ParallelWebgl2RendererDrawMetrics,
  ParallelWebgl2RendererSetupMetrics,
  ParallelWebgl2SelectedUpdateMetrics,
} from '../../packages/m-charts/src/m-parallel/core/index.ts';
import { parallelDisplayValueToRenderedNormalizedValue } from '../../packages/m-charts/src/m-parallel/core/index.ts';
import type { ParallelFastTheme } from '../../packages/m-charts/src/m-parallel/core/webglSegmentRenderer.ts';

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

class MockRenderer implements ParallelFastRendererLike {
  readonly draws: ParallelWebgl2RendererDrawMetrics[] = [];
  readonly preselectedUpdates: Uint32Array[] = [];
  readonly selectedUpdates: Uint32Array[] = [];
  disposed = false;
  hoverFocusActive = false;
  lineOpacityScale = 1;
  theme: ParallelFastTheme | undefined;
  setupMetrics: ParallelWebgl2RendererSetupMetrics = {
    blendMode: 'src-alpha-one-minus-src-alpha',
    densityMode: 'adaptive-alpha-source-over',
    lineAlpha: 0.1,
    lineOpacityScale: 1,
    selectedLineAlpha: 0.5,
    segmentCount: 4,
    uploadMs: 2,
    vertexCount: 8,
  };

  dispose(): void {
    this.disposed = true;
  }

  draw(): ParallelWebgl2RendererDrawMetrics | null {
    if (this.disposed) {
      return null;
    }
    const metrics = { drawCallCount: 1, redrawMs: 3 };
    this.draws.push(metrics);
    return metrics;
  }

  setHoverFocusActive(active: boolean): boolean {
    const changed = this.hoverFocusActive !== active;
    this.hoverFocusActive = active;
    return changed;
  }

  updateLineOpacityScale(lineOpacityScale: number): void {
    this.lineOpacityScale = lineOpacityScale;
  }

  updatePreselectedSourceIndices(
    _buffers: ParallelBuffers,
    preselectedSourceIndices: Uint32Array,
  ): void {
    this.preselectedUpdates.push(preselectedSourceIndices);
  }

  updateSelectedSourceIndices(
    _buffers: ParallelBuffers,
    selectedSourceIndices: Uint32Array,
  ): ParallelWebgl2SelectedUpdateMetrics {
    this.selectedUpdates.push(selectedSourceIndices);
    return {
      bufferCreationMs: 0,
      gpuUploadMs: 1,
      maskBuildMs: 2,
      maskGpuUploadMs: 3,
      selectedLineAlpha: 0.42,
      selectedRecordCount: selectedSourceIndices.length,
      selectedSegmentCount: selectedSourceIndices.length * 2,
      selectedVertexCount: selectedSourceIndices.length * 4,
      updateMs: 4,
    };
  }

  updateTheme(theme: ParallelFastTheme | undefined): void {
    this.theme = theme;
  }
}

class MockHoverRenderer implements ParallelFastHoverRendererLike {
  readonly draws: ParallelWebgl2HoverDrawMetrics[] = [];
  readonly hoverUpdates: Array<number | null> = [];
  disposed = false;
  theme: ParallelFastTheme | undefined;

  dispose(): void {
    this.disposed = true;
  }

  draw(): ParallelWebgl2HoverDrawMetrics | null {
    if (this.disposed) {
      return null;
    }
    const metrics = { drawCallCount: 1, redrawMs: 2 };
    this.draws.push(metrics);
    return metrics;
  }

  setHoverSourceIndex(
    _buffers: ParallelBuffers,
    sourceIndex: number | null,
  ): ParallelWebgl2HoverUpdateMetrics {
    this.hoverUpdates.push(sourceIndex);
    return {
      changed: true,
      gpuUploadMs: 1,
      hoverRecordIndex: sourceIndex,
      hoverSegmentCount: sourceIndex === null ? 0 : 2,
      hoverVertexCount: sourceIndex === null ? 0 : 4,
      updateMs: 2,
      uploadBytes: sourceIndex === null ? 0 : 16,
    };
  }

  updateTheme(theme: ParallelFastTheme | undefined): void {
    this.theme = theme;
  }
}

class ManualInputAdapter implements DomInputAdapter {
  private readonly handlers = new Map<string, Set<(event: never) => void>>();

  dispose(): void {
    this.handlers.clear();
  }

  emit<K extends keyof PlotInputEvents & string>(
    type: K,
    event: PlotInputEvents[K],
  ): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(event as never);
    }
  }

  on<K extends keyof PlotInputEvents & string>(
    type: K,
    handler: (event: PlotInputEvents[K]) => void,
  ): Unsubscribe {
    let handlers = this.handlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(type, handlers);
    }
    handlers.add(handler as (event: never) => void);
    return () => {
      handlers?.delete(handler as (event: never) => void);
    };
  }
}

function installDomGlobals(): FakeDocument {
  const document = new FakeDocument();
  Object.assign(globalThis, {
    cancelAnimationFrame: () => {},
    devicePixelRatio: 2,
    document,
    requestAnimationFrame: () => 1,
    window: {
      addEventListener: () => {},
      devicePixelRatio: 2,
      removeEventListener: () => {},
    },
  });
  return document;
}

function createBuffers(): ParallelBuffers {
  return {
    axisCount: 3,
    axisMetadataByAxis: {
      a: {
        categories: [
          { encoded: 0, label: 'Low', value: 'low' },
          { encoded: 1, label: 'Mid', value: 'mid' },
          { encoded: 2, label: 'High', value: 'high' },
        ],
        domain: { max: 2, min: 0 },
        key: 'a',
        kind: 'categorical',
        label: 'A',
        source: { fieldKey: 'category_a', tableKey: 'records' },
      },
      b: {
        domain: { max: 3, min: 1 },
        key: 'b',
        kind: 'numeric',
        label: 'B',
      },
      c: {
        domain: { max: 4, min: 2 },
        key: 'c',
        kind: 'numeric',
        label: 'C',
      },
    },
    axisOrder: ['a', 'b', 'c'],
    domainsByAxis: {
      a: { max: 2, min: 0, span: 2 },
      b: { max: 3, min: 1, span: 2 },
      c: { max: 4, min: 2, span: 2 },
    },
    ids: ['r0', 'r1'],
    lineSeriesBuffers: {
      gapCount: 0,
      pointsPerRecord: 3,
      sampleCount: 6,
      x: new Float32Array([0, 1, 2, 0, 1, 2]),
      y: new Float32Array([0, 0.5, 1, 1, 0.5, 0]),
    },
    normalizedValuesByAxis: {
      a: new Float32Array([0, 1]),
      b: new Float32Array([0.5, 0.5]),
      c: new Float32Array([1, 0]),
    },
    preselectedCount: 0,
    preselectedSourceIndices: new Uint32Array(0),
    rawValuesByAxis: {
      a: new Float64Array([0, 2]),
      b: new Float64Array([2, 2]),
      c: new Float64Array([4, 2]),
    },
    recordIdentityBySourceIndex: [
      { id: 'r0', sourceIndex: 0, table: 'parallel-a' },
      { id: 'r1', sourceIndex: 1, table: 'parallel-b' },
    ],
    recordCount: 2,
    webglSegmentBuffers: {
      positions: new Float32Array([0, 0, 1, 0.5, 1, 0.5, 2, 1]),
      segmentCount: 4,
      sourceIndices: new Uint32Array([0, 0, 1, 1]),
      valuesPerVertex: 2,
      verticesPerSegment: 2,
    },
  };
}

function createRendererFactories(
  renderers: MockRenderer[],
  hoverRenderers: MockHoverRenderer[],
): {
  hoverRendererFactory: ParallelFastHoverRendererFactory;
  rendererFactory: ParallelFastRendererFactory;
} {
  return {
    hoverRendererFactory: () => {
      const renderer = new MockHoverRenderer();
      hoverRenderers.push(renderer);
      return renderer;
    },
    rendererFactory: () => {
      const renderer = new MockRenderer();
      renderers.push(renderer);
      return renderer;
    },
  };
}

function makePointerEvent(
  type: NormalizedPointerEvent['type'],
  values: {
    button?: number;
    buttons?: number;
    clientX: number;
    clientY: number;
    ctrlKey?: boolean;
    hostX: number;
    hostY: number;
    shiftKey: boolean;
  },
): NormalizedPointerEvent {
  const originalEvent = new Event(type, { cancelable: true });
  return {
    button:
      values.button ??
      (type === 'pointerdown'
        ? 0
        : type === 'pointermove'
          ? -1
          : values.button === 1
            ? 1
            : values.button === 2
              ? 2
              : 0),
    buttons:
      values.buttons ??
      (type === 'pointerup' || type === 'pointercancel'
        ? 0
        : values.button === 1
          ? 4
          : values.button === 2
            ? 2
            : 1),
    client: { x: values.clientX, y: values.clientY },
    defaultPrevented: false,
    host: { x: values.hostX, y: values.hostY },
    modifiers: {
      altKey: false,
      ctrlKey: values.ctrlKey ?? false,
      metaKey: false,
      shiftKey: values.shiftKey,
    },
    originalEvent,
    pointerId: 1,
    pointerType: 'mouse',
    timeStamp: 0,
    type,
  };
}

function makeKeyEvent(
  type: NormalizedKeyEvent['type'],
  values: { code: string; key: string },
): NormalizedKeyEvent {
  const originalEvent = new Event(type, { cancelable: true });
  return {
    code: values.code,
    defaultPrevented: false,
    key: values.key,
    modifiers: {
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    },
    originalEvent,
    repeat: false,
    timeStamp: 0,
    type,
  };
}

function getFirstBrushRange(
  interval: NumericRange | readonly NumericRange[] | null | undefined,
): NumericRange | null {
  if (interval === null || interval === undefined) {
    return null;
  }
  return Array.isArray(interval) ? interval[0] ?? null : interval;
}

const document = installDomGlobals();

{
  const initialHost = new FakeElement(document);
  initialHost.setRect(320, 180);
  const initialRenderers: MockRenderer[] = [];
  const initialHoverRenderers: MockHoverRenderer[] = [];
  const { hoverRendererFactory, rendererFactory } = createRendererFactories(
    initialRenderers,
    initialHoverRenderers,
  );
  const initialPlot = createParallelFastPlot(
    initialHost as unknown as HTMLElement,
    {
      brushIntervals: { a: { max: 2.5, min: 1.5 } },
      buffers: createBuffers(),
      hoverRendererFactory,
      rendererFactory,
      selectedVisualUpdateDelayMs: 0,
    },
  );
  let lateSelectionEventCount = 0;
  initialPlot.on('selectionchange', () => {
    lateSelectionEventCount += 1;
  });
  const initialSnapshot = initialPlot.commands.getStateSnapshot();
  assert.equal(initialSnapshot.brush.activeBrushes.length, 1);
  assert.equal(initialSnapshot.selection.selectedCount, 1);
  assert.deepEqual([...initialSnapshot.selection.sourceIndices], [1]);
  assert.deepEqual([...initialSnapshot.selectedSourceIndices], [1]);
  const initialBrushOverlay = initialPlot.commands
    .getOverlays()
    .find((overlay) => overlay.kind === 'axis-brush');
  assert.equal(initialBrushOverlay?.activeBrushes.length, 1);
  assert.deepEqual([...initialRenderers[0]!.selectedUpdates.at(-1)!], [1]);
  assert.equal(lateSelectionEventCount, 0);
  initialPlot.dispose();
}

{
  const controlledHost = new FakeElement(document);
  controlledHost.setRect(320, 180);
  const controlledRenderers: MockRenderer[] = [];
  const controlledHoverRenderers: MockHoverRenderer[] = [];
  const { hoverRendererFactory, rendererFactory } = createRendererFactories(
    controlledRenderers,
    controlledHoverRenderers,
  );
  const controlledPlot = createParallelFastPlot(
    controlledHost as unknown as HTMLElement,
    {
      buffers: createBuffers(),
      hoverRendererFactory,
      rendererFactory,
      selectedVisualUpdateDelayMs: 0,
    },
  );
  const controlledBrushChanges: string[] = [];
  const controlledBrushCommits: string[] = [];
  const controlledSelections: number[][] = [];
  const controlledSelectionSources: unknown[] = [];
  const controlledSelectionValues: unknown[] = [];
  const controlledOverlayKinds: string[] = [];
  controlledPlot.on('brushchange', (event) => {
    controlledBrushChanges.push(
      `${event.phase}:${event.reason}:${event.source}:${event.activeBrushes.length}`,
    );
  });
  controlledPlot.on('brushcommit', (event) => {
    controlledBrushCommits.push(
      `${event.phase}:${event.defaultAction}:${event.target.parameterKey}:${event.range?.value?.min}:${event.range?.value?.max}`,
    );
  });
  controlledPlot.on('selectionchange', (event) => {
    controlledSelections.push([...event.sourceIndices]);
    controlledSelectionSources.push(event.filters[0]?.source);
    controlledSelectionValues.push(event.filters[0]?.values);
  });
  controlledPlot.on('overlaychange', (event) => {
    controlledOverlayKinds.push(event.kinds.join('+') || 'none');
  });

  controlledPlot.commands.previewBrushIntervals(
    { b: { max: 2.5, min: 1.5 } },
    { reason: 'create', source: 'pointer' },
  );
  assert.deepEqual(controlledSelections, []);

  controlledPlot.update({ brushIntervals: { a: { max: 2.5, min: 1.5 } } });
  assert.equal(controlledBrushChanges.at(-1), 'commit:set:command:1');
  assert.equal(controlledBrushCommits.at(-1), 'commit:select:a:1.5:2.5');
  assert.deepEqual(controlledSelections.at(-1), [1]);
  assert.deepEqual(controlledSelectionSources.at(-1), {
    fieldKey: 'category_a',
    tableKey: 'records',
  });
  assert.deepEqual(controlledSelectionValues.at(-1), [
    { encoded: 2, label: 'High', value: 'high' },
  ]);
  assert.equal(controlledOverlayKinds.at(-1), 'axis-brush');
  assert.equal(
    controlledPlot.commands.getOverlays().find((overlay) => overlay.kind === 'axis-brush')
      ?.activeBrushes.length,
    1,
  );
  assert.deepEqual(
    [...controlledPlot.commands.getStateSnapshot().selection.sourceIndices],
    [1],
  );
  assert.deepEqual([...controlledRenderers[0]!.selectedUpdates.at(-1)!], [1]);

  const nextBuffers = createBuffers();
  nextBuffers.rawValuesByAxis = {
    ...nextBuffers.rawValuesByAxis,
    a: new Float64Array([2, 2]),
  };
  controlledPlot.update({ buffers: nextBuffers });
  assert.deepEqual(controlledSelections.at(-1), [0, 1]);
  assert.deepEqual(
    [...controlledPlot.commands.getStateSnapshot().selection.sourceIndices],
    [0, 1],
  );
  assert.equal(controlledBrushChanges.at(-1), 'commit:set:command:1');

  const controlledMultiAxisSelections: Array<{
    activeBrushCount: number;
    aBrushCount: number;
    bBrushCount: number;
  }> = [];
  const unsubscribeControlledMultiAxisSelection = controlledPlot.on(
    'selectionchange',
    (event) => {
      controlledMultiAxisSelections.push({
        activeBrushCount: event.activeBrushes.length,
        aBrushCount: Array.isArray(event.brushIntervals.a)
          ? event.brushIntervals.a.length
          : event.brushIntervals.a === undefined
            ? 0
            : 1,
        bBrushCount: Array.isArray(event.brushIntervals.b)
          ? event.brushIntervals.b.length
          : event.brushIntervals.b === undefined
            ? 0
            : 1,
      });
    },
  );
  controlledPlot.commands.commitBrushIntervals(
    {
      a: [
        { max: 1.25, min: 0.75 },
        { max: 2.25, min: 1.75 },
      ],
      b: { max: 2.5, min: 1.5 },
    },
    { reason: 'set', source: 'command' },
  );
  assert.deepEqual(controlledMultiAxisSelections.at(-1), {
    activeBrushCount: 3,
    aBrushCount: 2,
    bBrushCount: 1,
  });
  unsubscribeControlledMultiAxisSelection();
  controlledPlot.dispose();
}

{
  const explicitInspection = {
    activeAxis: 'b',
    activeAxisValue: 2,
    distancePx: 0,
    id: 'r1',
    normalizedAxisValue: 0.5,
    projectedAxisPosition: 1,
    projectedNormalizedValue: 0.5,
    recordIndex: 1,
    segmentEndAxis: 'c',
    segmentStartAxis: 'b',
    source: 'local-nearest-segment',
  } as const;
  const explicitHost = new FakeElement(document);
  explicitHost.setRect(320, 180);
  const explicitRenderers: MockRenderer[] = [];
  const explicitHoverRenderers: MockHoverRenderer[] = [];
  const explicitFactories = createRendererFactories(
    explicitRenderers,
    explicitHoverRenderers,
  );
  const explicitPlot = createParallelFastPlot(
    explicitHost as unknown as HTMLElement,
    {
      buffers: createBuffers(),
      hoverRendererFactory: explicitFactories.hoverRendererFactory,
      inspection: explicitInspection,
      rendererFactory: explicitFactories.rendererFactory,
      selectedVisualUpdateDelayMs: 0,
    },
  );
  const explicitAdapter = new ManualInputAdapter();
  const explicitBinding = explicitPlot.use(
    createDefaultParallelBindings({
      inputAdapter: explicitAdapter,
      inspection: {
        explicitHoverModeActive: () => true,
      },
    }),
  );
  explicitAdapter.emit('key', makeKeyEvent('keyup', { code: 'ShiftLeft', key: 'Shift' }));
  assert.equal(explicitPlot.commands.getStateSnapshot().inspection?.id, 'r1');
  explicitBinding.dispose();
  explicitPlot.dispose();

  const transientHost = new FakeElement(document);
  transientHost.setRect(320, 180);
  const transientRenderers: MockRenderer[] = [];
  const transientHoverRenderers: MockHoverRenderer[] = [];
  const transientFactories = createRendererFactories(
    transientRenderers,
    transientHoverRenderers,
  );
  const transientPlot = createParallelFastPlot(
    transientHost as unknown as HTMLElement,
    {
      buffers: createBuffers(),
      hoverRendererFactory: transientFactories.hoverRendererFactory,
      inspection: explicitInspection,
      rendererFactory: transientFactories.rendererFactory,
      selectedVisualUpdateDelayMs: 0,
    },
  );
  const transientAdapter = new ManualInputAdapter();
  const transientBinding = transientPlot.use(
    createDefaultParallelBindings({
      inputAdapter: transientAdapter,
      inspection: {
        explicitHoverModeActive: () => false,
      },
    }),
  );
  transientAdapter.emit('key', makeKeyEvent('keyup', { code: 'ShiftLeft', key: 'Shift' }));
  assert.equal(transientPlot.commands.getStateSnapshot().inspection, null);
  transientBinding.dispose();
  transientPlot.dispose();
}

const host = new FakeElement(document);
host.setRect(320, 180);
const renderers: MockRenderer[] = [];
const hoverRenderers: MockHoverRenderer[] = [];
const metrics: ParallelFastRendererMetricsEvent[] = [];
const { hoverRendererFactory, rendererFactory } = createRendererFactories(
  renderers,
  hoverRenderers,
);

const plot = createParallelFastPlot(host as unknown as HTMLElement, {
  buffers: createBuffers(),
  hoverRendererFactory,
  onMetrics: (event) => metrics.push(event),
  rendererFactory,
  selectedVisualUpdateDelayMs: 0,
});

assert.equal(host.children.length, 2);
assert.equal(plot.commands.getCanvas(), host.children[0] as unknown as HTMLCanvasElement);
assert.equal(
  plot.commands.getHoverCanvas(),
  host.children[1] as unknown as HTMLCanvasElement,
);
assert.equal(renderers.length, 1);
assert.equal(hoverRenderers.length, 1);

const renderStates: string[] = [];
plot.on('renderstate', (event) => renderStates.push(event.state));
const hoverEvents: number[] = [];
plot.on('hovervisualchange', (event) => {
  hoverEvents.push(event.state.sourceIndex ?? -1);
});

plot.commands.render();
assert.equal(renderers[0]!.draws.length, 1);
assert.equal(hoverRenderers[0]!.draws.length, 1);
assert.deepEqual(renderStates, ['ready']);
assert.equal(plot.commands.getRenderSnapshot().canvas.width, 640);
assert.equal(plot.commands.getRenderSnapshot().canvas.height, 360);

plot.commands.setSelectedSourceIndices(new Uint32Array([1]));
assert.deepEqual([...renderers[0]!.selectedUpdates.at(-1)!], [1]);
assert.equal(metrics.at(-1)?.selectedLineSampleCount, 4);

plot.commands.setPreselectedSourceIndices(new Uint32Array([0]));
assert.deepEqual([...renderers[0]!.preselectedUpdates.at(-1)!], [0]);

const hoverMetrics = plot.commands.setHoverSourceIndex(1);
assert.equal(hoverMetrics?.hoverRecordIndex, 1);
assert.deepEqual(hoverRenderers[0]!.hoverUpdates, [1]);
assert.equal(renderers[0]!.hoverFocusActive, false);
assert.deepEqual(hoverEvents, [1]);
assert.equal(plot.commands.getStateSnapshot().hover.sourceIndex, 1);

const unchangedHover = plot.commands.setHoverState({
  dimBackground: true,
  sourceIndex: 1,
});
assert.equal(unchangedHover?.changed, false);
assert.equal(unchangedHover?.skipped, true);
assert.deepEqual(hoverEvents, [1]);

plot.commands.updateLineOpacityScale(0.25);
assert.equal(renderers[0]!.lineOpacityScale, 0.25);
assert.equal(plot.commands.getStateSnapshot().lineOpacityScale, 0.25);

const brushPreviewEvents: string[] = [];
const brushChangeEvents: string[] = [];
const brushCommitEvents: string[] = [];
const selectionEvents: Array<{
  activeBrushCount: number;
  reason: string;
  selectedCount: number;
  source: string;
  sourceIndices: number[];
}> = [];
const inspectionEvents: string[] = [];
const overlayKinds: string[] = [];
const lineOpacityRequests: string[] = [];
plot.on('brushpreview', (event) => {
  brushPreviewEvents.push(
    `${event.phase}:${event.reason}:${event.source}:${event.defaultAction}:${event.target.parameterKey}:${event.range?.value?.min}:${event.range?.value?.max}`,
  );
});
plot.on('brushchange', (event) => {
  brushChangeEvents.push(
    `${event.phase}:${event.reason}:${event.source}:${event.activeBrushes.length}`,
  );
});
plot.on('brushcommit', (event) => {
  brushCommitEvents.push(
    `${event.phase}:${event.reason}:${event.source}:${event.defaultAction}:${event.target.parameterKey}:${event.range?.value?.min}:${event.range?.value?.max}`,
  );
});
plot.on('selectionchange', (event) => {
  selectionEvents.push({
    activeBrushCount: event.activeBrushes.length,
    reason: event.reason,
    selectedCount: event.selectedCount,
    source: event.source,
    sourceIndices: [...event.sourceIndices],
  });
});
plot.on('inspectionchange', (event) => {
  inspectionEvents.push(
    `${event.lookupSource}:${event.source}:${event.inspection?.recordIndex ?? -1}:${event.inspection?.record?.table ?? 'none'}`,
  );
});
plot.on('overlaychange', (event) => {
  overlayKinds.push(event.kinds.join('+') || 'none');
});
plot.on('lineopacityadjustrequest', (event) => {
  lineOpacityRequests.push(
    `${event.adjustment}:${event.source}:${event.currentScale}`,
  );
});

plot.commands.previewBrushIntervals(
  { a: { max: 1.5, min: 0.5 } },
  { reason: 'create', source: 'pointer' },
);
assert.deepEqual(brushPreviewEvents, ['preview:create:pointer:select:a:0.5:1.5']);
assert.equal(plot.commands.getStateSnapshot().brush.activeBrushes[0]?.parameter, 'a');
assert.deepEqual(selectionEvents, []);

plot.commands.commitBrushIntervals(
  { a: [{ max: 1.5, min: 0.5 }] },
  { reason: 'set', source: 'route' },
);
assert.deepEqual(brushChangeEvents, ['commit:set:route:1']);
assert.deepEqual(brushCommitEvents, ['commit:set:route:select:a:0.5:1.5']);
assert.equal(plot.commands.getStateSnapshot().brush.activeBrushes.length, 1);
assert.deepEqual(selectionEvents.at(-1), {
  activeBrushCount: 1,
  reason: 'set',
  selectedCount: 0,
  source: 'route',
  sourceIndices: [],
});

plot.commands.removeBrushInterval('a', 0, { source: 'pointer' });
assert.equal(brushChangeEvents.at(-1), 'commit:remove:pointer:0');
assert.equal(brushCommitEvents.at(-1), 'commit:remove:pointer:select:null:undefined:undefined');
assert.equal(plot.commands.getStateSnapshot().brush.activeBrushes.length, 0);
assert.deepEqual(selectionEvents.at(-1), {
  activeBrushCount: 0,
  reason: 'remove',
  selectedCount: 0,
  source: 'pointer',
  sourceIndices: [],
});

const inspection = {
  activeAxis: 'b',
  activeAxisValue: 2,
  distancePx: 3,
  id: 'r1',
  normalizedAxisValue: 0.5,
  projectedAxisPosition: 1,
  projectedNormalizedValue: 0.5,
  record: { id: 'r1', sourceIndex: 1, table: 'parallel-b' },
  recordIndex: 1,
  segmentEndAxis: 'c',
  segmentStartAxis: 'b',
  source: 'local-nearest-segment',
} as const;
plot.commands.setInspection(inspection, {
  lookupSource: 'index',
  resolveMs: 1.25,
  source: 'pointer',
});
assert.deepEqual(inspectionEvents, ['index:pointer:1:parallel-b']);
assert.equal(plot.commands.getStateSnapshot().inspection?.id, 'r1');
assert.equal(overlayKinds.at(-1), 'inspection');

plot.commands.clearInspection({ lookupSource: 'none', source: 'keyboard' });
assert.equal(inspectionEvents.at(-1), 'none:keyboard:-1:none');
assert.equal(plot.commands.getStateSnapshot().inspection, null);
assert.equal(plot.commands.getStateSnapshot().hover.sourceIndex, null);
const inspectionEventCountBeforeControlledUpdate = inspectionEvents.length;
plot.update({ inspection });
assert.equal(inspectionEvents.length, inspectionEventCountBeforeControlledUpdate);
assert.equal(plot.commands.getStateSnapshot().inspection?.id, 'r1');
assert.equal(
  plot.commands.getOverlays().find((overlay) => overlay.kind === 'inspection')
    ?.inspection.id,
  'r1',
);
plot.commands.clearInspection({ lookupSource: 'none', source: 'keyboard' });
assert.equal(inspectionEvents.at(-1), 'none:keyboard:-1:none');
assert.equal(plot.commands.getStateSnapshot().inspection, null);

plot.commands.clearBrushes({ source: 'keyboard' });
assert.equal(brushChangeEvents.at(-1), 'commit:clear:keyboard:0');
assert.equal(brushCommitEvents.at(-1), 'commit:clear:keyboard:select:null:undefined:undefined');
assert.equal(plot.commands.getStateSnapshot().brush.activeBrushes.length, 0);
assert.equal(overlayKinds.at(-1), 'none');
assert.deepEqual(selectionEvents.at(-1), {
  activeBrushCount: 0,
  reason: 'clear',
  selectedCount: 0,
  source: 'keyboard',
  sourceIndices: [],
});

plot.commands.requestLineOpacityAdjustment('increase', { source: 'keyboard' });
assert.deepEqual(lineOpacityRequests, ['increase:keyboard:0.25']);

Object.assign(globalThis, {
  requestAnimationFrame: (callback: FrameRequestCallback) => {
    callback(performance.now());
    return 2;
  },
});
const adapter = new ManualInputAdapter();
const bindingBrushChanges: string[] = [];
const bindingInspections: string[] = [];
plot.on('brushchange', (event) => {
  bindingBrushChanges.push(`${event.reason}:${event.activeBrushes.length}`);
});
plot.on('inspectionchange', (event) => {
  bindingInspections.push(
    `${event.lookupSource}:${event.inspection?.recordIndex ?? -1}:${event.inspection?.record?.table ?? 'none'}`,
  );
});
const defaultBinding = plot.use(
  createDefaultParallelBindings({
    brushHitTest: () => ({
      axis: 'a',
      axisBounds: { height: 100, top: 0 },
      kind: 'create',
    }),
    inputAdapter: adapter,
  }),
);
const noHitBrushChangeCount = bindingBrushChanges.length;
const noHitAdapter = new ManualInputAdapter();
const noHitBinding = plot.use(
  createDefaultParallelBindings({
    inputAdapter: noHitAdapter,
  }),
);
noHitAdapter.emit(
  'pointer',
  makePointerEvent('pointerdown', {
    clientX: 20,
    clientY: 80,
    hostX: 20,
    hostY: 80,
    shiftKey: false,
  }),
);
noHitAdapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    clientX: 20,
    clientY: 20,
    hostX: 20,
    hostY: 20,
    shiftKey: false,
  }),
);
noHitAdapter.emit(
  'pointer',
  makePointerEvent('pointerup', {
    clientX: 20,
    clientY: 20,
    hostX: 20,
    hostY: 20,
    shiftKey: false,
  }),
);
assert.equal(bindingBrushChanges.length, noHitBrushChangeCount);
noHitBinding.dispose();
adapter.emit(
  'pointer',
  makePointerEvent('pointerdown', {
    button: 0,
    clientX: 20,
    clientY: 80,
    hostX: 20,
    hostY: 80,
    shiftKey: false,
  }),
);
adapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    button: 0,
    clientX: 20,
    clientY: 20,
    hostX: 20,
    hostY: 20,
    shiftKey: false,
  }),
);
adapter.emit(
  'pointer',
  makePointerEvent('pointerup', {
    button: 0,
    clientX: 20,
    clientY: 20,
    hostX: 20,
    hostY: 20,
    shiftKey: false,
  }),
);
assert.equal(bindingBrushChanges.length, noHitBrushChangeCount);
const colorRuleAdapter = new ManualInputAdapter();
const colorRuleBinding = plot.use(
  createDefaultParallelBindings({
    axisBrushGestures: [
      { button: 0, defaultAction: 'none', modifiers: { ctrlKey: true } },
    ],
    brushHitTest: () => ({
      axis: 'a',
      axisBounds: { height: 100, top: 0 },
      kind: 'create',
    }),
    inputAdapter: colorRuleAdapter,
  }),
);
const colorRuleSelectionEventCount = selectionEvents.length;
const colorRuleBrushChangeCount = bindingBrushChanges.length;
colorRuleAdapter.emit(
  'pointer',
  makePointerEvent('pointerdown', {
    button: 0,
    clientX: 20,
    clientY: 80,
    ctrlKey: true,
    hostX: 20,
    hostY: 80,
    shiftKey: false,
  }),
);
colorRuleAdapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    button: 0,
    clientX: 20,
    clientY: 20,
    ctrlKey: true,
    hostX: 20,
    hostY: 20,
    shiftKey: false,
  }),
);
colorRuleAdapter.emit(
  'pointer',
  makePointerEvent('pointerup', {
    button: 0,
    clientX: 20,
    clientY: 20,
    ctrlKey: true,
    hostX: 20,
    hostY: 20,
    shiftKey: false,
  }),
);
assert.match(
  brushPreviewEvents.at(-1) ?? '',
  /^preview:create:pointer:none:a:/,
);
assert.match(brushCommitEvents.at(-1) ?? '', /^commit:create:pointer:none:a:/);
assert.equal(selectionEvents.length, colorRuleSelectionEventCount);
assert.equal(bindingBrushChanges.length, colorRuleBrushChangeCount);
const colorRuleBrushOverlay = plot.commands
  .getOverlays()
  .find((overlay) => overlay.kind === 'color-rule-brush');
assert.equal(colorRuleBrushOverlay?.activeBrushes.length, 1);
assert.equal(getFirstBrushRange(colorRuleBrushOverlay?.brushIntervals.a)?.min, 0.2608695652173912);
plot.commands.clearOverlays('color-rule-brush');
assert.equal(
  plot.commands.getOverlays().some((overlay) => overlay.kind === 'color-rule-brush'),
  false,
);
colorRuleBinding.dispose();
adapter.emit(
  'pointer',
  makePointerEvent('pointerdown', {
    button: 2,
    clientX: 20,
    clientY: 80,
    hostX: 20,
    hostY: 80,
    shiftKey: false,
  }),
);
adapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    button: 2,
    clientX: 20,
    clientY: 20,
    hostX: 20,
    hostY: 20,
    shiftKey: false,
  }),
);
adapter.emit(
  'pointer',
  makePointerEvent('pointerup', {
    button: 2,
    clientX: 20,
    clientY: 20,
    hostX: 20,
    hostY: 20,
    shiftKey: false,
  }),
);
assert.equal(bindingBrushChanges.at(-1), 'create:1');
const resizeAdapter = new ManualInputAdapter();
const resizeBinding = plot.use(
  createDefaultParallelBindings({
    brushHitTest: () => ({
      axis: 'a',
      axisBounds: { height: 100, top: 0 },
      axisRangeIndex: 0,
      kind: 'max',
    }),
    inputAdapter: resizeAdapter,
  }),
);
resizeAdapter.emit(
  'pointer',
  makePointerEvent('pointerdown', {
    button: 2,
    clientX: 20,
    clientY: 20,
    hostX: 20,
    hostY: 20,
    shiftKey: false,
  }),
);
resizeAdapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    button: 2,
    clientX: 20,
    clientY: 5,
    hostX: 20,
    hostY: 5,
    shiftKey: false,
  }),
);
resizeAdapter.emit(
  'pointer',
  makePointerEvent('pointerup', {
    button: 2,
    clientX: 20,
    clientY: 5,
    hostX: 20,
    hostY: 5,
    shiftKey: false,
  }),
);
assert.equal(bindingBrushChanges.at(-1), 'resize-max:1');
assert.equal(
  getFirstBrushRange(plot.commands.getStateSnapshot().brush.brushIntervals.a)?.max,
  parallelDisplayValueToRenderedNormalizedValue(0.95) * 2,
);
resizeBinding.dispose();

const moveAdapter = new ManualInputAdapter();
const moveBinding = plot.use(
  createDefaultParallelBindings({
    brushHitTest: () => ({
      axis: 'a',
      axisBounds: { height: 100, top: 0 },
      axisRangeIndex: 0,
      kind: 'move',
    }),
    inputAdapter: moveAdapter,
  }),
);
moveAdapter.emit(
  'pointer',
  makePointerEvent('pointerdown', {
    button: 2,
    clientX: 20,
    clientY: 50,
    hostX: 20,
    hostY: 50,
    shiftKey: false,
  }),
);
moveAdapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    button: 2,
    clientX: 20,
    clientY: 60,
    hostX: 20,
    hostY: 60,
    shiftKey: false,
  }),
);
moveAdapter.emit(
  'pointer',
  makePointerEvent('pointerup', {
    button: 2,
    clientX: 20,
    clientY: 60,
    hostX: 20,
    hostY: 60,
    shiftKey: false,
  }),
);
assert.equal(bindingBrushChanges.at(-1), 'move:1');
assert.deepEqual(getFirstBrushRange(plot.commands.getStateSnapshot().brush.brushIntervals.a), {
  max: 1.6739130434782608,
  min: 0.04347826086956513,
});
moveBinding.dispose();

const appendAdapter = new ManualInputAdapter();
const appendBinding = plot.use(
  createDefaultParallelBindings({
    brushHitTest: () => ({
      axis: 'a',
      axisBounds: { height: 100, top: 0 },
      kind: 'create',
    }),
    inputAdapter: appendAdapter,
  }),
);
plot.commands.clearBrushes({ source: 'test-hook' });
appendAdapter.emit(
  'pointer',
  makePointerEvent('pointerdown', {
    button: 2,
    clientX: 20,
    clientY: 80,
    hostX: 20,
    hostY: 80,
    shiftKey: false,
  }),
);
appendAdapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    button: 2,
    clientX: 20,
    clientY: 60,
    hostX: 20,
    hostY: 60,
    shiftKey: false,
  }),
);
appendAdapter.emit(
  'pointer',
  makePointerEvent('pointerup', {
    button: 2,
    clientX: 20,
    clientY: 60,
    hostX: 20,
    hostY: 60,
    shiftKey: false,
  }),
);
appendAdapter.emit(
  'pointer',
  makePointerEvent('pointerdown', {
    button: 2,
    clientX: 20,
    clientY: 40,
    ctrlKey: true,
    hostX: 20,
    hostY: 40,
    shiftKey: false,
  }),
);
appendAdapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    button: 2,
    clientX: 20,
    clientY: 20,
    ctrlKey: true,
    hostX: 20,
    hostY: 20,
    shiftKey: false,
  }),
);
appendAdapter.emit(
  'pointer',
  makePointerEvent('pointerup', {
    button: 2,
    clientX: 20,
    clientY: 20,
    ctrlKey: true,
    hostX: 20,
    hostY: 20,
    shiftKey: false,
  }),
);
assert.equal(bindingBrushChanges.at(-1), 'create:2');
appendAdapter.emit(
  'pointer',
  makePointerEvent('pointerdown', {
    button: 2,
    clientX: 20,
    clientY: 70,
    hostX: 20,
    hostY: 70,
    shiftKey: false,
  }),
);
appendAdapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    button: 2,
    clientX: 20,
    clientY: 30,
    hostX: 20,
    hostY: 30,
    shiftKey: false,
  }),
);
appendAdapter.emit(
  'pointer',
  makePointerEvent('pointerup', {
    button: 2,
    clientX: 20,
    clientY: 30,
    hostX: 20,
    hostY: 30,
    shiftKey: false,
  }),
);
assert.equal(bindingBrushChanges.at(-1), 'create:1');
appendBinding.dispose();

const perAxisReplaceAdapter = new ManualInputAdapter();
const perAxisReplaceBinding = plot.use(
  createDefaultParallelBindings({
    brushHitTest: (event) => ({
      axis: event.host.x < 40 ? 'a' : 'b',
      axisBounds: { height: 100, top: 0 },
      kind: 'create',
    }),
    inputAdapter: perAxisReplaceAdapter,
  }),
);
plot.commands.clearBrushes({ source: 'test-hook' });
perAxisReplaceAdapter.emit(
  'pointer',
  makePointerEvent('pointerdown', {
    button: 2,
    clientX: 20,
    clientY: 80,
    hostX: 20,
    hostY: 80,
    shiftKey: false,
  }),
);
perAxisReplaceAdapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    button: 2,
    clientX: 20,
    clientY: 60,
    hostX: 20,
    hostY: 60,
    shiftKey: false,
  }),
);
perAxisReplaceAdapter.emit(
  'pointer',
  makePointerEvent('pointerup', {
    button: 2,
    clientX: 20,
    clientY: 60,
    hostX: 20,
    hostY: 60,
    shiftKey: false,
  }),
);
perAxisReplaceAdapter.emit(
  'pointer',
  makePointerEvent('pointerdown', {
    button: 2,
    clientX: 60,
    clientY: 75,
    hostX: 60,
    hostY: 75,
    shiftKey: false,
  }),
);
perAxisReplaceAdapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    button: 2,
    clientX: 60,
    clientY: 55,
    hostX: 60,
    hostY: 55,
    shiftKey: false,
  }),
);
perAxisReplaceAdapter.emit(
  'pointer',
  makePointerEvent('pointerup', {
    button: 2,
    clientX: 60,
    clientY: 55,
    hostX: 60,
    hostY: 55,
    shiftKey: false,
  }),
);
assert.equal(bindingBrushChanges.at(-1), 'create:2');
assert.equal(plot.commands.getStateSnapshot().brush.activeBrushes.length, 2);
perAxisReplaceAdapter.emit(
  'pointer',
  makePointerEvent('pointerdown', {
    button: 2,
    clientX: 60,
    clientY: 40,
    hostX: 60,
    hostY: 40,
    shiftKey: false,
  }),
);
perAxisReplaceAdapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    button: 2,
    clientX: 60,
    clientY: 20,
    hostX: 60,
    hostY: 20,
    shiftKey: false,
  }),
);
perAxisReplaceAdapter.emit(
  'pointer',
  makePointerEvent('pointerup', {
    button: 2,
    clientX: 60,
    clientY: 20,
    hostX: 60,
    hostY: 20,
    shiftKey: false,
  }),
);
assert.equal(bindingBrushChanges.at(-1), 'create:2');
const perAxisBrushIntervals = plot.commands.getStateSnapshot().brush.brushIntervals;
assert.equal(getFirstBrushRange(perAxisBrushIntervals.a)?.min, 0.2608695652173912);
assert.equal(getFirstBrushRange(perAxisBrushIntervals.a)?.max, 0.6956521739130435);
assert.equal(getFirstBrushRange(perAxisBrushIntervals.b)?.min, 2.1304347826086953);
assert.equal(getFirstBrushRange(perAxisBrushIntervals.b)?.max, 2.5652173913043477);
perAxisReplaceBinding.dispose();

const removeInput = new FakeElement(document);
plot.commands.commitBrushIntervals(
  { a: [{ max: 1.5, min: 0.5 }] },
  { reason: 'set', source: 'test-hook' },
);
const removeBinding = plot.use(
  createDefaultParallelBindings({
    brushHitTest: () => ({
      axis: 'a',
      axisBounds: { height: 100, top: 0 },
      axisRangeIndex: 0,
      kind: 'move',
    }),
    inputAdapter: new ManualInputAdapter(),
    inputElement: removeInput as unknown as HTMLElement,
  }),
);
removeInput.dispatchEvent(
  Object.assign(new Event('dblclick', { cancelable: true }), { button: 2 }),
);
assert.equal(bindingBrushChanges.at(-1), 'remove:0');
removeBinding.dispose();

const gatedAdapter = new ManualInputAdapter();
const gatedBinding = plot.use(
  createDefaultParallelBindings({
    inputAdapter: gatedAdapter,
    shortcutGate: () => false,
  }),
);
const ignoredEscape = makeKeyEvent('keydown', { code: 'Escape', key: 'Escape' });
gatedAdapter.emit('key', ignoredEscape);
assert.equal(ignoredEscape.originalEvent.defaultPrevented, false);
assert.equal(bindingBrushChanges.at(-1), 'remove:0');
gatedBinding.dispose();

plot.commands.commitBrushIntervals(
  { a: [{ max: 1.5, min: 0.5 }] },
  { reason: 'set', source: 'test-hook' },
);
const handledEscape = makeKeyEvent('keydown', { code: 'Escape', key: 'Escape' });
const brushChangeCountBeforeEscape = bindingBrushChanges.length;
adapter.emit('key', handledEscape);
assert.equal(handledEscape.originalEvent.defaultPrevented, true);
assert.equal(bindingBrushChanges.at(-1), 'clear:0');
assert.equal(bindingBrushChanges.length, brushChangeCountBeforeEscape + 1);
const lineOpacityRequestCountBeforeKey = lineOpacityRequests.length;
const increaseKey = makeKeyEvent('keydown', { code: 'Period', key: '.' });
adapter.emit('key', increaseKey);
assert.equal(increaseKey.originalEvent.defaultPrevented, true);
assert.equal(lineOpacityRequests.at(-1), 'increase:keyboard:0.25');
assert.equal(lineOpacityRequests.length, lineOpacityRequestCountBeforeKey + 1);
adapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    clientX: 160,
    clientY: 90,
    hostX: 160,
    hostY: 90,
    shiftKey: true,
  }),
	);
assert.equal(bindingInspections.at(-1)?.startsWith('fallback:'), true);
defaultBinding.dispose();

let queuedRafCallbacks: FrameRequestCallback[] = [];
const flushQueuedRafCallbacks = () => {
  const callbacks = queuedRafCallbacks;
  queuedRafCallbacks = [];
  callbacks.forEach((callback) => callback(performance.now()));
};
Object.assign(globalThis, {
  cancelAnimationFrame: (handle: number) => {
    void handle;
  },
  requestAnimationFrame: (callback: FrameRequestCallback) => {
    queuedRafCallbacks.push(callback);
    return queuedRafCallbacks.length;
  },
});

plot.commands.clearBrushes({ source: 'test-hook' });
const deferredAdapter = new ManualInputAdapter();
const deferredBrushEvents: Array<{
  max: number | undefined;
  min: number | undefined;
  phase: string;
}> = [];
const unsubscribeDeferredBrush = plot.on('brushchange', (event) => {
  const range = getFirstBrushRange(event.brushIntervals.a);
  deferredBrushEvents.push({
    max: range?.max,
    min: range?.min,
    phase: event.phase,
  });
});
const unsubscribeDeferredPreview = plot.on('brushpreview', (event) => {
  const range = getFirstBrushRange(event.brushIntervals.a);
  deferredBrushEvents.push({
    max: range?.max,
    min: range?.min,
    phase: event.phase,
  });
});
const deferredBinding = plot.use(
  createDefaultParallelBindings({
    brushHitTest: () => ({
      axis: 'a',
      axisBounds: { height: 100, top: 0 },
      kind: 'create',
    }),
    inputAdapter: deferredAdapter,
  }),
);
deferredAdapter.emit(
  'pointer',
  makePointerEvent('pointerdown', {
    button: 2,
    clientX: 20,
    clientY: 80,
    hostX: 20,
    hostY: 80,
    shiftKey: false,
  }),
);
deferredAdapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    button: 2,
    clientX: 20,
    clientY: 20,
    hostX: 20,
    hostY: 20,
    shiftKey: false,
  }),
);
deferredAdapter.emit(
  'pointer',
  makePointerEvent('pointerup', {
    button: 2,
    clientX: 20,
    clientY: 20,
    hostX: 20,
    hostY: 20,
    shiftKey: false,
  }),
);
const deferredCommitCount = deferredBrushEvents.filter(
  (event) => event.phase === 'commit',
).length;
assert.deepEqual(deferredBrushEvents.at(-1), {
  max: 1.565217391304348,
  min: 0.2608695652173912,
  phase: 'commit',
});
flushQueuedRafCallbacks();
assert.equal(
  deferredBrushEvents.filter((event) => event.phase === 'commit').length,
  deferredCommitCount,
);
deferredBinding.dispose();
unsubscribeDeferredPreview();
unsubscribeDeferredBrush();

plot.commands.clearBrushes({ source: 'test-hook' });
queuedRafCallbacks = [];
const coalescedAdapter = new ManualInputAdapter();
const coalescedPreviews: Array<{
  max: number | undefined;
  min: number | undefined;
}> = [];
const unsubscribeCoalescedPreview = plot.on('brushpreview', (event) => {
  const range = getFirstBrushRange(event.brushIntervals.a);
  coalescedPreviews.push({
    max: range?.max,
    min: range?.min,
  });
});
const coalescedBinding = plot.use(
  createDefaultParallelBindings({
    brushHitTest: () => ({
      axis: 'a',
      axisBounds: { height: 100, top: 0 },
      kind: 'create',
    }),
    inputAdapter: coalescedAdapter,
  }),
);
coalescedAdapter.emit(
  'pointer',
  makePointerEvent('pointerdown', {
    button: 2,
    clientX: 20,
    clientY: 80,
    hostX: 20,
    hostY: 80,
    shiftKey: false,
  }),
);
coalescedAdapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    button: 2,
    clientX: 20,
    clientY: 60,
    hostX: 20,
    hostY: 60,
    shiftKey: false,
  }),
);
coalescedAdapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    button: 2,
    clientX: 20,
    clientY: 10,
    hostX: 20,
    hostY: 10,
    shiftKey: false,
  }),
);
assert.equal(coalescedPreviews.length, 1);
flushQueuedRafCallbacks();
assert.deepEqual(coalescedPreviews.at(-1), {
  max: 1.782608695652174,
  min: 0.2608695652173912,
});
coalescedBinding.dispose();
unsubscribeCoalescedPreview();

plot.commands.clearBrushes({ source: 'test-hook' });
queuedRafCallbacks = [];
const cancelAdapter = new ManualInputAdapter();
const cancelCommits: Array<{ max: number | undefined; min: number | undefined }> =
  [];
const unsubscribeCancelBrush = plot.on('brushchange', (event) => {
  if (event.phase === 'commit') {
    const range = getFirstBrushRange(event.brushIntervals.a);
    cancelCommits.push({
      max: range?.max,
      min: range?.min,
    });
  }
});
const cancelBinding = plot.use(
  createDefaultParallelBindings({
    brushHitTest: () => ({
      axis: 'a',
      axisBounds: { height: 100, top: 0 },
      kind: 'create',
    }),
    inputAdapter: cancelAdapter,
  }),
);
cancelAdapter.emit(
  'pointer',
  makePointerEvent('pointerdown', {
    button: 2,
    clientX: 20,
    clientY: 80,
    hostX: 20,
    hostY: 80,
    shiftKey: false,
  }),
);
cancelAdapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    button: 2,
    clientX: 20,
    clientY: 20,
    hostX: 20,
    hostY: 20,
    shiftKey: false,
  }),
);
cancelAdapter.emit(
  'pointer',
  makePointerEvent('pointercancel', {
    button: 2,
    clientX: 20,
    clientY: 20,
    hostX: 20,
    hostY: 20,
    shiftKey: false,
  }),
);
assert.deepEqual(cancelCommits.at(-1), {
  max: 1.565217391304348,
  min: 0.2608695652173912,
});
cancelAdapter.emit(
  'pointer',
  makePointerEvent('pointermove', {
    button: 2,
    clientX: 20,
    clientY: 5,
    hostX: 20,
    hostY: 5,
    shiftKey: false,
  }),
);
assert.deepEqual(cancelCommits.at(-1), {
  max: 1.565217391304348,
  min: 0.2608695652173912,
});
cancelBinding.dispose();
unsubscribeCancelBrush();

Object.assign(globalThis, {
  requestAnimationFrame: (callback: FrameRequestCallback) => {
    callback(performance.now());
    return 3;
  },
});

const theme: ParallelFastTheme = {
  backgroundColor: [0, 0, 0, 1],
  lineColor: [1, 1, 1, 1],
  preselectedColor: [1, 0.7, 0, 0.7],
  selectedColor: [1, 0, 0, 1],
};
plot.commands.updateTheme(theme);
assert.equal(renderers[0]!.theme, theme);
assert.equal(hoverRenderers[0]!.theme, theme);

host.setRect(400, 200);
plot.commands.resize();
assert.equal(plot.commands.getRenderSnapshot().canvas.width, 800);
assert.equal(plot.commands.getRenderSnapshot().hoverCanvas.height, 400);

let bindingDisposed = false;
const binding = plot.use(() => () => {
  bindingDisposed = true;
});
binding.dispose();
assert.equal(bindingDisposed, true);

const contextLost = new Event('webglcontextlost', { cancelable: true });
plot.commands.getCanvas().dispatchEvent(contextLost);
assert.equal(contextLost.defaultPrevented, true);
assert.equal(renderers[0]!.disposed, true);
assert.equal(hoverRenderers[0]!.disposed, true);

plot.commands.getCanvas().dispatchEvent(new Event('webglcontextrestored'));
assert.equal(renderers.length, 2);
assert.equal(hoverRenderers.length, 2);
const restoredRendererDrawCount = renderers[1]!.draws.length;

let disposeEventCount = 0;
plot.on('dispose', () => {
  disposeEventCount += 1;
});
plot.dispose();
assert.equal(disposeEventCount, 1);
assert.equal(host.children.length, 0);
assert.equal(renderers[1]!.disposed, true);
assert.equal(hoverRenderers[1]!.disposed, true);

plot.commands.render();
plot.commands.setSelectedSourceIndices(new Uint32Array([0]));
plot.commands.setHoverSourceIndex(0);
plot.update({ lineOpacityScale: 2 });
plot.use(() => {
  throw new Error('disposed plot should not attach bindings');
});
assert.equal(renderers[1]!.draws.length, restoredRendererDrawCount);
assert.deepEqual(hoverEvents, [1, -1, 1, -1, 0, -1]);

console.log('parallel-fast engine lifecycle tests passed');
