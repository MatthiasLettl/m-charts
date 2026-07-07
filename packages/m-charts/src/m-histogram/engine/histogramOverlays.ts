import type {
  HistogramBinDescriptor,
  HistogramCanvasPoint,
  HistogramSubplotId,
} from '../core/index.js';

export interface HistogramCssPoint {
  readonly xCssPx: number;
  readonly yCssPx: number;
}

export interface HistogramCssRect extends HistogramCssPoint {
  readonly heightCssPx: number;
  readonly widthCssPx: number;
}

export type HistogramOverlayKind =
  | 'color-rule-brush'
  | 'committed-selection'
  | 'cursor-tooltip'
  | 'custom'
  | 'hover-guide'
  | 'lasso'
  | 'measurement-guide'
  | 'rectangle-selection'
  | 'rectangle-zoom';

export interface HistogramOverlayBase {
  readonly id: string;
  readonly kind: HistogramOverlayKind;
}

export interface HistogramRectangleOverlay extends HistogramOverlayBase {
  readonly binDescriptors?: readonly HistogramBinDescriptor[];
  readonly kind: 'color-rule-brush' | 'rectangle-selection' | 'rectangle-zoom';
  readonly rect: HistogramCssRect;
  readonly subplotId?: HistogramSubplotId;
}

export interface HistogramLassoOverlay extends HistogramOverlayBase {
  readonly kind: 'lasso';
  readonly points: readonly HistogramCssPoint[];
  readonly subplotId?: HistogramSubplotId;
}

export type HistogramCommittedSelectionShape =
  | {
      readonly kind: 'lasso';
      readonly points: readonly HistogramCssPoint[];
      readonly subplotId?: HistogramSubplotId;
    }
  | {
      readonly kind: 'rectangle';
      readonly rect: HistogramCssRect;
      readonly subplotId?: HistogramSubplotId;
    };

export interface HistogramCommittedSelectionOverlay extends HistogramOverlayBase {
  readonly kind: 'committed-selection';
  readonly rect: HistogramCssRect;
  readonly shapes: readonly HistogramCommittedSelectionShape[];
  readonly subplotId?: HistogramSubplotId;
}

export interface HistogramHoverGuideOverlay extends HistogramOverlayBase {
  readonly anchor: HistogramCssPoint;
  readonly bin: HistogramBinDescriptor;
  readonly kind: 'hover-guide';
  readonly subplotId: HistogramSubplotId;
}

export interface HistogramCursorTooltipOverlay extends HistogramOverlayBase {
  readonly anchor: HistogramCssPoint;
  readonly bin?: HistogramBinDescriptor;
  readonly kind: 'cursor-tooltip';
  readonly subplotId?: HistogramSubplotId;
}

export interface HistogramMeasurementGuideOverlay extends HistogramOverlayBase {
  readonly current?: HistogramCanvasPoint;
  readonly kind: 'measurement-guide';
  readonly reference: HistogramCanvasPoint;
  readonly subplotId: HistogramSubplotId;
}

export interface HistogramCustomOverlay extends HistogramOverlayBase {
  readonly data?: unknown;
  readonly kind: 'custom';
}

export type HistogramOverlayDescriptor =
  | HistogramCommittedSelectionOverlay
  | HistogramCursorTooltipOverlay
  | HistogramCustomOverlay
  | HistogramHoverGuideOverlay
  | HistogramLassoOverlay
  | HistogramMeasurementGuideOverlay
  | HistogramRectangleOverlay;
