import type {
  BrushDefaultAction,
  BrushEventBase,
  BrushNumericRange,
} from '../../plot-engine/core/index.js';
import type {
  FastScatterHeatmapPalette,
  FastScatterHoverEvent,
  FastScatterMeasurementEvent,
  FastScatterMetricsEvent,
  FastScatterSelectionEvent,
  FastScatterViewport,
  FastScatterViewportChangeReason,
  FastScatterViewportChangePhase,
  FastScatterVisualizationMode,
} from '../core/index.js';
import type { FastScatterAxisMode } from '../core/index.js';
import type { FastScatterOverlayDescriptor } from './scatterOverlays.js';
import type { FastScatterCursorState, FastScatterRenderState } from './scatterState.js';

export interface FastScatterRenderStateEvent {
  message?: string;
  state: FastScatterRenderState;
}

export interface FastScatterViewportChangeEvent {
  phase: FastScatterViewportChangePhase;
  reason: FastScatterViewportChangeReason;
  viewport: FastScatterViewport;
}

export interface FastScatterActivePlotChangeEvent {
  plotId: string | null;
  previousPlotId: string | null;
  reason: 'binding' | 'command' | 'pointer' | 'programmatic';
}

export interface FastScatterCursorChangeEvent {
  cursor: FastScatterCursorState;
  previousCursor: FastScatterCursorState;
  reason: 'binding' | 'command' | 'pointer' | 'programmatic';
}

export interface FastScatterOverlayChangeEvent {
  overlays: readonly FastScatterOverlayDescriptor[];
  reason: 'clear' | 'replace' | 'set';
}

export interface FastScatterPointSizeAdjustRequestEvent {
  delta: number;
  mode: FastScatterVisualizationMode;
  pointSizeScale?: number;
  source: 'command' | 'keyboard' | 'wheel';
}

export interface FastScatterHeatmapBinSizeAdjustRequestEvent {
  delta: number;
  heatmapBinSizePx?: number;
  palette?: FastScatterHeatmapPalette;
  source: 'command' | 'keyboard' | 'wheel';
}

export interface FastScatterViewportUndoRequestEvent {
  source: 'command' | 'keyboard' | 'pointer';
}

export type FastScatterBrushDefaultAction = Extract<
  BrushDefaultAction,
  'none' | 'select' | 'zoom'
>;

export interface FastScatterBrushTarget {
  axisMode: FastScatterAxisMode;
  xParameterKey?: string;
  parameterKey: string;
  plotId: string;
  yKey: string;
}

export interface FastScatterBrushRange {
  parameter?: BrushNumericRange;
  x?: BrushNumericRange;
  y?: BrushNumericRange;
}

export type FastScatterBrushEvent = BrushEventBase<
  FastScatterBrushTarget,
  FastScatterBrushRange,
  FastScatterBrushDefaultAction
>;

export interface FastScatterContextEvent {
  originalEvent?: Event;
}

export interface FastScatterEngineEvents {
  activeplotchange: FastScatterActivePlotChangeEvent;
  brushcancel: FastScatterBrushEvent & { phase: 'cancel' };
  brushcommit: FastScatterBrushEvent & { phase: 'commit' };
  brushpreview: FastScatterBrushEvent & { phase: 'preview' };
  brushstart: FastScatterBrushEvent & { phase: 'start' };
  contextlost: FastScatterContextEvent;
  contextrestored: FastScatterContextEvent;
  cursorchange: FastScatterCursorChangeEvent;
  heatmapbinsizeadjustrequest: FastScatterHeatmapBinSizeAdjustRequestEvent;
  hoverchange: FastScatterHoverEvent | null;
  measurementchange: FastScatterMeasurementEvent | null;
  metrics: FastScatterMetricsEvent;
  overlaychange: FastScatterOverlayChangeEvent;
  pointsizeadjustrequest: FastScatterPointSizeAdjustRequestEvent;
  renderstate: FastScatterRenderStateEvent;
  renderstatechange: FastScatterRenderStateEvent;
  selectionchange: FastScatterSelectionEvent;
  viewportchange: FastScatterViewportChangeEvent;
  viewportundorequest: FastScatterViewportUndoRequestEvent;
}

export type FastScatterEngineEventName = keyof FastScatterEngineEvents & string;
