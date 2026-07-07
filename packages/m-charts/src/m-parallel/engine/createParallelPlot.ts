import {
  DisposableStack,
  createEmitter,
  createResizeLifecycle,
  createWebGlContextLifecycle,
  normalizeBrushNumericRange,
  snapshotBrushModifiers,
  toDisposable,
  type Disposable,
  type InputModifiers,
} from '../../plot-engine/core/index.js';
import {
  normalizeParallelBrushIntervals,
  ParallelWebgl2HoverOverlayRenderer,
  ParallelWebgl2SegmentRenderer,
  selectParallelRecordIdsByBrushes,
} from '../core/index.js';
import type {
  ParallelActiveBrushInterval,
  ParallelBrushIntervals,
  ParallelFastAxisMetadata,
  ParallelParameter,
  ParallelWebgl2HoverDrawMetrics,
  ParallelWebgl2HoverUpdateMetrics,
  ParallelWebgl2RendererDrawMetrics,
} from '../core/index.js';
import type { ParallelFastTheme } from '../core/webglSegmentRenderer.js';
import type {
  ParallelFastBrushCommandOptions,
  ParallelFastInspectionCommandOptions,
  ParallelFastLineOpacityAdjustCommandOptions,
  ParallelFastPlotCommands,
} from './parallelCommands.js';
import type {
  ParallelFastEngineEvents,
  ParallelFastBrushEvent,
  ParallelFastLineOpacityAdjustment,
  ParallelFastRendererMetricsEvent,
  ParallelFastSelectionFilter,
} from './parallelEvents.js';
import type {
  ParallelFastOverlayDescriptor,
  ParallelFastOverlayKind,
} from './parallelOverlays.js';
import {
  resolveLineOpacityScale,
  type ParallelFastRenderSnapshot,
  type ParallelFastRenderState,
  type ParallelFastStateSnapshot,
} from './parallelState.js';
import type {
  ParallelFastBinding,
  ParallelFastHoverRendererLike,
  ParallelFastHoverVisualState,
  ParallelFastInspectionState,
  ParallelFastPlotInstance,
  ParallelFastPlotOptions,
  ParallelFastRendererLike,
} from './types.js';

const DEFAULT_BASE_CANVAS_CLASS =
  'parallel-fast-webgl-canvas parallel-fast-webgl-canvas-base';
const DEFAULT_BASE_CANVAS_LABEL = 'WebGL2 parallel coordinate segment canvas';
const DEFAULT_HOST_CLASS = 'parallel-fast-engine-host';
const DEFAULT_HOVER_CANVAS_CLASS =
  'parallel-fast-webgl-canvas parallel-fast-webgl-hover-canvas';
const DEFAULT_SELECTED_VISUAL_UPDATE_DELAY_MS = 100;
const WEBGL_UNAVAILABLE_MESSAGE =
  'WebGL2 is unavailable in this browser. Use a browser or device with WebGL2 enabled.';

export function createParallelFastPlot(
  hostElement: HTMLElement,
  options: ParallelFastPlotOptions,
): ParallelFastPlotInstance {
  const emitter = createEmitter<ParallelFastEngineEvents>();
  const disposables = new DisposableStack();
  const bindingDisposables = new DisposableStack();
  const document = hostElement.ownerDocument ?? globalThis.document;
  if (!document) {
    throw new Error('Parallel fast plot requires a DOM document.');
  }

  let disposed = false;
  let optionsState = normalizeOptions(options);
  let renderer: ParallelFastRendererLike | null = null;
  let hoverRenderer: ParallelFastHoverRendererLike | null = null;
  let renderState: ParallelFastRenderState = 'idle';
  let renderStateMessage: string | undefined;
  let firstReadyReported = false;
  let setupStartedAt = 0;
  let animationFrame = 0;
  let selectedVisualAnimationFrame = 0;
  let selectedVisualTimeout: ReturnType<typeof globalThis.setTimeout> | null = null;
  let hoverState: ParallelFastHoverVisualState = {
    dimBackground: false,
    sourceIndex: null,
  };
  let brushIntervals: ParallelBrushIntervals = cloneBrushIntervals(
    optionsState.brushIntervals,
  );
  let activeBrushes = getActiveBrushes(brushIntervals, optionsState.buffers);
  let inspection: ParallelFastInspectionState | null = optionsState.inspection;
  let overlays: readonly ParallelFastOverlayDescriptor[] = [];
  let hasAppliedPreselectedVisual = false;
  let hasAppliedSelectedVisual = false;

  if (activeBrushes.length > 0) {
    const initialSelection = computeSelectionForBrushIntervals(brushIntervals);
    activeBrushes = initialSelection.activeBrushes;
    optionsState = {
      ...optionsState,
      selectedSourceIndices: initialSelection.sourceIndices,
    };
  }

  const previousHostClassName = hostElement.className;
  const previousHostInlinePosition = hostElement.style.position;
  if (optionsState.hostClassName) {
    hostElement.classList.add(...splitClassNames(optionsState.hostClassName));
  }
  ensurePositionedHost(hostElement);

  const canvas = document.createElement('canvas');
  canvas.className = optionsState.baseCanvasClassName;
  canvas.setAttribute('aria-label', optionsState.baseCanvasLabel);
  canvas.dataset.renderer = 'webgl2-segments';
  Object.assign(canvas.style, {
    display: 'block',
    height: '100%',
    inset: '0',
    position: 'absolute',
    width: '100%',
  });

  const hoverCanvas = document.createElement('canvas');
  hoverCanvas.className = optionsState.hoverCanvasClassName;
  hoverCanvas.setAttribute('aria-hidden', 'true');
  Object.assign(hoverCanvas.style, {
    display: 'block',
    height: '100%',
    inset: '0',
    pointerEvents: 'none',
    position: 'absolute',
    width: '100%',
  });

  hostElement.append(canvas, hoverCanvas);
  disposables.defer(() => {
    bindingDisposables.dispose();
    cancelScheduledRender();
    cancelScheduledSelectedVisualUpdate();
    destroyRenderers();
    canvas.remove();
    hoverCanvas.remove();
    hostElement.className = previousHostClassName;
    hostElement.style.position = previousHostInlinePosition;
  });

  function emitRenderState(state: ParallelFastRenderState, message?: string): void {
    if (disposed) {
      return;
    }
    if (renderState === state && renderStateMessage === message) {
      return;
    }
    renderState = state;
    renderStateMessage = message;
    const event = message === undefined ? { state } : { message, state };
    emitter.emit('renderstate', event);
    emitter.emit('renderstatechange', event);
  }

  function emitMetrics(metrics: ParallelFastRendererMetricsEvent): void {
    if (disposed) {
      return;
    }
    optionsState.onMetrics?.(metrics);
    emitter.emit('metrics', metrics);
  }

  function emitOverlayChange(reason: 'clear' | 'replace' | 'set' = 'set'): void {
    emitter.emit('overlaychange', {
      activeBrushes,
      brushIntervals,
      inspection,
      kinds: overlays.map((overlay) => overlay.kind),
      overlays,
      reason,
    });
  }

  function replaceOverlayKinds(
    kinds: readonly ParallelFastOverlayKind[],
    nextOverlays: readonly ParallelFastOverlayDescriptor[],
    reason: 'clear' | 'replace' | 'set' = 'set',
  ): void {
    if (disposed) {
      return;
    }
    const kindSet = new Set(kinds);
    overlays = [
      ...overlays.filter((overlay) => !kindSet.has(overlay.kind)),
      ...nextOverlays,
    ];
    emitOverlayChange(reason);
  }

  function syncBrushOverlay(reason: 'clear' | 'replace' | 'set' = 'set'): void {
    if (activeBrushes.length === 0) {
      replaceOverlayKinds(['axis-brush'], [], 'clear');
      return;
    }
    replaceOverlayKinds(
      ['axis-brush'],
      [
        {
          activeBrushes,
          brushIntervals,
          id: 'axis-brush',
          kind: 'axis-brush',
        },
      ],
      reason,
    );
  }

  function syncInspectionOverlay(reason: 'clear' | 'replace' | 'set' = 'set'): void {
    if (inspection === null) {
      replaceOverlayKinds(['inspection'], [], 'clear');
      return;
    }
    replaceOverlayKinds(
      ['inspection'],
      [
        {
          id: 'inspection',
          inspection,
          kind: 'inspection',
        },
      ],
      reason,
    );
  }

  function setBrushState(
    nextBrushIntervals: ParallelBrushIntervals,
    phase: 'preview' | 'commit',
    options: ParallelFastBrushCommandOptions | undefined,
  ): void {
    brushIntervals = cloneBrushIntervals(nextBrushIntervals);
    activeBrushes = getActiveBrushes(brushIntervals, optionsState.buffers);
    const reason = options?.reason ?? 'set';
    const source = options?.source ?? 'command';
    const event = createParallelBrushEvent({
      activeBrushes,
      brushIntervals,
      reason,
      modifiers: options?.modifiers,
      phase,
      source,
    });
    if (phase === 'preview') {
      emitter.emit('brushpreview', event);
    } else {
      emitter.emit('brushcommit', event as ParallelFastBrushEvent & { phase: 'commit' });
      emitter.emit('brushchange', event);
    }
    if (phase === 'commit') {
      computeAndCommitSelection(brushIntervals, reason, source, {
        scheduleVisualUpdate: true,
      });
    }
    syncBrushOverlay();
  }

  function computeSelectionForBrushIntervals(
    nextBrushIntervals: ParallelBrushIntervals,
  ) {
    const startedAt = performance.now();
    const activeSelectionBrushes = getActiveBrushes(
      nextBrushIntervals,
      optionsState.buffers,
    );
    const selectionResult =
      activeSelectionBrushes.length === 0
        ? {
            activeBrushes: activeSelectionBrushes,
            selectedCount: 0,
            sourceIndexCreationMs: 0,
            sourceIndices: new Uint32Array(0),
          }
        : selectParallelRecordIdsByBrushes(
            optionsState.buffers,
            nextBrushIntervals,
          );
    return {
      ...selectionResult,
      computeMs: performance.now() - startedAt,
    };
  }

  function computeAndCommitSelection(
    nextBrushIntervals: ParallelBrushIntervals,
    reason: NonNullable<ParallelFastBrushCommandOptions['reason']>,
    source: NonNullable<ParallelFastBrushCommandOptions['source']>,
    options: { scheduleVisualUpdate: boolean },
  ): void {
    const selectionResult = computeSelectionForBrushIntervals(nextBrushIntervals);
    optionsState = {
      ...optionsState,
      selectedSourceIndices: selectionResult.sourceIndices,
    };
    emitter.emit('selectionchange', {
      activeBrushes: selectionResult.activeBrushes,
      brushIntervals,
      computeMs: selectionResult.computeMs,
      filters: createParallelSelectionFilters(
        selectionResult.activeBrushes,
        optionsState.buffers,
      ),
      reason,
      selectedCount: selectionResult.selectedCount,
      source,
      sourceIndexCreationMs: selectionResult.sourceIndexCreationMs ?? null,
      sourceIndices: selectionResult.sourceIndices,
    });
    if (options.scheduleVisualUpdate) {
      scheduleSelectedVisualUpdate();
    }
  }

  function emitProgrammaticSelectionChange(
    sourceIndices: Uint32Array,
    source: NonNullable<ParallelFastBrushCommandOptions['source']>,
  ): void {
    emitter.emit('selectionchange', {
      activeBrushes,
      brushIntervals,
      computeMs: 0,
      filters: createParallelSelectionFilters(activeBrushes, optionsState.buffers),
      reason: 'set',
      selectedCount: sourceIndices.length,
      source,
      sourceIndexCreationMs: null,
      sourceIndices,
    });
  }

  function setInspectionState(
    nextInspection: ParallelFastInspectionState | null,
    options: ParallelFastInspectionCommandOptions | undefined,
  ): void {
    inspection = nextInspection;
    syncHoverVisualToInspection(nextInspection);
    emitter.emit('inspectionchange', {
      inspection,
      lookupSource: options?.lookupSource ?? 'none',
      resolveMs: options?.resolveMs ?? null,
      source: options?.source ?? 'command',
    });
    syncInspectionOverlay(nextInspection === null ? 'clear' : 'set');
  }

  function syncHoverVisualToInspection(
    nextInspection: ParallelFastInspectionState | null,
  ): void {
    applyHoverVisualState({
      dimBackground: false,
      sourceIndex: nextInspection?.recordIndex ?? null,
    });
  }

  function emitLineOpacityAdjustmentRequest(
    adjustment: ParallelFastLineOpacityAdjustment,
    options: ParallelFastLineOpacityAdjustCommandOptions | undefined,
  ): void {
    emitter.emit('lineopacityadjustrequest', {
      adjustment,
      currentScale: optionsState.lineOpacityScale,
      source: options?.source ?? 'command',
    });
  }

  function createRenderers(): void {
    if (disposed || renderer !== null) {
      return;
    }
    emitRenderState('rendering');
    firstReadyReported = false;
    hasAppliedPreselectedVisual = false;
    hasAppliedSelectedVisual = false;
    hoverState = { dimBackground: false, sourceIndex: null };

    if (optionsState.forceWebglUnavailable) {
      throw new Error(WEBGL_UNAVAILABLE_MESSAGE);
    }

    setupStartedAt = performance.now();
    const rendererFactory =
      optionsState.rendererFactory ??
      ((rendererCanvas, buffers, rendererOptions) =>
        new ParallelWebgl2SegmentRenderer(
          rendererCanvas,
          buffers,
          rendererOptions,
        ));
    const hoverRendererFactory =
      optionsState.hoverRendererFactory ??
      ((rendererCanvas, buffers, rendererOptions) =>
        new ParallelWebgl2HoverOverlayRenderer(
          rendererCanvas,
          buffers,
          rendererOptions,
        ));
    renderer = rendererFactory(canvas, optionsState.buffers, {
      lineOpacityScale: optionsState.lineOpacityScale,
      preserveDrawingBuffer: optionsState.preserveDrawingBuffer,
      theme: optionsState.theme,
    });
    hoverRenderer = hoverRendererFactory(hoverCanvas, optionsState.buffers, {
      preserveDrawingBuffer: optionsState.preserveDrawingBuffer,
      theme: optionsState.theme,
    });

    const rendererSetupMs = performance.now() - setupStartedAt;
    emitMetrics({
      densityBlendMode: renderer.setupMetrics.blendMode,
      densityMode: renderer.setupMetrics.densityMode,
      drawCallCount: 0,
      firstReadySignalMs: null,
      hoverVisualMode: 'webgl2-hover-overlay-canvas',
      hoverVisualUploadBytes: 0,
      lineAlpha: renderer.setupMetrics.lineAlpha,
      lineOpacityScale: renderer.setupMetrics.lineOpacityScale,
      lineSetSamplesMs: null,
      rendererKind: 'webgl2-segments',
      rendererRedrawMs: null,
      rendererSetupMs,
      rendererState: 'rendering',
      rendererUploadMs: renderer.setupMetrics.uploadMs,
      selectedLineAlpha: renderer.setupMetrics.selectedLineAlpha,
      selectedLineSampleCount: 0,
      selectionVisualUpdateMs: null,
      sharedArrayBuffersUsed: false,
      webglSegmentCount: renderer.setupMetrics.segmentCount,
      webglVertexCount: renderer.setupMetrics.vertexCount,
    });
    applyPreselectedVisual();
    applySelectedVisual();
    scheduleRender();
  }

  function destroyRenderers(): void {
    renderer?.dispose();
    hoverRenderer?.dispose();
    renderer = null;
    hoverRenderer = null;
  }

  function recreateRenderers(): void {
    cancelScheduledRender();
    destroyRenderers();
    try {
      createRenderers();
    } catch (error) {
      handleSetupError(error, 'Unknown parallel-fast WebGL2 renderer setup error.');
    }
  }

  function drawNow(): {
    base: ParallelWebgl2RendererDrawMetrics | null;
    hover: ParallelWebgl2HoverDrawMetrics | null;
  } {
    if (disposed || renderer === null) {
      return { base: null, hover: null };
    }
    syncCanvasSize();
    const base = renderer.draw();
    const hover = hoverRenderer?.draw() ?? null;
    if (base !== null) {
      emitMetrics({
        drawCallCount: base.drawCallCount,
        hoverVisualRedrawMs: hover?.redrawMs ?? null,
        rendererKind: 'webgl2-segments',
        rendererRedrawMs: base.redrawMs,
        rendererState: firstReadyReported ? 'ready' : 'rendering',
      });
      if (!firstReadyReported) {
        firstReadyReported = true;
        emitMetrics({
          firstReadySignalMs: performance.now() - setupStartedAt,
          rendererKind: 'webgl2-segments',
          rendererState: 'ready',
        });
        emitRenderState('ready');
      }
    }
    return { base, hover };
  }

  function scheduleRender(): void {
    if (disposed || animationFrame !== 0) {
      return;
    }
    const raf = globalThis.requestAnimationFrame ?? ((callback: FrameRequestCallback) => {
      return globalThis.setTimeout(() => callback(performance.now()), 0);
    });
    animationFrame = raf(() => {
      animationFrame = 0;
      drawNow();
    });
  }

  function cancelScheduledRender(): void {
    if (animationFrame === 0) {
      return;
    }
    const cancel = globalThis.cancelAnimationFrame ?? globalThis.clearTimeout;
    cancel(animationFrame);
    animationFrame = 0;
  }

  function scheduleSelectedVisualUpdate(): void {
    cancelScheduledSelectedVisualUpdate();
    if (disposed) {
      return;
    }
    if (optionsState.selectedVisualUpdateDelayMs <= 0) {
      applySelectedVisual();
      return;
    }
    const requestFrame =
      globalThis.requestAnimationFrame ??
      ((callback: FrameRequestCallback) =>
        globalThis.setTimeout(() => callback(performance.now()), 0));
    selectedVisualAnimationFrame = requestFrame(() => {
      selectedVisualAnimationFrame = 0;
      selectedVisualTimeout = globalThis.setTimeout(() => {
        selectedVisualTimeout = null;
        applySelectedVisual();
      }, optionsState.selectedVisualUpdateDelayMs);
    });
  }

  function cancelScheduledSelectedVisualUpdate(): void {
    if (selectedVisualAnimationFrame !== 0) {
      const cancel = globalThis.cancelAnimationFrame ?? globalThis.clearTimeout;
      cancel(selectedVisualAnimationFrame);
      selectedVisualAnimationFrame = 0;
    }
    if (selectedVisualTimeout !== null) {
      globalThis.clearTimeout(selectedVisualTimeout);
      selectedVisualTimeout = null;
    }
  }

  function syncCanvasSize(): void {
    const rect = hostElement.getBoundingClientRect();
    const dpr = globalThis.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(Math.max(0, rect.width) * dpr));
    const height = Math.max(1, Math.floor(Math.max(0, rect.height) * dpr));
    if (canvas.width !== width) {
      canvas.width = width;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }
    if (hoverCanvas.width !== width) {
      hoverCanvas.width = width;
    }
    if (hoverCanvas.height !== height) {
      hoverCanvas.height = height;
    }
  }

  function applySelectedVisual(): void {
    if (renderer === null) {
      return;
    }
    if (
      optionsState.selectedSourceIndices.length === 0 &&
      !hasAppliedSelectedVisual
    ) {
      return;
    }
    hasAppliedSelectedVisual = true;
    const selectedMetrics = renderer.updateSelectedSourceIndices(
      optionsState.buffers,
      optionsState.selectedSourceIndices,
    );
    const drawMetrics = renderer.draw();
    emitMetrics({
      drawCallCount: drawMetrics?.drawCallCount,
      rendererKind: 'webgl2-segments',
      rendererRedrawMs: drawMetrics?.redrawMs,
      rendererState: 'ready',
      selectedLineAlpha: selectedMetrics.selectedLineAlpha,
      selectedLineSampleCount: selectedMetrics.selectedVertexCount,
      selectedVisualBufferCreationMs: selectedMetrics.bufferCreationMs,
      selectedVisualGpuUploadMs: selectedMetrics.gpuUploadMs,
      selectedVisualMaskBuildMs: selectedMetrics.maskBuildMs,
      selectedVisualMaskGpuUploadMs: selectedMetrics.maskGpuUploadMs,
      selectedVisualRedrawMs: drawMetrics?.redrawMs ?? null,
      selectionVisualUpdateMs:
        selectedMetrics.updateMs + (drawMetrics?.redrawMs ?? 0),
    });
  }

  function applyPreselectedVisual(): void {
    if (renderer === null) {
      return;
    }
    if (
      !optionsState.preselectedOverlayEnabled &&
      !hasAppliedPreselectedVisual
    ) {
      return;
    }
    hasAppliedPreselectedVisual = true;
    renderer.updatePreselectedSourceIndices(
      optionsState.buffers,
      optionsState.preselectedOverlayEnabled
        ? optionsState.preselectedSourceIndices
        : new Uint32Array(0),
    );
    const drawMetrics = renderer.draw();
    emitMetrics({
      drawCallCount: drawMetrics?.drawCallCount,
      rendererKind: 'webgl2-segments',
      rendererRedrawMs: drawMetrics?.redrawMs,
      rendererState: 'ready',
    });
  }

  function applyHoverVisualState(
    state: ParallelFastHoverVisualState,
  ): ParallelWebgl2HoverUpdateMetrics | null {
    if (disposed || renderer === null || hoverRenderer === null) {
      return null;
    }
    const resolvedState = {
      dimBackground: false,
      sourceIndex: state.sourceIndex,
    };

    const previousState = hoverState;
    const sourceChanged = previousState.sourceIndex !== resolvedState.sourceIndex;
    const dimChanged = previousState.dimBackground !== resolvedState.dimBackground;
    if (!sourceChanged && !dimChanged) {
      const updateStartedAt = performance.now();
      return {
        baseRedrawMs: null,
        changed: false,
        gpuUploadMs: 0,
        hoverRecordIndex: previousState.sourceIndex,
        hoverSegmentCount: 0,
        hoverVertexCount: 0,
        skipped: true,
        updateMs: performance.now() - updateStartedAt,
        uploadBytes: 0,
      };
    }

    hoverState = { ...resolvedState };
    const hoverMetrics = sourceChanged
      ? hoverRenderer.setHoverSourceIndex(optionsState.buffers, resolvedState.sourceIndex)
      : {
          baseRedrawMs: null,
          changed: false,
          gpuUploadMs: 0,
          hoverRecordIndex: resolvedState.sourceIndex,
          hoverSegmentCount: 0,
          hoverVertexCount: 0,
          skipped: false,
          updateMs: 0,
          uploadBytes: 0,
        };
    let baseDrawMetrics: ParallelWebgl2RendererDrawMetrics | null = null;
    let baseRedrawMs: number | null = null;
    if (dimChanged && renderer.setHoverFocusActive(resolvedState.dimBackground)) {
      baseDrawMetrics = renderer.draw();
      baseRedrawMs = baseDrawMetrics?.redrawMs ?? null;
      emitMetrics({
        drawCallCount: baseDrawMetrics?.drawCallCount,
        hoverVisualBaseRedrawMs: baseRedrawMs,
        rendererKind: 'webgl2-segments',
        rendererRedrawMs: baseDrawMetrics?.redrawMs,
        rendererState: 'ready',
      });
    }
    const hoverDrawMetrics = hoverRenderer.draw();
    const result = {
      ...hoverMetrics,
      baseRedrawMs,
      changed: hoverMetrics.changed || dimChanged,
      skipped: false,
      updateMs: hoverMetrics.updateMs + (baseRedrawMs ?? 0),
    };
    emitMetrics({
      hoverVisualBaseRedrawMs: result.baseRedrawMs,
      hoverVisualGpuUploadMs: result.gpuUploadMs,
      hoverVisualMode: 'webgl2-hover-overlay-canvas',
      hoverVisualRedrawMs: hoverDrawMetrics?.redrawMs ?? null,
      hoverVisualSkipped: result.skipped,
      hoverVisualUpdateMs:
        result.updateMs + (hoverDrawMetrics?.redrawMs ?? 0),
      hoverVisualUploadBytes: result.uploadBytes,
      rendererKind: 'webgl2-segments',
      rendererState: 'ready',
    });
    emitter.emit('hovervisualchange', {
      drawMetrics: baseDrawMetrics,
      hoverDrawMetrics,
      hoverMetrics: result,
      state: hoverState,
    });
    return result;
  }

  function handleSetupError(error: unknown, fallback: string): void {
    const message = error instanceof Error ? error.message : fallback;
    emitMetrics({
      firstReadySignalMs: null,
      rendererKind: 'webgl2-segments',
      rendererSetupMs: null,
      rendererState: 'error',
    });
    emitRenderState('error', message);
  }

  function getRenderSnapshot(): ParallelFastRenderSnapshot {
    const rect = hostElement.getBoundingClientRect();
    const snapshot: ParallelFastRenderSnapshot = {
      canvas: {
        cssHeight: rect.height,
        cssWidth: rect.width,
        devicePixelRatio: globalThis.devicePixelRatio || 1,
        height: canvas.height,
        width: canvas.width,
      },
      hoverCanvas: {
        height: hoverCanvas.height,
        width: hoverCanvas.width,
      },
      renderState,
    };
    if (renderStateMessage !== undefined) {
      snapshot.renderStateMessage = renderStateMessage;
    }
    return snapshot;
  }

  function getStateSnapshot(): ParallelFastStateSnapshot {
    const segmentCount = optionsState.buffers.webglSegmentBuffers?.segmentCount ?? 0;
    const verticesPerSegment =
      optionsState.buffers.webglSegmentBuffers?.verticesPerSegment ?? 0;
    return {
      bufferStats: {
        axisCount: optionsState.buffers.axisCount,
        recordCount: optionsState.buffers.recordCount,
        webglSegmentCount: segmentCount,
        webglVertexCount: segmentCount * verticesPerSegment,
      },
      buffers: optionsState.buffers,
      brush: {
        activeBrushes,
        brushIntervals,
      },
      hover: hoverState,
      inspection,
      lineOpacityScale: optionsState.lineOpacityScale,
      preselectedOverlayEnabled: optionsState.preselectedOverlayEnabled,
      preselectedSourceIndices: optionsState.preselectedSourceIndices,
      render: getRenderSnapshot(),
      selection: {
        selectedCount: optionsState.selectedSourceIndices.length,
        sourceIndices: optionsState.selectedSourceIndices,
      },
      selectedSourceIndices: optionsState.selectedSourceIndices,
    };
  }

  disposables.add(
    createWebGlContextLifecycle(canvas, {
      onLost(event) {
        if (disposed) {
          return;
        }
        emitMetrics({ rendererKind: 'webgl2-segments', rendererState: 'rendering' });
        emitter.emit('contextlost', { originalEvent: event });
        emitRenderState('rendering', 'WebGL2 context lost; waiting for restore.');
        destroyRenderers();
      },
      onRestored(event) {
        if (disposed) {
          return;
        }
        emitter.emit('contextrestored', { originalEvent: event });
        recreateRenderers();
      },
      preventDefaultOnLost: true,
    }),
  );

  disposables.add(
    createResizeLifecycle(hostElement, () => {
      if (disposed) {
        return;
      }
      syncCanvasSize();
      scheduleRender();
    }),
  );

  const commands: ParallelFastPlotCommands = {
    getCanvas() {
      return canvas;
    },
    getHoverCanvas() {
      return hoverCanvas;
    },
    getHostElement() {
      return hostElement;
    },
    getOverlays() {
      return overlays;
    },
    getRenderSnapshot,
    getStateSnapshot,
    clearBrushes(options) {
      setBrushState({}, 'commit', {
        reason: options?.reason ?? 'clear',
        source: options?.source,
      });
    },
    clearInspection(options) {
      setInspectionState(null, options);
    },
    clearOverlays(kind?: ParallelFastOverlayKind) {
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
      emitOverlayChange('clear');
    },
    commitBrushIntervals(nextBrushIntervals, options) {
      setBrushState(nextBrushIntervals, 'commit', options);
    },
    drawHover() {
      if (disposed || hoverRenderer === null) {
        return null;
      }
      const hover = hoverRenderer.draw();
      emitMetrics({
        hoverVisualMode: 'webgl2-hover-overlay-canvas',
        hoverVisualRedrawMs: hover?.redrawMs ?? null,
        rendererKind: 'webgl2-segments',
        rendererState: renderState,
      });
      return hover;
    },
    emitBrushEvent(event) {
      if (disposed) {
        return;
      }
      if (event.phase === 'preview') {
        emitter.emit('brushpreview', event);
        return;
      }
      emitter.emit('brushcommit', event as ParallelFastBrushEvent & { phase: 'commit' });
      if (event.defaultAction !== 'none') {
        emitter.emit('brushchange', event);
      }
    },
    previewBrushIntervals(nextBrushIntervals, options) {
      setBrushState(nextBrushIntervals, 'preview', options);
    },
    render() {
      drawNow();
    },
    requestLineOpacityAdjustment(adjustment, options) {
      emitLineOpacityAdjustmentRequest(adjustment, options);
    },
    removeBrushInterval(axis, axisRangeIndex, options) {
      setBrushState(
        removeAxisBrushInterval(brushIntervals, axis, axisRangeIndex),
        'commit',
        {
          reason: options?.reason ?? 'remove',
          source: options?.source,
        },
      );
    },
    resize() {
      if (disposed) {
        return;
      }
      syncCanvasSize();
      drawNow();
    },
    setHoverSourceIndex(sourceIndex) {
      return applyHoverVisualState({
        dimBackground: false,
        sourceIndex: normalizeSourceIndex(sourceIndex, optionsState.buffers.recordCount),
      });
    },
    setHoverState(state) {
      return applyHoverVisualState({
        dimBackground: false,
        sourceIndex: normalizeSourceIndex(state.sourceIndex, optionsState.buffers.recordCount),
      });
    },
    setInspection(nextInspection, options) {
      setInspectionState(nextInspection, options);
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
      emitOverlayChange(reason);
    },
    setPreselectedSourceIndices(sourceIndices) {
      if (disposed) {
        return;
      }
      optionsState = {
        ...optionsState,
        preselectedOverlayEnabled: true,
        preselectedSourceIndices: sourceIndices,
      };
      applyPreselectedVisual();
    },
    setSelectedSourceIndices(sourceIndices, options) {
      if (disposed) {
        return;
      }
      cancelScheduledSelectedVisualUpdate();
      optionsState = { ...optionsState, selectedSourceIndices: sourceIndices };
      emitProgrammaticSelectionChange(sourceIndices, options?.source ?? 'command');
      scheduleSelectedVisualUpdate();
    },
    updateLineOpacityScale(lineOpacityScale) {
      if (disposed || renderer === null) {
        return null;
      }
      optionsState = {
        ...optionsState,
        lineOpacityScale: resolveLineOpacityScale({ lineOpacityScale }),
      };
      renderer.updateLineOpacityScale(optionsState.lineOpacityScale);
      const drawMetrics = renderer.draw();
      emitMetrics({
        drawCallCount: drawMetrics?.drawCallCount,
        lineOpacityScale: optionsState.lineOpacityScale,
        rendererKind: 'webgl2-segments',
        rendererRedrawMs: drawMetrics?.redrawMs,
        rendererState: 'ready',
      });
      return drawMetrics;
    },
    updateTheme(theme) {
      if (disposed || renderer === null) {
        return { base: null, hover: null };
      }
      optionsState = { ...optionsState, theme };
      renderer.updateTheme(theme);
      hoverRenderer?.updateTheme(theme);
      const drawMetrics = renderer.draw();
      const hoverDrawMetrics = hoverRenderer?.draw() ?? null;
      emitMetrics({
        drawCallCount: drawMetrics?.drawCallCount,
        hoverVisualRedrawMs: hoverDrawMetrics?.redrawMs ?? null,
        rendererKind: 'webgl2-segments',
        rendererRedrawMs: drawMetrics?.redrawMs,
        rendererState: 'ready',
      });
      return { base: drawMetrics, hover: hoverDrawMetrics };
    },
  };

  const instance: ParallelFastPlotInstance = {
    commands,
    dispose() {
      if (disposed) {
        return;
      }
      emitter.emit('dispose', { reason: 'dispose' });
      disposed = true;
      disposables.dispose();
      emitter.clear();
    },
    hostElement,
    on(event, handler) {
      return emitter.on(event, handler);
    },
    update(partialOptions) {
      if (disposed) {
        return;
      }
      const previousBuffers = optionsState.buffers;
      const previousPreserveDrawingBuffer = optionsState.preserveDrawingBuffer;
      optionsState = normalizeOptions({ ...optionsState, ...partialOptions });
      if (
        optionsState.buffers !== previousBuffers ||
        optionsState.preserveDrawingBuffer !== previousPreserveDrawingBuffer
      ) {
        cancelScheduledSelectedVisualUpdate();
        brushIntervals = cloneBrushIntervals(optionsState.brushIntervals);
        activeBrushes = getActiveBrushes(brushIntervals, optionsState.buffers);
        inspection = optionsState.inspection;
        if (partialOptions.brushIntervals !== undefined) {
          const event = createParallelBrushEvent({
            activeBrushes,
            brushIntervals,
            phase: 'commit',
            reason: 'set',
            source: 'command',
          });
          emitter.emit('brushcommit', event as ParallelFastBrushEvent & { phase: 'commit' });
          emitter.emit('brushchange', event);
        }
        computeAndCommitSelection(brushIntervals, 'set', 'command', {
          scheduleVisualUpdate: false,
        });
        recreateRenderers();
        syncBrushOverlay();
        syncInspectionOverlay();
        return;
      }
      if (partialOptions.brushIntervals !== undefined) {
        setBrushState(optionsState.brushIntervals, 'commit', {
          reason: 'set',
          source: 'command',
        });
      }
      if (partialOptions.inspection !== undefined) {
        inspection = optionsState.inspection;
        syncHoverVisualToInspection(inspection);
        syncInspectionOverlay(inspection === null ? 'clear' : 'set');
      }
      if (partialOptions.theme !== undefined) {
        commands.updateTheme(optionsState.theme);
      }
      if (partialOptions.lineOpacityScale !== undefined) {
        commands.updateLineOpacityScale(optionsState.lineOpacityScale);
      }
      if (
        partialOptions.preselectedSourceIndices !== undefined ||
        partialOptions.preselectedOverlayEnabled !== undefined
      ) {
        applyPreselectedVisual();
      }
      if (partialOptions.selectedSourceIndices !== undefined) {
        cancelScheduledSelectedVisualUpdate();
        emitProgrammaticSelectionChange(
          optionsState.selectedSourceIndices,
          'command',
        );
        scheduleSelectedVisualUpdate();
      }
    },
    use(binding: ParallelFastBinding): Disposable {
      if (disposed) {
        return toDisposable(() => {});
      }
      const cleanup =
        typeof binding === 'function' ? binding(instance) : binding.attach(instance);
      const disposable = toDisposableLike(cleanup);
      bindingDisposables.add(disposable);
      return disposable;
    },
  };

  syncBrushOverlay('replace');
  syncInspectionOverlay('replace');

  try {
    createRenderers();
  } catch (error) {
    handleSetupError(error, 'Unknown parallel-fast WebGL2 renderer setup error.');
  }

  return instance;
}

function normalizeOptions(options: ParallelFastPlotOptions): RequiredOptions {
  return {
    ...options,
    baseCanvasClassName: options.baseCanvasClassName ?? DEFAULT_BASE_CANVAS_CLASS,
    baseCanvasLabel: options.baseCanvasLabel ?? DEFAULT_BASE_CANVAS_LABEL,
    brushIntervals: options.brushIntervals ?? {},
    forceWebglUnavailable: options.forceWebglUnavailable ?? false,
    hostClassName: options.hostClassName ?? DEFAULT_HOST_CLASS,
    hoverCanvasClassName: options.hoverCanvasClassName ?? DEFAULT_HOVER_CANVAS_CLASS,
    lineOpacityScale: resolveLineOpacityScale(options),
    inspection: options.inspection ?? null,
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    preselectedOverlayEnabled: options.preselectedOverlayEnabled ?? false,
    preselectedSourceIndices:
      options.preselectedSourceIndices ?? options.buffers.preselectedSourceIndices,
    selectedSourceIndices: options.selectedSourceIndices ?? new Uint32Array(0),
    selectedVisualUpdateDelayMs: Math.max(
      0,
      normalizeFinite(
        options.selectedVisualUpdateDelayMs,
        DEFAULT_SELECTED_VISUAL_UPDATE_DELAY_MS,
      ),
    ),
  };
}

function cloneBrushIntervals(
  brushIntervals: ParallelBrushIntervals,
): ParallelBrushIntervals {
  const next: ParallelBrushIntervals = {};
  for (const [axis, interval] of Object.entries(brushIntervals)) {
    if (interval === null || interval === undefined) {
      continue;
    }
    if (Array.isArray(interval)) {
      next[axis] = interval.map((range) => ({ max: range.max, min: range.min }));
    } else {
      const range = interval as { max: number; min: number };
      next[axis] = { max: range.max, min: range.min };
    }
  }
  return next;
}

function getActiveBrushes(
  brushIntervals: ParallelBrushIntervals,
  buffers: Pick<RequiredOptions['buffers'], 'axisOrder'>,
): readonly ParallelActiveBrushInterval[] {
  return normalizeParallelBrushIntervals(brushIntervals, buffers.axisOrder);
}

function removeAxisBrushInterval(
  currentBrushIntervals: ParallelBrushIntervals,
  parameter: ParallelParameter,
  axisRangeIndex: number,
): ParallelBrushIntervals {
  const currentRanges = getBrushRangesForAxis(currentBrushIntervals, parameter);
  if (axisRangeIndex < 0 || axisRangeIndex >= currentRanges.length) {
    return currentBrushIntervals;
  }
  const nextRanges = currentRanges.filter((_, index) => index !== axisRangeIndex);
  const nextBrushIntervals = { ...currentBrushIntervals };
  if (nextRanges.length === 0) {
    delete nextBrushIntervals[parameter];
  } else {
    nextBrushIntervals[parameter] = nextRanges;
  }
  return nextBrushIntervals;
}

function getBrushRangesForAxis(
  brushIntervals: ParallelBrushIntervals,
  parameter: ParallelParameter,
): { max: number; min: number }[] {
  const interval = brushIntervals[parameter];
  if (interval === null || interval === undefined) {
    return [];
  }
  if (Array.isArray(interval)) {
    return interval.map((range) => ({ max: range.max, min: range.min }));
  }
  const range = interval as { max: number; min: number };
  return [{ max: range.max, min: range.min }];
}

const EMPTY_BRUSH_MODIFIERS: InputModifiers = {
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
};

function createParallelBrushEvent({
  activeBrushes,
  brushIntervals,
  modifiers,
  phase,
  reason,
  source,
}: {
  activeBrushes: readonly ParallelActiveBrushInterval[];
  brushIntervals: ParallelBrushIntervals;
  modifiers?: InputModifiers;
  phase: 'preview' | 'commit';
  reason: ParallelFastBrushCommandOptions['reason'];
  source: NonNullable<ParallelFastBrushCommandOptions['source']>;
}): ParallelFastBrushEvent {
  const intervals = activeBrushes.map((brush) => ({
    axis: brush.parameter,
    axisRangeIndex: brush.axisRangeIndex,
    max: brush.max,
    min: brush.min,
    parameterKey: brush.parameter,
  }));
  const primaryBrush = activeBrushes.at(-1) ?? null;
  const primaryRange =
    primaryBrush === null
      ? undefined
      : normalizeBrushNumericRange({
          max: primaryBrush.max,
          min: primaryBrush.min,
        });
  return {
    activeBrushes,
    brushIntervals,
    defaultAction: 'select',
    modifiers: snapshotBrushModifiers(modifiers ?? EMPTY_BRUSH_MODIFIERS),
    phase,
    range:
      primaryRange === undefined
        ? { intervals }
        : {
            intervals,
            value: primaryRange,
          },
    reason: reason ?? 'set',
    shape: 'axis-range',
    source,
    target: {
      axis: primaryBrush?.parameter ?? null,
      axisRangeIndex: primaryBrush?.axisRangeIndex ?? null,
      parameterKey: primaryBrush?.parameter ?? null,
    },
  };
}

function createParallelSelectionFilters(
  activeBrushes: readonly ParallelActiveBrushInterval[],
  buffers: {
    axisMetadataByAxis?: Readonly<Record<ParallelParameter, ParallelFastAxisMetadata>>;
  },
): readonly ParallelFastSelectionFilter[] {
  return activeBrushes.map((brush) => {
    const axisMetadata = buffers.axisMetadataByAxis?.[brush.parameter];
    const values = getParallelSelectedCategoricalValues(axisMetadata, brush);
    return {
      axisRangeIndex: brush.axisRangeIndex,
      parameterKey: brush.parameter,
      range: {
        max: brush.max,
        min: brush.min,
      },
      ...(axisMetadata?.source === undefined ? {} : { source: axisMetadata.source }),
      valueType: axisMetadata?.kind ?? 'unknown',
      ...(values === undefined ? {} : { values }),
    };
  });
}

function getParallelSelectedCategoricalValues(
  axisMetadata: ParallelFastAxisMetadata | undefined,
  range: { max: number; min: number },
): ParallelFastSelectionFilter['values'] | undefined {
  if (
    axisMetadata === undefined ||
    (axisMetadata.kind !== 'categorical' && axisMetadata.kind !== 'boolean')
  ) {
    return undefined;
  }
  return axisMetadata.categories
    .filter(
      (category) => category.encoded >= range.min && category.encoded <= range.max,
    )
    .map((category) => ({
      encoded: category.encoded,
      label: category.label,
      value:
        axisMetadata.kind === 'boolean'
          ? coerceParallelBooleanCategoryValue(category.value)
          : category.value,
    }));
}

function coerceParallelBooleanCategoryValue(value: string): boolean | string {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
}

function normalizeFinite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function normalizeSourceIndex(sourceIndex: number | null, recordCount: number): number | null {
  if (sourceIndex === null) {
    return null;
  }
  const normalized = Math.floor(sourceIndex);
  return Number.isSafeInteger(normalized) && normalized >= 0 && normalized < recordCount
    ? normalized
    : null;
}

function splitClassNames(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}

function ensurePositionedHost(hostElement: HTMLElement): void {
  if (hostElement.style.position) {
    return;
  }
  const view = hostElement.ownerDocument?.defaultView ?? globalThis.window;
  const getComputedStyle =
    view?.getComputedStyle?.bind(view) ?? globalThis.getComputedStyle;
  const computedPosition = getComputedStyle?.(hostElement).position ?? 'static';
  if (computedPosition === 'static') {
    hostElement.style.position = 'relative';
  }
}

function toDisposableLike(
  cleanup: Disposable | (() => void) | void,
): Disposable {
  if (cleanup === undefined) {
    return toDisposable(() => {});
  }
  return typeof cleanup === 'function' ? toDisposable(cleanup) : cleanup;
}

type RequiredOptions = Omit<
  ParallelFastPlotOptions,
  | 'baseCanvasClassName'
  | 'baseCanvasLabel'
  | 'brushIntervals'
  | 'forceWebglUnavailable'
  | 'hostClassName'
  | 'hoverCanvasClassName'
  | 'inspection'
  | 'lineOpacityScale'
  | 'preserveDrawingBuffer'
  | 'preselectedOverlayEnabled'
  | 'preselectedSourceIndices'
  | 'selectedSourceIndices'
  | 'selectedVisualUpdateDelayMs'
> & {
  baseCanvasClassName: string;
  baseCanvasLabel: string;
  brushIntervals: ParallelBrushIntervals;
  forceWebglUnavailable: boolean;
  hostClassName: string;
  hoverCanvasClassName: string;
  inspection: ParallelFastInspectionState | null;
  lineOpacityScale: number;
  preserveDrawingBuffer: boolean;
  preselectedOverlayEnabled: boolean;
  preselectedSourceIndices: Uint32Array;
  selectedSourceIndices: Uint32Array;
  selectedVisualUpdateDelayMs: number;
  theme?: ParallelFastTheme;
};
