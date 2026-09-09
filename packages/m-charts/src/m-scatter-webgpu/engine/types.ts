import type {
  FastScatterPlotInstance,
  FastScatterPlotOptions,
} from '../../m-scatter/engine/index.js';
import type { FastScatterClientViewBinding } from '../../m-scatter/core/index.js';
import type {
  FastScatterWebgpuAggregationBackend,
  FastScatterWebgpuDiagnostics,
  FastScatterWebgpuPackedStyles,
} from '../core/index.js';

export interface FastScatterWebgpuPlotOptions
  extends FastScatterPlotOptions {
  /** WebGPU aggregation implementation preference. Creation-only. */
  aggregationBackend?: FastScatterWebgpuAggregationBackend;
  /** Enables generated styles when explicit style columns are absent. Creation-only. */
  indexedStyle?: boolean;
  /** Supplies prepacked WebGPU style storage. Creation-only. */
  packedStyles?: FastScatterWebgpuPackedStyles;
  /** Optional initial GPU point capacity. Creation-only. */
  pointCapacity?: number;
  /** Requests optional GPU timestamp-query support. Creation-only. */
  requestTimestampQuery?: boolean;
  /** Optional additive resident client-side data view. Creation-only. */
  clientView?: FastScatterClientViewBinding;
}

export type FastScatterWebgpuPlotUpdateOptions = Partial<Omit<
  FastScatterWebgpuPlotOptions,
  'aggregationBackend' | 'clientView' | 'indexedStyle' | 'packedStyles'
  | 'requestTimestampQuery' | 'pointCapacity'
>>;

export interface FastScatterWebgpuPlotInstance extends FastScatterPlotInstance {
  readonly interactive: Promise<void>;
  readonly ready: Promise<void>;
  /** Fence submitted GPU work; settle pending client-view updates before calling. */
  waitForGpuIdle(): Promise<void>;
  getWebgpuDiagnostics(): FastScatterWebgpuDiagnostics;
  update(options: FastScatterWebgpuPlotUpdateOptions): void;
}

export type ScatterWebgpuPlotOptions = FastScatterWebgpuPlotOptions;
export type ScatterWebgpuPlotInstance = FastScatterWebgpuPlotInstance;
export type ScatterWebgpuPlotUpdateOptions = FastScatterWebgpuPlotUpdateOptions;
