import type {
  ParallelActiveBrushInterval,
  ParallelBrushIntervals,
} from '../core/index.js';
import type { ParallelFastInspectionState } from './types.js';

export type ParallelFastOverlayKind =
  | 'axis-brush'
  | 'color-rule-brush'
  | 'inspection';

export interface ParallelFastOverlayBase {
  readonly id: string;
  readonly kind: ParallelFastOverlayKind;
}

export interface ParallelFastAxisBrushOverlay extends ParallelFastOverlayBase {
  readonly activeBrushes: readonly ParallelActiveBrushInterval[];
  readonly brushIntervals: ParallelBrushIntervals;
  readonly kind: 'axis-brush';
}

export interface ParallelFastColorRuleBrushOverlay extends ParallelFastOverlayBase {
  readonly activeBrushes: readonly ParallelActiveBrushInterval[];
  readonly brushIntervals: ParallelBrushIntervals;
  readonly kind: 'color-rule-brush';
}

export interface ParallelFastInspectionOverlay extends ParallelFastOverlayBase {
  readonly inspection: ParallelFastInspectionState;
  readonly kind: 'inspection';
}

export type ParallelFastOverlayDescriptor =
  | ParallelFastAxisBrushOverlay
  | ParallelFastColorRuleBrushOverlay
  | ParallelFastInspectionOverlay;
