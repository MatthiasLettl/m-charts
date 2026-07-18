import {
  DisposableStack,
  brushEventNameForPhase,
  createEmitter,
  createResizeLifecycle,
  toDisposable,
  type Disposable,
} from '../../plot-engine/core/index.js';
import {
  FAST_SCATTER_SHAPE_CODES,
  axisToPixel,
  calculateFastScatterDomain,
  calculateFastScatterNavigatorWindowPixels,
  createFastScatterBubbleRadiusPx,
  createFastScatterPointRef,
  formatFastScatterColumnValueForDisplay,
  type FastScatterControllerOptions,
  type FastScatterAggregationSet,
  type FastScatterBubbleAggregationSet,
  type FastScatterHoverEvent,
  type FastScatterMetricsEvent,
  type FastScatterMeasurementEvent,
  type FastScatterPlotRect,
  type FastScatterPointAxisMetadata,
  type FastScatterRange,
  type FastScatterSelectionFilter,
  type FastScatterSelectionDimension,
  type FastScatterSelectionPoint,
  type FastScatterRendererOptions,
  type FastScatterViewport,
  type FastScatterViewportChangeReason,
  type FastScatterViewportChangePhase,
  createFastScatterLayout,
  createFastScatterRectangleZoomFeedback,
  createFastScatterSelectionState,
  createFastScatterViewportWithSharedX,
  dragFastScatterNavigatorWindow,
  findFastScatterPlotRectAtPoint,
  mergeFastScatterSelectionSourceIndices,
  panFastScatterViewportFromDrag,
  resolveFastScatterRectangleZoomEffectiveAxisMode,
  resizeFastScatterNavigatorWindow,
  lookupFastScatterNearestPoint,
  lookupFastScatterAggregateHit,
  materializeFastScatterHeatmapCellSourceIndices,
  estimateFastScatterSelectionCandidateCount,
  selectFastScatterSourceIndicesInBounds,
  selectFastScatterSourceIndicesInPolygon,
  isFastScatterPointInPolygon,
  normalizeSelectionSourceIndices,
  formatFastScatterAxisValue,
  zoomFastScatterViewportAtPointer,
  zoomFastScatterViewportToRectangle,
} from '../core/index.js';
import type {
  FastScatterBinding,
  FastScatterEngineBackend,
  FastScatterEngineOptions,
  FastScatterPlotInstance,
  FastScatterPlotOptions,
  FastScatterRendererLike,
} from './types.js';
import type { FastScatterPlotCommands } from './scatterCommands.js';
import type {
  FastScatterBrushEvent,
  FastScatterEngineEvents,
} from './scatterEvents.js';
import type { FastScatterOverlayDescriptor, FastScatterOverlayKind } from './scatterOverlays.js';
import type { FastScatterCursorState, FastScatterRenderState } from './scatterState.js';

const DEFAULT_OVERLAY_CLASS = 'scatter-fast-engine-overlay';
const DEFAULT_NAVIGATOR_CSS_PX = 36;
const DEFAULT_POINT_MARKER_SIZE_CSS_PX = 4;
const MAX_POINT_MARKERS = 100;
const PIN_GLYPH_VISUAL_CENTER_LOCAL_Y = 0.13153;
const TRIANGLE_GLYPH_VISUAL_CENTER_LOCAL_Y = -1 / 3;
export function createFastScatterEngine(
  hostElement: HTMLElement,
  options: FastScatterEngineOptions,
  backend: FastScatterEngineBackend,
): FastScatterPlotInstance {
  const emitter = createEmitter<FastScatterEngineEvents>();
  const disposables = new DisposableStack();
  const bindingDisposables = new DisposableStack();
  const document = hostElement.ownerDocument ?? globalThis.document;
  if (!document) {
    throw new Error('Fast scatter plot requires a DOM document.');
  }

  let disposed = false;
  let optionsState = options;
  let renderer: FastScatterRendererLike | null = null;
  let renderState: FastScatterRenderState = 'idle';
  let renderStateMessage: string | undefined;
  let firstRenderReported = backend.asynchronousReady === true;
  let rendererGeneration = 0;
  let activePlotId: string | null = null;
  let cursorState: FastScatterCursorState = 'default';
  let overlays: readonly FastScatterOverlayDescriptor[] = [];
  let activeHover = normalizeHoverSourceIndex(
    options.hoverSourceIndex ?? null,
    options.columns.x.length,
  );
  let activeHoverEvent: ReturnType<FastScatterPlotCommands['hoverAtPoint']> = null;
  let activeHoverSource: string | null = activeHover === null ? null : 'programmatic';
  let activeMeasurement: FastScatterMeasurementEvent | null = null;
  let activeSelectionFilters: readonly FastScatterSelectionFilter[] = [];
  let pointMarkerSourceIndices: readonly number[] = [];
  let pointIndexBySourceIndex: ReadonlyMap<number, number> | null = null;
  let viewportGeneration = 0;
  let dataDomain = calculateFastScatterDomain(options.columns, options.spec);

  const previousHostClassName = hostElement.className;
  const previousHostInlinePosition = hostElement.style.position;
  if (options.hostClassName ?? backend.hostClassName) {
    hostElement.classList.add(...splitClassNames(options.hostClassName ?? backend.hostClassName));
  }
  hostElement.style.position ||= 'relative';

  const canvas = document.createElement('canvas');
  canvas.className = options.canvasClassName ?? backend.canvasClassName;
  canvas.setAttribute('aria-label', options.canvasLabel ?? backend.canvasLabel);
  canvas.dataset.renderer = backend.canvasRenderer;
  canvas.dataset.testid = 'scatter-fast-engine-canvas';
  Object.assign(canvas.style, {
    display: 'block',
    height: '100%',
    inset: '0',
    position: 'absolute',
    width: '100%',
  });

  const overlayElement = document.createElement('div');
  overlayElement.className = options.overlayClassName ?? DEFAULT_OVERLAY_CLASS;
  overlayElement.dataset.testid = 'scatter-fast-engine-overlay';
  Object.assign(overlayElement.style, {
    inset: '0',
    pointerEvents: 'none',
    position: 'absolute',
  });

  hostElement.append(canvas, overlayElement);
  disposables.defer(() => {
    bindingDisposables.dispose();
    renderer?.dispose();
    renderer = null;
    canvas.remove();
    overlayElement.remove();
    hostElement.className = previousHostClassName;
    hostElement.style.position = previousHostInlinePosition;
  });

  function emitRenderState(state: FastScatterRenderState, message?: string): void {
    if (disposed) {
      return;
    }
    if (renderState === state && renderStateMessage === message) {
      return;
    }
    renderState = state;
    renderStateMessage = message;
    const event = { message, state };
    emitter.emit('renderstate', event);
    emitter.emit('renderstatechange', event);
  }

  function emitMetrics(metrics: FastScatterMetricsEvent): void {
    if (disposed) {
      return;
    }
    optionsState.onMetrics?.(metrics);
    emitter.emit('metrics', metrics);
    if (metrics.phase === 'render' && !firstRenderReported) {
      firstRenderReported = true;
      emitRenderState('ready');
    }
  }

  function buildRendererOptions(): FastScatterRendererOptions {
    return {
      ...optionsState,
      canvas,
      onHoverChange: (hover) => {
        optionsState.onHoverChange?.(hover);
        emitter.emit('hoverchange', hover);
      },
      onMeasurementChange: (measurement) => {
        optionsState.onMeasurementChange?.(measurement);
        emitter.emit('measurementchange', measurement);
      },
      onMetrics: emitMetrics,
      onSelectionChange: (selection) => {
        optionsState.onSelectionChange?.(selection);
        emitter.emit('selectionchange', selection);
      },
      onViewportChange: (viewport, reason, phase) => {
        optionsState.onViewportChange?.(viewport, reason, phase);
        emitter.emit('viewportchange', { phase, reason, viewport });
      },
    };
  }

  function resizeRenderer(): void {
    if (disposed || renderer === null) {
      return;
    }
    const rect = getHostLayoutRect();
    renderer.resize(rect.width, rect.height, globalThis.devicePixelRatio || 1);
    refreshNavigatorOverlay();
    refreshPointMarkerOverlays();
  }

  function createRenderer(): void {
    if (disposed || renderer !== null) {
      return;
    }
    emitRenderState('rendering');
    firstRenderReported = backend.asynchronousReady === true;
    const generation = ++rendererGeneration;
    const isCurrentGeneration = () => !disposed && generation === rendererGeneration;
    backend.assertAvailable?.(optionsState);
    renderer = backend.createRenderer(buildRendererOptions(), optionsState, {
      onContextLost(detail) {
        if (!isCurrentGeneration()) return;
        emitMetrics({ at: performance.now(), detail, phase: 'context-lost' });
        emitter.emit('contextlost', {});
        emitRenderState(
          'rendering',
          backend.contextLostMessage ?? 'Renderer context lost; waiting for restore.',
        );
      },
      onContextRestored(detail) {
        if (!isCurrentGeneration()) return;
        emitMetrics({ at: performance.now(), detail, phase: 'context-restored' });
        emitter.emit('contextrestored', {});
        emitRenderState('ready');
      },
      onError(error) {
        if (!isCurrentGeneration()) return;
        handleSetupError(error, backend.setupErrorMessage ?? 'Unknown scatter renderer error.');
      },
      onReady() {
        if (!isCurrentGeneration()) return;
        emitRenderState('ready');
      },
    });
    resizeRenderer();
    if (backend.asynchronousReady !== true) emitRenderState('ready');
  }

  function destroyRenderer(): void {
    rendererGeneration += 1;
    renderer?.dispose();
    renderer = null;
  }

  function getCurrentLayout() {
    const rect = getHostLayoutRect();
    return createFastScatterLayout(optionsState.spec, {
      focusedPlotId: optionsState.focusedPlotId,
      heightCssPx: rect.height,
      navigatorCssPx: optionsState.navigatorCssPx ?? DEFAULT_NAVIGATOR_CSS_PX,
      widthCssPx: rect.width,
    });
  }

  function getCurrentPlotRects() {
    return getCurrentLayout().plotRects;
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
    const shell = hostElement.closest('.scatter-fast-chart-shell');
    const shellRect = shell?.getBoundingClientRect();
    const header = shell?.querySelector('.fast-route-header');
    const headerRect = header?.getBoundingClientRect();
    if (shellRect !== undefined && shellRect.width > 0 && shellRect.height > 0) {
      return new DOMRect(
        shellRect.x,
        (headerRect?.bottom ?? shellRect.y) - shellRect.y,
        shellRect.width,
        Math.max(0, shellRect.height - (headerRect?.height ?? 0)),
      );
    }
    return rect;
  }

  function handleSetupError(error: unknown, fallback: string): void {
    const message = error instanceof Error ? error.message : fallback;
    emitRenderState('error', message);
  }

  if (backend.attachContextLifecycle !== undefined) {
    disposables.add(
      backend.attachContextLifecycle(canvas, {
        onLost(event) {
          if (disposed) {
            return;
          }
          emitMetrics({ at: performance.now(), phase: 'context-lost' });
          emitter.emit('contextlost', { originalEvent: event });
          emitRenderState('rendering', backend.contextLostMessage);
          destroyRenderer();
        },
        onRestored(event) {
          if (disposed) {
            return;
          }
          emitMetrics({ at: performance.now(), phase: 'context-restored' });
          emitter.emit('contextrestored', { originalEvent: event });
          try {
            createRenderer();
          } catch (error) {
            handleSetupError(
              error,
              backend.contextRestoreErrorMessage ?? 'Unknown scatter renderer restore error.',
            );
          }
        },
      }),
    );
  }

  disposables.add(
    createResizeLifecycle(hostElement, (event) => {
      const useVisibleFallback =
        (event.cssSize.width <= 0 || event.cssSize.height <= 0) &&
        hostElement.offsetParent !== null;
      const fallbackRect = useVisibleFallback ? getHostLayoutRect() : null;
      renderer?.resize(
        event.cssSize.width > 0 ? event.cssSize.width : (fallbackRect?.width ?? 0),
        event.cssSize.height > 0 ? event.cssSize.height : (fallbackRect?.height ?? 0),
        event.devicePixelRatio,
      );
      refreshNavigatorOverlay();
      refreshPointMarkerOverlays();
    }),
  );

  const commands: FastScatterPlotCommands = {
    clearPointMarkers() {
      if (disposed || pointMarkerSourceIndices.length === 0) {
        return;
      }
      pointMarkerSourceIndices = [];
      refreshPointMarkerOverlays();
    },
    clearHover() {
      commitHover(null);
    },
    clearSelection(kind = 'replace') {
      if (disposed) {
        return null;
      }
      activeSelectionFilters = [];
      const emptySourceIndices = new Uint32Array(0);
      const currentSelection = optionsState.selectedSourceIndices;
      if (currentSelection === undefined || currentSelection.length === 0) {
        commands.clearOverlays('committed-selection');
        return {
          durationMs: 0,
          filters: activeSelectionFilters,
          kind,
          plotId: activePlotId ?? optionsState.spec.plots[0]?.id ?? 'programmatic',
          sampleIds: [],
          selectedCount: 0,
          sourceIndices: emptySourceIndices,
          tool: 'programmatic',
          viewport: optionsState.viewport,
        };
      }
      commands.clearOverlays('committed-selection');
      return commitSelection({
        durationMs: 0,
        kind,
        operation: 'clear-selection',
        plotId: activePlotId ?? optionsState.spec.plots[0]?.id ?? 'programmatic',
        rawSourceIndices: emptySourceIndices,
        tool: 'programmatic',
      });
    },
    clearOverlays(kind?: FastScatterOverlayKind) {
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
    getAggregation() {
      return renderer?.getAggregation?.() ?? null;
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
      return findFastScatterPlotRectAtPoint(
        getCurrentPlotRects(),
        pointerCssX,
        pointerCssY,
      );
    },
    getPlotXKey() {
      return optionsState.columns.xKey ?? null;
    },
    getPlotYKey(plotId) {
      return optionsState.spec.plots.find((plot) => plot.id === plotId)?.yKey ?? null;
    },
    getNavigatorRect() {
      return getCurrentLayout().navigatorRect;
    },
    getNavigatorWindowPixels(widthCssPx) {
      return calculateFastScatterNavigatorWindowPixels(
        optionsState.viewport.x,
        dataDomain.x,
        widthCssPx,
      );
    },
    getRenderSnapshot() {
      const rect = hostElement.getBoundingClientRect();
      return {
        aggregation: renderer?.getAggregation?.() ?? null,
        canvas: {
          cssHeight: rect.height,
          cssWidth: rect.width,
          devicePixelRatio: globalThis.devicePixelRatio || 1,
          height: canvas.height,
          width: canvas.width,
        },
        renderState,
        renderStateMessage,
      };
    },
    getStateSnapshot() {
      return {
        activePlotId,
        cursor: cursorState,
        heatmapBinSizePx: optionsState.heatmapBinSizePx,
        hoverSourceIndex: activeHover,
        measurement: activeMeasurement,
        mode: optionsState.mode,
        overlays,
        pointMarkerSourceIndices,
        pointSizeScale: optionsState.pointSizeScale,
        render: commands.getRenderSnapshot(),
        selectionFilters: activeSelectionFilters,
        selectedSourceIndices: optionsState.selectedSourceIndices ?? new Uint32Array(0),
        viewport: optionsState.viewport,
        visualizationMode: optionsState.visualizationMode ?? 'points',
      };
    },
    emitBrushEvent(event: FastScatterBrushEvent) {
      if (disposed) {
        return;
      }
      emitter.emit(brushEventNameForPhase(event.phase), event as never);
    },
    playEasterEgg(request) {
      if (disposed) {
        return false;
      }
      return renderer?.playEasterEgg?.(request) ?? false;
    },
    render() {
      if (disposed) {
        return;
      }
      renderer?.render();
    },
    requestHeatmapBinSizeAdjust(request) {
      if (disposed) {
        return;
      }
      emitter.emit('heatmapbinsizeadjustrequest', {
        delta: request.delta,
        heatmapBinSizePx: request.heatmapBinSizePx ?? optionsState.heatmapBinSizePx,
        palette: request.palette ?? optionsState.heatmapPalette,
        source: request.source ?? 'command',
      });
    },
    requestPointSizeAdjust(request) {
      if (disposed) {
        return;
      }
      emitter.emit('pointsizeadjustrequest', {
        delta: request.delta,
        mode: request.mode ?? optionsState.visualizationMode ?? 'points',
        pointSizeScale: request.pointSizeScale ?? optionsState.pointSizeScale,
        source: request.source ?? 'command',
      });
    },
    requestViewportUndo(source = 'command') {
      if (disposed) {
        return;
      }
      emitter.emit('viewportundorequest', { source });
    },
    resize() {
      resizeRenderer();
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
    setHoverSourceIndex(sourceIndex) {
      if (disposed) {
        return;
      }
      const normalized = normalizeHoverSourceIndex(sourceIndex, optionsState.columns.x.length);
      if (normalized === null) {
        commitHover(null, undefined, undefined, 'programmatic');
        return;
      }
      const hover = createProgrammaticHoverEvent(normalized);
      commitHover(
        hover,
        hover?.canvasPoint.canvasX,
        hover?.canvasPoint.canvasY,
        'programmatic',
      );
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
      viewport: FastScatterViewport,
      reason: FastScatterViewportChangeReason = 'programmatic',
      phase: FastScatterViewportChangePhase = 'commit',
    ) {
      if (disposed) {
        return;
      }
      optionsState = { ...optionsState, viewport };
      viewportGeneration += 1;
      if (renderer?.updateViewport !== undefined) {
        renderer.updateViewport(viewport, {
          generation: viewportGeneration,
          phase,
          reason,
        });
      } else {
        renderer?.update({ viewport });
      }
      if (phase === 'commit') {
        refreshNavigatorOverlay();
        refreshPointMarkerOverlays();
      }
      optionsState.onViewportChange?.(viewport, reason, phase);
      emitter.emit('viewportchange', { phase, reason, viewport });
    },
    panFromDrag(request) {
      if (disposed) {
        return null;
      }
      const startedAt = performance.now();
      const result = panFastScatterViewportFromDrag({
        axisMode: request.axisMode,
        currentPointerCssX: request.currentPointerCssX,
        currentPointerCssY: request.currentPointerCssY,
        plotId: request.plotId,
        plotRects: getCurrentPlotRects(),
        startPointerCssX: request.startPointerCssX,
        startPointerCssY: request.startPointerCssY,
        startViewport: request.startViewport,
      });

      if (result === null) {
        return null;
      }

      commands.setViewport(result.viewport, 'drag', 'preview');
      emitMetrics({
        at: performance.now(),
        detail: JSON.stringify({
          axisMode: request.axisMode,
          deltaX: result.deltaX,
          deltaY: result.deltaY,
          operation: 'drag-pan',
          plotId: result.plotId,
          updateCount: request.updateCount ?? 0,
        }),
        durationMs: performance.now() - startedAt,
        phase: 'interaction',
      });
      return result;
    },
    hoverAtPoint(request) {
      if (disposed) {
        return null;
      }
      if ((optionsState.visualizationMode ?? 'points') === 'heatmap') {
        const aggregateHover = lookupAggregateHoverAtPoint(
          request.pointerCssX,
          request.pointerCssY,
          request.source,
        );
        commitHover(aggregateHover, request.pointerCssX, request.pointerCssY, 'pointer');
        return aggregateHover;
      }
      const lookup = lookupFastScatterNearestPoint({
        columns: optionsState.columns,
        hoverIndex: optionsState.hoverIndex,
        isPointEligible: renderer?.isPointRendered === undefined
          ? undefined
          : (pointIndex, plotId) => renderer?.isPointRendered?.(pointIndex, plotId) ?? true,
        maxDistanceCssPx: 18,
        plotRects: getCurrentPlotRects(),
        pointerCssX: request.pointerCssX,
        pointerCssY: request.pointerCssY,
        spec: optionsState.spec,
        viewport: optionsState.viewport,
      });
      const hover =
        lookup.hit === null
          ? null
          : {
              canvasPoint: lookup.hit.canvasPoint,
              candidateCount: lookup.diagnostics.candidateCount,
              distancePx: lookup.hit.distancePx,
              durationMs: lookup.diagnostics.durationMs,
              pinned: false,
              point: lookup.hit.point,
              source: request.source,
              sourcePointIndex: lookup.hit.pointIndex,
            };
      const aggregateHover = lookupAggregateHoverAtPoint(
        request.pointerCssX,
        request.pointerCssY,
        request.source,
      );
      if (aggregateHover !== null) {
        commitHover(aggregateHover, request.pointerCssX, request.pointerCssY, 'pointer');
        return aggregateHover;
      }
      commitHover(hover, request.pointerCssX, request.pointerCssY, 'pointer');
      emitMetrics({
        at: performance.now(),
        detail: JSON.stringify({
          candidateCount: lookup.diagnostics.candidateCount,
          changed: true,
          distancePx: lookup.hit?.distancePx ?? null,
          operation: 'nearest-point-lookup',
          plotId: lookup.diagnostics.plotId,
          scheduling: 'raf-coalesced',
          source: hover?.source ?? 'none',
          sourceIndex: hover?.point.sourceIndex ?? null,
          yKey: lookup.diagnostics.yKey,
        }),
        durationMs: lookup.diagnostics.durationMs,
        phase: 'hover',
        pointCount: optionsState.columns.x.length,
      });
      return hover;
    },
    dragNavigator(request) {
      if (disposed) {
        return null;
      }
      const startedAt = performance.now();
      const domain = dataDomain.x;
      const x =
        request.edge === null
          ? dragFastScatterNavigatorWindow({
              currentPointerCssX: request.currentPointerCssX,
              domain,
              startPointerCssX: request.startPointerCssX,
              startWindow: request.startWindow,
              widthCssPx: request.widthCssPx,
            })
          : resizeFastScatterNavigatorWindow({
              currentPointerCssX: request.currentPointerCssX,
              domain,
              edge: request.edge,
              startPointerCssX: request.startPointerCssX,
              startWindow: request.startWindow,
              widthCssPx: request.widthCssPx,
            });
      const nextViewport = createFastScatterViewportWithSharedX(optionsState.viewport, x);
      commands.setViewport(nextViewport, 'navigator', 'preview');
      emitMetrics({
        at: performance.now(),
        detail: JSON.stringify({
          durationMs: performance.now() - startedAt,
          edge: request.edge ?? 'window',
          operation: 'navigator-drag',
          updateCount: request.updateCount ?? 0,
          windowMax: x.max,
          windowMin: x.min,
        }),
        durationMs: performance.now() - startedAt,
        phase: 'interaction',
      });
      return x;
    },
    setMeasurement(measurement) {
      if (disposed) {
        return;
      }
      activeMeasurement = measurement;
      updateMeasurementOverlay(measurement);
      optionsState.onMeasurementChange?.(measurement);
      emitter.emit('measurementchange', measurement);
    },
    selectLasso(request) {
      if (disposed) {
        return null;
      }
      const startedAt = performance.now();
      const aggregateSelection = collectHeatmapAggregateSelectionInPolygon({
        points: request.points,
        plotId: request.plotId,
      });
      const polygonSelection =
        aggregateSelection === null
          ? selectFastScatterSourceIndicesInPolygon(optionsState.columns, {
              points: request.points,
              yKey: request.yKey,
            })
          : null;
      const durationMs = performance.now() - startedAt;
      const rawSelection =
        aggregateSelection?.sourceIndices ??
        polygonSelection?.sourceIndices ??
        new Uint32Array(0);
      return commitSelection({
        durationMs,
        kind: request.kind ?? 'replace',
        metricDetail: {
          candidateCount:
            aggregateSelection?.candidateCount ??
            polygonSelection?.diagnostics.candidateCount ??
            0,
          computeMs: durationMs,
          lassoPointCount: request.points.length,
          mode: aggregateSelection === null ? 'source-indices' : 'aggregate-heatmap',
          observableMs: durationMs,
          transferMs: 0,
        },
        operation: 'lasso-selection',
        plotId: request.plotId,
        rawSourceIndices: rawSelection,
        selectionFilter: createLassoSelectionFilter(request),
        tool: 'lasso',
      });
    },
    selectRectangle(request) {
      if (disposed) {
        return null;
      }
      const startedAt = performance.now();
      const aggregateSelection = collectHeatmapAggregateSelectionInBounds({
        plotId: request.plotId,
        xBounds: request.bounds.x,
        yBounds: request.bounds.y,
      });
      const sourceSelection =
        aggregateSelection === null
          ? selectFastScatterSourceIndicesInBounds(optionsState.columns, request.bounds)
          : null;
      const durationMs = performance.now() - startedAt;
      const rawSourceIndices =
        aggregateSelection?.sourceIndices ?? sourceSelection ?? new Uint32Array(0);
      return commitSelection({
        durationMs,
        kind: request.kind ?? 'replace',
        metricDetail: {
          candidateCount:
            aggregateSelection?.candidateCount ??
            estimateFastScatterSelectionCandidateCount(
              optionsState.columns,
              request.bounds,
            ),
          computeMs: durationMs,
          mode: aggregateSelection === null ? 'source-indices' : 'aggregate-heatmap',
          observableMs: durationMs,
          transferMs: 0,
        },
        operation: 'rectangle-selection',
        plotId: request.plotId,
        rawSourceIndices,
        selectionFilter: createRectangleSelectionFilter(request),
        tool: 'rectangle',
      });
    },
    togglePointMarker(request) {
      if (
        disposed ||
        (optionsState.visualizationMode ?? 'points') !== 'points' ||
        !isValidSourceIndex(request.sourceIndex, optionsState.columns.x.length)
      ) {
        return false;
      }

      const sourceIndex = Math.floor(request.sourceIndex);
      const existingIndex = pointMarkerSourceIndices.indexOf(sourceIndex);
      if (existingIndex >= 0) {
        pointMarkerSourceIndices = pointMarkerSourceIndices.filter(
          (candidate) => candidate !== sourceIndex,
        );
        refreshPointMarkerOverlays();
        return false;
      }

      const nextSourceIndices = [...pointMarkerSourceIndices, sourceIndex];
      pointMarkerSourceIndices =
        nextSourceIndices.length > MAX_POINT_MARKERS
          ? nextSourceIndices.slice(nextSourceIndices.length - MAX_POINT_MARKERS)
          : nextSourceIndices;
      refreshPointMarkerOverlays();
      return true;
    },
    zoomToRectangle(request) {
      if (disposed) {
        return null;
      }
      const feedback = createFastScatterRectangleZoomFeedback({
        axisMode: request.axisMode,
        axisModeStrategy: request.axisModeStrategy,
        currentPointerCssX: request.currentPointerCssX,
        currentPointerCssY: request.currentPointerCssY,
        plotRect: request.plotRect,
        startPointerCssX: request.startPointerCssX,
        startPointerCssY: request.startPointerCssY,
      });

      if (feedback !== null) {
        commands.setOverlays([
          {
            id: 'rectangle-zoom-preview',
            kind: 'rectangle-zoom',
            plotId: feedback.plotId,
            rect: feedback,
          },
        ]);
      }

      const startedAt = request.startedAt ?? performance.now();
      const result = zoomFastScatterViewportToRectangle({
        axisMode: request.axisMode,
        axisModeStrategy: request.axisModeStrategy,
        currentPointerCssX: request.currentPointerCssX,
        currentPointerCssY: request.currentPointerCssY,
        plotRect: request.plotRect,
        startPointerCssX: request.startPointerCssX,
        startPointerCssY: request.startPointerCssY,
        viewport: optionsState.viewport,
      });

      if (result === null) {
        return null;
      }

      commands.setViewport(result.viewport, 'rectangle-zoom');
      emitMetrics({
        at: performance.now(),
        detail: JSON.stringify({
          axisMode: resolveFastScatterRectangleZoomEffectiveAxisMode(request),
          operation: 'rectangle-zoom',
          plotId: result.plotId,
          rectHeight: result.zoomRect.heightCssPx,
          rectWidth: result.zoomRect.widthCssPx,
        }),
        durationMs: performance.now() - startedAt,
        phase: 'interaction',
      });
      return result;
    },
    zoomAtPointer(request) {
      if (disposed) {
        return null;
      }
      const startedAt = performance.now();
      const result = zoomFastScatterViewportAtPointer({
        axisMode: request.axisMode,
        deltaMode: request.deltaMode,
        deltaY: request.deltaY,
        plotRects: getCurrentPlotRects(),
        pointerCssX: request.pointerCssX,
        pointerCssY: request.pointerCssY,
        viewport: optionsState.viewport,
      });

      if (result === null) {
        return null;
      }

      commands.setViewport(result.viewport, 'wheel', request.phase ?? 'commit');
      emitMetrics({
        at: performance.now(),
        detail: JSON.stringify({
          axisMode: request.axisMode,
          browserDeltaX: request.deltaX ?? 0,
          browserDeltaY: request.deltaY,
          effectiveDeltaY: request.deltaY,
          operation: 'wheel-zoom',
          plotId: result.plotId,
          scale: result.scale,
        }),
        durationMs: performance.now() - startedAt,
        phase: 'interaction',
      });
      return result;
    },
  };

  function commitSelection({
    durationMs,
    kind,
    metricDetail,
    operation,
    plotId,
    rawSourceIndices,
    selectionFilter,
    tool,
  }: {
    durationMs: number;
    kind: 'append' | 'replace';
    metricDetail?: Record<string, number | string>;
    operation: string;
    plotId: string;
    rawSourceIndices: Uint32Array;
    selectionFilter?: FastScatterSelectionFilter;
    tool: 'lasso' | 'programmatic' | 'rectangle';
  }) {
    const sourceIndices =
      kind === 'append'
        ? mergeFastScatterSelectionSourceIndices(
            optionsState.selectedSourceIndices ?? new Uint32Array(0),
            rawSourceIndices,
          )
        : rawSourceIndices;
    const selectionState = createFastScatterSelectionState(
      optionsState.columns,
      sourceIndices,
    );
    activeSelectionFilters =
      kind === 'append'
        ? selectionFilter === undefined
          ? activeSelectionFilters
          : [...activeSelectionFilters, selectionFilter]
        : selectionFilter === undefined
          ? []
          : [selectionFilter];
    optionsState = { ...optionsState, selectedSourceIndices: selectionState.sourceIndices };
    renderer?.update({ selectedSourceIndices: selectionState.sourceIndices });
    const event = {
      durationMs,
      filters: activeSelectionFilters,
      kind,
      plotId,
      sampleIds: selectionState.sampleIds,
      selectedCount: selectionState.selectedCount,
      sourceIndices: selectionState.sourceIndices,
      tool,
      viewport: optionsState.viewport,
    };
    optionsState.onSelectionChange?.(event);
    emitter.emit('selectionchange', event);
    emitMetrics({
      at: performance.now(),
      detail: JSON.stringify({
        candidateCount: rawSourceIndices.length,
        computeMs: durationMs,
        durationMs,
        mode: 'programmatic',
        operation,
        plotId,
        ...metricDetail,
        observableMs: metricDetail?.observableMs ?? durationMs,
        sampleIds: selectionState.sampleIds,
        selectedCount: selectionState.selectedCount,
        transferMs: metricDetail?.transferMs ?? 0,
      }),
      durationMs,
      phase: 'selection',
      selectedPointCount: selectionState.selectedCount,
    });
    return event;
  }

  function createRectangleSelectionFilter(request: {
    bounds: {
      x: FastScatterRange;
      y: FastScatterRange;
      yKey: string;
    };
    plotId: string;
  }): FastScatterSelectionFilter {
    const x = normalizeScatterRange(request.bounds.x);
    const y = normalizeScatterRange(request.bounds.y);
    const source = getAxisForColumn(request.bounds.yKey)?.source;
    return {
      dimensions: createScatterSelectionDimensions(request.bounds.yKey, x, y),
      parameterKey: request.bounds.yKey,
      plotId: request.plotId,
      ranges: {
        parameter: y,
        x,
        y,
      },
      shape: 'rectangle',
      ...(source === undefined ? {} : { source }),
      yKey: request.bounds.yKey,
    };
  }

  function createLassoSelectionFilter(request: {
    plotId: string;
    points: readonly FastScatterSelectionPoint[];
    yKey: string;
  }): FastScatterSelectionFilter {
    const bounds = getScatterSelectionPointBounds(request.points) ?? {
      x: { max: 0, min: 0 },
      y: { max: 0, min: 0 },
    };
    const x = normalizeScatterRange(bounds.x);
    const y = normalizeScatterRange(bounds.y);
    const source = getAxisForColumn(request.yKey)?.source;
    return {
      dimensions: createScatterSelectionDimensions(request.yKey, x, y),
      parameterKey: request.yKey,
      plotId: request.plotId,
      points: request.points.map((point) => ({ x: point.x, y: point.y })),
      ranges: {
        parameter: y,
        x,
        y,
      },
      shape: 'lasso',
      ...(source === undefined ? {} : { source }),
      yKey: request.yKey,
    };
  }

  function createScatterSelectionDimensions(
    yKey: string,
    x: FastScatterRange,
    y: FastScatterRange,
  ): readonly FastScatterSelectionDimension[] {
    return [
      createScatterSelectionDimension('x', getXAxisKey(), x, getXAxis()),
      createScatterSelectionDimension('y', yKey, y, getAxisForColumn(yKey)),
    ];
  }

  function createScatterSelectionDimension(
    axis: 'x' | 'y',
    parameterKey: string,
    range: FastScatterRange,
    axisMetadata: FastScatterPointAxisMetadata | undefined,
  ): FastScatterSelectionDimension {
    const valueType = axisMetadata?.kind ?? 'unknown';
    const values = getScatterSelectedCategoricalValues(axisMetadata, range);
    return {
      axis,
      parameterKey,
      range,
      ...(axisMetadata?.source === undefined ? {} : { source: axisMetadata.source }),
      valueType,
      ...(values === undefined ? {} : { values }),
    };
  }

  function getScatterSelectedCategoricalValues(
    axisMetadata: FastScatterPointAxisMetadata | undefined,
    range: FastScatterRange,
  ): FastScatterSelectionDimension['values'] | undefined {
    if (
      axisMetadata === undefined ||
      (axisMetadata.kind !== 'categorical' && axisMetadata.kind !== 'boolean') ||
      axisMetadata.categories === undefined
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
            ? coerceBooleanCategoryValue(category.value)
            : category.value,
      }));
  }

  function coerceBooleanCategoryValue(value: boolean | number | string): boolean | string {
    if (typeof value === 'boolean') {
      return value;
    }
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    return String(value);
  }

  function getScatterSelectionPointBounds(
    points: readonly FastScatterSelectionPoint[],
  ): { x: FastScatterRange; y: FastScatterRange } | null {
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
    return {
      x: { max: maxX, min: minX },
      y: { max: maxY, min: minY },
    };
  }

  function normalizeScatterRange(range: FastScatterRange): FastScatterRange {
    return {
      max: Math.max(range.min, range.max),
      min: Math.min(range.min, range.max),
    };
  }

  function lookupAggregateHoverAtPoint(
    pointerCssX: number,
    pointerCssY: number,
    source: 'measure' | 'shift-hover',
  ) {
    const visualizationMode = optionsState.visualizationMode ?? 'points';
    if (visualizationMode === 'points') {
      return null;
    }
    const aggregation = renderer?.getAggregation?.() ?? optionsState.aggregation ?? null;
    if (aggregation === null || aggregation.kind !== visualizationMode) {
      return null;
    }
    const plotRects = getCurrentPlotRects();
    const bubbleRadii =
      aggregation.kind === 'bubble'
        ? createBubbleRadiiLookup(
            aggregation,
            plotRects,
            optionsState.pointSizeScale ?? 1,
          )
        : null;
    const lookup = lookupFastScatterAggregateHit({
      aggregation,
      bubbleMaxRadiusCssPx: bubbleRadii?.maxRadiusCssPx,
      bubbleRadiusCssPx:
        bubbleRadii === null
          ? undefined
          : ({ aggregateIndex, plotId }) =>
              bubbleRadii.radiusByPlotId.get(plotId)?.[aggregateIndex] ?? 0,
      columns: optionsState.columns,
      plotRects,
      pointerCssX,
      pointerCssY,
      sampleSize: 5,
      viewport: optionsState.viewport,
    });
    if (lookup.hit === null) {
      return null;
    }
    const sourceIndex = resolveAggregateRepresentativeSourceIndex(aggregation, lookup.hit);
    if (sourceIndex === null) {
      return null;
    }
    const point = createFastScatterPointRef({
      columns: optionsState.columns,
      fallbackId: lookup.hit.sampleIds[0],
      plotId: lookup.hit.plotId,
      sourceIndex,
      x: lookup.hit.axis.x.center,
      y: lookup.hit.axis.y.center,
      yKey: lookup.hit.yKey,
    });
    return {
      aggregate: createAggregateSummary(lookup.hit),
      canvasPoint: lookup.hit.canvasPoint,
      candidateCount: lookup.hit.count,
      distancePx: lookup.hit.aggregateKind === 'bubble' ? lookup.hit.distancePx : 0,
      durationMs: lookup.diagnostics.durationMs,
      pinned: false,
      point,
      source,
      sourcePointIndex: sourceIndex,
    };
  }

  function createProgrammaticHoverEvent(sourceIndex: number): FastScatterHoverEvent | null {
    const normalized = normalizeHoverSourceIndex(sourceIndex, optionsState.columns.x.length);
    if (normalized === null) {
      return null;
    }

    const plot =
      optionsState.spec.plots.find((item) => item.id === activePlotId) ??
      optionsState.spec.plots.find((item) => item.id === optionsState.focusedPlotId) ??
      optionsState.spec.plots[0];
    if (plot === undefined) {
      return null;
    }

    const x = optionsState.columns.x[normalized];
    const y = optionsState.columns.y[plot.yKey]?.[normalized];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    const plotRect = getCurrentPlotRects().find((rect) => rect.id === plot.id);
    const yRange = optionsState.viewport.yByPlot[plot.id];
    if (plotRect === undefined || yRange === undefined) {
      return null;
    }

    return {
      canvasPoint: {
        canvasX: axisToPixel(
          x,
          optionsState.viewport.x,
          plotRect.xCssPx,
          plotRect.xCssPx + plotRect.widthCssPx,
        ),
        canvasY: axisToPixel(
          y,
          yRange,
          plotRect.yCssPx + plotRect.heightCssPx,
          plotRect.yCssPx,
        ),
      },
      candidateCount: 1,
      distancePx: 0,
      durationMs: 0,
      pinned: false,
      point: createFastScatterPointRef({
        columns: optionsState.columns,
        plotId: plot.id,
        sourceIndex: normalized,
        x,
        y,
        yKey: plot.yKey,
      }),
      source: 'programmatic',
      sourcePointIndex: normalized,
    };
  }

  function collectHeatmapAggregateSelectionInBounds({
    plotId,
    xBounds,
    yBounds,
  }: {
    plotId: string;
    xBounds: FastScatterRange;
    yBounds: FastScatterRange;
  }): { candidateCount: number; sourceIndices: Uint32Array } | null {
    const aggregation = renderer?.getAggregation?.() ?? optionsState.aggregation ?? null;
    if (aggregation?.kind !== 'heatmap') {
      return null;
    }
    const subplot = aggregation.subplots.find((candidate) => candidate.plotId === plotId);
    if (subplot === undefined) {
      return { candidateCount: 0, sourceIndices: new Uint32Array(0) };
    }
    const selected: Uint32Array[] = [];
    let selectedCount = 0;
    let candidateCount = 0;
    for (let cellIndex = 0; cellIndex < subplot.cellCount; cellIndex += 1) {
      if ((subplot.counts[cellIndex] ?? 0) === 0) {
        continue;
      }
      candidateCount += 1;
      const xBin = cellIndex % subplot.xBinCount;
      const yBin = Math.floor(cellIndex / subplot.xBinCount);
      const centerX = subplot.xRange.min + (xBin + 0.5) * subplot.xBinSize;
      const centerY = subplot.yRange.min + (yBin + 0.5) * subplot.yBinSize;
      if (
        centerX < xBounds.min ||
        centerX > xBounds.max ||
        centerY < yBounds.min ||
        centerY > yBounds.max
      ) {
        continue;
      }
      const membership = materializeFastScatterHeatmapCellSourceIndices(subplot, cellIndex);
      selected.push(membership);
      selectedCount += membership.length;
    }
    return {
      candidateCount,
      sourceIndices: normalizeSelectionSourceIndices(
        concatenateSourceIndexArrays(selected, selectedCount),
      ),
    };
  }

  function collectHeatmapAggregateSelectionInPolygon({
    plotId,
    points,
  }: {
    plotId: string;
    points: readonly FastScatterSelectionPoint[];
  }): { candidateCount: number; sourceIndices: Uint32Array } | null {
    const aggregation = renderer?.getAggregation?.() ?? optionsState.aggregation ?? null;
    if (aggregation?.kind !== 'heatmap') {
      return null;
    }
    const subplot = aggregation.subplots.find((candidate) => candidate.plotId === plotId);
    if (subplot === undefined || points.length < 3) {
      return { candidateCount: 0, sourceIndices: new Uint32Array(0) };
    }
    const selected: Uint32Array[] = [];
    let selectedCount = 0;
    let candidateCount = 0;
    for (let cellIndex = 0; cellIndex < subplot.cellCount; cellIndex += 1) {
      if ((subplot.counts[cellIndex] ?? 0) === 0) {
        continue;
      }
      candidateCount += 1;
      const xBin = cellIndex % subplot.xBinCount;
      const yBin = Math.floor(cellIndex / subplot.xBinCount);
      const center = {
        x: subplot.xRange.min + (xBin + 0.5) * subplot.xBinSize,
        y: subplot.yRange.min + (yBin + 0.5) * subplot.yBinSize,
      };
      if (!isFastScatterPointInPolygon(center, points)) {
        continue;
      }
      const membership = materializeFastScatterHeatmapCellSourceIndices(subplot, cellIndex);
      selected.push(membership);
      selectedCount += membership.length;
    }
    return {
      candidateCount,
      sourceIndices: normalizeSelectionSourceIndices(
        concatenateSourceIndexArrays(selected, selectedCount),
      ),
    };
  }

  function createAggregateSummary(hit: NonNullable<ReturnType<typeof lookupFastScatterAggregateHit>['hit']>) {
    const axisColumns = optionsState.columns as typeof optionsState.columns & {
      axisByColumn?: Readonly<Record<string, Parameters<typeof formatFastScatterAxisValue>[0]>>;
      xKey?: string;
    };
    const xAxis =
      axisColumns.xKey === undefined
        ? undefined
        : axisColumns.axisByColumn?.[axisColumns.xKey];
    const yAxis = axisColumns.axisByColumn?.[hit.yKey];
    return {
      axis: hit.axis,
      count: hit.count,
      kind: hit.aggregateKind,
      membership: hit.membership,
      sampleIds: hit.sampleIds,
      visual:
        hit.aggregateKind === 'bubble'
          ? {
              aggregateIndex: hit.aggregateIndex,
              kind: 'bubble' as const,
              radiusCssPx: hit.radiusCssPx,
            }
          : {
              cellIndex: hit.cellIndex,
              kind: 'heatmap' as const,
              xBin: hit.xBin,
              yBin: hit.yBin,
            },
      xLabel:
        hit.aggregateKind === 'heatmap'
          ? `${formatFastScatterAxisValue(xAxis, hit.axis.x.min)} - ${formatFastScatterAxisValue(xAxis, hit.axis.x.max)}`
          : formatFastScatterAxisValue(xAxis, hit.axis.x.center),
      yLabel:
        hit.aggregateKind === 'heatmap'
          ? `${formatFastScatterAxisValue(yAxis, hit.axis.y.min)} - ${formatFastScatterAxisValue(yAxis, hit.axis.y.max)}`
          : formatFastScatterAxisValue(yAxis, hit.axis.y.center),
    };
  }

  function resolveAggregateRepresentativeSourceIndex(
    aggregation: FastScatterAggregationSet,
    hit: NonNullable<ReturnType<typeof lookupFastScatterAggregateHit>['hit']>,
  ): number | null {
    const preferredSourceIndex = hit.membership.minSourceIndex;
    if (
      preferredSourceIndex != null &&
      Number.isSafeInteger(preferredSourceIndex) &&
      preferredSourceIndex >= 0
    ) {
      return preferredSourceIndex;
    }
    const subplot = aggregation.subplots.find((candidate) => candidate.plotId === hit.plotId);
    return subplot?.sourceIndices[hit.membership.offset] ?? null;
  }

  const instance: FastScatterPlotInstance = {
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
    update(partialOptions: Partial<FastScatterPlotOptions>) {
      if (disposed) {
        return;
      }
      const previousSelectedSourceIndices = optionsState.selectedSourceIndices;
      optionsState = {
        ...optionsState,
        ...partialOptions,
      };
      if (partialOptions.columns !== undefined || partialOptions.spec !== undefined) {
        dataDomain = calculateFastScatterDomain(optionsState.columns, optionsState.spec);
      }
      if (
        partialOptions.selectedSourceIndices !== undefined &&
        !areSourceIndexArraysEqual(
          previousSelectedSourceIndices,
          partialOptions.selectedSourceIndices,
        )
      ) {
        activeSelectionFilters = [];
      }
      if (partialOptions.hoverSourceIndex !== undefined) {
        const normalized = normalizeHoverSourceIndex(
          partialOptions.hoverSourceIndex,
          optionsState.columns.x.length,
        );
	        if (normalized === null) {
	          activeHover = null;
	          activeHoverEvent = null;
	          activeHoverSource = null;
	          updateHoverOverlays(null);
	        } else {
	          activeHover = normalized;
	          activeHoverEvent = null;
	          activeHoverSource = 'programmatic';
	        }
        optionsState = { ...optionsState, hoverSourceIndex: normalized };
      }
      renderer?.update(buildRendererUpdateOptions(partialOptions, buildRendererOptions()));
      if (
        partialOptions.viewport !== undefined ||
        partialOptions.columns !== undefined ||
        partialOptions.focusedPlotId !== undefined ||
        partialOptions.spec !== undefined
      ) {
        if (partialOptions.columns !== undefined) {
          pointIndexBySourceIndex = null;
        }
        refreshNavigatorOverlay();
        refreshPointMarkerOverlays();
      }
    },
    use(binding: FastScatterBinding) {
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
    refreshNavigatorOverlay();
  } catch (error) {
    handleSetupError(error, backend.setupErrorMessage ?? 'Unknown scatter renderer setup error.');
  }

  return instance;

  function replaceOverlayKinds(
    kinds: readonly FastScatterOverlayKind[],
    nextOverlays: readonly FastScatterOverlayDescriptor[],
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
    emitter.emit('overlaychange', { overlays, reason });
  }

  function refreshNavigatorOverlay(): void {
    if (disposed) {
      return;
    }
    const layout = getCurrentLayout();
    const navigatorRect = layout.navigatorRect;
    if (navigatorRect === null) {
      replaceOverlayKinds(['navigator'], [], 'clear');
      return;
    }
    const domain = dataDomain.x;
    const windowPixels = calculateFastScatterNavigatorWindowPixels(
      optionsState.viewport.x,
      domain,
      navigatorRect.widthCssPx,
    );
    replaceOverlayKinds(
      ['navigator'],
      [
        {
          domain,
          id: 'x-navigator',
          kind: 'navigator',
          rect: {
            heightCssPx: navigatorRect.heightCssPx,
            widthCssPx: navigatorRect.widthCssPx,
            xCssPx: navigatorRect.xCssPx,
            yCssPx: navigatorRect.yCssPx,
          },
          viewportRect: {
            heightCssPx: Math.max(1, navigatorRect.heightCssPx - 8),
            widthCssPx: windowPixels.widthCssPx,
            xCssPx: navigatorRect.xCssPx + windowPixels.leftCssPx,
            yCssPx: navigatorRect.yCssPx + 4,
          },
          window: optionsState.viewport.x,
          windowLabel: {
            max: formatFastScatterAxisValue(getXAxis(), optionsState.viewport.x.max),
            min: formatFastScatterAxisValue(getXAxis(), optionsState.viewport.x.min),
          },
        },
      ],
    );
  }

  function refreshPointMarkerOverlays(): void {
    if (disposed) {
      return;
    }
    if (pointMarkerSourceIndices.length === 0) {
      replaceOverlayKinds(['point-marker'], [], 'clear');
      return;
    }

    const layout = getCurrentLayout();
    const markerOverlays: FastScatterOverlayDescriptor[] = [];

    for (const sourceIndex of pointMarkerSourceIndices) {
      const pointIndex = resolvePointIndexForSourceIndex(sourceIndex);
      if (pointIndex === null) {
        continue;
      }
      const x = optionsState.columns.x[pointIndex];
      if (typeof x !== 'number' || !Number.isFinite(x)) {
        continue;
      }

      for (const plot of optionsState.spec.plots) {
        const plotRect = layout.plotRects.find((rect) => rect.id === plot.id);
        const yRange = optionsState.viewport.yByPlot[plot.id];
        const y = optionsState.columns.y[plot.yKey]?.[pointIndex];

        if (
          plotRect === undefined ||
          yRange === undefined ||
          typeof y !== 'number' ||
          !Number.isFinite(y)
        ) {
          continue;
        }

        const xCssPx = axisToPixel(
          x,
          optionsState.viewport.x,
          plotRect.xCssPx,
          plotRect.xCssPx + plotRect.widthCssPx,
        );
        const yCssPx = axisToPixel(
          y,
          yRange,
          plotRect.yCssPx + plotRect.heightCssPx,
          plotRect.yCssPx,
        );
        const visualCenterOffset = getPointVisualCenterOffsetCssPx(pointIndex);
        const visualCenterXCssPx = xCssPx + visualCenterOffset.xCssPx;
        const visualCenterYCssPx = yCssPx + visualCenterOffset.yCssPx;
        const label = formatFastScatterColumnValueForDisplay({
          axis: getAxisForColumn(plot.yKey),
          encodedValue: y,
          sourceIndex: pointIndex,
        }).label;

        markerOverlays.push({
          id: `point-marker:${sourceIndex}:${plot.id}`,
          kind: 'point-marker',
          label,
          line: {
            xCssPx: visualCenterXCssPx,
            y1CssPx: plotRect.yCssPx,
            y2CssPx: plotRect.yCssPx + plotRect.heightCssPx,
          },
          plotId: plot.id,
          point: {
            xCssPx: visualCenterXCssPx,
            yCssPx: visualCenterYCssPx,
          },
          sourceIndex,
          yKey: plot.yKey,
          zIndex: 3,
        });
      }
    }

    replaceOverlayKinds(['point-marker'], markerOverlays);
  }

  function resolvePointIndexForSourceIndex(sourceIndex: number): number | null {
    if (!isValidSourceIndex(sourceIndex, optionsState.columns.x.length)) {
      return null;
    }

    const sourceIndexColumn = optionsState.columns.sourceIndex;
    if (sourceIndexColumn === undefined) {
      return sourceIndex;
    }

    if (sourceIndexColumn[sourceIndex] === sourceIndex) {
      return sourceIndex;
    }

    if (pointIndexBySourceIndex === null) {
      const nextMap = new Map<number, number>();
      for (let pointIndex = 0; pointIndex < sourceIndexColumn.length; pointIndex += 1) {
        const mappedSourceIndex = sourceIndexColumn[pointIndex];
        if (mappedSourceIndex !== undefined && !nextMap.has(mappedSourceIndex)) {
          nextMap.set(mappedSourceIndex, pointIndex);
        }
      }
      pointIndexBySourceIndex = nextMap;
    }

    return pointIndexBySourceIndex.get(sourceIndex) ?? null;
  }

  function getPointVisualCenterOffsetCssPx(pointIndex: number): {
    xCssPx: number;
    yCssPx: number;
  } {
    const shape = optionsState.columns.shape?.[pointIndex] ?? FAST_SCATTER_SHAPE_CODES.circle;
    const localCenterY =
      shape === FAST_SCATTER_SHAPE_CODES.pin
        ? PIN_GLYPH_VISUAL_CENTER_LOCAL_Y
        : shape === FAST_SCATTER_SHAPE_CODES.triangle
          ? TRIANGLE_GLYPH_VISUAL_CENTER_LOCAL_Y
          : 0;
    if (localCenterY === 0) {
      return { xCssPx: 0, yCssPx: 0 };
    }

    const rotation = optionsState.columns.rotation?.[pointIndex] ?? 0;
    const size =
      optionsState.columns.size?.[pointIndex] ?? DEFAULT_POINT_MARKER_SIZE_CSS_PX;
    const pointSizeScale = optionsState.pointSizeScale ?? 1;
    if (
      !Number.isFinite(rotation) ||
      !Number.isFinite(size) ||
      size <= 0 ||
      !Number.isFinite(pointSizeScale) ||
      pointSizeScale <= 0
    ) {
      return { xCssPx: 0, yCssPx: 0 };
    }

    const visualCenterLocalY = localCenterY * size * pointSizeScale;
    return {
      xCssPx: -Math.sin(rotation) * visualCenterLocalY,
      yCssPx: -Math.cos(rotation) * visualCenterLocalY,
    };
  }

  function commitHover(
    hover: ReturnType<FastScatterPlotCommands['hoverAtPoint']>,
    pointerCssX?: number,
    pointerCssY?: number,
    reason: 'binding' | 'command' | 'pointer' | 'programmatic' = 'command',
  ): void {
    if (disposed) {
      return;
    }
    const nextHoverSourceIndex = normalizeHoverSourceIndex(
      hover?.point.sourceIndex ?? null,
      optionsState.columns.x.length,
    );
    const nextHoverSource = hover?.source ?? null;
	    const changed =
	      !areScatterHoverEventsEquivalent(activeHoverEvent, hover) ||
	      activeHover !== nextHoverSourceIndex ||
	      activeHoverSource !== nextHoverSource;
    activeHover = nextHoverSourceIndex;
    activeHoverEvent = hover;
    activeHoverSource = nextHoverSource;
    optionsState = { ...optionsState, hoverSourceIndex: nextHoverSourceIndex };
    renderer?.update({ hoverSourceIndex: nextHoverSourceIndex });

    if (
      hover === null ||
      pointerCssX === undefined ||
      pointerCssY === undefined
    ) {
      updateHoverOverlays(null);
    } else {
      updateHoverOverlays(hover, pointerCssX, pointerCssY);
      commands.setActivePlot(hover.point.plotId, reason);
    }

    if (!changed) {
      return;
    }
    optionsState.onHoverChange?.(hover);
    emitter.emit('hoverchange', hover);
  }

  function getXAxis(): Parameters<typeof formatFastScatterAxisValue>[0] {
    const axisColumns = optionsState.columns as typeof optionsState.columns & {
      axisByColumn?: Readonly<Record<string, Parameters<typeof formatFastScatterAxisValue>[0]>>;
      xKey?: string;
    };
    return axisColumns.xKey === undefined
      ? undefined
      : axisColumns.axisByColumn?.[axisColumns.xKey];
  }

  function getXAxisKey(): string {
    return (
      optionsState.columns as FastScatterControllerOptions['columns'] & {
        xKey?: string;
      }
    ).xKey ?? 'x';
  }

  function getAxisForColumn(columnKey: string): Parameters<typeof formatFastScatterAxisValue>[0] {
    const axisColumns = optionsState.columns as typeof optionsState.columns & {
      axisByColumn?: Readonly<Record<string, Parameters<typeof formatFastScatterAxisValue>[0]>>;
    };
    return axisColumns.axisByColumn?.[columnKey];
  }

  function updateHoverOverlays(
    hover: ReturnType<FastScatterPlotCommands['hoverAtPoint']>,
    pointerCssX?: number,
    pointerCssY?: number,
  ): void {
    if (hover === null || pointerCssX === undefined || pointerCssY === undefined) {
      replaceOverlayKinds(['hover-guide', 'cursor-tooltip'], [], 'clear');
      return;
    }
    replaceOverlayKinds(
      ['hover-guide', 'cursor-tooltip'],
      [
        {
          anchor: {
            xCssPx: hover.canvasPoint.canvasX,
            yCssPx: hover.canvasPoint.canvasY,
          },
          id: 'hover-guide',
          kind: 'hover-guide',
          plotId: hover.point.plotId,
          sourceIndex: hover.point.sourceIndex,
        },
        {
          anchor: {
            xCssPx: pointerCssX,
            yCssPx: pointerCssY,
          },
          id: 'cursor-tooltip',
          kind: 'cursor-tooltip',
          plotId: hover.point.plotId,
          sourceIndex: hover.point.sourceIndex,
        },
      ],
    );
  }

  function updateMeasurementOverlay(measurement: FastScatterMeasurementEvent | null): void {
    if (
      measurement === null ||
      measurement.current?.canvasPoint === undefined ||
      measurement.reference.canvasPoint === undefined
    ) {
      replaceOverlayKinds(['measurement-guide'], [], 'clear');
      return;
    }
    replaceOverlayKinds(
      ['measurement-guide'],
      [
        {
          current: {
            xCssPx: measurement.current.canvasPoint.canvasX,
            yCssPx: measurement.current.canvasPoint.canvasY,
          },
          id: 'measurement-guide',
          kind: 'measurement-guide',
          plotId: measurement.reference.plotId,
          reference: {
            xCssPx: measurement.reference.canvasPoint.canvasX,
            yCssPx: measurement.reference.canvasPoint.canvasY,
          },
        },
      ],
    );
  }
}

function normalizeHoverSourceIndex(sourceIndex: number | null, pointCount: number): number | null {
  if (sourceIndex === null) {
    return null;
  }

  const normalized = Math.floor(sourceIndex);
  return Number.isSafeInteger(normalized) && normalized >= 0 && normalized < pointCount
    ? normalized
    : null;
}

type ScatterHoverEventSnapshot = ReturnType<FastScatterPlotCommands['hoverAtPoint']>;

function areScatterHoverEventsEquivalent(
  previous: ScatterHoverEventSnapshot,
  next: ScatterHoverEventSnapshot,
): boolean {
  if (previous === next) {
    return true;
  }

  if (previous === null || next === null) {
    return false;
  }

  return (
    previous.point.sourceIndex === next.point.sourceIndex &&
    previous.point.plotId === next.point.plotId &&
    previous.point.yKey === next.point.yKey &&
    previous.source === next.source &&
    previous.aggregate?.kind === next.aggregate?.kind &&
    previous.aggregate?.count === next.aggregate?.count &&
    getAggregateVisualIdentity(previous.aggregate) === getAggregateVisualIdentity(next.aggregate)
  );
}

function getAggregateVisualIdentity(
  aggregate: NonNullable<ScatterHoverEventSnapshot>['aggregate'] | undefined,
): string {
  const visual = aggregate?.visual;
  if (visual === undefined) {
    return 'none';
  }

  return visual.kind === 'bubble'
    ? `bubble:${visual.aggregateIndex}`
    : `heatmap:${visual.cellIndex}:${visual.xBin}:${visual.yBin}`;
}

function createBubbleRadiiLookup(
  aggregation: FastScatterBubbleAggregationSet,
  plotRects: readonly FastScatterPlotRect[],
  pointSizeScale: number,
): {
  maxRadiusCssPx: number;
  radiusByPlotId: ReadonlyMap<string, Float32Array>;
} {
  const radiusByPlotId = new Map<string, Float32Array>();
  let maxRadiusCssPx = 0;
  const maxCount = getMaxBubbleCount(aggregation.subplots);

  for (const subplot of aggregation.subplots) {
    const plotRect = plotRects.find((candidate) => candidate.id === subplot.plotId);
    if (plotRect === undefined) {
      continue;
    }

    const radii = createFastScatterBubbleRadiusPx(
      subplot.counts,
      plotRect.widthCssPx,
      plotRect.heightCssPx,
      pointSizeScale,
      { maxCount },
    );
    radiusByPlotId.set(subplot.plotId, radii);

    for (let index = 0; index < radii.length; index += 1) {
      const radius = radii[index] ?? 0;
      if (Number.isFinite(radius) && radius > maxRadiusCssPx) {
        maxRadiusCssPx = radius;
      }
    }
  }

  return { maxRadiusCssPx, radiusByPlotId };
}

function concatenateSourceIndexArrays(
  arrays: readonly Uint32Array[],
  totalLength: number,
): Uint32Array {
  const result = new Uint32Array(totalLength);
  let offset = 0;
  for (const values of arrays) {
    result.set(values, offset);
    offset += values.length;
  }
  return result;
}

function getMaxBubbleCount(
  subplots: readonly FastScatterBubbleAggregationSet['subplots'][number][],
): number {
  let maxCount = 0;
  for (const subplot of subplots) {
    for (let index = 0; index < subplot.counts.length; index += 1) {
      maxCount = Math.max(maxCount, subplot.counts[index] ?? 0);
    }
  }
  return maxCount;
}

function buildRendererUpdateOptions(
  partialOptions: Partial<FastScatterPlotOptions>,
  rendererOptions: FastScatterRendererOptions,
): Partial<FastScatterControllerOptions> {
  const controllerOptions = { ...partialOptions };
  delete controllerOptions.canvasClassName;
  delete controllerOptions.canvasLabel;
  delete controllerOptions.forceWebglUnavailable;
  delete controllerOptions.hostClassName;
  delete controllerOptions.navigatorCssPx;
  delete controllerOptions.overlayClassName;
  delete controllerOptions.preserveDrawingBuffer;
  delete controllerOptions.rendererFactory;
  return {
    ...controllerOptions,
    onHoverChange: rendererOptions.onHoverChange,
    onMeasurementChange: rendererOptions.onMeasurementChange,
    onMetrics: rendererOptions.onMetrics,
    onSelectionChange: rendererOptions.onSelectionChange,
    onViewportChange: rendererOptions.onViewportChange,
  };
}

function normalizeDisposable(
  disposable: Disposable | (() => void) | void,
): Disposable {
  if (!disposable) {
    return toDisposable(() => {});
  }
  return typeof disposable === 'function' ? toDisposable(disposable) : disposable;
}

function splitClassNames(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}

function areSourceIndexArraysEqual(
  first: Uint32Array | readonly number[] | undefined,
  second: Uint32Array | readonly number[] | undefined,
): boolean {
  if (first === second) {
    return true;
  }
  if (first === undefined || second === undefined) {
    return false;
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

function isValidSourceIndex(sourceIndex: number, pointCount: number): boolean {
  if (
    !Number.isSafeInteger(sourceIndex) ||
    sourceIndex < 0 ||
    sourceIndex >= pointCount
  ) {
    return false;
  }
  return true;
}
