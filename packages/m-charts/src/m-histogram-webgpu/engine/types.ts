import type {
  HistogramPlotInstance,
  HistogramPlotOptions,
} from '../../m-histogram/engine/index.js';
import type {
  HistogramWebgpuAggregationBackend,
  HistogramWebgpuAggregationDiagnostics,
  HistogramWebgpuDiagnostics,
} from '../core/index.js';

export interface HistogramWebgpuPlotOptions extends HistogramPlotOptions {
  /** Aggregation preference. `auto` uses Rust/WASM when the input supports it. */
  aggregationBackend?: HistogramWebgpuAggregationBackend;
  /** Requests GPU timestamp-query support when the adapter exposes it. */
  requestTimestampQuery?: boolean;
}

export type HistogramWebgpuPlotUpdateOptions = Partial<Omit<
  HistogramWebgpuPlotOptions,
  'aggregationBackend' | 'requestTimestampQuery'
>>;

export interface HistogramWebgpuPlotDiagnostics extends HistogramWebgpuDiagnostics {
  aggregation: HistogramWebgpuAggregationDiagnostics;
}

export interface HistogramWebgpuPlotInstance extends HistogramPlotInstance {
  readonly interactive: Promise<void>;
  readonly ready: Promise<void>;
  getWebgpuDiagnostics(): HistogramWebgpuPlotDiagnostics;
  update(options: HistogramWebgpuPlotUpdateOptions): void;
}
