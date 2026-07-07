import type { Disposable, Unsubscribe } from '../../plot-engine/core/index.js';
import type {
  FastScatterAggregationSet,
  FastScatterController,
  FastScatterControllerOptions,
  FastScatterEasterEggPlaybackOptions,
  FastScatterWebglRendererOptions,
} from '../core/index.js';
import type { FastScatterPlotCommands } from './scatterCommands.js';
import type {
  FastScatterEngineEventName,
  FastScatterEngineEvents,
} from './scatterEvents.js';

export interface FastScatterRendererLike extends FastScatterController {
  getAggregation?(): FastScatterAggregationSet | null;
  playEasterEgg?(options?: FastScatterEasterEggPlaybackOptions): boolean;
}

export type FastScatterRendererFactory = (
  options: FastScatterWebglRendererOptions,
) => FastScatterRendererLike;

export interface FastScatterPlotOptions extends FastScatterControllerOptions {
  canvasClassName?: string;
  canvasLabel?: string;
  forceWebglUnavailable?: boolean;
  hostClassName?: string;
  navigatorCssPx?: number;
  overlayClassName?: string;
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
