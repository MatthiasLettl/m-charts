import type { HistogramClientViewBinding } from '../../m-histogram/core/index.js';
import type { ClientDataViewEvaluation } from '../../client-data-view/index.js';
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
  /** Optional creation-bound client pipeline; source data remains immutable. */
  clientView?: HistogramClientViewBinding;
  /** Aggregation preference. `auto` uses Rust/WASM when the input supports it. */
  aggregationBackend?: HistogramWebgpuAggregationBackend;
  /** Requests GPU timestamp-query support when the adapter exposes it. */
  requestTimestampQuery?: boolean;
}

export type HistogramWebgpuPlotUpdateOptions = Partial<Omit<
  HistogramWebgpuPlotOptions,
  'clientView' | 'aggregationBackend' | 'requestTimestampQuery'
>>;

export interface HistogramWebgpuPlotDiagnostics extends HistogramWebgpuDiagnostics {
  aggregation: HistogramWebgpuAggregationDiagnostics;
  clientView?: ClientDataViewEvaluation['metrics'] & { revision: number; sourceStyleMode: 'preserve' | 'ignore' };
}

export interface HistogramWebgpuPlotInstance extends HistogramPlotInstance {
  readonly interactive: Promise<void>;
  readonly ready: Promise<void>;
  getWebgpuDiagnostics(): HistogramWebgpuPlotDiagnostics;
  update(options: HistogramWebgpuPlotUpdateOptions): void;
}
