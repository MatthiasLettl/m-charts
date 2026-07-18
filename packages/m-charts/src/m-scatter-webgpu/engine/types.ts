import type {
  FastScatterPlotInstance,
  FastScatterPlotOptions,
} from '../../m-scatter/engine/index.js';
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
  /** Requests optional GPU timestamp-query support. Creation-only. */
  requestTimestampQuery?: boolean;
}

export type FastScatterWebgpuPlotUpdateOptions = Partial<Omit<
  FastScatterWebgpuPlotOptions,
  'aggregationBackend' | 'indexedStyle' | 'packedStyles' | 'requestTimestampQuery'
>>;

export interface FastScatterWebgpuPlotInstance extends FastScatterPlotInstance {
  readonly interactive: Promise<void>;
  readonly ready: Promise<void>;
  getWebgpuDiagnostics(): FastScatterWebgpuDiagnostics;
  update(options: FastScatterWebgpuPlotUpdateOptions): void;
}

export type ScatterWebgpuPlotOptions = FastScatterWebgpuPlotOptions;
export type ScatterWebgpuPlotInstance = FastScatterWebgpuPlotInstance;
export type ScatterWebgpuPlotUpdateOptions = FastScatterWebgpuPlotUpdateOptions;
