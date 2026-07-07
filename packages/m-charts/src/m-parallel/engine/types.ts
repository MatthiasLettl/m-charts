import type { Disposable, Unsubscribe } from '../../plot-engine/core/index.js';
import type {
  ParallelBrushIntervals,
  ParallelBuffers,
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
}

export type ParallelFastRendererFactory = (
  canvas: HTMLCanvasElement,
  buffers: ParallelBuffers,
  options: ParallelWebgl2SegmentRendererOptions,
) => ParallelFastRendererLike;

export type ParallelFastHoverRendererFactory = (
  canvas: HTMLCanvasElement,
  buffers: ParallelBuffers,
  options: ParallelWebgl2HoverOverlayRendererOptions,
) => ParallelFastHoverRendererLike;

export interface ParallelFastPlotOptions {
  baseCanvasClassName?: string;
  baseCanvasLabel?: string;
  buffers: ParallelBuffers;
  forceWebglUnavailable?: boolean;
  hostClassName?: string;
  hoverCanvasClassName?: string;
  hoverRendererFactory?: ParallelFastHoverRendererFactory;
  lineOpacityScale?: number;
  onMetrics?: (event: ParallelFastRendererMetricsEvent) => void;
  preserveDrawingBuffer?: boolean;
  brushIntervals?: ParallelBrushIntervals;
  inspection?: ParallelFastInspectionState | null;
  preselectedOverlayEnabled?: boolean;
  preselectedSourceIndices?: Uint32Array;
  rendererFactory?: ParallelFastRendererFactory;
  selectedSourceIndices?: Uint32Array;
  selectedVisualUpdateDelayMs?: number;
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
