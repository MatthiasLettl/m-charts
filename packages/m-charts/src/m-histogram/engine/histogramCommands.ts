import type {
  HistogramAggregationSet,
  HistogramAxisMode,
  HistogramBinDescriptor,
  HistogramBinHit,
  HistogramBinSizeState,
  HistogramDragPanResult,
  HistogramHoverEvent,
  HistogramMeasurementEvent,
  HistogramPixelBounds,
  HistogramPlotRect,
  HistogramPoint,
  HistogramRectangleZoomAxisModeStrategy,
  HistogramRectangleZoomResult,
  HistogramRendererRenderMetrics,
  HistogramSelectionResult,
  HistogramSelectionEvent,
  HistogramSelectionKind,
  HistogramViewport,
  HistogramViewportChangePhase,
  HistogramViewportChangeReason,
  HistogramWheelZoomResult,
} from '../core/index.js';
import type { HistogramOverlayDescriptor, HistogramOverlayKind } from './histogramOverlays.js';
import type {
  HistogramBrushEvent,
  HistogramBinSizeAdjustRequestEvent,
  HistogramViewportUndoRequestEvent,
} from './histogramEvents.js';
import type { HistogramCursorState, HistogramRenderSnapshot, HistogramStateSnapshot } from './histogramState.js';

export interface HistogramPlotCommands {
  clearHover(reason?: 'binding' | 'command' | 'pointer' | 'programmatic'): void;
  clearOverlays(kind?: HistogramOverlayKind): void;
  clearSelection(kind?: HistogramSelectionKind): HistogramSelectionEvent | null;
  getBinAtPoint(pointerCssX: number, pointerCssY: number): HistogramBinHit | null;
  getCanvas(): HTMLCanvasElement;
  getHostElement(): HTMLElement;
  getOverlayElement(): HTMLDivElement;
  getOverlays(): readonly HistogramOverlayDescriptor[];
  getPlotRectAtPoint(pointerCssX: number, pointerCssY: number): HistogramPlotRect | null;
  getRenderSnapshot(): HistogramRenderSnapshot;
  getStateSnapshot(): HistogramStateSnapshot;
  emitBrushEvent(event: HistogramBrushEvent): void;
  hoverAtPoint(request: {
    pinned?: boolean;
    pointerCssX: number;
    pointerCssY: number;
    source: Exclude<HistogramHoverEvent['source'], 'programmatic'>;
  }): HistogramHoverEvent | null;
  panFromDrag(request: {
    axisMode?: HistogramAxisMode;
    currentPointerCssX: number;
    currentPointerCssY: number;
    startPointerCssX: number;
    startPointerCssY: number;
    startViewport: HistogramViewport;
    subplotId: string;
    updateCount?: number;
  }): HistogramDragPanResult | null;
  materializeSelectionSourceIndices(): HistogramSelectionEvent | null;
  materializeVisibleMembership(): HistogramAggregationSet | null;
  queryBinsInLasso(request: {
    points: readonly HistogramPoint[];
    subplotId?: string;
  }): HistogramSelectionResult | null;
  queryBinsInRectangle(request: {
    bounds: HistogramPixelBounds;
    subplotId?: string;
  }): HistogramSelectionResult | null;
  render(): HistogramRendererRenderMetrics | null;
  requestBinSizeAdjust(request: {
    binSize?: HistogramBinSizeAdjustRequestEvent['binSize'];
    delta: number;
    source?: HistogramBinSizeAdjustRequestEvent['source'];
    subplotId?: string;
  }): void;
  requestViewportUndo(source?: HistogramViewportUndoRequestEvent['source']): void;
  resize(): void;
  selectBins(request: {
    binDescriptors?: readonly HistogramBinDescriptor[];
    binIndices?: readonly number[];
    kind?: HistogramSelectionKind;
    sourceIndices?: Uint32Array | readonly number[];
    subplotId?: string;
  }): HistogramSelectionEvent | null;
  selectLasso(request: {
    kind?: HistogramSelectionKind;
    points: readonly HistogramPoint[];
    subplotId?: string;
  }): HistogramSelectionEvent | null;
  selectRectangle(request: {
    bounds: HistogramPixelBounds;
    kind?: HistogramSelectionKind;
    subplotId?: string;
  }): HistogramSelectionEvent | null;
  setBinSizes(request: {
    binSizes: readonly HistogramBinSizeState[];
    materializeMembership?: boolean;
  }): HistogramAggregationSet | null;
  setActivePlot(
    plotId: string | null,
    reason?: 'binding' | 'command' | 'pointer' | 'programmatic',
  ): void;
  setCursorState(
    cursor: HistogramCursorState,
    reason?: 'binding' | 'command' | 'pointer' | 'programmatic',
  ): void;
  setMeasurement(measurement: HistogramMeasurementEvent | null): void;
  setOverlays(
    overlays: readonly HistogramOverlayDescriptor[],
    reason?: 'replace' | 'set',
  ): void;
  setViewport(
    viewport: HistogramViewport,
    reason?: HistogramViewportChangeReason,
    phase?: HistogramViewportChangePhase,
  ): void;
  zoomAtPointer(request: {
    axisMode?: HistogramAxisMode;
    deltaMode: number;
    deltaY: number;
    pointerCssX: number;
    pointerCssY: number;
  }): HistogramWheelZoomResult | null;
  zoomToRectangle(request: {
    axisMode?: HistogramAxisMode;
    axisModeStrategy?: HistogramRectangleZoomAxisModeStrategy;
    currentPointerCssX: number;
    currentPointerCssY: number;
    plotRect: HistogramPlotRect;
    startPointerCssX: number;
    startPointerCssY: number;
    startedAt?: number;
  }): HistogramRectangleZoomResult | null;
}
