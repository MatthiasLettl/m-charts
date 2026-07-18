import type { Disposable, Unsubscribe } from '../../plot-engine/core/index.js';
import type {
  FastScatterAggregationSet,
  FastScatterController,
  FastScatterControllerOptions,
  FastScatterEasterEggPlaybackOptions,
  FastScatterRendererOptions,
  FastScatterWebglRendererOptions,
  FastScatterViewport,
  FastScatterViewportChangePhase,
  FastScatterViewportChangeReason,
} from '../core/index.js';
import type { FastScatterPlotCommands } from './scatterCommands.js';
import type {
  FastScatterEngineEventName,
  FastScatterEngineEvents,
} from './scatterEvents.js';

export interface FastScatterRendererLike extends FastScatterController {
  getAggregation?(): FastScatterAggregationSet | null;
  isPointRendered?(pointIndex: number, plotId: string): boolean;
  playEasterEgg?(options?: FastScatterEasterEggPlaybackOptions): boolean;
  updateViewport?(
    viewport: FastScatterViewport,
    context: FastScatterRendererViewportUpdateContext,
  ): void;
}

export interface FastScatterRendererViewportUpdateContext {
  generation: number;
  phase: FastScatterViewportChangePhase;
  reason: FastScatterViewportChangeReason;
}

export type FastScatterRendererFactory = (
  options: FastScatterWebglRendererOptions,
) => FastScatterRendererLike;

export interface FastScatterEngineOptions extends FastScatterControllerOptions {
  canvasClassName?: string;
  canvasLabel?: string;
  hostClassName?: string;
  navigatorCssPx?: number;
  overlayClassName?: string;
}

export interface FastScatterEngineContextLifecycleHandlers {
  onLost(event?: Event): void;
  onRestored(event?: Event): void;
}

export interface FastScatterEngineRendererLifecycleHandlers {
  onContextLost(detail?: string): void;
  onContextRestored(detail?: string): void;
  onError(error: unknown): void;
  onReady(): void;
}

export interface FastScatterEngineBackend {
  readonly asynchronousReady?: boolean;
  readonly canvasClassName: string;
  readonly canvasLabel: string;
  readonly canvasRenderer: string;
  readonly hostClassName: string;
  attachContextLifecycle?(
    canvas: HTMLCanvasElement,
    handlers: FastScatterEngineContextLifecycleHandlers,
  ): Disposable;
  assertAvailable?(options: FastScatterEngineOptions): void;
  createRenderer(
    options: FastScatterRendererOptions,
    plotOptions: FastScatterEngineOptions,
    lifecycle: FastScatterEngineRendererLifecycleHandlers,
  ): FastScatterRendererLike;
  readonly contextLostMessage?: string;
  readonly contextRestoreErrorMessage?: string;
  readonly setupErrorMessage?: string;
}

export interface FastScatterPlotOptions extends FastScatterEngineOptions {
  forceWebglUnavailable?: boolean;
  preserveDrawingBuffer?: boolean;
  rendererFactory?: FastScatterRendererFactory;
}

export type FastScatterBinding =
  | ((plot: FastScatterPlotInstance) => Disposable | (() => void) | void)
  | {
      attach(plot: FastScatterPlotInstance): Disposable | (() => void) | void;
    };

export interface FastScatterPlotInstance extends Disposable {
  readonly canvas: HTMLCanvasElement;
  readonly commands: FastScatterPlotCommands;
  readonly hostElement: HTMLElement;
  readonly overlayElement: HTMLDivElement;
  dispose(): void;
  on<K extends FastScatterEngineEventName>(
    event: K,
    handler: (payload: FastScatterEngineEvents[K]) => void,
  ): Unsubscribe;
  update(options: Partial<FastScatterPlotOptions>): void;
  use(binding: FastScatterBinding): Disposable;
}
