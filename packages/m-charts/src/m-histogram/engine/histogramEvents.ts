import type {
  BrushDefaultAction,
  BrushEventBase,
  BrushNumericRange,
} from '../../plot-engine/core/index.js';
import type {
  HistogramBinDescriptor,
  HistogramBinSizeState,
  HistogramHoverEvent,
  HistogramMeasurementEvent,
  HistogramMetricsEvent,
  HistogramSelectionEvent,
  HistogramViewport,
  HistogramViewportChangePhase,
  HistogramViewportChangeReason,
} from '../core/index.js';
import type { HistogramOverlayDescriptor } from './histogramOverlays.js';
import type { HistogramCursorState, HistogramRenderState } from './histogramState.js';

export interface HistogramRenderStateEvent {
  readonly message?: string;
  readonly state: HistogramRenderState;
}

export interface HistogramViewportChangeEvent {
  readonly phase: HistogramViewportChangePhase;
  readonly reason: HistogramViewportChangeReason;
  readonly viewport: HistogramViewport;
}

export interface HistogramActivePlotChangeEvent {
  readonly plotId: string | null;
  readonly previousPlotId: string | null;
  readonly reason: 'binding' | 'command' | 'pointer' | 'programmatic';
}

export interface HistogramCursorChangeEvent {
  readonly cursor: HistogramCursorState;
  readonly previousCursor: HistogramCursorState;
  readonly reason: 'binding' | 'command' | 'pointer' | 'programmatic';
}

export interface HistogramOverlayChangeEvent {
  readonly overlays: readonly HistogramOverlayDescriptor[];
  readonly reason: 'clear' | 'replace' | 'set';
}

export interface HistogramBinSizeAdjustRequestEvent {
  readonly binSize?: HistogramBinSizeState;
  readonly delta: number;
  readonly source: 'command' | 'keyboard' | 'wheel';
  readonly subplotId?: string;
}

export interface HistogramViewportUndoRequestEvent {
  readonly source: 'command' | 'keyboard' | 'pointer';
}

export type HistogramBrushDefaultAction = Extract<
  BrushDefaultAction,
  'none' | 'select' | 'zoom'
>;

export interface HistogramBrushTarget {
  readonly parameterKey: string;
  readonly subplotId: string;
}

export interface HistogramBrushRange {
  readonly bins?: readonly HistogramBinDescriptor[];
  readonly value?: BrushNumericRange;
  readonly x?: BrushNumericRange;
  readonly y?: BrushNumericRange;
}

export type HistogramBrushEvent = BrushEventBase<
  HistogramBrushTarget,
  HistogramBrushRange,
  HistogramBrushDefaultAction
>;

export interface HistogramContextEvent {
  readonly originalEvent?: Event;
}

export interface HistogramEngineEvents {
  activeplotchange: HistogramActivePlotChangeEvent;
  binsizeadjustrequest: HistogramBinSizeAdjustRequestEvent;
  brushcancel: HistogramBrushEvent & { phase: 'cancel' };
  brushcommit: HistogramBrushEvent & { phase: 'commit' };
  brushpreview: HistogramBrushEvent & { phase: 'preview' };
  brushstart: HistogramBrushEvent & { phase: 'start' };
  contextlost: HistogramContextEvent;
  contextrestored: HistogramContextEvent;
  cursorchange: HistogramCursorChangeEvent;
  hoverchange: HistogramHoverEvent | null;
  measurementchange: HistogramMeasurementEvent | null;
  metrics: HistogramMetricsEvent;
  overlaychange: HistogramOverlayChangeEvent;
  renderstate: HistogramRenderStateEvent;
  renderstatechange: HistogramRenderStateEvent;
  selectionchange: HistogramSelectionEvent;
  viewportchange: HistogramViewportChangeEvent;
  viewportundorequest: HistogramViewportUndoRequestEvent;
}

export type HistogramEngineEventName = keyof HistogramEngineEvents & string;
