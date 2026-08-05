import type {
  ParallelActiveBrushInterval,
  ParallelAxisViewports,
  ParallelBrushIntervals,
  ParallelBuffers,
} from '../core/index.js';
import type {
  ParallelFastHoverVisualState,
  ParallelFastInspectionState,
  ParallelFastPlotOptions,
} from './types.js';

export type ParallelFastRenderState = 'idle' | 'rendering' | 'ready' | 'error';

export interface ParallelFastRenderSnapshot {
  canvas: {
    cssHeight: number;
    cssWidth: number;
    devicePixelRatio: number;
    height: number;
    width: number;
  };
  hoverCanvas: {
    height: number;
    width: number;
  };
  renderState: ParallelFastRenderState;
  renderStateMessage?: string;
}

export interface ParallelFastStateSnapshot {
  bufferStats: {
    axisCount: number;
    recordCount: number;
    webglSegmentCount: number;
    webglVertexCount: number;
  };
  buffers: ParallelBuffers;
  hover: ParallelFastHoverVisualState;
  inspection: ParallelFastInspectionState | null;
  lineOpacityScale: number;
  brush: ParallelFastBrushStateSnapshot;
  axisViewports: ParallelAxisViewports;
  preselectedOverlayEnabled: boolean;
  preselectedSourceIndices: Uint32Array;
  render: ParallelFastRenderSnapshot;
  selection: ParallelFastSelectionStateSnapshot;
  selectedSourceIndices: Uint32Array;
}

export interface ParallelFastBrushStateSnapshot {
  activeBrushes: readonly ParallelActiveBrushInterval[];
  brushIntervals: ParallelBrushIntervals;
}

export interface ParallelFastSelectionStateSnapshot {
  selectedCount: number;
  sourceIndices: Uint32Array;
}

export function resolveLineOpacityScale(options: Pick<ParallelFastPlotOptions, 'lineOpacityScale'>): number {
  const value = options.lineOpacityScale;
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 1;
}
