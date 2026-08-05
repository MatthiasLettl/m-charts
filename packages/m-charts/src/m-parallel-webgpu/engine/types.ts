import type {
  ParallelFastPlotInstance,
  ParallelFastPlotOptions,
} from '../../m-parallel/engine/index.js';
import type {
  ParallelWebgpuAggregationBackend,
  ParallelWebgpuDiagnostics,
  ParallelWebgpuRenderMode,
} from '../core/index.js';

export interface ParallelWebgpuPlotOptions extends ParallelFastPlotOptions {
  /** Exact CPU finalization preference. Rust/WASM falls back to TypeScript. */
  aggregationBackend?: ParallelWebgpuAggregationBackend;
  /** Pairwise screen-bin resolution. Creation-only. */
  binResolution?: number;
  /** Maximum directly rendered adjacent-axis segments. Creation-only. */
  directSegmentLimit?: number;
  /** Controls automatic direct/density selection. Creation-only. */
  renderMode?: ParallelWebgpuRenderMode;
  /** Maximum exact-style records overlaid in density mode. Creation-only. */
  representativeRecordLimit?: number;
  /** Requests optional GPU timestamp-query support. Creation-only. */
  requestTimestampQuery?: boolean;
}

export type ParallelWebgpuPlotUpdateOptions = Partial<Omit<
  ParallelWebgpuPlotOptions,
  | 'aggregationBackend'
  | 'binResolution'
  | 'directSegmentLimit'
  | 'renderMode'
  | 'representativeRecordLimit'
  | 'requestTimestampQuery'
>>;

export interface ParallelWebgpuPlotInstance extends ParallelFastPlotInstance {
  readonly interactive: Promise<void>;
  readonly ready: Promise<void>;
  getWebgpuDiagnostics(): ParallelWebgpuDiagnostics;
  update(options: ParallelWebgpuPlotUpdateOptions): void;
}

export type ParallelFastWebgpuPlotOptions = ParallelWebgpuPlotOptions;
export type ParallelFastWebgpuPlotInstance = ParallelWebgpuPlotInstance;

