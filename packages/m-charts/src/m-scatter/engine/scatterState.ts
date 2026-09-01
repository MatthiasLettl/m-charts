import type {
  FastScatterAggregationSet,
  FastScatterInteractionMode,
  FastScatterMeasurementEvent,
  FastScatterSelectionFilter,
  FastScatterViewport,
  FastScatterVisualizationMode,
} from '../core/index.js';
import type { FastScatterOverlayDescriptor } from './scatterOverlays.js';
import type {
  FastScatterReferenceLine,
  FastScatterReferenceLineHoverEvent,
} from './scatterReferenceLines.js';

export type FastScatterRenderState = 'idle' | 'rendering' | 'ready' | 'error';

export type FastScatterCursorState =
  | 'col-resize'
  | 'crosshair'
  | 'default'
  | 'grabbing'
  | 'help';

export interface FastScatterRenderSnapshot {
  aggregation: FastScatterAggregationSet | null;
  canvas: {
    cssHeight: number;
    cssWidth: number;
    devicePixelRatio: number;
    height: number;
    width: number;
  };
  renderState: FastScatterRenderState;
  renderStateMessage?: string;
}

export interface FastScatterStateSnapshot {
  activePlotId: string | null;
  cursor: FastScatterCursorState;
  heatmapBinSizePx?: number;
  hoverSourceIndex: number | null;
  measurement: FastScatterMeasurementEvent | null;
  mode: FastScatterInteractionMode;
  overlays: readonly FastScatterOverlayDescriptor[];
  pointMarkerSourceIndices: readonly number[];
  pointSizeScale?: number;
  referenceLineHover: FastScatterReferenceLineHoverEvent | null;
  referenceLines: readonly FastScatterReferenceLine[];
  render: FastScatterRenderSnapshot;
  selectionFilters: readonly FastScatterSelectionFilter[];
  selectedSourceIndices: Uint32Array;
  viewport: FastScatterViewport;
  visualizationMode: FastScatterVisualizationMode;
}
