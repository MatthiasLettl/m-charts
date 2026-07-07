import type { InputModifiers } from './events.js';

export type BrushPhase = 'start' | 'preview' | 'commit' | 'cancel';

export type BrushEventName =
  | 'brushstart'
  | 'brushpreview'
  | 'brushcommit'
  | 'brushcancel';

export type BrushShape = 'rectangle' | 'lasso' | 'axis-range';

export type BrushInteractionSource =
  | 'pointer'
  | 'keyboard'
  | 'command'
  | 'route'
  | 'test-hook';

export type BrushDefaultAction = 'zoom' | 'select' | 'none';

export interface BrushNumericRange {
  readonly max: number;
  readonly min: number;
}

export interface BrushCssRect {
  readonly heightCssPx: number;
  readonly widthCssPx: number;
  readonly xCssPx: number;
  readonly yCssPx: number;
}

export interface BrushCssPoint {
  readonly xCssPx: number;
  readonly yCssPx: number;
}

export type BrushCssGeometry =
  | {
      readonly rect: BrushCssRect;
      readonly shape: 'rectangle';
    }
  | {
      readonly points: readonly BrushCssPoint[];
      readonly shape: 'lasso';
    }
  | {
      readonly axisCssPx?: number;
      readonly rangeCssPx?: BrushNumericRange;
      readonly shape: 'axis-range';
    };

export interface BrushEventBase<
  TTarget,
  TRange,
  TDefaultAction extends string = BrushDefaultAction,
> {
  readonly cssGeometry?: BrushCssGeometry;
  readonly defaultAction: TDefaultAction;
  readonly modifiers: InputModifiers;
  readonly phase: BrushPhase;
  readonly range?: TRange;
  readonly resolveSourceIndices?: () => Uint32Array | null;
  readonly shape: BrushShape;
  readonly source: BrushInteractionSource;
  readonly target: TTarget;
}

export type BrushStartEvent<
  TTarget,
  TRange,
  TDefaultAction extends string = BrushDefaultAction,
> = BrushEventBase<TTarget, TRange, TDefaultAction> & {
  readonly phase: 'start';
};

export type BrushPreviewEvent<
  TTarget,
  TRange,
  TDefaultAction extends string = BrushDefaultAction,
> = BrushEventBase<TTarget, TRange, TDefaultAction> & {
  readonly phase: 'preview';
};

export type BrushCommitEvent<
  TTarget,
  TRange,
  TDefaultAction extends string = BrushDefaultAction,
> = BrushEventBase<TTarget, TRange, TDefaultAction> & {
  readonly phase: 'commit';
};

export type BrushCancelEvent<
  TTarget,
  TRange,
  TDefaultAction extends string = BrushDefaultAction,
> = BrushEventBase<TTarget, TRange, TDefaultAction> & {
  readonly phase: 'cancel';
};

export type BrushEvent<
  TTarget,
  TRange,
  TDefaultAction extends string = BrushDefaultAction,
> =
  | BrushStartEvent<TTarget, TRange, TDefaultAction>
  | BrushPreviewEvent<TTarget, TRange, TDefaultAction>
  | BrushCommitEvent<TTarget, TRange, TDefaultAction>
  | BrushCancelEvent<TTarget, TRange, TDefaultAction>;

export const BRUSH_EVENT_NAME_BY_PHASE = {
  cancel: 'brushcancel',
  commit: 'brushcommit',
  preview: 'brushpreview',
  start: 'brushstart',
} as const satisfies Record<BrushPhase, BrushEventName>;

export function brushEventNameForPhase(phase: BrushPhase): BrushEventName {
  return BRUSH_EVENT_NAME_BY_PHASE[phase];
}

export function normalizeBrushNumericRange(
  range: BrushNumericRange,
): BrushNumericRange {
  return {
    max: Math.max(range.min, range.max),
    min: Math.min(range.min, range.max),
  };
}

export function snapshotBrushModifiers(modifiers: InputModifiers): InputModifiers {
  return {
    altKey: modifiers.altKey,
    ctrlKey: modifiers.ctrlKey,
    metaKey: modifiers.metaKey,
    shiftKey: modifiers.shiftKey,
  };
}
