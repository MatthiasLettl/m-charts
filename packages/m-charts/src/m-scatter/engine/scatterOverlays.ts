import type {
  FastScatterOutOfRangeMarker,
  FastScatterRange,
  FastScatterSelectionKind,
} from '../core/index.js';

export interface FastScatterCssPoint {
  xCssPx: number;
  yCssPx: number;
}

export interface FastScatterCssRect {
  heightCssPx: number;
  widthCssPx: number;
  xCssPx: number;
  yCssPx: number;
}

export interface FastScatterOverlayBase {
  id: string;
  plotId?: string;
  zIndex?: number;
}

export interface FastScatterRectangleZoomOverlay extends FastScatterOverlayBase {
  kind: 'rectangle-zoom';
  rect: FastScatterCssRect;
}

export interface FastScatterColorRuleBrushOverlay extends FastScatterOverlayBase {
  kind: 'color-rule-brush';
  rect: FastScatterCssRect;
}

export interface FastScatterRectangleSelectionOverlay extends FastScatterOverlayBase {
  kind: 'rectangle-selection';
  rect: FastScatterCssRect;
  selectionKind?: FastScatterSelectionKind;
}

export interface FastScatterLassoOverlay extends FastScatterOverlayBase {
  kind: 'lasso';
  points: readonly FastScatterCssPoint[];
  selectionKind?: FastScatterSelectionKind;
}

export interface FastScatterCommittedSelectionOverlay extends FastScatterOverlayBase {
  kind: 'committed-selection';
  shapes: readonly (
    | {
        kind: 'rectangle';
        plotId?: string;
        rect: FastScatterCssRect;
      }
    | {
        kind: 'lasso';
        plotId?: string;
        points: readonly FastScatterCssPoint[];
      }
  )[];
}

export interface FastScatterHoverGuideOverlay extends FastScatterOverlayBase {
  kind: 'hover-guide';
  anchor: FastScatterCssPoint;
  sourceIndex?: number;
}

export interface FastScatterMeasurementGuideOverlay extends FastScatterOverlayBase {
  kind: 'measurement-guide';
  current: FastScatterCssPoint;
  reference: FastScatterCssPoint;
}

export interface FastScatterCursorTooltipOverlay extends FastScatterOverlayBase {
  kind: 'cursor-tooltip';
  anchor: FastScatterCssPoint;
  sourceIndex?: number;
}

export interface FastScatterNavigatorOverlay extends FastScatterOverlayBase {
  kind: 'navigator';
  domain: FastScatterRange;
  rect: FastScatterCssRect;
  window: FastScatterRange;
  windowLabel: {
    max: string;
    min: string;
  };
  viewportRect: FastScatterCssRect;
}

export interface FastScatterOutOfRangeMarkersOverlay extends FastScatterOverlayBase {
  kind: 'out-of-range-markers';
  candidateCount?: number;
  durationMs?: number;
  markers: readonly FastScatterOutOfRangeMarker[];
}

export interface FastScatterPointMarkerOverlay extends FastScatterOverlayBase {
  kind: 'point-marker';
  label: string;
  line: {
    xCssPx: number;
    y1CssPx: number;
    y2CssPx: number;
  };
  point: FastScatterCssPoint;
  sourceIndex: number;
  yKey: string;
}

export type FastScatterOverlayDescriptor =
  | FastScatterRectangleZoomOverlay
  | FastScatterColorRuleBrushOverlay
  | FastScatterRectangleSelectionOverlay
  | FastScatterLassoOverlay
  | FastScatterCommittedSelectionOverlay
  | FastScatterHoverGuideOverlay
  | FastScatterMeasurementGuideOverlay
  | FastScatterCursorTooltipOverlay
  | FastScatterNavigatorOverlay
  | FastScatterOutOfRangeMarkersOverlay
  | FastScatterPointMarkerOverlay;

export type FastScatterOverlayKind = FastScatterOverlayDescriptor['kind'];
