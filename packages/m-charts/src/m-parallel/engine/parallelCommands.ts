import type { InputModifiers } from '../../plot-engine/core/index.js';
import type {
  ParallelBrushIntervals,
  ParallelAxisViewports,
  ParallelParameter,
  ParallelWebgl2HoverDrawMetrics,
  ParallelWebgl2HoverUpdateMetrics,
  ParallelWebgl2RendererDrawMetrics,
} from '../core/index.js';
import type { ParallelFastTheme } from '../core/webglSegmentRenderer.js';
import type {
  ParallelFastHoverVisualState,
  ParallelFastInspectionState,
} from './types.js';
import type { ParallelFastRenderSnapshot, ParallelFastStateSnapshot } from './parallelState.js';
import type {
  ParallelFastBrushChangeReason,
  ParallelFastBrushEvent,
  ParallelFastInteractionSource,
  ParallelFastInspectionLookupSource,
  ParallelFastLineOpacityAdjustment,
} from './parallelEvents.js';
import type {
  ParallelFastOverlayDescriptor,
  ParallelFastOverlayKind,
} from './parallelOverlays.js';

export interface ParallelFastBrushCommandOptions {
  modifiers?: InputModifiers;
  reason?: ParallelFastBrushChangeReason;
  source?: ParallelFastInteractionSource;
}

export interface ParallelFastInspectionCommandOptions {
  lookupSource?: ParallelFastInspectionLookupSource;
  resolveMs?: number | null;
  source?: ParallelFastInteractionSource;
}

export interface ParallelFastLineOpacityAdjustCommandOptions {
  source?: ParallelFastInteractionSource;
}

export interface ParallelFastSelectionCommandOptions {
  source?: ParallelFastInteractionSource;
}

export interface ParallelFastAxisViewportCommandOptions {
  phase?: 'preview' | 'commit';
  reason?: 'pan' | 'reset' | 'set' | 'undo' | 'zoom';
  source?: ParallelFastInteractionSource;
}

export interface ParallelFastPlotCommands {
  getCanvas(): HTMLCanvasElement;
  getHoverCanvas(): HTMLCanvasElement;
  getHostElement(): HTMLElement;
  getOverlays(): readonly ParallelFastOverlayDescriptor[];
  getRenderSnapshot(): ParallelFastRenderSnapshot;
  getStateSnapshot(): ParallelFastStateSnapshot;
  clearBrushes(options?: ParallelFastBrushCommandOptions): void;
  resetAxisViewports(options?: ParallelFastAxisViewportCommandOptions): void;
  undoAxisViewport(options?: ParallelFastAxisViewportCommandOptions): void;
  clearInspection(options?: ParallelFastInspectionCommandOptions): void;
  clearOverlays(kind?: ParallelFastOverlayKind): void;
  commitBrushIntervals(
    brushIntervals: ParallelBrushIntervals,
    options?: ParallelFastBrushCommandOptions,
  ): void;
  drawHover(): ParallelWebgl2HoverDrawMetrics | null;
  emitBrushEvent(event: ParallelFastBrushEvent): void;
  previewBrushIntervals(
    brushIntervals: ParallelBrushIntervals,
    options?: ParallelFastBrushCommandOptions,
  ): void;
  render(): void;
  requestLineOpacityAdjustment(
    adjustment: ParallelFastLineOpacityAdjustment,
    options?: ParallelFastLineOpacityAdjustCommandOptions,
  ): void;
  removeBrushInterval(
    axis: ParallelParameter,
    axisRangeIndex: number,
    options?: ParallelFastBrushCommandOptions,
  ): void;
  resolveInspectionAtPoint(query: {
    axisPosition: number;
    maxDistancePx: number;
    normalizedValue: number;
    plotHeightPx: number;
    plotWidthPx: number;
  }): Promise<import('../core/index.js').ParallelNearestRecordResult | null> | null;
  resize(): void;
  setHoverSourceIndex(sourceIndex: number | null): ParallelWebgl2HoverUpdateMetrics | null;
  setHoverState(state: ParallelFastHoverVisualState): ParallelWebgl2HoverUpdateMetrics | null;
  setInspection(
    inspection: ParallelFastInspectionState | null,
    options?: ParallelFastInspectionCommandOptions,
  ): void;
  setOverlays(
    overlays: readonly ParallelFastOverlayDescriptor[],
    reason?: 'replace' | 'set',
  ): void;
  setPreselectedSourceIndices(sourceIndices: Uint32Array): void;
  setAxisViewports(
    axisViewports: ParallelAxisViewports,
    options?: ParallelFastAxisViewportCommandOptions,
  ): void;
  setSelectedSourceIndices(
    sourceIndices: Uint32Array,
    options?: ParallelFastSelectionCommandOptions,
  ): void;
  updateLineOpacityScale(lineOpacityScale: number): ParallelWebgl2RendererDrawMetrics | null;
  updateTheme(theme: ParallelFastTheme | undefined): {
    base: ParallelWebgl2RendererDrawMetrics | null;
    hover: ParallelWebgl2HoverDrawMetrics | null;
  };
}
