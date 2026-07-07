import type {
  HistogramAggregationSet,
  HistogramBinSizeState,
  HistogramHoverEvent,
  HistogramLayout,
  HistogramMeasurementEvent,
  HistogramRendererHoverBin,
  HistogramSelectionFilter,
  HistogramViewport,
} from '../core/index.js';
import type { HistogramOverlayDescriptor } from './histogramOverlays.js';

export type HistogramRenderState = 'error' | 'idle' | 'ready' | 'rendering';
export type HistogramInteractionMode =
  | 'hover'
  | 'lasso'
  | 'measure'
  | 'pan'
  | 'select'
  | 'zoom';

export type HistogramCursorState =
  | 'crosshair'
  | 'default'
  | 'grabbing'
  | 'help'
  | 'not-allowed';

export interface HistogramRenderSnapshot {
  readonly aggregation: HistogramAggregationSet;
  readonly canvas: {
    readonly cssHeight: number;
    readonly cssWidth: number;
    readonly devicePixelRatio: number;
    readonly height: number;
    readonly width: number;
  };
  readonly hoverBin: HistogramRendererHoverBin | null;
  readonly layout: HistogramLayout;
  readonly renderState: HistogramRenderState;
  readonly renderStateMessage?: string;
}

export interface HistogramStateSnapshot {
  readonly activeSubplotId: string | null;
  readonly aggregation: HistogramAggregationSet;
  readonly axisMode: 'x' | 'xy' | 'y';
  readonly binSizes: readonly HistogramBinSizeState[];
  readonly cursor: HistogramCursorState;
  readonly focusedSubplotId: string | null;
  readonly hover: HistogramHoverEvent | null;
  readonly measurement: HistogramMeasurementEvent | null;
  readonly mode: HistogramInteractionMode;
  readonly overlays: readonly HistogramOverlayDescriptor[];
  readonly render: HistogramRenderSnapshot;
  readonly selectionFilters: readonly HistogramSelectionFilter[];
  readonly selectedSourceIndices: Uint32Array;
  readonly viewport: HistogramViewport;
}
