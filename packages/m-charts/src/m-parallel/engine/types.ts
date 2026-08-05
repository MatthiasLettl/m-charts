import type { Disposable, Unsubscribe } from '../../plot-engine/core/index.js';
import type {
  ParallelBrushIntervals,
  ParallelBuffers,
  ParallelAxisViewports,
  ParallelBrushSelectionResult,
  ParallelNearestRecordResult,
  ParallelWebgl2HoverDrawMetrics,
  ParallelWebgl2HoverOverlayRendererOptions,
  ParallelWebgl2HoverUpdateMetrics,
  ParallelWebgl2RendererDrawMetrics,
  ParallelWebgl2RendererSetupMetrics,
  ParallelWebgl2SegmentRendererOptions,
  ParallelWebgl2SelectedUpdateMetrics,
} from '../core/index.js';
import type { ParallelFastTheme } from '../core/webglSegmentRenderer.js';
import type {
  ParallelFastEngineEventName,
  ParallelFastEngineEvents,
  ParallelFastRendererMetricsEvent,
  ParallelFastRendererKind,
} from './parallelEvents.js';
import type { ParallelFastPlotCommands } from './parallelCommands.js';
import type { ParallelFastRenderState } from './parallelState.js';

export interface ParallelFastHoverVisualState {
  dimBackground: boolean;
  sourceIndex: number | null;
}

export interface ParallelFastInspectionState extends ParallelNearestRecordResult {
  source: 'e2e-inspect-record' | 'local-nearest-segment';
}

export interface ParallelFastRendererLike {
  readonly interactive?: Promise<void>;
  readonly ready?: Promise<void>;
  readonly setupMetrics: ParallelWebgl2RendererSetupMetrics;
  dispose(): void;
  draw(): ParallelWebgl2RendererDrawMetrics | null;
  setHoverFocusActive(active: boolean): boolean;
  updateLineOpacityScale(lineOpacityScale: number): void;
  updatePreselectedSourceIndices(
    buffers: ParallelBuffers,
    preselectedSourceIndices: Uint32Array,
  ): void;
  updateSelectedSourceIndices(
    buffers: ParallelBuffers,
    selectedSourceIndices: Uint32Array,
  ): ParallelWebgl2SelectedUpdateMetrics;
  updateTheme(theme: ParallelFastTheme | undefined): void;
  updateAxisViewports?(
    axisViewports: ParallelAxisViewports,
    options?: { phase: 'commit' | 'preview' },
  ): void;
  updateBrushIntervals?(brushIntervals: ParallelBrushIntervals): void;
  selectByBrushes?(
    buffers: ParallelBuffers,
    brushIntervals: ParallelBrushIntervals,
  ): Promise<ParallelBrushSelectionResult>;
  resolveInspection?(
    query: {
      axisPosition: number;
      maxDistancePx: number;
      normalizedValue: number;
      plotHeightPx: number;
      plotWidthPx: number;
    },
  ): Promise<ParallelNearestRecordResult | null>;
}

export interface ParallelFastHoverRendererLike {
  clear?(): ParallelWebgl2HoverDrawMetrics | null;
  dispose(): void;
  draw(): ParallelWebgl2HoverDrawMetrics | null;
  setHoverSourceIndex(
    buffers: ParallelBuffers,
    sourceIndex: number | null,
  ): ParallelWebgl2HoverUpdateMetrics;
  updateTheme(theme: ParallelFastTheme | undefined): void;
  updateAxisViewports?(axisViewports: ParallelAxisViewports): void;
}

export interface ParallelFastRendererLifecycleHandlers {
  onContextLost(detail?: string): void;
  onContextRestored(detail?: string): void;
  onError(error: unknown): void;
  onMetrics(metrics: ParallelFastRendererMetricsEvent): void;
}

export type ParallelFastRendererFactory = (
  canvas: HTMLCanvasElement,
  buffers: ParallelBuffers,
  options: ParallelWebgl2SegmentRendererOptions,
  lifecycle: ParallelFastRendererLifecycleHandlers,
) => ParallelFastRendererLike;

export type ParallelFastHoverRendererFactory = (
  canvas: HTMLCanvasElement,
  buffers: ParallelBuffers,
  options: ParallelWebgl2HoverOverlayRendererOptions,
) => ParallelFastHoverRendererLike;

export interface ParallelFastPlotOptions {
  axisViewports?: ParallelAxisViewports;
  baseCanvasClassName?: string;
  baseCanvasLabel?: string;
  baseCanvasRenderer?: string;
  buffers: ParallelBuffers;
  forceWebglUnavailable?: boolean;
  hostClassName?: string;
  hoverCanvasClassName?: string;
  hoverVisualMode?: 'canvas2d-hover-overlay' | 'webgl2-hover-overlay-canvas';
  hoverRendererFactory?: ParallelFastHoverRendererFactory;
  lineOpacityScale?: number;
  onMetrics?: (event: ParallelFastRendererMetricsEvent) => void;
  preserveDrawingBuffer?: boolean;
  brushIntervals?: ParallelBrushIntervals;
  inspection?: ParallelFastInspectionState | null;
  preselectedOverlayEnabled?: boolean;
  preselectedSourceIndices?: Uint32Array;
  rendererFactory?: ParallelFastRendererFactory;
  rendererKind?: ParallelFastRendererKind;
  selectedSourceIndices?: Uint32Array;
  selectedVisualUpdateDelayMs?: number;
  skipWebglContextLifecycle?: boolean;
  /** Defers initial brush selection until an asynchronous renderer is ready. */
  deferSelectionUntilRenderer?: boolean;
  theme?: ParallelFastTheme;
}

export type ParallelFastBinding =
  | ((plot: ParallelFastPlotInstance) => Disposable | (() => void) | void)
  | {
      attach(plot: ParallelFastPlotInstance): Disposable | (() => void) | void;
    };

export interface ParallelFastPlotInstance extends Disposable {
  readonly commands: ParallelFastPlotCommands;
  readonly hostElement: HTMLElement;
  dispose(): void;
  on<K extends ParallelFastEngineEventName>(
    event: K,
    handler: (payload: ParallelFastEngineEvents[K]) => void,
  ): Unsubscribe;
  update(options: Partial<ParallelFastPlotOptions>): void;
  use(binding: ParallelFastBinding): Disposable;
}

export type {
  ParallelFastEngineEventName,
  ParallelFastEngineEvents,
  ParallelFastRenderState,
  ParallelFastRendererMetricsEvent,
};
