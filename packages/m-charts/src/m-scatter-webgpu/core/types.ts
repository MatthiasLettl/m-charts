import type {
  FastScatterControllerOptions,
  FastScatterDataDomain,
  FastScatterRendererOptions,
} from '../../m-scatter/core/index.js';
import type { FastScatterWebgpuWasmAggregationDiagnostics } from './wasmAggregation.js';

export type FastScatterWebgpuAggregationBackend =
  | 'auto'
  | 'rust-wasm'
  | 'typescript';

export interface FastScatterWebgpuRendererOptions
  extends FastScatterRendererOptions {
  /** Preferred built-in aggregate backend. Rust/WASM requests fall back to TypeScript if unavailable. */
  aggregationBackend?: FastScatterWebgpuAggregationBackend;
  /** Optional prepared domain used for stable high-precision column encoding. */
  dataDomain?: FastScatterDataDomain;
  indexedStyle?: boolean;
  lifecycle?: FastScatterWebgpuRendererLifecycle;
  packedStyles?: FastScatterWebgpuPackedStyles;
  /** Optional initial allocation capacity for progressive append sources. */
  pointCapacity?: number;
  requestTimestampQuery?: boolean;
}

export interface FastScatterWebgpuRendererLifecycle {
  onContextLost?(info: GPUDeviceLostInfo): void;
  onContextRestored?(): void;
  onError?(error: unknown): void;
}

export interface FastScatterWebgpuPackedStylePage {
  readonly data: Uint32Array;
  readonly startPoint: number;
}

export type FastScatterWebgpuPackedStyles = {
  readonly data: Uint32Array;
  readonly maxPointSize: number;
  readonly styleStrideBytes?: 4 | 8 | 12;
} | {
  readonly createPages: () => AsyncIterable<FastScatterWebgpuPackedStylePage>;
  readonly maxPointSize: number;
  readonly pointCount: number;
  readonly styleStrideBytes?: 4 | 8 | 12;
};

export interface FastScatterWebgpuDiagnostics {
  adapterInfo?: {
    architecture: string;
    description: string;
    device: string;
    vendor: string;
  };
  aggregationBackend?: 'external' | 'rust-wasm' | 'typescript';
  aggregationBackendPreference?: FastScatterWebgpuAggregationBackend;
  aggregationWasm?: FastScatterWebgpuWasmAggregationDiagnostics;
  backend: 'webgpu';
  cacheBytes: number;
  cacheReady: boolean;
  coalescedFrameCount: number;
  deviceLimits?: {
    maxBufferSize: number;
    maxStorageBufferBindingSize: number;
    maxStorageBuffersPerShaderStage: number;
  };
  estimatedPeakBytes: number;
  /** Compatibility name for first complete settled-frame readiness; inspect settledExact for stride-one rendering. */
  exactReady: boolean;
  interactionCacheOverscan: number;
  interactiveReady: boolean;
  lodPointCount: number;
  lodPointBudget: number;
  lodStride: number;
  overviewRepresentativeCount: number;
  pointCount: number;
  pointCapacity: number;
  ready: boolean;
  residentBytes: number;
  requiredBufferSize: number;
  requiredStorageBufferBindingSize: number;
  selectedPointCount: number;
  selectedStorageBytes: number;
  selectedStorageMode: 'bitset' | 'indices';
  settledExact: boolean;
  settledFrameCount: number;
  settledPointCoverage: number;
  submittedFrameCount: number;
  timestampQuerySupported: boolean;
  /** Compatibility name for the most recent settled-frame GPU duration. */
  lastExactGpuMs?: number;
  lastCachedGpuMs?: number;
  uploadBytes: number;
}

export type FastScatterWebgpuControllerOptions = FastScatterControllerOptions;
