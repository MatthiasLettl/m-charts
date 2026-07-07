import type {
  BrushDefaultAction,
  BrushEventBase,
  BrushNumericRange,
  BrushPhase,
  BrushInteractionSource,
  InputModifiers,
} from '../../plot-engine/core/index.js';
import type {
  ParallelActiveBrushInterval,
  ParallelBrushIntervals,
  ParallelFastAxisKind,
  ParallelFastSelectionSource,
  ParallelParameter,
  ParallelWebgl2HoverDrawMetrics,
  ParallelWebgl2HoverUpdateMetrics,
  ParallelWebgl2RendererDrawMetrics,
} from '../core/index.js';
import type {
  ParallelFastHoverVisualState,
  ParallelFastInspectionState,
} from './types.js';
import type { ParallelFastRenderState } from './parallelState.js';
import type {
  ParallelFastOverlayDescriptor,
  ParallelFastOverlayKind,
} from './parallelOverlays.js';

export type ParallelFastRendererKind = 'webgl2-segments';

export interface ParallelFastRendererMetricsEvent {
  densityBlendMode?: string;
  densityMode?: string;
  drawCallCount?: number;
  firstReadySignalMs?: number | null;
  hoverResolveMs?: number | null;
  hoverVisualBaseRedrawMs?: number | null;
  hoverVisualGpuUploadMs?: number | null;
  hoverVisualMode?: 'webgl2-hover-overlay-canvas';
  hoverVisualRedrawMs?: number | null;
  hoverVisualSkipped?: boolean;
  hoverVisualUpdateMs?: number | null;
  hoverVisualUploadBytes?: number;
  lineAlpha?: number;
  lineOpacityScale?: number;
  lineSetSamplesMs?: number | null;
  rendererKind?: ParallelFastRendererKind;
  rendererRedrawMs?: number | null;
  rendererSetupMs?: number | null;
  rendererState?: ParallelFastRenderState;
  rendererUploadMs?: number | null;
  selectedLineAlpha?: number;
  selectedLineSampleCount?: number;
  selectedVisualBufferCreationMs?: number | null;
  selectedVisualGpuUploadMs?: number | null;
  selectedVisualMaskBuildMs?: number | null;
  selectedVisualMaskGpuUploadMs?: number | null;
  selectedVisualRedrawMs?: number | null;
  selectionVisualUpdateMs?: number | null;
  sharedArrayBuffersUsed?: boolean;
  webglSegmentCount?: number;
  webglVertexCount?: number;
}

export interface ParallelFastRenderStateEvent {
  message?: string;
  state: ParallelFastRenderState;
}

export interface ParallelFastHoverVisualChangeEvent {
  drawMetrics: ParallelWebgl2RendererDrawMetrics | null;
  hoverDrawMetrics: ParallelWebgl2HoverDrawMetrics | null;
  hoverMetrics: ParallelWebgl2HoverUpdateMetrics | null;
  state: ParallelFastHoverVisualState;
}

export type ParallelFastInteractionSource = BrushInteractionSource;

export type ParallelFastBrushChangeReason =
  | 'clear'
  | 'create'
  | 'move'
  | 'remove'
  | 'resize-max'
  | 'resize-min'
  | 'set';

export type ParallelFastBrushPhase = Extract<BrushPhase, 'preview' | 'commit'>;

export type ParallelFastBrushDefaultAction = Extract<
  BrushDefaultAction,
  'none' | 'select'
>;

export interface ParallelFastBrushTarget {
  axis: ParallelParameter | null;
  axisRangeIndex: number | null;
  parameterKey: ParallelParameter | null;
}

export interface ParallelFastBrushRangeItem extends BrushNumericRange {
  axis: ParallelParameter;
  axisRangeIndex: number;
  parameterKey: ParallelParameter;
}

export interface ParallelFastBrushRange {
  intervals: readonly ParallelFastBrushRangeItem[];
  value?: BrushNumericRange;
}

export interface ParallelFastBrushEvent
  extends BrushEventBase<
    ParallelFastBrushTarget,
    ParallelFastBrushRange,
    ParallelFastBrushDefaultAction
  > {
  activeBrushes: readonly ParallelActiveBrushInterval[];
  brushIntervals: ParallelBrushIntervals;
  phase: ParallelFastBrushPhase;
  reason: ParallelFastBrushChangeReason;
  modifiers: InputModifiers;
  source: ParallelFastInteractionSource;
}

export interface ParallelFastSelectionChangeEvent {
  activeBrushes: readonly ParallelActiveBrushInterval[];
  brushIntervals: ParallelBrushIntervals;
  computeMs: number;
  filters: readonly ParallelFastSelectionFilter[];
  reason: ParallelFastBrushChangeReason;
  selectedCount: number;
  source: ParallelFastInteractionSource;
  sourceIndexCreationMs: number | null;
  sourceIndices: Uint32Array;
}

export interface ParallelFastSelectionFilter {
  axisRangeIndex: number;
  parameterKey: ParallelParameter;
  range: {
    max: number;
    min: number;
  };
  source?: ParallelFastSelectionSource;
  valueType: ParallelFastAxisKind | 'unknown';
  values?: readonly ParallelFastSelectionCategoryValue[];
}

export interface ParallelFastSelectionCategoryValue {
  encoded: number;
  label: string;
  value: boolean | number | string;
}

export type ParallelFastInspectionLookupSource = 'fallback' | 'index' | 'none';

export interface ParallelFastInspectionChangeEvent {
  inspection: ParallelFastInspectionState | null;
  lookupSource: ParallelFastInspectionLookupSource;
  resolveMs: number | null;
  source: ParallelFastInteractionSource;
}

export interface ParallelFastOverlayChangeEvent {
  activeBrushes: readonly ParallelActiveBrushInterval[];
  brushIntervals: ParallelBrushIntervals;
  inspection: ParallelFastInspectionState | null;
  kinds: readonly ParallelFastOverlayKind[];
  overlays: readonly ParallelFastOverlayDescriptor[];
  reason: 'clear' | 'replace' | 'set';
}

export type ParallelFastLineOpacityAdjustment = 'decrease' | 'increase' | 'reset';

export interface ParallelFastLineOpacityAdjustRequestEvent {
  adjustment: ParallelFastLineOpacityAdjustment;
  currentScale: number;
  source: ParallelFastInteractionSource;
}

export interface ParallelFastContextEvent {
  originalEvent: Event;
}

export interface ParallelFastDisposeEvent {
  reason: 'dispose';
}

export interface ParallelFastEngineEvents {
  contextlost: ParallelFastContextEvent;
  contextrestored: ParallelFastContextEvent;
  dispose: ParallelFastDisposeEvent;
  brushchange: ParallelFastBrushEvent;
  brushcommit: ParallelFastBrushEvent & { phase: 'commit' };
  brushpreview: ParallelFastBrushEvent;
  hovervisualchange: ParallelFastHoverVisualChangeEvent;
  inspectionchange: ParallelFastInspectionChangeEvent;
  lineopacityadjustrequest: ParallelFastLineOpacityAdjustRequestEvent;
  metrics: ParallelFastRendererMetricsEvent;
  overlaychange: ParallelFastOverlayChangeEvent;
  renderstate: ParallelFastRenderStateEvent;
  renderstatechange: ParallelFastRenderStateEvent;
  selectionchange: ParallelFastSelectionChangeEvent;
}

export type ParallelFastEngineEventName = keyof ParallelFastEngineEvents & string;
