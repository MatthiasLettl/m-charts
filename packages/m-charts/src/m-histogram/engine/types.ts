import type { Disposable, Unsubscribe } from '../../plot-engine/core/index.js';
import type {
  HistogramAggregationPreparedState,
  HistogramAggregationRequest,
  HistogramAggregationSet,
  HistogramBinSizeState,
  HistogramColumns,
  HistogramHoverEvent,
  HistogramMeasurementEvent,
  HistogramMetricsEvent,
  HistogramPlotSpec,
  HistogramRendererRenderMetrics,
  HistogramRendererOptions,
  HistogramRendererTheme,
  HistogramRendererUpdate,
  HistogramSelectionEvent,
  HistogramViewport,
  HistogramViewportChangePhase,
  HistogramViewportChangeReason,
  HistogramWebglRendererOptions,
} from '../core/index.js';
import type { HistogramPlotCommands } from './histogramCommands.js';
import type {
  HistogramEngineEventName,
  HistogramEngineEvents,
} from './histogramEvents.js';
import type { HistogramInteractionMode } from './histogramState.js';

export interface HistogramRendererLike extends Disposable {
  render(): HistogramRendererRenderMetrics | null;
  update(update: HistogramRendererUpdate): void;
}

export interface HistogramAggregationProvider extends Disposable {
  build(
    columns: HistogramColumns,
    request: HistogramAggregationRequest,
  ): HistogramAggregationSet;
  prepare(
    columns: HistogramColumns,
    spec: Pick<HistogramPlotSpec, 'parameters'>,
  ): HistogramAggregationPreparedState;
}

export interface HistogramEngineContextLifecycleHandlers {
  onLost(event?: Event): void;
  onRestored(event?: Event): void;
}

export interface HistogramEngineRendererLifecycleHandlers {
  onContextLost(detail?: string): void;
  onContextRestored(detail?: string): void;
  onError(error: unknown): void;
  onReady(): void;
}

export interface HistogramEngineBackend {
  readonly aggregationProvider: HistogramAggregationProvider;
  readonly asynchronousReady?: boolean;
  readonly canvasClassName: string;
  readonly canvasLabel: string;
  readonly canvasRenderer: string;
  readonly deferMembership?: boolean;
  readonly hostClassName: string;
  attachContextLifecycle?(
    canvas: HTMLCanvasElement,
    handlers: HistogramEngineContextLifecycleHandlers,
  ): Disposable;
  assertAvailable?(options: HistogramPlotOptions): void;
  createRenderer(
    options: HistogramRendererOptions,
    plotOptions: HistogramPlotOptions,
    lifecycle: HistogramEngineRendererLifecycleHandlers,
  ): HistogramRendererLike;
  readonly contextLostMessage?: string;
  readonly contextRestoreErrorMessage?: string;
  readonly setupErrorMessage?: string;
}

export type HistogramRendererFactory = (
  options: HistogramWebglRendererOptions,
) => HistogramRendererLike;

export interface HistogramPlotOptions {
  aggregation?: HistogramAggregationSet;
  axisMode?: 'x' | 'xy' | 'y';
  binSizes?: readonly HistogramBinSizeState[];
  canvasClassName?: string;
  canvasLabel?: string;
  columns?: HistogramColumns;
  focusedSubplotId?: string | null;
  forceWebglUnavailable?: boolean;
  hostClassName?: string;
  hoverSourceIndex?: number | null;
  onHoverChange?: (event: HistogramHoverEvent | null) => void;
  onMeasurementChange?: (event: HistogramMeasurementEvent | null) => void;
  onMetrics?: (event: HistogramMetricsEvent) => void;
  onSelectionChange?: (event: HistogramSelectionEvent) => void;
  onViewportChange?: (
    viewport: HistogramViewport,
    reason: HistogramViewportChangeReason,
    phase: HistogramViewportChangePhase,
  ) => void;
  overlayClassName?: string;
  preserveDrawingBuffer?: boolean;
  rendererFactory?: HistogramRendererFactory;
  selectedSourceIndices?: Uint32Array | readonly number[];
  spec: HistogramPlotSpec;
  theme?: HistogramRendererTheme;
  mode?: HistogramInteractionMode;
  viewport?: HistogramViewport;
}

export type HistogramBinding =
  | ((plot: HistogramPlotInstance) => Disposable | (() => void) | void)
  | {
      attach(plot: HistogramPlotInstance): Disposable | (() => void) | void;
    };

export interface HistogramPlotInstance extends Disposable {
  readonly canvas: HTMLCanvasElement;
  readonly commands: HistogramPlotCommands;
  readonly hostElement: HTMLElement;
  readonly overlayElement: HTMLDivElement;
  dispose(): void;
  on<K extends HistogramEngineEventName>(
    event: K,
    handler: (payload: HistogramEngineEvents[K]) => void,
  ): Unsubscribe;
  update(options: Partial<HistogramPlotOptions>): void;
  use(binding: HistogramBinding): Disposable;
}
