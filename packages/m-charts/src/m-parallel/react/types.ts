import type { ReactNode } from 'react';

import type {
  ParallelBrushIntervals,
  ParallelBuffers,
} from '../core/buffers.js';
import type {
  ParallelFastInspectionState,
  ParallelFastLineOpacityAdjustment,
  ParallelFastSelectionChangeEvent,
} from '../engine/index.js';
import type { ParallelFastTheme } from '../core/webglSegmentRenderer.js';

export type ParallelFastRendererKind = 'webgl2-segments';

export type ParallelFastRendererState = 'idle' | 'rendering' | 'ready' | 'error';

export type { ParallelFastInspectionState } from '../engine/index.js';

export interface ParallelFastRendererMetricsEvent {
  densityBlendMode?: string;
  densityMode?: string;
  drawCallCount?: number;
  lineAlpha?: number;
  lineOpacityScale?: number;
  firstReadySignalMs?: number | null;
  lineSetSamplesMs?: number | null;
  rendererKind?: ParallelFastRendererKind;
  rendererRedrawMs?: number | null;
  rendererSetupMs?: number | null;
  rendererState?: ParallelFastRendererState;
  rendererUploadMs?: number | null;
  selectedLineSampleCount?: number;
  selectedLineAlpha?: number;
  selectedVisualBufferCreationMs?: number | null;
  selectedVisualGpuUploadMs?: number | null;
  selectedVisualMaskBuildMs?: number | null;
  selectedVisualMaskGpuUploadMs?: number | null;
  selectedVisualRedrawMs?: number | null;
  selectionVisualUpdateMs?: number | null;
  sharedArrayBuffersUsed?: boolean;
  hoverResolveMs?: number | null;
  hoverVisualBaseRedrawMs?: number | null;
  hoverVisualGpuUploadMs?: number | null;
  hoverVisualMode?: 'webgl2-hover-overlay-canvas';
  hoverVisualRedrawMs?: number | null;
  hoverVisualSkipped?: boolean;
  hoverVisualUpdateMs?: number | null;
  hoverVisualUploadBytes?: number;
  webglSegmentCount?: number;
  webglVertexCount?: number;
}

export interface ParallelFastRendererProps {
  axisOverlay: ReactNode;
  brushIntervals: ParallelBrushIntervals;
  buffers: ParallelBuffers;
  inspection: ParallelFastInspectionState | null;
  lineOpacityScale?: number;
  onBrushIntervalsPreview?: (brushIntervals: ParallelBrushIntervals) => void;
  onInspectionChange: (
    inspection: ParallelFastInspectionState | null,
    resolveMs: number | null,
  ) => void;
  onLineOpacityAdjustRequest?: (
    adjustment: ParallelFastLineOpacityAdjustment,
  ) => void;
  onMetricsChange: (event: ParallelFastRendererMetricsEvent) => void;
  onSelectionChange: (event: ParallelFastSelectionChangeEvent) => void;
  preserveDrawingBuffer?: boolean;
  preselectedOverlayEnabled: boolean;
  preselectedSourceIndices: Uint32Array;
  selectedVisualUpdateDelayMs?: number;
  theme?: ParallelFastTheme;
}
