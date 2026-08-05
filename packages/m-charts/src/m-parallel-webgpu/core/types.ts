import type {
  ParallelFastPlotOptions,
  ParallelFastTheme,
} from '../../m-parallel/index.js';
import type { WebgpuDeviceLimitsSnapshot } from '../../plot-engine-webgpu/index.js';

export type ParallelWebgpuAggregationBackend = 'auto' | 'rust-wasm' | 'typescript';
export type ParallelWebgpuRenderMode = 'auto' | 'density' | 'direct';

export interface ParallelWebgpuDiagnostics {
  aggregationBackend: 'rust-wasm' | 'typescript';
  aggregationBackendPreference: ParallelWebgpuAggregationBackend;
  backend: 'webgpu';
  binCount: number;
  binResolution: number;
  coordinateQuantizationBits: 16;
  refinedCoordinatePrecisionBits: 32;
  densityVisible: boolean;
  directRecordCount: number;
  hoverFallbackCount: number;
  initialized: boolean;
  lastAggregationMs: number;
  lastAggregationPairCount: number;
  lastHoverResolveMs: number;
  lastHoverUsedFullPopulation: boolean;
  hoverSearchRecordCount: number;
  lastRenderMs: number;
  pageCount: number;
  refinedRecordCount: number;
  refinementQualifiedRecordCount: number;
  refinementStride: number;
  renderMode: 'density' | 'direct' | 'hybrid';
  representativeRecordCount: number;
  residentBytes: number;
  selectedCount: number;
  styleMode: 'continuous-aggregate-plus-representatives' | 'uniform';
  timestampQuerySupported: boolean;
  uploadBytes: number;
  deviceLimits?: WebgpuDeviceLimitsSnapshot;
}

export interface ParallelWebgpuRendererLifecycle {
  onContextLost?(info: GPUDeviceLostInfo): void;
  onContextRestored?(): void;
  onError?(error: unknown): void;
}

export interface ParallelWebgpuRendererOptions {
  aggregationBackend?: ParallelWebgpuAggregationBackend;
  binResolution?: number;
  directSegmentLimit?: number;
  lifecycle?: ParallelWebgpuRendererLifecycle;
  lineOpacityScale?: number;
  onMetrics?: ParallelFastPlotOptions['onMetrics'];
  renderMode?: ParallelWebgpuRenderMode;
  representativeRecordLimit?: number;
  requestTimestampQuery?: boolean;
  theme?: ParallelFastTheme;
}
