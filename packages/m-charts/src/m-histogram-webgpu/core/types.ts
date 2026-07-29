import type {
  HistogramRendererOptions,
} from '../../m-histogram/core/index.js';

export type HistogramWebgpuAggregationBackend = 'auto' | 'rust-wasm' | 'typescript';
export type HistogramWebgpuResolvedAggregationBackend = 'rust-wasm' | 'typescript';

export interface HistogramWebgpuDiagnostics {
  aggregationBackend: HistogramWebgpuResolvedAggregationBackend;
  aggregationBackendPreference: HistogramWebgpuAggregationBackend;
  aggregationBuildCount: number;
  aggregationFallbackReason?: string;
  canvasFormat?: GPUTextureFormat;
  deviceLimits?: {
    maxBufferSize: number;
    maxStorageBufferBindingSize: number;
  };
  initialized: boolean;
  lastAggregationMs: number;
  lastRenderMs: number;
  timestampQuerySupported: boolean;
  uploadBytes: number;
}

export interface HistogramWebgpuRendererLifecycle {
  onContextLost?(info: GPUDeviceLostInfo): void;
  onContextRestored?(): void;
  onError?(error: unknown): void;
}

export interface HistogramWebgpuRendererOptions extends HistogramRendererOptions {
  readonly lifecycle?: HistogramWebgpuRendererLifecycle;
  readonly requestTimestampQuery?: boolean;
}
