import {
  DisposableStack,
  brushEventNameForPhase,
  createEmitter,
  createResizeLifecycle,
  createWebGlContextLifecycle,
  toDisposable,
  type Disposable,
} from '../../plot-engine/core/index.js';
import {
  HistogramWebglRenderer,
  buildHistogramAggregation,
  createDefaultHistogramViewport,
  createHistogramLayout,
  findHistogramPlotRectAtPoint,
  locateHistogramBinAtPixel,
  materializeHistogramBinSourceIndices,
  prepareHistogramAggregationState,
  histogramPixelToAxis,
  normalizeHistogramViewport,
  panHistogramViewportFromDrag,
  selectHistogramBinsInBounds,
  selectHistogramBinsInPolygon,
  resolveHistogramRectangleZoomEffectiveAxisMode,
  zoomHistogramViewportAtPointer,
  zoomHistogramViewportToRectangle,
  type HistogramAggregationSet,
  type HistogramAggregationPreparedState,
  type HistogramBinDescriptor,
  type HistogramBinRef,
  type HistogramBinHit,
  type HistogramBinSizeState,
  type HistogramHoverEvent,
  type HistogramLayout,
  type HistogramMeasurementEvent,
  type HistogramMetricsEvent,
  type HistogramParameterSpec,
  type HistogramPixelBounds,
  type HistogramPlotRect,
  type HistogramPoint,
  type HistogramRange,
  type HistogramRendererHoverBin,
  type HistogramSelectionEvent,
  type HistogramSelectionCategoryValue,
  type HistogramSelectionFilter,
  type HistogramSelectionKind,
  type HistogramSelectionResult,
  type HistogramSelectionSource,
  type HistogramSourceIndicesStatus,
  type HistogramViewport,
  type HistogramViewportChangePhase,
  type HistogramViewportChangeReason,
  type HistogramWebglRendererOptions,
} from '../core/index.js';
import type { HistogramPlotCommands } from './histogramCommands.js';
import type {
  HistogramBrushEvent,
  HistogramEngineEvents,
} from './histogramEvents.js';
import type { HistogramOverlayDescriptor, HistogramOverlayKind } from './histogramOverlays.js';
import type {
  HistogramBinding,
  HistogramPlotInstance,
  HistogramPlotOptions,
  HistogramRendererLike,
} from './types.js';
import type { HistogramCursorState, HistogramRenderState } from './histogramState.js';

const DEFAULT_CANVAS_CLASS = 'histogram-fast-engine-canvas';
const DEFAULT_CANVAS_LABEL = 'WebGL2 histogram canvas';
const DEFAULT_HOST_CLASS = 'histogram-fast-engine-host';
const DEFAULT_OVERLAY_CLASS = 'histogram-fast-engine-overlay';
const DEFAULT_SELECTION_SAMPLE_SIZE = 5;
const WEBGL_UNAVAILABLE_MESSAGE =
  'WebGL2 is unavailable in this browser. Use a browser or device with WebGL2 enabled.';

interface HistogramEngineState {
  readonly aggregation: HistogramAggregationSet;
  readonly preparedAggregationState?: HistogramAggregationPreparedState;
  readonly binSizes: readonly HistogramBinSizeState[];
  readonly lastSelection: HistogramSelectionEvent | null;
  readonly options: HistogramPlotOptions;
  readonly selectionFilters: readonly HistogramSelectionFilter[];
  readonly selectedSourceIndices: Uint32Array;
  readonly viewport: HistogramViewport;
}

export function createHistogramPlot(
  hostElement: HTMLElement,
  options: HistogramPlotOptions,
): HistogramPlotInstance {
  const emitter = createEmitter<HistogramEngineEvents>();
  const disposables = new DisposableStack();
  const bindingDisposables = new DisposableStack();
  const document = hostElement.ownerDocument ?? globalThis.document;
  if (!document) {
    throw new Error('Histogram plot requires a DOM document.');
  }

  let disposed = false;
  let state = createInitialState(options);
  let renderer: HistogramRendererLike | null = null;
  let renderState: HistogramRenderState = 'idle';
  let renderStateMessage: string | undefined;
  let firstRenderReported = false;
  let activePlotId: string | null = null;
  let cursorState: HistogramCursorState = 'default';
  let overlays: readonly HistogramOverlayDescriptor[] = [];
  let activeHover: HistogramHoverEvent | null = null;
  let activeHoverBin: HistogramRendererHoverBin | null = null;
  let activeMeasurement: HistogramMeasurementEvent | null = null;

  const previousHostClassName = hostElement.className;
  const previousHostInlinePosition = hostElement.style.position;
  if (state.options.hostClassName ?? DEFAULT_HOST_CLASS) {
    hostElement.classList.add(
      ...splitClassNames(state.options.hostClassName ?? DEFAULT_HOST_CLASS),
    );
  }
  hostElement.style.position ||= 'relative';

  const canvas = document.createElement('canvas');
  canvas.className = state.options.canvasClassName ?? DEFAULT_CANVAS_CLASS;
  canvas.setAttribute('aria-label', state.options.canvasLabel ?? DEFAULT_CANVAS_LABEL);
  canvas.dataset.renderer = 'webgl2-histogram';
  canvas.dataset.testid = 'histogram-fast-engine-canvas';
  Object.assign(canvas.style, {
    display: 'block',
    height: '100%',
    inset: '0',
    position: 'absolute',
    width: '100%',
  });

  const overlayElement = document.createElement('div');
  overlayElement.className = state.options.overlayClassName ?? DEFAULT_OVERLAY_CLASS;
  overlayElement.dataset.testid = 'histogram-fast-engine-overlay';
  Object.assign(overlayElement.style, {
    inset: '0',
    pointerEvents: 'none',
    position: 'absolute',
  });

  hostElement.append(canvas, overlayElement);
  disposables.defer(() => {
    bindingDisposables.dispose();
    destroyRenderer();
    canvas.remove();
    overlayElement.remove();
    hostElement.className = previousHostClassName;
    hostElement.style.position = previousHostInlinePosition;
  });

  function emitRenderState(nextState: HistogramRenderState, message?: string): void {
    if (disposed) {
      return;
    }
    if (renderState === nextState && renderStateMessage === message) {
      return;
    }
    renderState = nextState;
    renderStateMessage = message;
    const event = message === undefined ? { state: nextState } : { message, state: nextState };
    emitter.emit('renderstate', event);
    emitter.emit('renderstatechange', event);
  }

  function emitMetrics(metrics: HistogramMetricsEvent): void {
    if (disposed) {
      return;
    }
    const event =
      metrics.at === undefined
        ? {
            ...metrics,
            at: performance.now(),
          }
        : metrics;
    state.options.onMetrics?.(event);
    emitter.emit('metrics', event);
    if (event.phase === 'render' && !firstRenderReported) {
      firstRenderReported = true;
      emitRenderState('ready');
    }
  }

  function getCurrentLayout(): HistogramLayout {
    const rect = getHostLayoutRect();
    return createHistogramLayout(state.options.spec, {
      focusedSubplotId: state.options.focusedSubplotId,
      heightCssPx: rect.height,
      widthCssPx: rect.width,
    });
  }

  function getHostLayoutRect(): DOMRect {
    const rect = hostElement.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return rect;
    }
    const parentRect = hostElement.parentElement?.getBoundingClientRect();
    if (parentRect !== undefined && parentRect.width > 0 && parentRect.height > 0) {
      return parentRect;
    }
    return rect;
  }

  function buildRendererOptions(): HistogramWebglRendererOptions {
    return {
      aggregation: state.aggregation,
      canvas,
      devicePixelRatio: globalThis.devicePixelRatio || 1,
      hoverBin: activeHoverBin,
      layout: getCurrentLayout(),
      onMetrics: emitMetrics,
      preserveDrawingBuffer: state.options.preserveDrawingBuffer,
      selectedBinKeys: getRenderableSelectedBinKeys(state),
      theme: state.options.theme,
      viewport: state.viewport,
    };
  }

  function createRenderer(): void {
    if (disposed || renderer !== null) {
      return;
    }
    emitRenderState('rendering');
    firstRenderReported = false;
    if (state.options.forceWebglUnavailable) {
      throw new Error(WEBGL_UNAVAILABLE_MESSAGE);
    }
    const rendererFactory =
      state.options.rendererFactory ??
      ((rendererOptions) => new HistogramWebglRenderer(rendererOptions));
    renderer = rendererFactory(buildRendererOptions());
    emitRenderState('ready');
  }

  function destroyRenderer(): void {
    renderer?.dispose();
    renderer = null;
  }

  function resizeRenderer(): void {
    if (disposed || renderer === null) {
      return;
    }
    renderer.update({
      devicePixelRatio: globalThis.devicePixelRatio || 1,
      layout: getCurrentLayout(),
    });
  }

  function handleSetupError(error: unknown, fallback: string): void {
    const message = error instanceof Error ? error.message : fallback;
    emitRenderState('error', message);
  }

  disposables.add(
    createWebGlContextLifecycle(canvas, {
      onLost(event) {
        if (disposed) {
          return;
        }
        emitter.emit('contextlost', { originalEvent: event });
        emitRenderState('rendering', 'WebGL2 context lost; waiting for restore.');
        destroyRenderer();
      },
      onRestored(event) {
        if (disposed) {
          return;
        }
        emitter.emit('contextrestored', { originalEvent: event });
        try {
          createRenderer();
        } catch (error) {
          handleSetupError(error, 'Unknown histogram WebGL2 renderer restore error.');
        }
      },
      preventDefaultOnLost: true,
    }),
  );

  disposables.add(
    createResizeLifecycle(hostElement, (event) => {
      if (disposed || renderer === null) {
        return;
      }
      renderer.update({
        devicePixelRatio: event.devicePixelRatio,
        layout: getCurrentLayout(),
      });
    }),
  );

  const commands: HistogramPlotCommands = {
    clearHover() {
      commitHover(null, null);
    },
    clearOverlays(kind?: HistogramOverlayKind) {
      if (disposed) {
        return;
      }
      const nextOverlays = kind
        ? overlays.filter((overlay) => overlay.kind !== kind)
        : [];
      if (nextOverlays.length === overlays.length) {
        return;
      }
      overlays = nextOverlays;
      emitter.emit('overlaychange', { overlays, reason: 'clear' });
    },
    clearSelection(kind = 'replace') {
      if (disposed) {
        return null;
      }
      commands.clearOverlays('committed-selection');
      return commitSelection({
        durationMs: 0,
        kind,
        result: createProgrammaticSelectionResult({
          sourceIndices: new Uint32Array(0),
          tool: 'programmatic',
        }),
      });
    },
    getBinAtPoint(pointerCssX, pointerCssY) {
      if (disposed) {
        return null;
      }
      return locateHistogramBinAtPixel({
        aggregation: state.aggregation,
        canvasX: pointerCssX,
        canvasY: pointerCssY,
        ids: state.options.columns?.ids,
        layout: getCurrentLayout(),
        sampleSize: DEFAULT_SELECTION_SAMPLE_SIZE,
        viewport: state.viewport,
      });
    },
    getCanvas() {
      return canvas;
    },
    getHostElement() {
      return hostElement;
    },
    getOverlayElement() {
      return overlayElement;
    },
    getOverlays() {
      return overlays;
    },
    getPlotRectAtPoint(pointerCssX, pointerCssY) {
      return findHistogramPlotRectAtPoint(
        getCurrentLayout().plotRects,
        pointerCssX,
        pointerCssY,
      );
    },
    getRenderSnapshot() {
      const rect = getHostLayoutRect();
      return {
        aggregation: state.aggregation,
        canvas: {
          cssHeight: rect.height,
          cssWidth: rect.width,
          devicePixelRatio: globalThis.devicePixelRatio || 1,
          height: canvas.height,
          width: canvas.width,
        },
        hoverBin: activeHoverBin,
        layout: getCurrentLayout(),
        renderState,
        renderStateMessage,
      };
    },
    getStateSnapshot() {
      return {
        activeSubplotId: activePlotId,
        aggregation: state.aggregation,
        axisMode: state.options.axisMode ?? 'xy',
        binSizes: state.binSizes,
        cursor: cursorState,
        focusedSubplotId: state.options.focusedSubplotId ?? null,
        hover: activeHover,
        measurement: activeMeasurement,
        mode: state.options.mode ?? 'select',
        overlays,
        render: commands.getRenderSnapshot(),
        selectionFilters: state.selectionFilters,
        selectedSourceIndices: state.selectedSourceIndices,
        viewport: state.viewport,
      };
    },
    emitBrushEvent(event: HistogramBrushEvent) {
      if (disposed) {
        return;
      }
      emitter.emit(brushEventNameForPhase(event.phase), event as never);
    },
    hoverAtPoint(request) {
      if (disposed) {
        return null;
      }
      const startedAt = performance.now();
      const hit = commands.getBinAtPoint(request.pointerCssX, request.pointerCssY);
      const hover =
        hit === null
          ? null
          : {
              bin: enrichHistogramBinRefSource(hit.binRef),
              canvasPoint: hit.canvasPoint,
              candidateCount: hit.bin.totalCount,
              durationMs: Math.max(0, performance.now() - startedAt),
              pinned: request.pinned ?? false,
              source: request.source,
            };
      const hoverBin =
        hit === null
          ? null
          : {
              binIndex: hit.binIndex,
              subplotId: hit.subplot.subplotId,
            };
      commitHover(hover, hoverBin, 'pointer');
      if (hover !== null) {
        commands.setActivePlot(hover.bin.bin.subplotId, 'pointer');
      }
      emitMetrics({
        at: performance.now(),
        detail: JSON.stringify({
          binIndex: hit?.binIndex ?? null,
          operation: 'bin-hover-lookup',
          source: hover?.source ?? 'none',
          subplotId: hit?.subplot.subplotId ?? null,
        }),
        durationMs: Math.max(0, performance.now() - startedAt),
        phase: 'hover',
      });
      return hover;
    },
    panFromDrag(request) {
      if (disposed) {
        return null;
      }
      const startedAt = performance.now();
      const result = panHistogramViewportFromDrag({
        axisMode: request.axisMode,
        currentPointerCssX: request.currentPointerCssX,
        currentPointerCssY: request.currentPointerCssY,
        layout: getCurrentLayout(),
        startPointerCssX: request.startPointerCssX,
        startPointerCssY: request.startPointerCssY,
        startViewport: request.startViewport,
        subplotId: request.subplotId,
      });
      if (result === null) {
        return null;
      }
      commands.setViewport(result.viewport, 'drag', 'preview');
      emitMetrics({
        at: performance.now(),
        detail: JSON.stringify({
          axisMode: request.axisMode ?? 'xy',
          deltaX: result.deltaX,
          deltaY: result.deltaY,
          operation: 'drag-pan',
          subplotId: result.subplotId,
          updateCount: request.updateCount ?? 0,
        }),
        durationMs: Math.max(0, performance.now() - startedAt),
        phase: 'interaction',
      });
      return result;
    },
    materializeSelectionSourceIndices() {
      if (disposed || state.lastSelection === null) {
        return null;
      }
      const selection = materializeSelectionFromState();
      if (selection === null) {
        return null;
      }
      state = {
        ...state,
        lastSelection: selection,
        options: {
          ...state.options,
          selectedSourceIndices: selection.sourceIndices,
        },
        selectedSourceIndices: selection.sourceIndices,
      };
      state = rebuildStateAggregation(state, {
        includeMembership: !aggregationHasPendingMembership(state.aggregation),
      });
      renderer?.update({
        aggregation: state.aggregation,
        selectedBinKeys: getRenderableSelectedBinKeys(state),
      });
      renderer?.render();
      state.options.onSelectionChange?.(selection);
      emitter.emit('selectionchange', selection);
      return selection;
    },
    materializeVisibleMembership() {
      if (disposed) {
        return null;
      }
      const aggregation = materializeCurrentAggregationMembership();
      return aggregation;
    },
    render() {
      if (disposed) {
        return null;
      }
      return renderer?.render() ?? null;
    },
    requestBinSizeAdjust(request) {
      if (disposed) {
        return;
      }
      const binSize =
        request.binSize ??
        state.binSizes.find((candidate) => candidate.subplotId === request.subplotId);
      emitter.emit('binsizeadjustrequest', {
        binSize,
        delta: request.delta,
        source: request.source ?? 'command',
        subplotId: request.subplotId ?? binSize?.subplotId,
      });
    },
    requestViewportUndo(source = 'command') {
      if (disposed) {
        return;
      }
      emitter.emit('viewportundorequest', { source });
    },
    queryBinsInLasso(request) {
      if (disposed) {
        return null;
      }
      return selectHistogramBinsInPolygon({
        aggregation: state.aggregation,
        ids: state.options.columns?.ids,
        layout: getCurrentLayout(),
        materializeSourceIndices: false,
        points: request.points,
        sampleSize: DEFAULT_SELECTION_SAMPLE_SIZE,
        subplotId: request.subplotId,
        viewport: state.viewport,
      });
    },
    queryBinsInRectangle(request) {
      if (disposed) {
        return null;
      }
      return selectHistogramBinsInBounds({
        aggregation: state.aggregation,
        bounds: request.bounds,
        ids: state.options.columns?.ids,
        layout: getCurrentLayout(),
        materializeSourceIndices: false,
        sampleSize: DEFAULT_SELECTION_SAMPLE_SIZE,
        subplotId: request.subplotId,
        viewport: state.viewport,
      });
    },
    resize() {
      resizeRenderer();
    },
    selectBins(request) {
      if (disposed) {
        return null;
      }
      const startedAt = performance.now();
      const result = createProgrammaticSelectionResult({
        binDescriptors: request.binDescriptors,
        binIndices: request.binIndices,
        sourceIndices: request.sourceIndices,
        subplotId: request.subplotId,
        tool: 'programmatic',
      });
      return commitSelection({
        durationMs: Math.max(0, performance.now() - startedAt),
        kind: request.kind ?? 'replace',
        nextFilters: createProgrammaticHistogramSelectionFilters(result.binDescriptors),
        result,
      });
    },
    selectLasso(request) {
      if (disposed) {
        return null;
      }
      const startedAt = performance.now();
      const result = selectHistogramBinsInPolygon({
        aggregation: state.aggregation,
        currentSourceIndices: state.selectedSourceIndices,
        ids: state.options.columns?.ids,
        kind: request.kind,
        layout: getCurrentLayout(),
        materializeSourceIndices: false,
        points: request.points,
        sampleSize: DEFAULT_SELECTION_SAMPLE_SIZE,
        subplotId: request.subplotId,
        viewport: state.viewport,
      });
      return commitSelection({
        durationMs: Math.max(0, performance.now() - startedAt),
        kind: result.kind,
        nextFilters: createHistogramLassoSelectionFilters(result, request.points),
        result,
      });
    },
    selectRectangle(request) {
      if (disposed) {
        return null;
      }
      const startedAt = performance.now();
      const result = selectHistogramBinsInBounds({
        aggregation: state.aggregation,
        bounds: request.bounds,
        currentSourceIndices: state.selectedSourceIndices,
        ids: state.options.columns?.ids,
        kind: request.kind,
        layout: getCurrentLayout(),
        materializeSourceIndices: false,
        sampleSize: DEFAULT_SELECTION_SAMPLE_SIZE,
        subplotId: request.subplotId,
        viewport: state.viewport,
      });
      return commitSelection({
        durationMs: Math.max(0, performance.now() - startedAt),
        kind: result.kind,
        nextFilters: createHistogramRectangleSelectionFilters(result, request.bounds),
        result,
      });
    },
    setBinSizes(request) {
      if (disposed) {
        return null;
      }
      const nextState = updateStateForBinSizes(state, request.binSizes, {
        materializeMembership: request.materializeMembership ?? true,
      });
      if (nextState === state) {
        return state.aggregation;
      }
      state = nextState;
      commitHover(null, null);
      renderer?.update({
        aggregation: state.aggregation,
        devicePixelRatio: globalThis.devicePixelRatio || 1,
        hoverBin: activeHoverBin,
        layout: getCurrentLayout(),
        selectedBinKeys: getRenderableSelectedBinKeys(state),
        theme: state.options.theme,
        viewport: state.viewport,
      });
      return state.aggregation;
    },
    setActivePlot(plotId, reason = 'command') {
      if (disposed || activePlotId === plotId) {
        return;
      }
      const previousPlotId = activePlotId;
      activePlotId = plotId;
      emitter.emit('activeplotchange', { plotId, previousPlotId, reason });
    },
    setCursorState(cursor, reason = 'command') {
      if (disposed || cursorState === cursor) {
        return;
      }
      const previousCursor = cursorState;
      cursorState = cursor;
      emitter.emit('cursorchange', { cursor, previousCursor, reason });
    },
    setMeasurement(measurement) {
      if (disposed || activeMeasurement === measurement) {
        return;
      }
      const nextMeasurement = enrichHistogramMeasurementEvent(measurement);
      activeMeasurement = nextMeasurement;
      state.options.onMeasurementChange?.(nextMeasurement);
      emitter.emit('measurementchange', nextMeasurement);
    },
    setOverlays(nextOverlays, reason = 'set') {
      if (disposed) {
        return;
      }
      if (reason === 'set') {
        const nextKinds = new Set(nextOverlays.map((overlay) => overlay.kind));
        overlays = [
          ...overlays.filter((overlay) => !nextKinds.has(overlay.kind)),
          ...nextOverlays,
        ];
      } else {
        overlays = [...nextOverlays];
      }
      emitter.emit('overlaychange', { overlays, reason });
    },
    setViewport(
      viewport: HistogramViewport,
      reason: HistogramViewportChangeReason = 'programmatic',
      phase: HistogramViewportChangePhase = 'commit',
    ) {
      if (disposed) {
        return;
      }
      const fallback = createDefaultHistogramViewport(state.aggregation);
      const normalizedViewport = normalizeHistogramViewport(viewport, fallback);
      const aggregationDependsOnViewport =
        shouldUseViewportBoundAggregation(state) &&
        viewportChangeAffectsAggregation(state.viewport, normalizedViewport);
      if (phase === 'commit' && aggregationDependsOnViewport) {
        state = rebuildStateAggregation(state, {
          includeMembership: reason === 'programmatic',
          viewport: normalizedViewport,
        });
      } else {
        state = {
          ...state,
          options:
            phase === 'commit'
              ? {
                  ...state.options,
                  viewport: normalizedViewport,
                }
              : state.options,
          viewport: normalizedViewport,
        };
      }
      if (phase === 'commit') {
        state = {
          ...state,
          options: {
            ...state.options,
            viewport: state.viewport,
          },
        };
      }
      renderer?.update({
        aggregation: state.aggregation,
        selectedBinKeys: getRenderableSelectedBinKeys(state),
        viewport: state.viewport,
      });
      renderer?.render();
      state.options.onViewportChange?.(state.viewport, reason, phase);
      emitter.emit('viewportchange', { phase, reason, viewport: state.viewport });
    },
    zoomAtPointer(request) {
      if (disposed) {
        return null;
      }
      const startedAt = performance.now();
      const result = zoomHistogramViewportAtPointer({
        axisMode: request.axisMode,
        deltaMode: request.deltaMode,
        deltaY: request.deltaY,
        layout: getCurrentLayout(),
        pointerCssX: request.pointerCssX,
        pointerCssY: request.pointerCssY,
        viewport: state.viewport,
      });
      if (result === null) {
        return null;
      }
      commands.setViewport(result.viewport, 'wheel');
      emitMetrics({
        at: performance.now(),
        detail: JSON.stringify({
          axisMode: request.axisMode ?? 'xy',
          browserDeltaY: request.deltaY,
          operation: 'wheel-zoom',
          scale: result.scale,
          subplotId: result.subplotId,
        }),
        durationMs: Math.max(0, performance.now() - startedAt),
        phase: 'interaction',
      });
      return result;
    },
    zoomToRectangle(request) {
      if (disposed) {
        return null;
      }
      const startedAt = request.startedAt ?? performance.now();
      const result = zoomHistogramViewportToRectangle({
        axisMode: request.axisMode,
        axisModeStrategy: request.axisModeStrategy,
        currentPointerCssX: request.currentPointerCssX,
        currentPointerCssY: request.currentPointerCssY,
        plotRect: request.plotRect,
        startPointerCssX: request.startPointerCssX,
        startPointerCssY: request.startPointerCssY,
        viewport: state.viewport,
      });
      if (result === null) {
        return null;
      }
      commands.setViewport(result.viewport, 'rectangle-zoom');
      emitMetrics({
        at: performance.now(),
        detail: JSON.stringify({
          axisMode: resolveHistogramRectangleZoomEffectiveAxisMode(request),
          operation: 'rectangle-zoom',
          rectHeight: result.zoomRect.heightCssPx,
          rectWidth: result.zoomRect.widthCssPx,
          subplotId: result.subplotId,
        }),
        durationMs: Math.max(0, performance.now() - startedAt),
        phase: 'interaction',
      });
      return result;
    },
  };

  const instance: HistogramPlotInstance = {
    canvas,
    commands,
    hostElement,
    overlayElement,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      disposables.dispose();
      emitter.clear();
    },
    on(event, handler) {
      return emitter.on(event, handler);
    },
    update(partialOptions: Partial<HistogramPlotOptions>) {
      if (disposed) {
        return;
      }
      state = reconcileState(state, partialOptions);
      if (partialOptions.hoverSourceIndex !== undefined) {
        activeHover = null;
        activeHoverBin = null;
      }
      renderer?.update({
        aggregation: state.aggregation,
        devicePixelRatio: globalThis.devicePixelRatio || 1,
        hoverBin: activeHoverBin,
        layout: getCurrentLayout(),
        selectedBinKeys: getRenderableSelectedBinKeys(state),
        theme: state.options.theme,
        viewport: state.viewport,
      });
    },
    use(binding: HistogramBinding) {
      if (disposed) {
        return toDisposable(() => {});
      }
      const attached =
        typeof binding === 'function' ? binding(instance) : binding.attach(instance);
      const disposable = normalizeDisposable(attached);
      bindingDisposables.add(disposable);
      return disposable;
    },
  };

  try {
    createRenderer();
  } catch (error) {
    handleSetupError(error, 'Unknown histogram WebGL2 renderer setup error.');
  }

  return instance;

  function commitHover(
    hover: HistogramHoverEvent | null,
    hoverBin: HistogramRendererHoverBin | null,
    reason: 'binding' | 'command' | 'pointer' | 'programmatic' = 'command',
  ): void {
    if (disposed || areHoverEventsEquivalent(activeHover, hover)) {
      return;
    }
    activeHover = hover;
    activeHoverBin = hoverBin;
    renderer?.update({ hoverBin });
    renderer?.render();
    if (hover !== null) {
      commands.setActivePlot(hover.bin.bin.subplotId, reason);
    }
    state.options.onHoverChange?.(hover);
    emitter.emit('hoverchange', hover);
  }

  function enrichHistogramMeasurementEvent(
    measurement: HistogramMeasurementEvent | null,
  ): HistogramMeasurementEvent | null {
    if (measurement === null) {
      return null;
    }
    return {
      current:
        measurement.current === null
          ? null
          : {
              ...measurement.current,
              ...enrichHistogramBinRefSource(measurement.current),
            },
      reference: {
        ...measurement.reference,
        ...enrichHistogramBinRefSource(measurement.reference),
      },
    };
  }

  function enrichHistogramBinRefSource(binRef: HistogramBinRef): HistogramBinRef {
    if (binRef.source !== undefined) {
      return binRef;
    }
    const parameter = state.options.spec.parameters.find(
      (candidate) => candidate.key === binRef.bin.parameterKey,
    );
    const source =
      parameter?.source ??
      (binRef.bin.table === undefined
        ? undefined
        : { tableKey: binRef.bin.table, fieldKey: binRef.bin.parameterKey });
    return source === undefined ? binRef : { ...binRef, source };
  }

  function commitSelection(input: {
    readonly durationMs: number;
    readonly kind: HistogramSelectionKind;
    readonly nextFilters?: readonly HistogramSelectionFilter[];
    readonly result: HistogramSelectionResult;
  }): HistogramSelectionEvent {
    const previousState = state;
    const mergedBinDescriptors =
      input.kind === 'append'
        ? mergeBinDescriptors(
            previousState.lastSelection?.binDescriptors,
            input.result.binDescriptors,
          )
        : input.result.binDescriptors;
    const selectedSourceIndices = resolveSelectedSourceIndicesForSelection(previousState, input);
    const selectionFilters =
      input.kind === 'append'
        ? [...previousState.selectionFilters, ...(input.nextFilters ?? [])]
        : input.nextFilters ?? [];
    state = {
      ...previousState,
      lastSelection: null,
      options: {
        ...previousState.options,
        selectedSourceIndices,
      },
      selectionFilters,
      selectedSourceIndices,
    };
    const event: HistogramSelectionEvent = {
      binDescriptors: mergedBinDescriptors,
      durationMs: input.durationMs,
      filters: selectionFilters,
      kind: input.kind,
      sampleIds: input.result.sampleIds,
      selectedBinCount: mergedBinDescriptors.length,
      selectedSourceCount: resolveSelectionSourceCount(
        previousState,
        input,
        selectedSourceIndices,
      ),
      sourceIndices: selectedSourceIndices,
      sourceIndicesAvailable: input.result.sourceIndicesAvailable,
      sourceIndicesStatus: input.result.sourceIndicesStatus,
      subplotId: resolveSelectionSubplotId(mergedBinDescriptors),
      tool: input.result.tool,
      viewport: state.viewport,
    };
    state = {
      ...state,
      lastSelection: event,
    };
    if (event.sourceIndicesAvailable) {
      state = rebuildStateAggregation(state, {
        includeMembership: !aggregationHasPendingMembership(state.aggregation),
      });
    }
    renderer?.update({
      aggregation: state.aggregation,
      selectedBinKeys: getRenderableSelectedBinKeys(state),
    });
    renderer?.render();
    state.options.onSelectionChange?.(event);
    emitter.emit('selectionchange', event);
    emitMetrics({
      at: performance.now(),
      detail: JSON.stringify({
        candidateBinCount: input.result.candidateBinCount,
        selectedBinCount: event.selectedBinCount,
        selectedSourceCount: event.selectedSourceCount,
        tool: event.tool,
      }),
      durationMs: input.durationMs,
      phase: 'selection',
      selectedBinCount: event.selectedBinCount,
      selectedSourceCount: event.selectedSourceCount,
    });
    return event;
  }

  function createHistogramRectangleSelectionFilters(
    result: HistogramSelectionResult,
    bounds: HistogramPixelBounds,
  ): readonly HistogramSelectionFilter[] {
    const target = resolveHistogramSelectionFilterTarget(result);
    if (target === null) {
      return [];
    }
    const ranges = histogramPixelBoundsToSelectionRanges(target.plotRect, bounds);
    if (ranges === null) {
      return [];
    }
    return [
      {
        binDescriptors: result.binDescriptors,
        dimensions: [
          createHistogramSelectionDimension(
            target.parameterKey,
            ranges.value,
            result.binDescriptors,
          ),
        ],
        parameterKey: target.parameterKey,
        ranges,
        shape: 'rectangle',
        ...withOptionalHistogramSource(
          resolveHistogramSelectionSource(target.parameter, result.binDescriptors),
        ),
        subplotId: target.subplotId,
      },
    ];
  }

  function createHistogramLassoSelectionFilters(
    result: HistogramSelectionResult,
    points: readonly HistogramPoint[],
  ): readonly HistogramSelectionFilter[] {
    const target = resolveHistogramSelectionFilterTarget(result);
    const bounds = histogramPointBounds(points);
    if (target === null || bounds === null) {
      return [];
    }
    const ranges = histogramPixelBoundsToSelectionRanges(target.plotRect, bounds);
    if (ranges === null) {
      return [];
    }
    return [
      {
        binDescriptors: result.binDescriptors,
        dimensions: [
          createHistogramSelectionDimension(
            target.parameterKey,
            ranges.value,
            result.binDescriptors,
          ),
        ],
        parameterKey: target.parameterKey,
        points: points.map((point) => ({ x: point.x, y: point.y })),
        ranges,
        shape: 'lasso',
        ...withOptionalHistogramSource(
          resolveHistogramSelectionSource(target.parameter, result.binDescriptors),
        ),
        subplotId: target.subplotId,
      },
    ];
  }

  function createProgrammaticHistogramSelectionFilters(
    binDescriptors: readonly HistogramBinDescriptor[],
  ): readonly HistogramSelectionFilter[] {
    return binDescriptors.map((descriptor) => {
      const valueRange = normalizeHistogramRange({
        max: descriptor.max,
        min: descriptor.min,
      });
      return {
        binDescriptors: [descriptor],
        dimensions: [
          createHistogramSelectionDimension(descriptor.parameterKey, valueRange, [
            descriptor,
          ]),
        ],
        parameterKey: descriptor.parameterKey,
        ranges: {
          value: valueRange,
          x: valueRange,
        },
        shape: 'programmatic',
        ...withOptionalHistogramSource(
          resolveHistogramSelectionSource(
            getHistogramParameter(descriptor.parameterKey),
            [descriptor],
          ),
        ),
        subplotId: descriptor.subplotId,
      };
    });
  }

  function createHistogramSelectionDimension(
    parameterKey: string,
    range: HistogramRange,
    binDescriptors: readonly HistogramBinDescriptor[],
  ): HistogramSelectionFilter['dimensions'][number] {
    const parameter = getHistogramParameter(parameterKey);
    const values = getHistogramSelectedCategoricalValues(parameter, range, binDescriptors);
    const source = resolveHistogramSelectionSource(parameter, binDescriptors);
    return {
      axis: 'value',
      parameterKey,
      range,
      ...withOptionalHistogramSource(source),
      valueType: parameter?.kind ?? 'unknown',
      ...(values === undefined ? {} : { values }),
    };
  }

  function getHistogramParameter(parameterKey: string): HistogramParameterSpec | undefined {
    return state.options.spec.parameters.find((item) => item.key === parameterKey);
  }

  function resolveHistogramSelectionSource(
    parameter: HistogramParameterSpec | undefined,
    binDescriptors: readonly HistogramBinDescriptor[],
  ): HistogramSelectionSource | undefined {
    if (parameter?.source !== undefined) {
      return parameter.source;
    }
    const tableKey = resolveSingleHistogramTableKey(parameter, binDescriptors);
    return tableKey === undefined ? undefined : { tableKey };
  }

  function resolveSingleHistogramTableKey(
    parameter: HistogramParameterSpec | undefined,
    binDescriptors: readonly HistogramBinDescriptor[],
  ): string | undefined {
    const descriptorTables = new Set(
      binDescriptors
        .map((descriptor) => descriptor.table)
        .filter((table): table is string => table !== undefined),
    );
    if (descriptorTables.size === 1) {
      return [...descriptorTables][0];
    }
    if (descriptorTables.size > 1) {
      return undefined;
    }
    return parameter?.sourceTables?.length === 1 ? parameter.sourceTables[0] : undefined;
  }

  function withOptionalHistogramSource(
    source: HistogramSelectionSource | undefined,
  ): { readonly source?: HistogramSelectionSource } {
    return source === undefined ? {} : { source };
  }

  function getHistogramSelectedCategoricalValues(
    parameter: HistogramParameterSpec | undefined,
    range: HistogramRange,
    binDescriptors: readonly HistogramBinDescriptor[],
  ): HistogramSelectionFilter['dimensions'][number]['values'] | undefined {
    if (
      parameter === undefined ||
      (parameter.kind !== 'categorical' && parameter.kind !== 'boolean')
    ) {
      return undefined;
    }
    const categoriesByEncoded = new Map<number, HistogramSelectionCategoryValue>();
    for (const descriptor of binDescriptors) {
      if (descriptor.category === undefined) {
        continue;
      }
      categoriesByEncoded.set(descriptor.category.encoded, {
        encoded: descriptor.category.encoded,
        label: descriptor.category.label,
        value: descriptor.category.value,
      });
    }
    if (categoriesByEncoded.size === 0) {
      for (const category of parameter.categories ?? []) {
        if (category.encoded >= range.min && category.encoded <= range.max) {
          categoriesByEncoded.set(category.encoded, {
            encoded: category.encoded,
            label: category.label,
            value: category.value,
          });
        }
      }
    }
    return [...categoriesByEncoded.values()].sort(
      (first, second) => first.encoded - second.encoded,
    );
  }

  function resolveHistogramSelectionFilterTarget(
    result: HistogramSelectionResult,
  ): {
    parameter: HistogramParameterSpec | undefined;
    parameterKey: string;
    plotRect: HistogramPlotRect;
    subplotId: string;
  } | null {
    const subplotId = result.subplotId ?? result.binDescriptors[0]?.subplotId;
    if (subplotId === undefined) {
      return null;
    }
    const plotRect = getCurrentLayout().plotRects.find((candidate) => candidate.id === subplotId);
    if (plotRect === undefined) {
      return null;
    }
    const parameterKey =
      result.binDescriptors[0]?.parameterKey ??
      state.aggregation.subplots.find((subplot) => subplot.subplotId === subplotId)
        ?.parameterKey;
    if (parameterKey === undefined) {
      return null;
    }
    return {
      parameter: getHistogramParameter(parameterKey),
      parameterKey,
      plotRect,
      subplotId,
    };
  }

  function histogramPixelBoundsToSelectionRanges(
    plotRect: HistogramPlotRect,
    bounds: HistogramPixelBounds,
  ): HistogramSelectionFilter['ranges'] | null {
    const subplotViewport = state.viewport.subplotById[plotRect.id];
    if (subplotViewport === undefined) {
      return null;
    }
    const x = normalizeHistogramRange({
      max: histogramPixelToAxis(
        bounds.maxX,
        subplotViewport.x,
        plotRect.xCssPx,
        plotRect.xCssPx + plotRect.widthCssPx,
      ),
      min: histogramPixelToAxis(
        bounds.minX,
        subplotViewport.x,
        plotRect.xCssPx,
        plotRect.xCssPx + plotRect.widthCssPx,
      ),
    });
    const y = normalizeHistogramRange({
      max: histogramPixelToAxis(
        bounds.minY,
        subplotViewport.y,
        plotRect.yCssPx + plotRect.heightCssPx,
        plotRect.yCssPx,
      ),
      min: histogramPixelToAxis(
        bounds.maxY,
        subplotViewport.y,
        plotRect.yCssPx + plotRect.heightCssPx,
        plotRect.yCssPx,
      ),
    });
    return {
      value: x,
      x,
      y,
    };
  }

  function histogramPointBounds(points: readonly HistogramPoint[]): HistogramPixelBounds | null {
    if (points.length === 0) {
      return null;
    }
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxY)
    ) {
      return null;
    }
    return { maxX, maxY, minX, minY };
  }

  function normalizeHistogramRange(range: HistogramRange): HistogramRange {
    return {
      max: Math.max(range.min, range.max),
      min: Math.min(range.min, range.max),
    };
  }

  function createProgrammaticSelectionResult(input: {
    readonly binDescriptors?: readonly HistogramBinDescriptor[];
    readonly binIndices?: readonly number[];
    readonly materializeSourceIndices?: boolean;
    readonly sourceIndices?: Uint32Array | readonly number[];
    readonly subplotId?: string;
    readonly tool: 'programmatic';
  }): HistogramSelectionResult {
    const selectedBins = findSelectedBins(input);
    const sourceIndexResult =
      input.sourceIndices === undefined
        ? materializeSourceIndicesForSelectedBins(
            selectedBins,
            input.materializeSourceIndices,
          )
        : {
            available: true,
            sourceIndices: normalizeSourceIndices(input.sourceIndices),
          };
    const sourceIndicesStatus: HistogramSourceIndicesStatus =
      sourceIndexResult.available
        ? input.materializeSourceIndices === false
          ? 'pending'
          : 'available'
        : 'unavailable';
    return {
      binDescriptors: selectedBins.map((match) => match.bin.descriptor),
      candidateBinCount: state.aggregation.metrics.binCount,
      kind: 'replace',
      sampleIds: sourceIndexResult.available
        ? materializeSampleIds(sourceIndexResult.sourceIndices, state.options.columns?.ids)
        : [],
      selectedBinCount: selectedBins.length,
      selectedSourceCount: sourceIndexResult.sourceIndices.length,
      sourceIndices: sourceIndexResult.sourceIndices,
      sourceIndicesAvailable: sourceIndicesStatus === 'available',
      sourceIndicesStatus,
      subplotId: input.subplotId,
      tool: input.tool,
      viewport: state.viewport,
    };
  }

  function materializeSourceIndicesForSelectedBins(
    selectedBins: ReadonlyArray<{
      readonly bin: HistogramBinHit['bin'];
      readonly binIndex: number;
      readonly subplot: HistogramBinHit['subplot'];
    }>,
    materializeSourceIndices = true,
  ): { readonly available: boolean; readonly sourceIndices: Uint32Array } {
    if (!materializeSourceIndices) {
      return {
        available: true,
        sourceIndices: new Uint32Array(0),
      };
    }
    const selected: number[] = [];
    let available = true;
    for (const match of selectedBins) {
      if (match.bin.membership === undefined || !match.bin.membership.sourceIndicesAvailable) {
        available = false;
        continue;
      }
      const sourceIndices = materializeHistogramBinSourceIndices(match.subplot, match.binIndex);
      if (sourceIndices.length < match.bin.membership.count) {
        available = false;
        continue;
      }
      selected.push(...sourceIndices);
    }
    return {
      available,
      sourceIndices: available ? normalizeSourceIndices(selected) : new Uint32Array(0),
    };
  }

  function findSelectedBins(input: {
    readonly binDescriptors?: readonly HistogramBinDescriptor[];
    readonly binIndices?: readonly number[];
    readonly subplotId?: string;
  }): ReadonlyArray<{
    readonly bin: HistogramBinHit['bin'];
    readonly binIndex: number;
    readonly subplot: HistogramBinHit['subplot'];
  }> {
    const descriptorKeys =
      input.binDescriptors === undefined
        ? null
        : new Set(input.binDescriptors.map(createBinDescriptorKey));
    const binIndexSet =
      input.binIndices === undefined ? null : new Set(input.binIndices.map(Math.floor));
    const matches: Array<{
      readonly bin: HistogramBinHit['bin'];
      readonly binIndex: number;
      readonly subplot: HistogramBinHit['subplot'];
    }> = [];
    for (const subplot of state.aggregation.subplots) {
      if (input.subplotId !== undefined && subplot.subplotId !== input.subplotId) {
        continue;
      }
      for (let binIndex = 0; binIndex < subplot.bins.length; binIndex += 1) {
        const bin = subplot.bins[binIndex];
        if (bin === undefined) {
          continue;
        }
        const selectedByIndex = binIndexSet?.has(binIndex) ?? false;
        const selectedByDescriptor =
          descriptorKeys?.has(createBinDescriptorKey(bin.descriptor)) ?? false;
        if (selectedByIndex || selectedByDescriptor) {
          matches.push({ bin, binIndex, subplot });
        }
      }
    }
    return matches;
  }

  function materializeSelectionFromState(): HistogramSelectionEvent | null {
    const previousSelection = state.lastSelection;
    if (previousSelection === null) {
      return null;
    }
    if (previousSelection.sourceIndicesAvailable) {
      return previousSelection;
    }
    materializeCurrentAggregationMembership();
    const result = createProgrammaticSelectionResult({
      binDescriptors: previousSelection.binDescriptors,
      materializeSourceIndices: true,
      subplotId: previousSelection.subplotId,
      tool: 'programmatic',
    });
    return {
      ...previousSelection,
      sampleIds: result.sampleIds,
      selectedSourceCount: result.sourceIndices.length,
      sourceIndices: result.sourceIndices,
      sourceIndicesAvailable: result.sourceIndicesAvailable,
      sourceIndicesStatus: result.sourceIndicesStatus,
      viewport: state.viewport,
    };
  }

  function materializeCurrentAggregationMembership(): HistogramAggregationSet {
    if (state.options.columns === undefined || state.options.spec.mode !== 'histogram') {
      return state.aggregation;
    }
    if (!aggregationHasPendingMembership(state.aggregation)) {
      return state.aggregation;
    }
    state = rebuildStateAggregation(state, { includeMembership: true });
    renderer?.update({
      aggregation: state.aggregation,
      selectedBinKeys: getRenderableSelectedBinKeys(state),
      viewport: state.viewport,
    });
    renderer?.render();
    return state.aggregation;
  }
}

function createInitialState(options: HistogramPlotOptions): HistogramEngineState {
  const selectedSourceIndices = normalizeSourceIndices(options.selectedSourceIndices);
  const binSizes = options.binSizes ?? [];
  const preparedAggregationState = createPreparedAggregationState(options);
  const aggregation =
    options.aggregation ??
    buildAggregationFromOptions({
      ...options,
      binSizes,
      preparedAggregationState,
      selectedSourceIndices,
      viewport: options.viewport,
    });
  const viewport = normalizeHistogramViewport(
    options.viewport,
    createDefaultHistogramViewport(aggregation),
  );
  return {
    aggregation,
    lastSelection: null,
    preparedAggregationState,
    binSizes,
    options: {
      ...options,
      aggregation,
      binSizes,
      selectedSourceIndices,
      viewport,
    },
    selectionFilters: [],
    selectedSourceIndices,
    viewport,
  };
}

function reconcileState(
  previous: HistogramEngineState,
  partialOptions: Partial<HistogramPlotOptions>,
): HistogramEngineState {
  const options = {
    ...previous.options,
    ...partialOptions,
  };
  const binSizes = partialOptions.binSizes ?? previous.binSizes;
  const selectedSourceIndices =
    partialOptions.selectedSourceIndices === undefined
      ? previous.selectedSourceIndices
      : normalizeSourceIndices(partialOptions.selectedSourceIndices);
  const selectedSourceIndicesChanged =
    partialOptions.selectedSourceIndices !== undefined &&
    !areSourceIndexArraysEqual(previous.selectedSourceIndices, selectedSourceIndices);
  const preparedAggregationState =
    partialOptions.columns !== undefined || partialOptions.spec !== undefined
      ? createPreparedAggregationState(options)
      : previous.preparedAggregationState;
  const provisionalViewport =
    partialOptions.viewport === undefined
      ? previous.viewport
      : normalizeHistogramViewport(partialOptions.viewport, previous.viewport);
  const ignoreAggregationOverride =
    partialOptions.aggregation !== undefined &&
    shouldUseViewportBoundAggregationForOptions(options) &&
    partialOptions.columns !== undefined &&
    partialOptions.spec !== undefined;
  const aggregationOverride = ignoreAggregationOverride
    ? undefined
    : partialOptions.aggregation;
  let nextState: HistogramEngineState = {
    aggregation: aggregationOverride ?? previous.aggregation,
    binSizes,
    lastSelection: selectedSourceIndicesChanged ? null : previous.lastSelection,
    options,
    preparedAggregationState,
    selectionFilters: selectedSourceIndicesChanged ? [] : previous.selectionFilters,
    selectedSourceIndices,
    viewport: provisionalViewport,
  };
  const needsAggregationRebuild =
    aggregationOverride === undefined &&
    (partialOptions.columns !== undefined ||
      partialOptions.spec !== undefined ||
      partialOptions.selectedSourceIndices !== undefined ||
      partialOptions.hoverSourceIndex !== undefined ||
      (partialOptions.viewport !== undefined &&
        viewportChangeAffectsAggregation(previous.viewport, provisionalViewport)) ||
      findChangedBinSizeSubplotIds(previous.binSizes, binSizes).size > 0);
  if (needsAggregationRebuild) {
    nextState = rebuildStateAggregation(nextState, {
      includeMembership: true,
      viewport: provisionalViewport,
    });
  }
  const fallbackViewport = createDefaultHistogramViewport(nextState.aggregation);
  const viewport = normalizeHistogramViewport(
    partialOptions.viewport ??
      deriveViewportAfterUpdate({
        fallbackViewport,
        nextBinSizes: binSizes,
        partialOptions,
        previous,
      }),
    fallbackViewport,
  );
  nextState = {
    ...nextState,
    options: {
      ...options,
      aggregation: nextState.aggregation,
      binSizes,
      selectedSourceIndices,
      viewport,
    },
    viewport,
  };
  if (
    aggregationOverride === undefined &&
    shouldUseViewportBoundAggregation(nextState) &&
    !areHistogramViewportsExactlyEqual(provisionalViewport, viewport) &&
    viewportChangeAffectsAggregation(provisionalViewport, viewport)
  ) {
    nextState = rebuildStateAggregation(nextState, {
      includeMembership: true,
      viewport,
    });
  }
  return {
    ...nextState,
    options: {
      ...nextState.options,
      aggregation: nextState.aggregation,
      binSizes: nextState.binSizes,
      selectedSourceIndices: nextState.selectedSourceIndices,
      viewport: nextState.viewport,
    },
  };
}

function deriveViewportAfterUpdate(input: {
  readonly fallbackViewport: HistogramViewport;
  readonly nextBinSizes: readonly HistogramBinSizeState[];
  readonly partialOptions: Partial<HistogramPlotOptions>;
  readonly previous: HistogramEngineState;
}): HistogramViewport {
  if (input.partialOptions.binSizes === undefined) {
    return input.previous.viewport;
  }
  return resetViewportYForChangedBinSizes(
    input.previous.viewport,
    input.fallbackViewport,
    input.previous.binSizes,
    input.nextBinSizes,
  );
}

function resetViewportYForChangedBinSizes(
  previousViewport: HistogramViewport,
  fallbackViewport: HistogramViewport,
  previousBinSizes: readonly HistogramBinSizeState[],
  nextBinSizes: readonly HistogramBinSizeState[],
): HistogramViewport {
  const changedSubplotIds = findChangedBinSizeSubplotIds(previousBinSizes, nextBinSizes);
  if (changedSubplotIds.size === 0) {
    return previousViewport;
  }
  return {
    subplotById: Object.fromEntries(
      Object.entries(fallbackViewport.subplotById).map(([subplotId, fallbackSubplot]) => {
        const previousSubplot = previousViewport.subplotById[subplotId];
        if (previousSubplot === undefined) {
          return [subplotId, fallbackSubplot];
        }
        if (!changedSubplotIds.has(subplotId)) {
          return [subplotId, previousSubplot];
        }
        return [
          subplotId,
          {
            x: previousSubplot.x,
            y: fallbackSubplot.y,
          },
        ];
      }),
    ),
  };
}

function findChangedBinSizeSubplotIds(
  previousBinSizes: readonly HistogramBinSizeState[],
  nextBinSizes: readonly HistogramBinSizeState[],
): ReadonlySet<string> {
  const previousLookup = new Map(
    previousBinSizes.map((binSize) => [createBinSizeStateKey(binSize), binSize.binSize]),
  );
  const nextLookup = new Map(
    nextBinSizes.map((binSize) => [createBinSizeStateKey(binSize), binSize.binSize]),
  );
  const subplotIds = new Set<string>();
  for (const [key, previousValue] of previousLookup) {
    const nextValue = nextLookup.get(key);
    if (nextValue === undefined || nextValue !== previousValue) {
      subplotIds.add(readSubplotIdFromBinSizeKey(key));
    }
  }
  for (const [key, nextValue] of nextLookup) {
    const previousValue = previousLookup.get(key);
    if (previousValue === undefined || previousValue !== nextValue) {
      subplotIds.add(readSubplotIdFromBinSizeKey(key));
    }
  }
  return subplotIds;
}

function createBinSizeStateKey(binSize: HistogramBinSizeState): string {
  return `${binSize.subplotId}\u0000${binSize.parameterKey}\u0000${binSize.mode}`;
}

function readSubplotIdFromBinSizeKey(key: string): string {
  return key.split('\u0000', 1)[0] ?? '';
}

function buildAggregationFromOptions(
  options: HistogramPlotOptions & {
    readonly binSizes: readonly HistogramBinSizeState[];
    readonly preparedAggregationState?: HistogramAggregationPreparedState;
    readonly selectedSourceIndices: Uint32Array;
    readonly viewport?: HistogramViewport;
  },
): HistogramAggregationSet {
  if (options.columns === undefined) {
    throw new Error('Histogram plot requires either aggregation or columns.');
  }
  const startedAt = performance.now();
  return withAggregateBuildMs(
    buildHistogramAggregation(options.columns, {
      binSizes: options.binSizes,
      hoverSourceIndex: options.hoverSourceIndex,
      preparedState: options.preparedAggregationState,
      plotSpec: options.spec,
      selectedSourceIndices: options.selectedSourceIndices,
      viewport: shouldUseViewportBoundAggregationForOptions(options)
        ? options.viewport
        : undefined,
    }),
    performance.now() - startedAt,
  );
}

function createPreparedAggregationState(
  options: Pick<HistogramPlotOptions, 'columns' | 'spec'>,
): HistogramAggregationPreparedState | undefined {
  if (!shouldUseViewportBoundAggregationForOptions(options) || options.columns === undefined) {
    return undefined;
  }
  return prepareHistogramAggregationState(options.columns, options.spec);
}

function buildAggregationForState(
  state: HistogramEngineState,
  options: {
    readonly includeMembership: boolean;
    readonly viewport?: HistogramViewport;
  },
): HistogramAggregationSet {
  if (state.options.columns === undefined) {
    return state.options.aggregation ?? state.aggregation;
  }
  const startedAt = performance.now();
  return withAggregateBuildMs(
    buildHistogramAggregation(state.options.columns, {
      binSizes: state.binSizes,
      hoverSourceIndex: state.options.hoverSourceIndex,
      includeMembership: options.includeMembership,
      plotSpec: state.options.spec,
      preparedState: state.preparedAggregationState,
      selectedSourceIndices: state.selectedSourceIndices,
      viewport: shouldUseViewportBoundAggregation(state)
        ? options.viewport ?? state.viewport
        : undefined,
    }),
    performance.now() - startedAt,
  );
}

function rebuildStateAggregation(
  state: HistogramEngineState,
  options: {
    readonly includeMembership: boolean;
    readonly viewport?: HistogramViewport;
  },
): HistogramEngineState {
  const viewport = options.viewport ?? state.viewport;
  const aggregation = buildAggregationForState(
    {
      ...state,
      viewport,
    },
    {
      includeMembership: options.includeMembership,
      viewport,
    },
  );
  return {
    ...state,
    aggregation,
    options: {
      ...state.options,
      aggregation,
      viewport,
    },
    viewport,
  };
}

function updateStateForBinSizes(
  state: HistogramEngineState,
  binSizes: readonly HistogramBinSizeState[],
  options: {
    readonly materializeMembership: boolean;
  },
): HistogramEngineState {
  if (findChangedBinSizeSubplotIds(state.binSizes, binSizes).size === 0) {
    return state;
  }
  const provisionalState: HistogramEngineState = {
    ...state,
    binSizes,
    options: {
      ...state.options,
      binSizes,
    },
  };
  const aggregatedState = rebuildStateAggregation(provisionalState, {
    includeMembership: options.materializeMembership,
    viewport: provisionalState.viewport,
  });
  const fallbackViewport = createDefaultHistogramViewport(aggregatedState.aggregation);
  const viewport = resetViewportYForChangedBinSizes(
    state.viewport,
    fallbackViewport,
    state.binSizes,
    binSizes,
  );
  const normalizedViewport = normalizeHistogramViewport(viewport, fallbackViewport);
  return rebuildStateAggregation(
    {
      ...aggregatedState,
      options: {
        ...aggregatedState.options,
        aggregation: aggregatedState.aggregation,
        binSizes,
        viewport: normalizedViewport,
      },
      viewport: normalizedViewport,
    },
    {
      includeMembership: options.materializeMembership,
      viewport: normalizedViewport,
    },
  );
}

function shouldUseViewportBoundAggregation(
  state: HistogramEngineState,
): boolean {
  return shouldUseViewportBoundAggregationForOptions(state.options);
}

function shouldUseViewportBoundAggregationForOptions(
  options: Pick<HistogramPlotOptions, 'columns' | 'spec'>,
): boolean {
  return options.columns !== undefined && options.spec.mode === 'histogram';
}

function withAggregateBuildMs(
  aggregation: HistogramAggregationSet,
  aggregateBuildMs: number,
): HistogramAggregationSet {
  return {
    ...aggregation,
    metrics: {
      ...aggregation.metrics,
      aggregateBuildMs,
    },
  };
}

function normalizeSourceIndices(
  sourceIndices?: Uint32Array | readonly number[],
): Uint32Array {
  if (sourceIndices === undefined || sourceIndices.length === 0) {
    return new Uint32Array(0);
  }
  const values = new Set<number>();
  for (const rawValue of sourceIndices) {
    const value = Math.floor(rawValue);
    if (Number.isSafeInteger(value) && value >= 0) {
      values.add(value);
    }
  }
  return new Uint32Array([...values].sort((first, second) => first - second));
}

function areSourceIndexArraysEqual(
  first: Uint32Array,
  second: Uint32Array,
): boolean {
  if (first === second) {
    return true;
  }
  if (first.length !== second.length) {
    return false;
  }
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) {
      return false;
    }
  }
  return true;
}

function mergeSourceIndices(
  first: Uint32Array,
  second: Uint32Array,
): Uint32Array {
  if (first.length === 0) {
    return normalizeSourceIndices(second);
  }
  if (second.length === 0) {
    return normalizeSourceIndices(first);
  }
  return normalizeSourceIndices([...first, ...second]);
}

function resolveSelectedSourceIndicesForSelection(
  state: HistogramEngineState,
  input: {
    readonly kind: HistogramSelectionKind;
    readonly result: HistogramSelectionResult;
  },
): Uint32Array {
  if (!input.result.sourceIndicesAvailable) {
    return input.kind === 'append' ? state.selectedSourceIndices : new Uint32Array(0);
  }
  return input.kind === 'append'
    ? mergeSourceIndices(state.selectedSourceIndices, input.result.sourceIndices)
    : normalizeSourceIndices(input.result.sourceIndices);
}

function resolveSelectionSourceCount(
  state: HistogramEngineState,
  input: {
    readonly kind: HistogramSelectionKind;
    readonly result: HistogramSelectionResult;
  },
  selectedSourceIndices: Uint32Array,
): number {
  if (input.result.sourceIndicesAvailable) {
    return selectedSourceIndices.length;
  }
  if (input.kind !== 'append') {
    return input.result.selectedSourceCount;
  }
  return (state.lastSelection?.selectedSourceCount ?? state.selectedSourceIndices.length) +
    input.result.selectedSourceCount;
}

function getRenderableSelectedBinKeys(
  state: HistogramEngineState,
): readonly string[] {
  return state.lastSelection?.binDescriptors.map(createBinDescriptorKey) ?? [];
}

function aggregationHasPendingMembership(
  aggregation: HistogramAggregationSet,
): boolean {
  return aggregation.subplots.some(
    (subplot) => subplot.sourceIndicesState === 'pending',
  );
}

function viewportChangeAffectsAggregation(
  first: HistogramViewport,
  second: HistogramViewport,
): boolean {
  const firstEntries = Object.entries(first.subplotById);
  if (firstEntries.length !== Object.keys(second.subplotById).length) {
    return true;
  }
  return firstEntries.some(([subplotId, firstSubplot]) => {
    const secondSubplot = second.subplotById[subplotId];
    return (
      secondSubplot === undefined ||
      firstSubplot.x.min !== secondSubplot.x.min ||
      firstSubplot.x.max !== secondSubplot.x.max
    );
  });
}

function areHistogramViewportsExactlyEqual(
  first: HistogramViewport,
  second: HistogramViewport,
): boolean {
  const firstEntries = Object.entries(first.subplotById);
  if (firstEntries.length !== Object.keys(second.subplotById).length) {
    return false;
  }
  return firstEntries.every(([subplotId, firstSubplot]) => {
    const secondSubplot = second.subplotById[subplotId];
    return (
      secondSubplot !== undefined &&
      firstSubplot.x.min === secondSubplot.x.min &&
      firstSubplot.x.max === secondSubplot.x.max &&
      firstSubplot.y.min === secondSubplot.y.min &&
      firstSubplot.y.max === secondSubplot.y.max
    );
  });
}

function materializeSampleIds(
  sourceIndices: Uint32Array,
  ids: readonly string[] | undefined,
): readonly string[] {
  if (ids === undefined || sourceIndices.length === 0) {
    return [];
  }
  const sampleIds: string[] = [];
  for (
    let index = 0;
    index < sourceIndices.length && sampleIds.length < DEFAULT_SELECTION_SAMPLE_SIZE;
    index += 1
  ) {
    const id = ids[sourceIndices[index] ?? -1];
    if (id !== undefined) {
      sampleIds.push(id);
    }
  }
  return sampleIds;
}

function mergeBinDescriptors(
  previous: readonly HistogramBinDescriptor[] | undefined,
  next: readonly HistogramBinDescriptor[],
): readonly HistogramBinDescriptor[] {
  if (previous === undefined || previous.length === 0) {
    return next;
  }
  if (next.length === 0) {
    return previous;
  }
  const merged = new Map<string, HistogramBinDescriptor>();
  for (const descriptor of previous) {
    merged.set(createBinDescriptorKey(descriptor), descriptor);
  }
  for (const descriptor of next) {
    merged.set(createBinDescriptorKey(descriptor), descriptor);
  }
  return [...merged.values()];
}

function resolveSelectionSubplotId(
  binDescriptors: readonly HistogramBinDescriptor[],
): string | undefined {
  const first = binDescriptors[0]?.subplotId;
  if (first === undefined) {
    return undefined;
  }
  return binDescriptors.every((descriptor) => descriptor.subplotId === first)
    ? first
    : undefined;
}

function createBinDescriptorKey(descriptor: HistogramBinDescriptor): string {
  return [
    descriptor.subplotId,
    descriptor.parameterKey,
    descriptor.index,
    descriptor.min,
    descriptor.max,
    descriptor.table ?? '',
    descriptor.source ?? '',
  ].join('\u0000');
}

function areHoverEventsEquivalent(
  previous: HistogramHoverEvent | null,
  next: HistogramHoverEvent | null,
): boolean {
  if (previous === next) {
    return true;
  }
  if (previous === null || next === null) {
    return false;
  }
  return (
    createBinDescriptorKey(previous.bin.bin) === createBinDescriptorKey(next.bin.bin) &&
    previous.source === next.source &&
    previous.pinned === next.pinned
  );
}

function normalizeDisposable(
  disposable: Disposable | (() => void) | void,
): Disposable {
  if (typeof disposable === 'function') {
    return toDisposable(disposable);
  }
  return disposable ?? toDisposable(() => {});
}

function splitClassNames(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}
