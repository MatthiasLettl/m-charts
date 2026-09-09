import type { ParallelClientViewBinding } from '../../m-parallel/core/index.js';
import type { ClientDataViewEvaluation } from '../../client-data-view/index.js';
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
  /** Optional creation-bound client pipeline; source data remains immutable. */
  clientView?: ParallelClientViewBinding;
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
  | 'clientView'
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
  /** Fence submitted GPU work; settle pending client-view updates before calling. */
  waitForGpuIdle(): Promise<void>;
  getWebgpuDiagnostics(): ParallelWebgpuDiagnostics & { clientView?: ClientDataViewEvaluation['metrics'] & { pending: boolean; sourceUploadBytes: number; totalSourceUploadBytes: number; sourceBufferBuildCount: number; viewUploadBytes: number; revision: number; sourceStyleMode: 'preserve' | 'ignore' } };
  update(options: ParallelWebgpuPlotUpdateOptions): void;
}

export type ParallelFastWebgpuPlotOptions = ParallelWebgpuPlotOptions;
export type ParallelFastWebgpuPlotInstance = ParallelWebgpuPlotInstance;

