import type {
  FastScatterAggregationSet,
  FastScatterAxisMode,
  FastScatterDragPanResult,
  FastScatterEasterEggPlaybackOptions,
  FastScatterHoverEvent,
  FastScatterMeasurementEvent,
  FastScatterPlotRect,
  FastScatterRange,
  FastScatterRectangleZoomAxisModeStrategy,
  FastScatterRectangleZoomResult,
  FastScatterSelectionEvent,
  FastScatterSelectionKind,
  FastScatterSelectionPoint,
  FastScatterHeatmapPalette,
  FastScatterViewport,
  FastScatterViewportChangeReason,
  FastScatterViewportChangePhase,
  FastScatterVisualizationMode,
  FastScatterWheelZoomResult,
} from '../core/index.js';
import type { FastScatterOverlayDescriptor, FastScatterOverlayKind } from './scatterOverlays.js';
import type { FastScatterBrushEvent } from './scatterEvents.js';
import type {
  FastScatterCursorState,
  FastScatterRenderSnapshot,
  FastScatterStateSnapshot,
} from './scatterState.js';

export interface FastScatterPlotCommands {
  clearHover(reason?: 'binding' | 'command' | 'pointer' | 'programmatic'): void;
  clearPointMarkers(): void;
  clearSelection(kind?: FastScatterSelectionKind): FastScatterSelectionEvent | null;
  clearOverlays(kind?: FastScatterOverlayKind): void;
  getAggregation(): FastScatterAggregationSet | null;
  getCanvas(): HTMLCanvasElement;
  getHostElement(): HTMLElement;
  getOverlayElement(): HTMLDivElement;
  getOverlays(): readonly FastScatterOverlayDescriptor[];
  getPlotRectAtPoint(pointerCssX: number, pointerCssY: number): FastScatterPlotRect | null;
  getPlotXKey(): string | null;
  getPlotYKey(plotId: string): string | null;
  getNavigatorRect(): FastScatterPlotRect | null;
  getNavigatorWindowPixels(widthCssPx: number): { leftCssPx: number; widthCssPx: number };
  getRenderSnapshot(): FastScatterRenderSnapshot;
  getStateSnapshot(): FastScatterStateSnapshot;
  emitBrushEvent(event: FastScatterBrushEvent): void;
  playEasterEgg(options?: FastScatterEasterEggPlaybackOptions): boolean;
  render(): void;
  requestHeatmapBinSizeAdjust(request: {
    delta: number;
    heatmapBinSizePx?: number;
    palette?: FastScatterHeatmapPalette;
    source?: 'command' | 'keyboard' | 'wheel';
  }): void;
  requestPointSizeAdjust(request: {
    delta: number;
    mode?: FastScatterVisualizationMode;
    pointSizeScale?: number;
    source?: 'command' | 'keyboard' | 'wheel';
  }): void;
  requestViewportUndo(source?: 'command' | 'keyboard' | 'pointer'): void;
  resize(): void;
  setActivePlot(
    plotId: string | null,
    reason?: 'binding' | 'command' | 'pointer' | 'programmatic',
  ): void;
  setCursorState(
    cursor: FastScatterCursorState,
    reason?: 'binding' | 'command' | 'pointer' | 'programmatic',
  ): void;
  setHoverSourceIndex(sourceIndex: number | null): void;
  setOverlays(
    overlays: readonly FastScatterOverlayDescriptor[],
    reason?: 'replace' | 'set',
  ): void;
  togglePointMarker(request: { sourceIndex: number }): boolean;
  setViewport(
    viewport: FastScatterViewport,
    reason?: FastScatterViewportChangeReason,
    phase?: FastScatterViewportChangePhase,
  ): void;
  panFromDrag(request: {
    axisMode: FastScatterAxisMode;
    currentPointerCssX: number;
    currentPointerCssY: number;
    plotId: string;
    startPointerCssX: number;
    startPointerCssY: number;
    startViewport: FastScatterViewport;
    updateCount?: number;
  }): FastScatterDragPanResult | null;
  hoverAtPoint(request: {
    pointerCssX: number;
    pointerCssY: number;
    source: Exclude<FastScatterHoverEvent['source'], 'programmatic'>;
  }): FastScatterHoverEvent | null;
  dragNavigator(request: {
    currentPointerCssX: number;
    edge: 'max' | 'min' | null;
    startPointerCssX: number;
    startWindow: FastScatterRange;
    updateCount?: number;
    widthCssPx: number;
  }): FastScatterRange | null;
  setMeasurement(measurement: FastScatterMeasurementEvent | null): void;
  selectLasso(request: {
    kind?: FastScatterSelectionKind;
    pixelPoints?: readonly { xCssPx: number; yCssPx: number }[];
    plotId: string;
    points: readonly FastScatterSelectionPoint[];
    yKey: string;
  }): FastScatterSelectionEvent | null;
  selectRectangle(request: {
    bounds: {
      x: { max: number; min: number };
      y: { max: number; min: number };
      yKey: string;
    };
    kind?: FastScatterSelectionKind;
    plotId: string;
  }): FastScatterSelectionEvent | null;
  zoomToRectangle(request: {
    axisMode: FastScatterAxisMode;
    axisModeStrategy?: FastScatterRectangleZoomAxisModeStrategy;
    currentPointerCssX: number;
    currentPointerCssY: number;
    plotRect: FastScatterPlotRect;
    startPointerCssX: number;
    startPointerCssY: number;
    startedAt?: number;
  }): FastScatterRectangleZoomResult | null;
  zoomAtPointer(request: {
    axisMode: FastScatterAxisMode;
    deltaMode: number;
    deltaX?: number;
    deltaY: number;
    pointerCssX: number;
    pointerCssY: number;
    phase?: FastScatterViewportChangePhase;
  }): FastScatterWheelZoomResult | null;
}
