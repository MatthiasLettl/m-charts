import {
  buildFastScatterAggregation,
  createFastScatterBubbleRadiusPx,
  createFastScatterHeatmapColors,
  createFastScatterLayout,
  normalizeFastScatterOpacityScale,
  normalizeFastScatterHeatmapPalette,
  normalizeFastScatterPointSizeScale,
  normalizeFastScatterVisualizationMode,
  rectToDevicePixels,
  resolveFastScatterHeatmapBorderAlpha,
  resolveFastScatterAlphaPolicy,
  type FastScatterAggregationSet,
  type FastScatterBubbleSubplotAggregation,
  type FastScatterHeatmapSubplotAggregation,
  type FastScatterControllerOptions,
  type FastScatterEasterEggPlaybackOptions,
  type FastScatterMetricsEvent,
  type FastScatterPlotSpec,
  type FastScatterPointColumns,
  type FastScatterPlotRect,
  type FastScatterRange,
  type FastScatterTheme,
  type FastScatterViewport,
} from '../../m-scatter/core/index.js';
import {
  createFastScatterEasterEggColorArray,
  createFastScatterEasterEggPlayback,
  getFastScatterEasterEggTotalDurationMs,
  updateFastScatterEasterEggPositions,
  type FastScatterEasterEggPlayback,
} from '../../m-scatter/core/easterEgg.js';
import type {
  FastScatterRendererLike,
  FastScatterRendererViewportUpdateContext,
} from '../../m-scatter/engine/index.js';
import type { FastScatterRendererAppendOptions } from '../../m-scatter/engine/types.js';
import {
  createWebgpuContext,
  WebgpuTimestampProfiler,
  type WebgpuContext,
} from '../../plot-engine-webgpu/index.js';
import {
  FAST_SCATTER_WEBGPU_AGGREGATE_SHADER,
  FAST_SCATTER_WEBGPU_COMPOSITE_SHADER,
  FAST_SCATTER_WEBGPU_SHADER,
} from './shaders.js';
import {
  encodeFastScatterWebgpuRange,
  encodeFastScatterWebgpuValue,
  packFastScatterWebgpuStyle,
} from './packing.js';
import { buildFastScatterWebgpuBubbleAggregation } from './aggregation.js';
import {
  FastScatterWebgpuWasmAggregationSession,
  type FastScatterWebgpuWasmAggregationDiagnostics,
} from './wasmAggregation.js';
import type {
  FastScatterWebgpuAggregationBackend,
  FastScatterWebgpuDiagnostics,
  FastScatterWebgpuPackedStyles,
  FastScatterWebgpuRendererOptions,
} from './types.js';

interface EncodedColumn {
  buffer: GPUBuffer;
  byteLength: number;
  encoding: ColumnEncoding;
  storageMode: 0 | 1 | 2;
}

interface ColumnEncoding {
  offset: number;
  scale: number;
}

interface PlotResources {
  bindGroup: GPUBindGroup;
  compositeBindGroup: GPUBindGroup;
  compositeUniformBuffer: GPUBuffer;
  overviewBindGroup: GPUBindGroup;
  overviewBuffer: GPUBuffer;
  overviewCount: number;
  overviewIndices: Uint32Array;
  overviewUniformBuffer: GPUBuffer;
  plotId: string;
  selectedBindGroup: GPUBindGroup;
  selectedOverviewBindGroup: GPUBindGroup;
  selectedOverviewUniformBuffer: GPUBuffer;
  selectedUniformBuffer: GPUBuffer;
  uniformBuffer: GPUBuffer;
  y: EncodedColumn;
  yKey: string;
}

interface GpuResources {
  aggregateBindGroupLayout: GPUBindGroupLayout;
  aggregatePipeline: GPURenderPipeline;
  backgroundPipeline: GPURenderPipeline;
  bindGroupLayout: GPUBindGroupLayout;
  cacheHeight: number;
  cacheTexture: GPUTexture;
  cacheView: GPUTextureView;
  cacheWidth: number;
  compositeBindGroupLayout: GPUBindGroupLayout;
  compositePipeline: GPURenderPipeline;
  compositeSampler: GPUSampler;
  identitySourceOrder: boolean;
  inverseSourceIndex?: Uint32Array;
  maxPointSize: number;
  pipelines: readonly [GPURenderPipeline, GPURenderPipeline, GPURenderPipeline];
  plots: PlotResources[];
  pointCapacity: number;
  rotationBuffer: GPUBuffer;
  selectedBuffer: GPUBuffer;
  selectedCapacity: number;
  selectedCount: number;
  selectedDense: boolean;
  selectedDensePipelines: readonly [GPURenderPipeline, GPURenderPipeline, GPURenderPipeline];
  selectedPipelines: readonly [GPURenderPipeline, GPURenderPipeline, GPURenderPipeline];
  shaderModule: GPUShaderModule;
  styleBuffer: GPUBuffer;
  styleBufferHigh: GPUBuffer;
  styleByteLength: number;
  styleMode: number;
  styleSplitBytes: number;
  uploadBytes: number;
  workTexture: GPUTexture;
  workView: GPUTextureView;
  x: EncodedColumn;
  xIndexedMode: 0 | 1 | 2;
  xSorted: boolean;
}

interface AggregatePlotResources {
  bindGroup: GPUBindGroup;
  buffer: GPUBuffer;
  cellHeightPx: number;
  cellWidthPx: number;
  instanceCount: number;
  plotId: string;
  uniformBuffer: GPUBuffer;
  yKey: string;
}

interface EasterEggResources {
  bindGroup: GPUBindGroup;
  buffer: GPUBuffer;
  currentX: Float32Array;
  currentY: Float32Array;
  instanceData: ArrayBuffer;
  pointCount: number;
  uniformBuffer: GPUBuffer;
}

interface EasterEggFrame {
  elapsedMs: number;
  playback: FastScatterEasterEggPlayback;
  plotId: string;
}

const DEFAULT_THEME: FastScatterTheme = {
  alphaScaleMultiplier: 1,
  backgroundColor: [1, 1, 1, 1],
  bubbleColor: [6, 150, 125, 220],
  colorMixAmount: 0,
  colorMixColor: [255, 255, 255],
  defaultPointColor: [0, 0, 0, 255],
  selectedOverlayColor: [0.98, 0.72, 0.08, 0.95],
  subplotBackgroundColor: [0.965, 0.975, 0.988, 1],
};
const STYLE_STRIDE_BYTES = 4;
const ROTATION_LUT_SIZE = 1024;
const ROTATION_LUT_BYTES = ROTATION_LUT_SIZE * 2 * Float32Array.BYTES_PER_ELEMENT;
const UNIFORM_BYTES = 128;
const AGGREGATE_UNIFORM_BYTES = 144;
const AGGREGATE_INSTANCE_BYTES = 32;
const EMPTY_BUFFER_BYTES = 4;
const BUILD_YIELD_INTERVAL = 500_000;
const UPLOAD_CHUNK_POINTS = 262_144;
const UPLOAD_FLUSH_CHUNKS = 16;
const MAX_UPLOAD_STAGING_BYTES =
  UPLOAD_FLUSH_CHUNKS * UPLOAD_CHUNK_POINTS * STYLE_STRIDE_BYTES;
const INVALID_POINT_INDEX = 0xffff_ffff;
const INTERACTION_CACHE_OVERSCAN = 1.5;
export const FAST_SCATTER_WEBGPU_MAX_RENDERED_POINTS_PER_SUBPLOT = 1_000_000;
const STREAMING_PREVIEW_POINTS_PER_SUBPLOT = 25_000;
// Ten representative previews per second leave ample GPU time for cached
// pointer interaction and buffer uploads while still making stream growth
// visibly continuous. Interaction frames remain animation-frame driven.
const STREAMING_PREVIEW_INTERVAL_MS = 100;
const OVERVIEW_REPRESENTATIVE_BLOCK_SIZE = 4_096;
const PLOT_UNIFORM_SCRATCH = new ArrayBuffer(UNIFORM_BYTES);
const COMPOSITE_UNIFORM_SCRATCH = new Float32Array(
  UNIFORM_BYTES / Float32Array.BYTES_PER_ELEMENT,
);

function calculateWebgpuBufferRequirements(
  columns: FastScatterPointColumns,
  hasPackedStyles: boolean,
  pointCapacity = columns.x.length,
): { requiredBufferSize: number; requiredStorageBufferBindingSize: number } {
  const hasPerPointStyles = hasPackedStyles || columns.color !== undefined ||
    columns.opacity !== undefined || columns.rotation !== undefined ||
    columns.shape !== undefined || columns.size !== undefined;
  const coordinateBytes = Float32Array.BYTES_PER_ELEMENT * pointCapacity;
  const styleBytes = hasPerPointStyles
    ? STYLE_STRIDE_BYTES * pointCapacity
    : STYLE_STRIDE_BYTES;
  const styleAllocationBytes = styleBytes > 128 * 1024 * 1024
    ? Math.ceil(styleBytes / (STYLE_STRIDE_BYTES * 2)) * STYLE_STRIDE_BYTES
    : styleBytes;
  return {
    requiredBufferSize: Math.max(styleAllocationBytes, coordinateBytes),
    requiredStorageBufferBindingSize: Math.max(
      coordinateBytes,
      hasPerPointStyles ? Math.min(styleBytes, 128 * 1024 * 1024) : STYLE_STRIDE_BYTES,
    ),
  };
}

interface CachedFrameSnapshot {
  viewport: FastScatterViewport;
}

export class FastScatterWebgpuRenderer implements FastScatterRendererLike {
  readonly interactive: Promise<void>;
  readonly ready: Promise<void>;
  private aggregateDirty = true;
  private aggregateVisualDirty = true;
  private aggregatePlots: AggregatePlotResources[] = [];
  private aggregation: FastScatterAggregationSet | null = null;
  private aggregationBackend: 'external' | 'rust-wasm' | 'typescript' = 'typescript';
  private readonly aggregationBackendPreference: FastScatterWebgpuAggregationBackend;
  private aggregationWasm: FastScatterWebgpuWasmAggregationSession | null = null;
  private aggregationWasmAttempted = false;
  private animationFrame = 0;
  private cacheReady = false;
  private cacheSnapshot: CachedFrameSnapshot | null = null;
  private context: WebgpuContext | null = null;
  private devicePixelRatio = 1;
  private disposed = false;
  private exactRequested = true;
  private easterEggPlayback: FastScatterEasterEggPlayback | null = null;
  private easterEggResources: EasterEggResources | null = null;
  private firstFrameComplete: Promise<void>;
  private firstFrameResolved = false;
  private firstInteractiveFrame: Promise<void>;
  private interactiveFrameResolved = false;
  private inFlightCachedFrameCount = 0;
  private inFlightExactFrameCount = 0;
  private gpu: GpuResources | null = null;
  private gpuTimer: WebgpuTimestampProfiler | null = null;
  private heightCssPx = 0;
  private lastCachedGpuMs: number | undefined;
  private lastExactGpuMs: number | undefined;
  private lastLodPointCount = 0;
  private lastLodPointBudget = 0;
  private lastLodStart = 0;
  private lastLodStride = 1;
  private lastVisiblePointCount = 0;
  private options: FastScatterControllerOptions;
  private pendingDraw = false;
  private pointCapacity: number;
  private sampleReady = false;
  private rebuildVersion = 0;
  private coalescedFrameCount = 0;
  private submittedFrameCount = 0;
  private settledFrameCount = 0;
  private streamingAppendPending = false;
  private streamingQueuedUploadBytes = 0;
  private streamingPreviewTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private nextStreamingPreviewAt = 0;
  private widthCssPx = 0;
  private resolveFirstFrame!: () => void;
  private resolveInteractiveFrame!: () => void;

  constructor(private readonly rendererOptions: FastScatterWebgpuRendererOptions) {
    const {
      canvas: _canvas,
      aggregationBackend: _aggregationBackend,
      indexedStyle: _indexedStyle,
      lifecycle: _lifecycle,
      packedStyles: _packedStyles,
      pointCapacity: _pointCapacity,
      requestTimestampQuery: _requestTimestampQuery,
      ...options
    } = rendererOptions;
    void _canvas;
    this.aggregationBackendPreference = _aggregationBackend ?? 'auto';
    void _indexedStyle;
    void _lifecycle;
    void _packedStyles;
    this.pointCapacity = normalizePointCapacity(_pointCapacity, options.columns.x.length);
    void _requestTimestampQuery;
    this.options = options;
    this.firstFrameComplete = new Promise<void>((resolve) => {
      this.resolveFirstFrame = resolve;
    });
    this.firstInteractiveFrame = new Promise<void>((resolve) => {
      this.resolveInteractiveFrame = resolve;
    });
    this.interactive = this.initialize().then(() => this.firstInteractiveFrame);
    this.ready = this.interactive.then(() => this.firstFrameComplete);
    // Consumers commonly await only `interactive`; keep the stronger settled
    // promise rejecting for explicit awaiters without surfacing an unhandled
    // sibling rejection when initialization itself fails.
    void this.ready.catch(() => undefined);
  }

  update(options: Partial<FastScatterControllerOptions>): void {
    if (this.disposed) return;
    const previous = this.options;
    const rebuild =
      (options.columns !== undefined && options.columns !== previous.columns) ||
      (options.spec !== undefined && options.spec !== previous.spec) ||
      (options.hoverIndex !== undefined && options.hoverIndex !== previous.hoverIndex);
    const selectionChanged =
      options.selectedSourceIndices !== undefined &&
      options.selectedSourceIndices !== previous.selectedSourceIndices;
    const viewportChanged = options.viewport !== undefined &&
      !areViewportsEqual(options.viewport, previous.viewport);
    const nonViewportDrawChanged =
      (options.focusedPlotId !== undefined && options.focusedPlotId !== previous.focusedPlotId) ||
      (options.aggregation !== undefined && options.aggregation !== previous.aggregation) ||
      (options.heatmapBinSizePx !== undefined && options.heatmapBinSizePx !== previous.heatmapBinSizePx) ||
      (options.heatmapPalette !== undefined && options.heatmapPalette !== previous.heatmapPalette) ||
      (options.opacityScale !== undefined && options.opacityScale !== previous.opacityScale) ||
      (options.pointSizeScale !== undefined && options.pointSizeScale !== previous.pointSizeScale) ||
      (options.renderingMode !== undefined && options.renderingMode !== previous.renderingMode) ||
      (options.theme !== undefined && !areThemesEqual(options.theme, previous.theme)) ||
      (options.visualizationMode !== undefined && options.visualizationMode !== previous.visualizationMode);
    const drawChanged = viewportChanged || nonViewportDrawChanged;
    const aggregateDataChanged =
      selectionChanged || viewportChanged ||
      (options.aggregation !== undefined && options.aggregation !== previous.aggregation) ||
      (options.columns !== undefined && options.columns !== previous.columns) ||
      (options.focusedPlotId !== undefined && options.focusedPlotId !== previous.focusedPlotId) ||
      (options.heatmapBinSizePx !== undefined && options.heatmapBinSizePx !== previous.heatmapBinSizePx) ||
      (options.spec !== undefined && options.spec !== previous.spec) ||
      (options.visualizationMode !== undefined && options.visualizationMode !== previous.visualizationMode);
    const aggregateVisualChanged = aggregateDataChanged ||
      (options.heatmapPalette !== undefined && options.heatmapPalette !== previous.heatmapPalette) ||
      (options.theme !== undefined && !areThemesEqual(options.theme, previous.theme) &&
        normalizeFastScatterVisualizationMode(
          options.visualizationMode ?? previous.visualizationMode,
        ) === 'heatmap');
    this.options = { ...previous, ...options };
    this.rendererOptions.canvas.dataset.renderer =
      `webgpu-${normalizeFastScatterVisualizationMode(this.options.visualizationMode)}`;

    if (aggregateDataChanged) this.aggregateDirty = true;
    if (aggregateVisualChanged) this.aggregateVisualDirty = true;

    if (rebuild && this.context !== null) {
      void this.rebuildResources();
      return;
    }
    if (selectionChanged && this.context !== null && this.gpu !== null) {
      this.updateSelectedIndices(options.selectedSourceIndices ?? new Uint32Array(0));
    }
    if (drawChanged || selectionChanged) {
      this.exactRequested = true;
      this.scheduleDraw();
    }
  }

  async appendData({
    capacity,
    columns,
    maxPointSize,
    packedStyles,
    startPoint,
  }: FastScatterRendererAppendOptions): Promise<void> {
    if (this.disposed) return;
    const previousCount = this.options.columns.x.length;
    if (startPoint !== previousCount || columns.x.length < startPoint) {
      throw new Error(
        `Streamed scatter append starts at ${startPoint}; expected ${previousCount}.`,
      );
    }
    validatePointColumns(columns, this.options.spec);
    const nextPointCapacity = normalizePointCapacity(capacity, columns.x.length);
    const context = this.context;
    const gpu = this.gpu;
    if (context === null || gpu === null) {
      this.options = { ...this.options, columns };
      this.pointCapacity = nextPointCapacity;
      return;
    }

    if (nextPointCapacity > gpu.pointCapacity) {
      growGpuPointResources(
        context.device,
        gpu,
        nextPointCapacity,
        startPoint,
      );
      if (this.disposed || this.gpu !== gpu) return;
    }
    const indexedXRangeCompatible = isIndexedXRangeCompatible(
      columns.x,
      startPoint,
      gpu.xIndexedMode,
    );
    if (!indexedXRangeCompatible) {
      throw new Error(
        'Streamed scatter x values changed an indexed x layout detected in the first batch.',
      );
    }
    // Queue growth before publishing the larger logical count. Later writes and
    // draws execute after the GPU-to-GPU prefix copies on the same queue.
    this.options = { ...this.options, columns };
    this.pointCapacity = nextPointCapacity;

    const startedAt = performance.now();
    let uploadBytes = 0;
    if (gpu.xIndexedMode === 0) {
      uploadBytes += uploadEncodedColumnRange(
        context.device.queue,
        gpu.x,
        columns.x,
        startPoint,
        columns.x.length,
      );
    }
    const uploadedY = new Set<GPUBuffer>();
    for (const plot of gpu.plots) {
      if (uploadedY.has(plot.y.buffer)) continue;
      const values = columns.y[plot.yKey];
      if (values === undefined) continue;
      uploadedY.add(plot.y.buffer);
      uploadBytes += uploadEncodedColumnRange(
        context.device.queue,
        plot.y,
        values,
        startPoint,
        columns.x.length,
      );
    }
    if (gpu.styleMode === 0) {
      const appendedPointCount = columns.x.length - startPoint;
      if (packedStyles !== undefined && packedStyles.length !== appendedPointCount) {
        throw new Error(
          `Streamed scatter append supplied ${packedStyles.length} packed styles for ${appendedPointCount} points.`,
        );
      }
      const packed = packedStyles ?? new Uint32Array(appendedPointCount);
      const theme = this.options.theme ?? DEFAULT_THEME;
      if (packedStyles === undefined) {
        for (let index = startPoint; index < columns.x.length; index += 1) {
          const style = packFastScatterWebgpuStyle(
            columns,
            index,
            theme.defaultPointColor,
          );
          packed[index - startPoint] = compactStyleWords(style.color, style.meta);
          gpu.maxPointSize = Math.max(gpu.maxPointSize, style.size);
        }
      } else if (maxPointSize === undefined) {
        for (const word of packed) {
          gpu.maxPointSize = Math.max(gpu.maxPointSize, ((word >>> 29) & 0x7) + 1);
        }
      } else {
        gpu.maxPointSize = Math.max(gpu.maxPointSize, maxPointSize);
      }
      writeStyleQueueData(
        context.device.queue,
        gpu,
        startPoint * STYLE_STRIDE_BYTES,
        packed,
      );
      uploadBytes += packed.byteLength;
    }

    gpu.xSorted = gpu.xSorted && (
      gpu.xIndexedMode !== 0 || isNondecreasingRange(columns.x, startPoint)
    );
    gpu.uploadBytes += uploadBytes;
    this.streamingQueuedUploadBytes += uploadBytes;
    this.aggregationWasm = null;
    this.aggregationWasmAttempted = false;
    this.aggregateDirty = true;
    this.aggregateVisualDirty = true;
    // Appending points makes the cached frame incomplete, but it does not make
    // it unsafe to transform. Keep the last completed frame available for
    // interaction while the next exact frame is queued. This is especially
    // important when a large stream appends faster than the GPU can render:
    // discarding the cache here would stall every zoom/pan behind the in-flight
    // point draw even though a usable frame is already resident.
    this.sampleReady = false;
    this.exactRequested = true;
    this.streamingAppendPending = true;
    this.emitMetrics({
      durationMs: performance.now() - startedAt,
      phase: 'buffer-upload',
      pointCount: columns.x.length,
      uploadBytes,
      detail: JSON.stringify({
        backend: 'webgpu',
        capacity: gpu.pointCapacity,
        operation: 'stream-append',
        startPoint,
        uploadBytes,
      }),
    });
    this.scheduleStreamingPreview();
    if (this.streamingQueuedUploadBytes >= MAX_UPLOAD_STAGING_BYTES) {
      // Bound implementation-owned writeBuffer staging. Awaiting the queue
      // yields the event loop, so cached pointer interaction remains live while
      // the producer applies backpressure instead of forcing a synchronous
      // driver-side allocation on a later batch.
      this.streamingQueuedUploadBytes = 0;
      await context.device.queue.onSubmittedWorkDone();
    }
  }

  async finishDataAppend(): Promise<void> {
    if (this.disposed) return;
    if (this.streamingPreviewTimer !== null) {
      globalThis.clearTimeout(this.streamingPreviewTimer);
      this.streamingPreviewTimer = null;
    }
    this.streamingAppendPending = false;
    const context = this.context;
    const gpu = this.gpu;
    if (context !== null && gpu !== null) {
      // Do not overlap retained writeBuffer staging and preview work with the
      // largest settled draw at the stream's peak resident size.
      this.streamingQueuedUploadBytes = 0;
      await context.device.queue.onSubmittedWorkDone();
      if (this.disposed || this.context !== context || this.gpu !== gpu) return;
    }
    this.exactRequested = true;
    this.scheduleDraw();
  }

  updateViewport(
    viewport: FastScatterViewport,
    context: FastScatterRendererViewportUpdateContext,
  ): void {
    if (this.disposed) return;
    const changed = !areViewportsEqual(viewport, this.options.viewport);
    this.options = { ...this.options, viewport };
    if (context.phase === 'commit') {
      this.aggregateDirty = true;
      this.aggregateVisualDirty = true;
      if (this.cacheReady) {
        this.exactRequested = false;
        if (this.cacheSnapshot !== null) this.drawCachedFrameImmediately();
        this.exactRequested = true;
      } else {
        this.exactRequested = true;
      }
      this.scheduleDraw();
      return;
    }
    if (!changed) return;
    if (this.cacheReady) {
      this.exactRequested = false;
    } else {
      this.exactRequested = true;
    }
    if (this.cacheReady && this.cacheSnapshot !== null) {
      this.drawCachedFrameImmediately();
    } else {
      this.scheduleDraw();
    }
  }

  resize(widthCssPx: number, heightCssPx: number, devicePixelRatio: number): void {
    if (this.disposed) return;
    this.widthCssPx = Math.max(0, widthCssPx);
    this.heightCssPx = Math.max(0, heightCssPx);
    this.devicePixelRatio = normalizeDevicePixelRatio(devicePixelRatio);
    const width = this.widthCssPx > 0
      ? Math.max(1, Math.floor(this.widthCssPx * this.devicePixelRatio))
      : 0;
    const height = this.heightCssPx > 0
      ? Math.max(1, Math.floor(this.heightCssPx * this.devicePixelRatio))
      : 0;
    if (this.rendererOptions.canvas.width !== width) this.rendererOptions.canvas.width = width;
    if (this.rendererOptions.canvas.height !== height) this.rendererOptions.canvas.height = height;
    this.cacheReady = false;
    this.aggregateDirty = true;
    this.aggregateVisualDirty = true;
    this.exactRequested = true;
    this.scheduleDraw();
  }

  render(): void {
    if (!this.disposed) this.scheduleDraw();
  }

  getAggregation(): FastScatterAggregationSet | null {
    return this.aggregation;
  }

  playEasterEgg(options: FastScatterEasterEggPlaybackOptions = {}): boolean {
    if (this.disposed || this.easterEggPlayback !== null) return false;
    this.easterEggPlayback = createFastScatterEasterEggPlayback(options);
    this.exactRequested = true;
    this.scheduleDraw();
    return true;
  }

  isPointRendered(pointIndex: number, plotId: string): boolean {
    if (!Number.isInteger(pointIndex) || pointIndex < 0) return false;
    if (normalizeFastScatterVisualizationMode(this.options.visualizationMode) !== 'points') {
      return false;
    }
    if (!this.sampleReady) return true;
    if (this.lastLodPointCount === 0) return false;
    if (
      isFastScatterWebgpuLodPoint(
        pointIndex,
        this.lastLodStart,
        this.lastLodPointCount,
        this.lastLodStride,
      )
    ) {
      return true;
    }
    if (this.lastLodStride === 1) return false;
    const plot = this.gpu?.plots.find((candidate) => candidate.plotId === plotId);
    return plot !== undefined && sortedUint32ArrayIncludes(plot.overviewIndices, pointIndex);
  }

  getDiagnostics(): FastScatterWebgpuDiagnostics {
    const wasmDiagnostics = this.aggregationWasm?.getDiagnostics();
    const wasmResidentBytes = wasmDiagnostics?.residentBytes ?? 0;
    const aggregateBytes = calculateAggregateGpuResidentBytes(this.aggregatePlots);
    const residentBytes = (this.gpu === null
      ? aggregateBytes
      : calculateGpuResidentBytes(this.gpu) + aggregateBytes) + wasmResidentBytes;
    const requirements = calculateWebgpuBufferRequirements(
      this.options.columns,
      this.rendererOptions.packedStyles !== undefined,
      this.pointCapacity,
    );
    const visualizationMode = normalizeFastScatterVisualizationMode(
      this.options.visualizationMode,
    );
    const aggregateRenderedCount = this.aggregatePlots.reduce(
      (total, plot) => total + plot.instanceCount,
      0,
    );
    const aggregateTotalCount = this.aggregation?.kind === 'bubble'
      ? this.aggregation.totalAggregateCount
      : this.aggregation?.kind === 'heatmap'
        ? this.aggregation.totalPopulatedCellCount
        : 0;
    const settledExact = visualizationMode === 'points'
      ? this.lastLodStride === 1
      : visualizationMode === 'heatmap' || aggregateRenderedCount === aggregateTotalCount;
    return {
      adapterInfo: this.context === null ? undefined : {
        architecture: this.context.adapter.info.architecture,
        description: this.context.adapter.info.description,
        device: this.context.adapter.info.device,
        vendor: this.context.adapter.info.vendor,
      },
      aggregationBackend: this.aggregationBackend,
      aggregationBackendPreference: this.aggregationBackendPreference,
      aggregationWasm: wasmDiagnostics,
      backend: 'webgpu',
      pointCount: this.options.columns.x.length,
      pointCapacity: this.pointCapacity,
      ready: this.context !== null && this.gpu !== null,
      selectedPointCount: this.gpu?.selectedCount ?? 0,
      selectedStorageBytes: (this.gpu?.selectedCapacity ?? 1) * Uint32Array.BYTES_PER_ELEMENT,
      selectedStorageMode: this.gpu?.selectedDense === true ? 'bitset' : 'indices',
      settledExact,
      settledFrameCount: this.settledFrameCount,
      settledPointCoverage: visualizationMode === 'points'
        ? this.lastVisiblePointCount === 0
          ? 1
          : this.lastLodPointCount / this.lastVisiblePointCount
        : aggregateTotalCount === 0
          ? 1
          : aggregateRenderedCount / aggregateTotalCount,
      timestampQuerySupported: this.context?.timestampQuerySupported ?? false,
      lastExactGpuMs: this.lastExactGpuMs,
      lastCachedGpuMs: this.lastCachedGpuMs,
      lodPointCount: visualizationMode === 'points'
        ? this.lastLodPointCount
        : aggregateRenderedCount,
      lodPointBudget: visualizationMode === 'points'
        ? this.lastLodPointBudget
        : FAST_SCATTER_WEBGPU_MAX_RENDERED_POINTS_PER_SUBPLOT * Math.max(1, this.aggregatePlots.length),
      lodStride: visualizationMode === 'points'
        ? this.lastLodStride
        : Math.max(1, Math.ceil(aggregateTotalCount / Math.max(1, aggregateRenderedCount))),
      overviewRepresentativeCount: visualizationMode === 'points' ? this.gpu?.plots.reduce(
        (total, plot) => total + plot.overviewCount,
        0,
      ) ?? 0 : 0,
      uploadBytes: this.gpu?.uploadBytes ?? 0,
      cacheBytes: this.gpu === null
        ? 0
        : this.gpu.cacheWidth * this.gpu.cacheHeight * 8,
      cacheReady: this.cacheReady,
      coalescedFrameCount: this.coalescedFrameCount,
      deviceLimits: this.context === null ? undefined : {
        maxBufferSize: this.context.limits.maxBufferSize,
        maxStorageBufferBindingSize: this.context.limits.maxStorageBufferBindingSize,
        maxStorageBuffersPerShaderStage: this.context.limits.maxStorageBuffersPerShaderStage,
      },
      estimatedPeakBytes: residentBytes + (this.gpu === null ? 0 : MAX_UPLOAD_STAGING_BYTES),
      exactReady: this.firstFrameResolved,
      interactionCacheOverscan: INTERACTION_CACHE_OVERSCAN,
      interactiveReady: this.interactiveFrameResolved,
      residentBytes,
      requiredBufferSize: requirements.requiredBufferSize,
      requiredStorageBufferBindingSize: requirements.requiredStorageBufferBindingSize,
      submittedFrameCount: this.submittedFrameCount,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.firstFrameResolved) {
      this.firstFrameResolved = true;
      this.resolveFirstFrame();
    }
    if (!this.interactiveFrameResolved) {
      this.interactiveFrameResolved = true;
      this.resolveInteractiveFrame();
    }
    this.rebuildVersion += 1;
    if (this.animationFrame !== 0) {
      globalThis.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    if (this.streamingPreviewTimer !== null) {
      globalThis.clearTimeout(this.streamingPreviewTimer);
      this.streamingPreviewTimer = null;
    }
    this.destroyResources();
    this.gpuTimer?.dispose();
    this.gpuTimer = null;
    this.context?.canvasContext.unconfigure();
    this.context?.device.destroy();
    this.context = null;
    this.emitMetrics({ phase: 'dispose' });
  }

  private async initialize(): Promise<void> {
    const startedAt = performance.now();
    try {
      const columns = this.options.columns;
      const hasPerPointStyles = this.rendererOptions.packedStyles !== undefined ||
        columns.color !== undefined || columns.opacity !== undefined ||
        columns.rotation !== undefined || columns.shape !== undefined ||
        columns.size !== undefined;
      const requirements = calculateWebgpuBufferRequirements(
        columns,
        hasPerPointStyles,
        this.pointCapacity,
      );
      const context = await createWebgpuContext({
        canvas: this.rendererOptions.canvas,
        onDeviceLost: (info) => this.handleDeviceLost(info),
        powerPreference: 'high-performance',
        requestTimestampQuery: this.rendererOptions.requestTimestampQuery ?? true,
        requiredBufferSize: requirements.requiredBufferSize,
        requiredStorageBufferBindingSize: requirements.requiredStorageBufferBindingSize,
      });
      if (this.disposed) {
        context.device.destroy();
        return;
      }
      this.context = context;
      this.gpuTimer = new WebgpuTimestampProfiler(
        context.device,
        context.timestampQuerySupported,
      );
      this.emitMetrics({
        durationMs: performance.now() - startedAt,
        gpuTimerSupported: context.timestampQuerySupported,
        phase: 'init',
        pointCount: this.options.columns.x.length,
        detail: JSON.stringify({
          backend: 'webgpu',
          limits: context.limits,
          timestampQuerySupported: context.timestampQuerySupported,
        }),
      });
      await this.rebuildResources();
    } catch (error) {
      this.emitMetrics({
        durationMs: performance.now() - startedAt,
        phase: 'init',
        pointCount: this.options.columns.x.length,
        detail: JSON.stringify({
          backend: 'webgpu',
          error: error instanceof Error ? error.message : String(error),
          status: 'error',
        }),
      });
      throw error;
    }
  }

  private async rebuildResources(): Promise<void> {
    const context = this.context;
    if (context === null || this.disposed) return;
    const version = ++this.rebuildVersion;
    const startedAt = performance.now();
    const columns = this.options.columns;
    const spec = this.options.spec;
    validatePointColumns(columns, spec);

    if (this.gpu !== null) {
      await context.device.queue.onSubmittedWorkDone();
      if (this.disposed || version !== this.rebuildVersion) return;
      this.destroyResources();
    }

    const next = await createGpuResources(
      context,
      columns,
      spec,
      this.options.theme,
      this.rendererOptions.indexedStyle === true,
      this.rendererOptions.packedStyles,
      this.options.hoverIndex,
      this.pointCapacity,
    );
    if (this.disposed || version !== this.rebuildVersion) {
      destroyGpuResources(next);
      return;
    }
    this.gpu = next;
    this.aggregateDirty = true;
    this.aggregateVisualDirty = true;
    this.cacheReady = false;
    this.cacheSnapshot = null;
    this.sampleReady = false;
    this.exactRequested = true;
    this.updateSelectedIndices(this.options.selectedSourceIndices ?? new Uint32Array(0));
    this.emitMetrics({
      durationMs: performance.now() - startedAt,
      phase: 'buffer-upload',
      pointCount: columns.x.length,
      uploadBytes: next.uploadBytes,
      detail: JSON.stringify({
        backend: 'webgpu',
        compactSelectionOverlay: true,
        precisionEncoding: 'normalized-f32',
        styleMode: next.styleMode === 2 ? 'indexed' : next.styleMode === 1 ? 'constant' : 'columns',
        styleStrideBytes: STYLE_STRIDE_BYTES,
        uploadBytes: next.uploadBytes,
        xSorted: next.xSorted,
      }),
    });
    this.scheduleDraw();
  }

  private updateSelectedIndices(sourceIndices: Uint32Array): void {
    const context = this.context;
    const gpu = this.gpu;
    if (context === null || gpu === null) return;
    const startedAt = performance.now();
    const pointCount = this.options.columns.x.length;
    const pointIndices = materializePointIndices(gpu, sourceIndices, pointCount);
    const dense = pointIndices.length > 0;
    const upload = dense
      ? createFastScatterWebgpuSelectedBitset(pointIndices, pointCount)
      : new Uint32Array(0);
    const requiredCapacity = Math.max(1, nextPowerOfTwo(upload.length));
    let bufferChanged = false;
    if (requiredCapacity > gpu.selectedCapacity) {
      gpu.selectedBuffer.destroy();
      gpu.selectedBuffer = context.device.createBuffer({
        label: 'm-scatter-webgpu/selected-bitset',
        size: requiredCapacity * Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
      });
      gpu.selectedCapacity = requiredCapacity;
      bufferChanged = true;
    }
    if (upload.length > 0) {
      context.device.queue.writeBuffer(
        gpu.selectedBuffer,
        0,
        upload.buffer,
        upload.byteOffset,
        upload.byteLength,
      );
    }
    gpu.selectedCount = pointIndices.length;
    gpu.selectedDense = dense;
    if (bufferChanged) recreatePlotBindGroups(context.device, gpu);
    this.emitMetrics({
      durationMs: performance.now() - startedAt,
      phase: 'selection',
      pointCount: this.options.columns.x.length,
      selectedPointCount: pointIndices.length,
      uploadBytes: upload.byteLength,
      detail: JSON.stringify({
        backend: 'webgpu',
        sampledOverlay: true,
        selectionBitsetUpload: dense,
        operation: 'selected-index-overlay',
        uploadBytes: upload.byteLength,
      }),
    });
    this.exactRequested = true;
    this.scheduleDraw();
  }

  private scheduleDraw(): void {
    if (this.animationFrame !== 0 || this.disposed) {
      if (this.animationFrame !== 0) this.coalescedFrameCount += 1;
      return;
    }
    this.animationFrame = globalThis.requestAnimationFrame(() => {
      this.animationFrame = 0;
      this.drawFrame();
    });
  }

  private drawCachedFrameImmediately(): void {
    if (this.easterEggPlayback !== null) {
      this.exactRequested = true;
      this.scheduleDraw();
      return;
    }
    if (this.animationFrame !== 0) {
      globalThis.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
      this.coalescedFrameCount += 1;
    }
    this.drawCachedFrame();
  }

  private drawFrame(): void {
    const cachedFrame = !this.exactRequested && this.cacheReady && this.cacheSnapshot !== null;
    if (!cachedFrame && this.inFlightExactFrameCount >= 1) {
      this.coalescedFrameCount += 1;
      // A preview requested while another streaming preview is still running
      // is already stale. Drop it instead of turning `pendingDraw` into a
      // continuous GPU loop. `finishDataAppend` clears the streaming flag, so
      // the final static-equivalent frame is still guaranteed to run next.
      if (!this.streamingAppendPending) this.pendingDraw = true;
      return;
    }
    if (cachedFrame) {
      this.drawCachedFrame();
      return;
    }
    this.drawExactFrame();
  }

  private drawExactFrame(): void {
    const context = this.context;
    const gpu = this.gpu;
    const canvas = this.rendererOptions.canvas;
    if (
      this.disposed || context === null || gpu === null ||
      canvas.width <= 0 || canvas.height <= 0 ||
      this.widthCssPx <= 0 || this.heightCssPx <= 0
    ) return;

    const startedAt = performance.now();
    this.ensureCacheTexture(context.device, context.format, gpu, canvas.width, canvas.height);
    const theme = this.options.theme ?? DEFAULT_THEME;
    const layout = createFastScatterLayout(this.options.spec, {
      focusedPlotId: this.options.focusedPlotId,
      heightCssPx: this.heightCssPx,
      widthCssPx: this.widthCssPx,
    });
    const displayRenderPlan = layout.plotRects.map((rect) =>
      rectToDevicePixels(rect, this.devicePixelRatio)
    );
    const cacheScaleX = gpu.cacheWidth / canvas.width;
    const cacheScaleY = gpu.cacheHeight / canvas.height;
    const renderPlan = displayRenderPlan.map((rect) =>
      scaleDeviceRect(rect, cacheScaleX, cacheScaleY)
    );
    const easterEggFrame = this.createEasterEggFrame(gpu);
    const renderViewport = createOverscanViewport(
      this.options.viewport,
      cacheScaleX,
      cacheScaleY,
    );
    const visualizationMode = normalizeFastScatterVisualizationMode(
      this.options.visualizationMode,
    );
    const frameViewport = visualizationMode === 'points'
      ? renderViewport
      : this.options.viewport;
    if (visualizationMode === 'points') {
      this.deleteAggregateResources();
      this.aggregationWasm = null;
      this.aggregationWasmAttempted = false;
      this.aggregationBackend = 'typescript';
      this.aggregateDirty = true;
      this.aggregateVisualDirty = true;
    } else {
      this.ensureAggregateResources(layout.plotRects, visualizationMode);
    }
    const frameAggregation = this.aggregation;
    const aggregateResidentBytes = calculateAggregateGpuResidentBytes(this.aggregatePlots) +
      (this.aggregationWasm?.getDiagnostics().residentBytes ?? 0);
    const totalPlotArea = displayRenderPlan.reduce(
      (total, rect) => total + rect.widthCssPx * rect.heightCssPx,
      0,
    );
    const unpaddedVisibleRange = resolveVisibleRange(
      this.options.columns,
      renderViewport.x,
      gpu.xSorted,
    );
    const alphaPolicy = resolveFastScatterAlphaPolicy({
      plotAreaPx: totalPlotArea,
      pointCount: unpaddedVisibleRange.end - unpaddedVisibleRange.start,
      requestedRenderingMode: this.options.renderingMode,
    });
    const userPointSizeScale = normalizeFastScatterPointSizeScale(this.options.pointSizeScale);
    const maxPlotWidthCssPx = layout.plotRects.reduce(
      (max, rect) => Math.max(max, rect.widthCssPx),
      1,
    );
    const xSpan = Math.abs(renderViewport.x.max - renderViewport.x.min);
    const xPadding =
      (xSpan * gpu.maxPointSize * userPointSizeScale * alphaPolicy.pointSizeScale) /
      maxPlotWidthCssPx;
    const visibleRange = resolveVisibleRange(
      this.options.columns,
      {
        max: renderViewport.x.max + xPadding,
        min: renderViewport.x.min - xPadding,
      },
      gpu.xSorted,
    );
    const visibleCount = visibleRange.end - visibleRange.start;
    const maxVisibleOverviewCount = gpu.plots.reduce(
      (max, plot) => Math.max(
        max,
        countSortedUint32ValuesInRange(
          plot.overviewIndices,
          visibleRange.start,
          visibleRange.end,
        ),
      ),
      0,
    );
    const maximumRenderedPoints = this.streamingAppendPending
      ? STREAMING_PREVIEW_POINTS_PER_SUBPLOT
      : FAST_SCATTER_WEBGPU_MAX_RENDERED_POINTS_PER_SUBPLOT;
    const lodPointBudget = visibleCount <= maximumRenderedPoints
      ? maximumRenderedPoints
      : Math.max(
          1,
          maximumRenderedPoints - maxVisibleOverviewCount,
        );
    const lodRange = calculateFastScatterWebgpuLodRange(
      visibleRange.start,
      visibleRange.end,
      lodPointBudget,
    );
    const lodStride = lodRange.stride;
    const lodStart = lodRange.start;
    const lodPointCount = lodRange.count;
    this.lastLodPointCount = lodPointCount;
    this.lastLodPointBudget = lodPointBudget;
    this.lastLodStart = lodStart;
    this.lastLodStride = lodStride;
    this.lastVisiblePointCount = visibleCount;
    this.sampleReady = true;
    const encoder = context.device.createCommandEncoder({ label: 'm-scatter-webgpu/frame' });
    const timingMetadata = { cpuDurationMs: 0, drawCalls: 0, visibleCount };
    const timingFrame = this.gpuTimer?.beginFrame((gpuDurationMs) => {
      if (this.disposed || this.gpu !== gpu) return;
      this.lastExactGpuMs = gpuDurationMs;
      this.emitMetrics({
        aggregateCount: frameAggregation?.kind === 'bubble'
          ? frameAggregation.totalAggregateCount
          : undefined,
        cellCount: frameAggregation?.kind === 'heatmap'
          ? frameAggregation.totalCellCount
          : undefined,
        displayMode: visualizationMode,
        drawCalls: timingMetadata.drawCalls,
        durationMs: timingMetadata.cpuDurationMs,
        gpuDurationMs,
        gpuTimerSupported: true,
        phase: 'render',
        pointCount: this.options.columns.x.length,
        populatedCellCount: frameAggregation?.kind === 'heatmap'
          ? frameAggregation.totalPopulatedCellCount
          : undefined,
        selectedPointCount: gpu.selectedCount,
        subplotCount: gpu.plots.length,
        visiblePointCount: timingMetadata.visibleCount,
        detail: JSON.stringify({
          aggregate: createAggregateMetricDetail(
            frameAggregation,
            this.aggregationBackend,
            this.aggregationWasm?.getDiagnostics(),
          ),
          backend: 'webgpu',
          cacheBytes: gpu.cacheWidth * gpu.cacheHeight * 8,
          cachedInteractionFrame: false,
          coalescedFrameCount: this.coalescedFrameCount,
          cpuDurationMs: timingMetadata.cpuDurationMs,
          lodPointCount,
          lodPointBudget,
          lodStride,
          settledExact: lodStride === 1,
          settledPointCoverage: visibleCount === 0 ? 1 : lodPointCount / visibleCount,
          estimatedPeakBytes:
            calculateGpuResidentBytes(gpu) + aggregateResidentBytes + MAX_UPLOAD_STAGING_BYTES,
          profileOnly: true,
          progressiveExact: false,
          residentBytes: calculateGpuResidentBytes(gpu) + aggregateResidentBytes,
          submittedFrameCount: this.submittedFrameCount,
        }),
      });
    }) ?? null;
    const view = this.cacheReady ? gpu.workView : gpu.cacheView;
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        clearValue: toGpuColor(theme.backgroundColor),
        loadOp: 'clear',
        storeOp: 'store',
        view,
      }],
      label: 'm-scatter-webgpu/points-pass',
      timestampWrites: timingFrame?.timestampWrites,
    });

    let drawCalls = 0;
    for (const [plotIndex, plot] of gpu.plots.entries()) {
      const rect = renderPlan[plotIndex];
      const yRange = frameViewport.yByPlot[plot.plotId];
      if (rect === undefined || yRange === undefined || rect.widthCssPx <= 0 || rect.heightCssPx <= 0) {
        continue;
      }
      const encodedX = encodeXRangeForRender(
        renderViewport.x,
        gpu.x.encoding,
        gpu.xIndexedMode,
      );
      writePlotUniforms(context.device, plot, {
        alphaScale: alphaPolicy.alphaScale,
        canvasHeight: gpu.cacheHeight,
        canvasWidth: gpu.cacheWidth,
        devicePixelRatio: this.devicePixelRatio,
        opacityScale: normalizeFastScatterOpacityScale(this.options.opacityScale),
        plotHeight: rect.heightCssPx,
        plotWidth: rect.widthCssPx,
        plotX: rect.xCssPx,
        plotY: rect.yCssPx,
        pointSizeScale:
          normalizeFastScatterPointSizeScale(this.options.pointSizeScale) * alphaPolicy.pointSizeScale,
        pointIndexBase: lodStart,
        pointIndexStride: lodStride,
        alphaWeight: lodStride,
        indexedPass: false,
        selectedPass: false,
        selectedIndexMode: 0,
        theme,
        xIndexOrigin: encodedX.origin,
        xRange: encodedX.range,
        yRange: encodeFastScatterWebgpuRange(yRange, plot.y.encoding),
        yStorageMode: plot.y.storageMode,
      });
      pass.setScissorRect(
        clampInteger(rect.xCssPx, 0, gpu.cacheWidth),
        clampInteger(rect.yCssPx, 0, gpu.cacheHeight),
        clampInteger(rect.widthCssPx, 1, gpu.cacheWidth - clampInteger(rect.xCssPx, 0, gpu.cacheWidth)),
        clampInteger(rect.heightCssPx, 1, gpu.cacheHeight - clampInteger(rect.yCssPx, 0, gpu.cacheHeight)),
      );
      pass.setBindGroup(0, plot.bindGroup);
      pass.setPipeline(gpu.backgroundPipeline);
      pass.draw(3);
      drawCalls += 1;
      if (easterEggFrame?.plotId === plot.plotId) {
        const resources = this.ensureEasterEggResources(
          context.device,
          gpu,
          easterEggFrame.playback,
        );
        updateFastScatterEasterEggPositions(
          easterEggFrame.playback,
          easterEggFrame.elapsedMs,
          resources.currentX,
          resources.currentY,
        );
        updateEasterEggInstancePositions(resources);
        context.device.queue.writeBuffer(resources.buffer, 0, resources.instanceData);
        writeAggregateUniforms(context.device, resources.uniformBuffer, {
          cacheScaleX,
          cacheScaleY,
          canvasHeight: gpu.cacheHeight,
          canvasWidth: gpu.cacheWidth,
          cellHeightPx: 1,
          cellWidthPx: 1,
          mode: 'point',
          devicePixelRatio: this.devicePixelRatio,
          opacityScale: 1,
          plotHeight: rect.heightCssPx,
          plotWidth: rect.widthCssPx,
          plotX: rect.xCssPx,
          plotY: rect.yCssPx,
          pointSizeScale: 1,
          theme,
          // Counter the interaction cache's overscan so normalized word
          // coordinates retain the same visible padding as WebGL.
          xRange: expandRange({ min: 0, max: 1 }, cacheScaleX),
          yRange: expandRange({ min: 0, max: 1 }, cacheScaleY),
        });
        pass.setBindGroup(0, resources.bindGroup);
        pass.setPipeline(gpu.aggregatePipeline);
        pass.draw(4, resources.pointCount);
        drawCalls += 1;
        continue;
      }
      if (visualizationMode !== 'points') {
        const aggregatePlot = this.aggregatePlots.find(
          (candidate) => candidate.plotId === plot.plotId && candidate.yKey === plot.yKey,
        );
        if (aggregatePlot !== undefined && aggregatePlot.instanceCount > 0) {
          writeAggregateUniforms(context.device, aggregatePlot.uniformBuffer, {
            cacheScaleX,
            cacheScaleY,
            canvasHeight: gpu.cacheHeight,
            canvasWidth: gpu.cacheWidth,
            cellHeightPx: aggregatePlot.cellHeightPx,
            cellWidthPx: aggregatePlot.cellWidthPx,
            mode: visualizationMode,
            devicePixelRatio: this.devicePixelRatio,
            opacityScale: normalizeFastScatterOpacityScale(this.options.opacityScale),
            plotHeight: rect.heightCssPx,
            plotWidth: rect.widthCssPx,
            plotX: rect.xCssPx,
            plotY: rect.yCssPx,
            pointSizeScale: normalizeFastScatterPointSizeScale(this.options.pointSizeScale),
            theme,
            xRange: frameViewport.x,
            yRange,
          });
          pass.setBindGroup(0, aggregatePlot.bindGroup);
          pass.setPipeline(gpu.aggregatePipeline);
          pass.draw(4, aggregatePlot.instanceCount);
          drawCalls += 1;
        }
      } else if (lodPointCount > 0) {
        pass.setPipeline(gpu.pipelines[plot.y.storageMode]);
        pass.draw(4, lodPointCount);
        drawCalls += 1;
      }
      if (visualizationMode === 'points' && lodStride > 1 && plot.overviewCount > 0) {
        writePlotUniforms(context.device, plot, {
          alphaScale: alphaPolicy.alphaScale,
          canvasHeight: gpu.cacheHeight,
          canvasWidth: gpu.cacheWidth,
          devicePixelRatio: this.devicePixelRatio,
          opacityScale: normalizeFastScatterOpacityScale(this.options.opacityScale),
          plotHeight: rect.heightCssPx,
          plotWidth: rect.widthCssPx,
          plotX: rect.xCssPx,
          plotY: rect.yCssPx,
          pointSizeScale:
            normalizeFastScatterPointSizeScale(this.options.pointSizeScale) *
            alphaPolicy.pointSizeScale,
          pointIndexBase: 0,
          pointIndexStride: 1,
          alphaWeight: lodStride,
          indexedPass: true,
          selectedPass: false,
          selectedIndexMode: 0,
          theme,
          xIndexOrigin: encodedX.origin,
          xRange: encodedX.range,
          yRange: encodeFastScatterWebgpuRange(yRange, plot.y.encoding),
          yStorageMode: plot.y.storageMode,
        });
        pass.setBindGroup(0, plot.overviewBindGroup);
        pass.setPipeline(gpu.pipelines[plot.y.storageMode]);
        pass.draw(4, plot.overviewCount);
        drawCalls += 1;
      }
      if (visualizationMode === 'points' && gpu.selectedCount > 0) {
        writePlotUniforms(context.device, plot, {
          alphaScale: 1,
          canvasHeight: gpu.cacheHeight,
          canvasWidth: gpu.cacheWidth,
          devicePixelRatio: this.devicePixelRatio,
          opacityScale: 1,
          plotHeight: rect.heightCssPx,
          plotWidth: rect.widthCssPx,
          plotX: rect.xCssPx,
          plotY: rect.yCssPx,
          pointSizeScale: normalizeFastScatterPointSizeScale(this.options.pointSizeScale),
          pointIndexBase: lodStart,
          pointIndexStride: lodStride,
          alphaWeight: 1,
          indexedPass: false,
          selectedPass: true,
          selectedIndexMode: 1,
          theme,
          xIndexOrigin: encodedX.origin,
          xRange: encodedX.range,
          yRange: encodeFastScatterWebgpuRange(yRange, plot.y.encoding),
          yStorageMode: plot.y.storageMode,
        });
        pass.setBindGroup(0, plot.selectedBindGroup);
        pass.setPipeline(gpu.selectedDensePipelines[plot.y.storageMode]);
        if (lodPointCount > 0) {
          pass.draw(4, lodPointCount);
          drawCalls += 1;
        }
        if (lodStride > 1 && plot.overviewCount > 0) {
          writePlotUniforms(context.device, plot, {
            alphaScale: 1,
            canvasHeight: gpu.cacheHeight,
            canvasWidth: gpu.cacheWidth,
            devicePixelRatio: this.devicePixelRatio,
            opacityScale: 1,
            plotHeight: rect.heightCssPx,
            plotWidth: rect.widthCssPx,
            plotX: rect.xCssPx,
            plotY: rect.yCssPx,
            pointSizeScale: normalizeFastScatterPointSizeScale(this.options.pointSizeScale),
            pointIndexBase: 0,
            pointIndexStride: 1,
            alphaWeight: 1,
            indexedPass: true,
            selectedPass: true,
            selectedIndexMode: 1,
            theme,
            xIndexOrigin: encodedX.origin,
            xRange: encodedX.range,
            yRange: encodeFastScatterWebgpuRange(yRange, plot.y.encoding),
            yStorageMode: plot.y.storageMode,
          }, 'selected-overview');
          pass.setBindGroup(0, plot.selectedOverviewBindGroup);
          pass.draw(4, plot.overviewCount);
          drawCalls += 1;
        }
      }
    }
    pass.end();
    if (this.cacheReady) {
      this.swapCacheTextures(context.device, gpu);
    }
    this.encodeCompositePass(
      encoder,
      gpu,
      displayRenderPlan,
      this.options.viewport,
      frameViewport,
      theme,
    );
    timingFrame?.resolve(encoder);
    const snapshot = cloneViewport(frameViewport);
    this.cacheSnapshot = {
      viewport: snapshot,
    };
    this.cacheReady = true;
    this.exactRequested = false;
    this.submitFrame(context, encoder, timingFrame, true, true, 'exact');
    const durationMs = performance.now() - startedAt;
    timingMetadata.cpuDurationMs = durationMs;
    timingMetadata.drawCalls = drawCalls;
    const userOpacityScale = normalizeFastScatterOpacityScale(this.options.opacityScale);
    this.emitMetrics({
      aggregateCount: frameAggregation?.kind === 'bubble'
        ? frameAggregation.totalAggregateCount
        : undefined,
      cellCount: frameAggregation?.kind === 'heatmap'
        ? frameAggregation.totalCellCount
        : undefined,
      displayMode: visualizationMode,
      drawCalls,
      durationMs,
      gpuDurationMs: this.gpuTimer?.lastDurationMs,
      gpuTimerSupported: context.timestampQuerySupported,
      phase: 'render',
      pointCount: this.options.columns.x.length,
      populatedCellCount: frameAggregation?.kind === 'heatmap'
        ? frameAggregation.totalPopulatedCellCount
        : undefined,
      selectedPointCount: gpu.selectedCount,
      subplotCount: gpu.plots.length,
      visiblePointCount: visibleCount,
      detail: JSON.stringify({
        aggregate: createAggregateMetricDetail(
          frameAggregation,
          this.aggregationBackend,
          this.aggregationWasm?.getDiagnostics(),
        ),
        backend: 'webgpu',
        cacheBytes: gpu.cacheWidth * gpu.cacheHeight * 8,
        cachedInteractionFrame: false,
        coalescedFrameCount: this.coalescedFrameCount,
        compactSelectedDraw: gpu.selectedCount > 0,
        easterEgg: {
          active: easterEggFrame !== null,
          plotId: easterEggFrame?.plotId ?? null,
          pointCount: this.easterEggResources?.pointCount ?? 0,
        },
        lodPointCount,
        lodPointBudget,
        lodStride,
        streamingPreview: this.streamingAppendPending,
        settledExact: lodStride === 1,
        settledPointCoverage: visibleCount === 0 ? 1 : lodPointCount / visibleCount,
        progressiveExact: false,
        cpuDurationMs: durationMs,
        estimatedPeakBytes:
          calculateGpuResidentBytes(gpu) + aggregateResidentBytes + MAX_UPLOAD_STAGING_BYTES,
        firstInstance: lodStart,
        renderPolicy: {
          alphaScale: alphaPolicy.alphaScale,
          blendMode: alphaPolicy.blendMode,
          densityPointsPerPixel: alphaPolicy.densityPointsPerPixel,
          effectiveOpacityScale: userOpacityScale * alphaPolicy.alphaScale,
          effectivePointSizeScale: userPointSizeScale * alphaPolicy.pointSizeScale,
          effectiveRenderingMode: alphaPolicy.effectiveRenderingMode,
          mode: alphaPolicy.mode,
          pointSizeScale: alphaPolicy.pointSizeScale,
          renderingPolicy: alphaPolicy.renderingPolicy,
          requestedRenderingMode: alphaPolicy.requestedRenderingMode,
          userOpacityScale,
          userPointSizeScale,
          visualizationMode,
        },
        selectedPointCount: gpu.selectedCount,
        residentBytes: calculateGpuResidentBytes(gpu) + aggregateResidentBytes,
        sharedSourceBuffers: true,
        submittedFrameCount: this.submittedFrameCount,
        visiblePointCount: visibleCount,
        xRangeCulling: gpu.xSorted,
      }),
    });
    if (this.easterEggPlayback !== null) {
      this.exactRequested = true;
      this.scheduleDraw();
    }
  }

  private ensureAggregateResources(
    plotRects: readonly FastScatterPlotRect[],
    mode: 'bubble' | 'heatmap',
  ): void {
    const context = this.context;
    const gpu = this.gpu;
    if (
      context === null || gpu === null ||
      (!this.aggregateDirty && !this.aggregateVisualDirty && this.aggregation?.kind === mode)
    ) return;
    const rebuildStartedAt = performance.now();
    this.deleteAggregatePlotResources();
    let aggregation = this.aggregation;
    if (this.aggregateDirty) {
      const subplots = this.options.spec.plots.flatMap((plot, index) => {
        const rect = plotRects[index];
        const yRange = this.options.viewport.yByPlot[plot.id];
        return rect === undefined || yRange === undefined
          ? []
          : [{
              plotHeightPx: rect.heightCssPx,
              plotId: plot.id,
              plotWidthPx: rect.widthCssPx,
              yKey: plot.yKey,
              yRange,
            }];
      });
      const external = this.options.aggregation;
      if (external !== undefined) {
        aggregation = external?.kind === mode ? external : null;
        this.aggregationBackend = 'external';
      } else if (mode === 'bubble') {
        this.ensureWasmAggregationSession(gpu);
        const request = {
          hoverSourceIndex: null,
          mode: 'bubble' as const,
          selectedSourceIndices: this.options.selectedSourceIndices,
          subplots,
          xRange: this.options.viewport.x,
        };
        const wasmAggregation = this.buildWasmAggregation(request);
        aggregation = wasmAggregation ??
          buildFastScatterWebgpuBubbleAggregation(this.options.columns, request);
        this.aggregationBackend = wasmAggregation === null ? 'typescript' : 'rust-wasm';
      } else {
        this.ensureWasmAggregationSession(gpu);
        const request = {
          heatBinPx: normalizeHeatmapBinSize(this.options.heatmapBinSizePx),
          hoverSourceIndex: null,
          mode: 'heatmap' as const,
          selectedSourceIndices: this.options.selectedSourceIndices,
          subplots,
          xRange: this.options.viewport.x,
        };
        const wasmAggregation = this.buildWasmAggregation(request);
        aggregation = wasmAggregation ??
          buildFastScatterAggregation(this.options.columns, request);
        this.aggregationBackend = wasmAggregation === null ? 'typescript' : 'rust-wasm';
      }
      this.aggregation = aggregation;
    }
    if (aggregation === null) {
      this.aggregateDirty = false;
      this.aggregateVisualDirty = false;
      return;
    }
    const theme = this.options.theme ?? DEFAULT_THEME;
    const maxBubbleCount = aggregation.kind === 'bubble'
      ? aggregation.subplots.reduce((maximum, subplot) => {
          for (const count of subplot.counts) maximum = Math.max(maximum, count);
          return maximum;
        }, 1)
      : 1;
    this.aggregatePlots = aggregation.kind === 'bubble'
      ? aggregation.subplots.map((subplot, plotIndex) => {
      const rect = plotRects[plotIndex];
      const instanceData = createBubbleAggregateInstanceData(
            subplot,
            rect?.widthCssPx ?? 1,
            rect?.heightCssPx ?? 1,
            maxBubbleCount,
          );
      return this.createAggregatePlotResources(context.device, gpu, mode, subplot.plotId, subplot.yKey, instanceData);
    })
      : aggregation.subplots.map((subplot) => {
      const instanceData = createHeatmapAggregateInstanceData(
        subplot,
        theme,
        normalizeFastScatterHeatmapPalette(this.options.heatmapPalette),
      );
      return this.createAggregatePlotResources(context.device, gpu, mode, subplot.plotId, subplot.yKey, instanceData);
    });
    this.aggregateDirty = false;
    this.aggregateVisualDirty = false;
    this.emitMetrics({
      aggregateCount: aggregation.kind === 'bubble'
        ? aggregation.totalAggregateCount
        : undefined,
      cellCount: aggregation.kind === 'heatmap' ? aggregation.totalCellCount : undefined,
      displayMode: mode,
      durationMs: performance.now() - rebuildStartedAt,
      phase: 'buffer-upload',
      pointCount: this.options.columns.x.length,
      populatedCellCount: aggregation.kind === 'heatmap'
        ? aggregation.totalPopulatedCellCount
        : undefined,
      uploadBytes: this.aggregatePlots.reduce(
        (total, plot) => total + plot.instanceCount * AGGREGATE_INSTANCE_BYTES,
        0,
      ),
    });
  }

  private ensureWasmAggregationSession(gpu: GpuResources): void {
    if (this.aggregationBackendPreference === 'typescript') return;
    if (this.aggregationWasmAttempted) return;
    this.aggregationWasmAttempted = true;
    this.aggregationWasm = FastScatterWebgpuWasmAggregationSession.create(
      this.options.columns,
      this.options.spec,
      gpu.xSorted || this.options.columns.xOrder !== undefined,
    );
  }

  private buildWasmAggregation(
    request: Parameters<FastScatterWebgpuWasmAggregationSession['build']>[0],
  ): FastScatterAggregationSet | null {
    try {
      return this.aggregationWasm?.build(request) ?? null;
    } catch {
      this.aggregationWasm = null;
      return null;
    }
  }

  private createAggregatePlotResources(
    device: GPUDevice,
    gpu: GpuResources,
    mode: 'bubble' | 'heatmap',
    plotId: string,
    yKey: string,
    instanceData: AggregateInstanceData,
  ): AggregatePlotResources {
      const buffer = device.createBuffer({
        label: `m-scatter-webgpu/${mode}/${plotId}/instances`,
        mappedAtCreation: true,
        size: Math.max(AGGREGATE_INSTANCE_BYTES, instanceData.data.byteLength),
        usage: GPUBufferUsage.STORAGE,
      });
      if (instanceData.data.byteLength > 0) {
        new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(instanceData.data));
      }
      buffer.unmap();
      const uniformBuffer = device.createBuffer({
        label: `m-scatter-webgpu/${mode}/${plotId}/uniforms`,
        size: AGGREGATE_UNIFORM_BYTES,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
      });
      return {
        bindGroup: device.createBindGroup({
          layout: gpu.aggregateBindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: { buffer } },
          ],
        }),
        buffer,
        cellHeightPx: instanceData.cellHeightPx,
        cellWidthPx: instanceData.cellWidthPx,
        instanceCount: instanceData.instanceCount,
        plotId,
        uniformBuffer,
        yKey,
      };
  }

  private createEasterEggFrame(gpu: GpuResources): EasterEggFrame | null {
    const playback = this.easterEggPlayback;
    const plot = gpu.plots[0];
    if (playback === null || plot === undefined) return null;
    const elapsedMs = performance.now() - playback.startedAt;
    if (elapsedMs >= getFastScatterEasterEggTotalDurationMs(playback)) {
      this.easterEggPlayback = null;
      this.deleteEasterEggResources();
      return null;
    }
    return { elapsedMs, playback, plotId: plot.plotId };
  }

  private ensureEasterEggResources(
    device: GPUDevice,
    gpu: GpuResources,
    playback: FastScatterEasterEggPlayback,
  ): EasterEggResources {
    const existing = this.easterEggResources;
    if (existing !== null && existing.pointCount === playback.layout.points.length) {
      return existing;
    }
    this.deleteEasterEggResources();
    const pointCount = playback.layout.points.length;
    const instanceData = new ArrayBuffer(
      Math.max(AGGREGATE_INSTANCE_BYTES, pointCount * AGGREGATE_INSTANCE_BYTES),
    );
    const floats = new Float32Array(instanceData);
    const words = new Uint32Array(instanceData);
    const colors = createFastScatterEasterEggColorArray(
      playback.layout,
      playback.options.color,
    );
    for (let index = 0; index < pointCount; index += 1) {
      const wordOffset = index * (AGGREGATE_INSTANCE_BYTES / Uint32Array.BYTES_PER_ELEMENT);
      floats[wordOffset + 2] = playback.options.pointSizePx;
      floats[wordOffset + 3] = playback.options.pointSizePx;
      words[wordOffset + 4] = packRgba8([
        colors[index * 4] ?? 0,
        colors[index * 4 + 1] ?? 0,
        colors[index * 4 + 2] ?? 0,
        colors[index * 4 + 3] ?? 255,
      ]);
    }
    const buffer = device.createBuffer({
      label: 'm-scatter-webgpu/easter-egg/instances',
      mappedAtCreation: true,
      size: instanceData.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    });
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(instanceData));
    buffer.unmap();
    const uniformBuffer = device.createBuffer({
      label: 'm-scatter-webgpu/easter-egg/uniforms',
      size: AGGREGATE_UNIFORM_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });
    const resources = {
      bindGroup: device.createBindGroup({
        label: 'm-scatter-webgpu/easter-egg/bind-group',
        layout: gpu.aggregateBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer } },
        ],
      }),
      buffer,
      currentX: new Float32Array(pointCount),
      currentY: new Float32Array(pointCount),
      instanceData,
      pointCount,
      uniformBuffer,
    };
    this.easterEggResources = resources;
    return resources;
  }

  private deleteEasterEggResources(): void {
    this.easterEggResources?.buffer.destroy();
    this.easterEggResources?.uniformBuffer.destroy();
    this.easterEggResources = null;
  }

  private deleteAggregateResources(): void {
    this.deleteAggregatePlotResources();
    this.aggregation = null;
  }

  private deleteAggregatePlotResources(): void {
    for (const plot of this.aggregatePlots) {
      plot.buffer.destroy();
      plot.uniformBuffer.destroy();
    }
    this.aggregatePlots = [];
  }

  private drawCachedFrame(): void {
    const context = this.context;
    const gpu = this.gpu;
    const snapshot = this.cacheSnapshot;
    const canvas = this.rendererOptions.canvas;
    if (
      this.disposed || context === null || gpu === null || snapshot === null ||
      canvas.width <= 0 || canvas.height <= 0
    ) return;
    if (this.inFlightCachedFrameCount >= 1) {
      this.coalescedFrameCount += 1;
      this.pendingDraw = true;
      return;
    }
    this.ensureCacheTexture(context.device, context.format, gpu, canvas.width, canvas.height);
    if (!this.cacheReady) {
      this.exactRequested = true;
      this.scheduleDraw();
      return;
    }
    const startedAt = performance.now();
    const layout = createFastScatterLayout(this.options.spec, {
      focusedPlotId: this.options.focusedPlotId,
      heightCssPx: this.heightCssPx,
      widthCssPx: this.widthCssPx,
    });
    const renderPlan = layout.plotRects.map((rect) =>
      rectToDevicePixels(rect, this.devicePixelRatio)
    );
    const encoder = context.device.createCommandEncoder({
      label: 'm-scatter-webgpu/cached-frame',
    });
    const timingFrame = this.gpuTimer?.beginFrame((gpuDurationMs) => {
      this.lastCachedGpuMs = gpuDurationMs;
    }) ?? null;
    const drawCalls = this.encodeCompositePass(
      encoder,
      gpu,
      renderPlan,
      this.options.viewport,
      snapshot.viewport,
      this.options.theme ?? DEFAULT_THEME,
      timingFrame?.timestampWrites,
    );
    timingFrame?.resolve(encoder);
    this.submitFrame(context, encoder, timingFrame, true, false, 'cached');
    this.emitMetrics({
      displayMode: normalizeFastScatterVisualizationMode(this.options.visualizationMode),
      drawCalls,
      durationMs: performance.now() - startedAt,
      phase: 'render',
      pointCount: this.options.columns.x.length,
      selectedPointCount: gpu.selectedCount,
      subplotCount: gpu.plots.length,
      visiblePointCount: this.lastVisiblePointCount,
      detail: JSON.stringify({
        backend: 'webgpu',
        cacheBytes: gpu.cacheWidth * gpu.cacheHeight * 8,
        cachedInteractionFrame: true,
        coalescedFrameCount: this.coalescedFrameCount,
        estimatedPeakBytes: calculateGpuResidentBytes(gpu) +
          (this.aggregationWasm?.getDiagnostics().residentBytes ?? 0) +
          MAX_UPLOAD_STAGING_BYTES,
        residentBytes: calculateGpuResidentBytes(gpu) +
          (this.aggregationWasm?.getDiagnostics().residentBytes ?? 0),
        submittedFrameCount: this.submittedFrameCount,
      }),
    });
  }

  private encodeCompositePass(
    encoder: GPUCommandEncoder,
    gpu: GpuResources,
    renderPlan: readonly ReturnType<typeof rectToDevicePixels>[],
    currentViewport: FastScatterViewport,
    cachedViewport: FastScatterViewport,
    theme: FastScatterTheme,
    timestampWrites?: GPURenderPassTimestampWrites,
  ): number {
    const canvas = this.rendererOptions.canvas;
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        clearValue: toGpuColor(theme.backgroundColor),
        loadOp: 'clear',
        storeOp: 'store',
        view: this.context!.canvasContext.getCurrentTexture().createView(),
      }],
      label: 'm-scatter-webgpu/composite-pass',
      timestampWrites,
    });
    pass.setPipeline(gpu.compositePipeline);
    let drawCalls = 0;
    for (const [plotIndex, plot] of gpu.plots.entries()) {
      const rect = renderPlan[plotIndex];
      const currentY = currentViewport.yByPlot[plot.plotId];
      const cachedY = cachedViewport.yByPlot[plot.plotId];
      if (rect === undefined || currentY === undefined || cachedY === undefined) continue;
      const encodedX = encodeXRangesForComposite(
        currentViewport.x,
        cachedViewport.x,
        gpu.x.encoding,
        gpu.xIndexedMode,
      );
      writeCompositeUniforms(this.context!.device, plot.compositeUniformBuffer, {
        cachedX: encodedX.cached,
        cachedY: encodeFastScatterWebgpuRange(cachedY, plot.y.encoding),
        canvasHeight: canvas.height,
        canvasWidth: canvas.width,
        cacheCanvasHeight: gpu.cacheHeight,
        cacheCanvasWidth: gpu.cacheWidth,
        cachePlotHeight: rect.heightCssPx * (gpu.cacheHeight / canvas.height),
        cachePlotWidth: rect.widthCssPx * (gpu.cacheWidth / canvas.width),
        cachePlotX: rect.xCssPx * (gpu.cacheWidth / canvas.width),
        cachePlotY: rect.yCssPx * (gpu.cacheHeight / canvas.height),
        currentX: encodedX.current,
        currentY: encodeFastScatterWebgpuRange(currentY, plot.y.encoding),
        plotHeight: rect.heightCssPx,
        plotWidth: rect.widthCssPx,
        plotX: rect.xCssPx,
        plotY: rect.yCssPx,
        subplotColor: theme.subplotBackgroundColor,
      });
      pass.setScissorRect(
        clampInteger(rect.xCssPx, 0, canvas.width),
        clampInteger(rect.yCssPx, 0, canvas.height),
        clampInteger(rect.widthCssPx, 1, canvas.width - clampInteger(rect.xCssPx, 0, canvas.width)),
        clampInteger(rect.heightCssPx, 1, canvas.height - clampInteger(rect.yCssPx, 0, canvas.height)),
      );
      pass.setBindGroup(0, plot.compositeBindGroup);
      pass.draw(4);
      drawCalls += 1;
    }
    pass.end();
    return drawCalls;
  }

  private ensureCacheTexture(
    device: GPUDevice,
    format: GPUTextureFormat,
    gpu: GpuResources,
    width: number,
    height: number,
  ): void {
    const cacheWidth = Math.max(1, Math.ceil(width * INTERACTION_CACHE_OVERSCAN));
    const cacheHeight = Math.max(1, Math.ceil(height * INTERACTION_CACHE_OVERSCAN));
    if (gpu.cacheWidth === cacheWidth && gpu.cacheHeight === cacheHeight) return;
    gpu.cacheTexture.destroy();
    gpu.workTexture.destroy();
    gpu.cacheTexture = createCacheTexture(device, format, cacheWidth, cacheHeight);
    gpu.cacheView = gpu.cacheTexture.createView();
    gpu.workTexture = createCacheTexture(device, format, cacheWidth, cacheHeight);
    gpu.workView = gpu.workTexture.createView();
    gpu.cacheWidth = cacheWidth;
    gpu.cacheHeight = cacheHeight;
    for (const plot of gpu.plots) {
      plot.compositeBindGroup = createCompositeBindGroup(
        device,
        gpu.compositeBindGroupLayout,
        gpu.compositeSampler,
        gpu.cacheView,
        plot.compositeUniformBuffer,
      );
    }
    this.cacheReady = false;
    this.cacheSnapshot = null;
  }

  private swapCacheTextures(device: GPUDevice, gpu: GpuResources): void {
    [gpu.cacheTexture, gpu.workTexture] = [gpu.workTexture, gpu.cacheTexture];
    [gpu.cacheView, gpu.workView] = [gpu.workView, gpu.cacheView];
    for (const plot of gpu.plots) {
      plot.compositeBindGroup = createCompositeBindGroup(
        device,
        gpu.compositeBindGroupLayout,
        gpu.compositeSampler,
        gpu.cacheView,
        plot.compositeUniformBuffer,
      );
    }
  }

  private submitFrame(
    context: WebgpuContext,
    encoder: GPUCommandEncoder,
    timingFrame: ReturnType<WebgpuTimestampProfiler['beginFrame']>,
    resolvesFirstFrame = true,
    resolvesInteractiveFrame = false,
    frameKind: 'cached' | 'exact' = 'exact',
  ): void {
    context.device.queue.submit([encoder.finish()]);
    timingFrame?.submitted();
    this.submittedFrameCount += 1;
    if (frameKind === 'exact') this.inFlightExactFrameCount += 1;
    else this.inFlightCachedFrameCount += 1;
    void context.device.queue.onSubmittedWorkDone().catch(() => undefined).then(() => {
      if (this.disposed) return;
      if (frameKind === 'exact') {
        this.inFlightExactFrameCount = Math.max(0, this.inFlightExactFrameCount - 1);
        this.settledFrameCount += 1;
      } else {
        this.inFlightCachedFrameCount = Math.max(0, this.inFlightCachedFrameCount - 1);
      }
      if (resolvesInteractiveFrame && !this.interactiveFrameResolved) {
        this.interactiveFrameResolved = true;
        this.resolveInteractiveFrame();
      }
      if (resolvesFirstFrame && !this.firstFrameResolved) {
        this.firstFrameResolved = true;
        this.resolveFirstFrame();
      }
      if (this.pendingDraw) {
        this.pendingDraw = false;
        this.scheduleDraw();
      }
    });
  }

  private scheduleStreamingPreview(): void {
    if (this.streamingPreviewTimer !== null || this.disposed) return;
    const now = performance.now();
    const delayMs = Math.max(0, this.nextStreamingPreviewAt - now);
    if (delayMs === 0) {
      this.nextStreamingPreviewAt = now + STREAMING_PREVIEW_INTERVAL_MS;
      this.exactRequested = true;
      this.scheduleDraw();
      return;
    }
    this.streamingPreviewTimer = globalThis.setTimeout(() => {
      this.streamingPreviewTimer = null;
      if (this.disposed || !this.streamingAppendPending) return;
      this.nextStreamingPreviewAt = performance.now() + STREAMING_PREVIEW_INTERVAL_MS;
      this.exactRequested = true;
      this.scheduleDraw();
    }, delayMs);
  }

  private handleDeviceLost(info: GPUDeviceLostInfo): void {
    if (this.disposed) return;
    const lifecycle = this.rendererOptions.lifecycle;
    if (lifecycle === undefined) {
      this.emitMetrics({
        phase: 'context-lost',
        detail: JSON.stringify({ backend: 'webgpu', message: info.message, reason: info.reason }),
      });
    }
    this.gpuTimer?.dispose();
    this.gpuTimer = null;
    this.deleteEasterEggResources();
    this.context = null;
    this.gpu = null;
    lifecycle?.onContextLost?.(info);
    if (info.reason !== 'destroyed') {
      void this.initialize().then(
        () => {
          if (lifecycle === undefined) this.emitMetrics({ phase: 'context-restored' });
          lifecycle?.onContextRestored?.();
        },
        (error: unknown) => lifecycle?.onError?.(error),
      );
    }
  }

  private destroyResources(): void {
    this.deleteAggregateResources();
    this.deleteEasterEggResources();
    this.aggregationWasm = null;
    this.aggregationWasmAttempted = false;
    this.aggregationBackend = 'typescript';
    if (this.gpu !== null) destroyGpuResources(this.gpu);
    this.gpu = null;
  }

  private emitMetrics(metrics: Omit<FastScatterMetricsEvent, 'at'>): void {
    this.options.onMetrics?.({ at: performance.now(), ...metrics });
  }
}

interface AggregateInstanceData {
  cellHeightPx: number;
  cellWidthPx: number;
  data: ArrayBuffer;
  instanceCount: number;
}

function calculateAggregateGpuResidentBytes(
  plots: readonly AggregatePlotResources[],
): number {
  return plots.reduce(
    (total, plot) =>
      total + plot.instanceCount * AGGREGATE_INSTANCE_BYTES + AGGREGATE_UNIFORM_BYTES,
    0,
  );
}

function createAggregateMetricDetail(
  aggregation: FastScatterAggregationSet | null,
  backend: 'external' | 'rust-wasm' | 'typescript',
  wasm: FastScatterWebgpuWasmAggregationDiagnostics | undefined,
) {
  if (aggregation === null) return null;
  return aggregation.kind === 'bubble'
    ? {
        aggregateBuildMs: aggregation.metrics.aggregateBuildMs,
        backend,
        displayMode: 'bubble',
        totalAggregateCount: aggregation.totalAggregateCount,
        totalCellCount: 0,
        totalPopulatedCellCount: 0,
        totalVisiblePointCount: aggregation.subplots.reduce(
          (total, subplot) => total + subplot.counts.reduce(
            (subtotal, count) => subtotal + count,
            0,
          ),
          0,
        ),
        uploadBytes: aggregation.subplots.reduce(
          (total, subplot) => total + subplot.aggregateCount * AGGREGATE_INSTANCE_BYTES,
          0,
        ),
        wasm,
      }
    : {
        aggregateBuildMs: aggregation.metrics.aggregateBuildMs,
        backend,
        displayMode: 'heatmap',
        totalAggregateCount: 0,
        totalCellCount: aggregation.totalCellCount,
        totalPopulatedCellCount: aggregation.totalPopulatedCellCount,
        totalVisiblePointCount: aggregation.subplots.reduce(
          (total, subplot) => total + subplot.counts.reduce(
            (subtotal, count) => subtotal + count,
            0,
          ),
          0,
        ),
        uploadBytes: aggregation.totalPopulatedCellCount * AGGREGATE_INSTANCE_BYTES,
        wasm,
      };
}

function createBubbleAggregateInstanceData(
  subplot: FastScatterBubbleSubplotAggregation,
  plotWidthPx: number,
  plotHeightPx: number,
  maxCount: number,
): AggregateInstanceData {
  const radii = createFastScatterBubbleRadiusPx(
    subplot.counts,
    plotWidthPx,
    plotHeightPx,
    1,
    { maxCount },
  );
  const data = new ArrayBuffer(subplot.aggregateCount * AGGREGATE_INSTANCE_BYTES);
  const f32 = new Float32Array(data);
  const u32 = new Uint32Array(data);
  const color = 0xffff_ffff;
  for (let index = 0; index < subplot.aggregateCount; index += 1) {
    const offset = index * (AGGREGATE_INSTANCE_BYTES / 4);
    f32[offset] = subplot.centerX[index] ?? Number.NaN;
    f32[offset + 1] = subplot.centerY[index] ?? Number.NaN;
    f32[offset + 2] = radii[index] ?? 0;
    f32[offset + 3] = radii[index] ?? 0;
    u32[offset + 4] = color;
    f32[offset + 5] = (subplot.selectedCounts[index] ?? 0) /
      Math.max(1, subplot.counts[index] ?? 0);
    f32[offset + 6] = subplot.hovered[index] ?? 0;
  }
  return {
    cellHeightPx: 0,
    cellWidthPx: 0,
    data,
    instanceCount: subplot.aggregateCount,
  };
}

function createHeatmapAggregateInstanceData(
  subplot: FastScatterHeatmapSubplotAggregation,
  theme: FastScatterTheme,
  palette: Parameters<typeof createFastScatterHeatmapColors>[3],
): AggregateInstanceData {
  const populated: number[] = [];
  for (let cellIndex = 0; cellIndex < subplot.cellCount; cellIndex += 1) {
    if ((subplot.counts[cellIndex] ?? 0) > 0) populated.push(cellIndex);
  }
  const colors = createFastScatterHeatmapColors(subplot.counts, populated, theme, palette);
  const data = new ArrayBuffer(populated.length * AGGREGATE_INSTANCE_BYTES);
  const f32 = new Float32Array(data);
  const u32 = new Uint32Array(data);
  for (let index = 0; index < populated.length; index += 1) {
    const cellIndex = populated[index] ?? 0;
    const xBin = cellIndex % subplot.xBinCount;
    const yBin = Math.floor(cellIndex / subplot.xBinCount);
    const offset = index * (AGGREGATE_INSTANCE_BYTES / 4);
    f32[offset] = subplot.xRange.min + (xBin + 0.5) * subplot.xBinSize;
    f32[offset + 1] = subplot.yRange.min + (yBin + 0.5) * subplot.yBinSize;
    f32[offset + 2] = subplot.xBinSize * 0.5;
    f32[offset + 3] = subplot.yBinSize * 0.5;
    const colorOffset = index * 4;
    u32[offset + 4] = packRgba8([
      colors[colorOffset] ?? 0,
      colors[colorOffset + 1] ?? 0,
      colors[colorOffset + 2] ?? 0,
      colors[colorOffset + 3] ?? 0,
    ]);
    f32[offset + 5] = (subplot.selectedCounts[cellIndex] ?? 0) /
      Math.max(1, subplot.counts[cellIndex] ?? 0);
    f32[offset + 6] = subplot.hovered[cellIndex] ?? 0;
  }
  return {
    cellHeightPx: subplot.plotHeightPx / Math.max(1, subplot.yBinCount),
    cellWidthPx: subplot.plotWidthPx / Math.max(1, subplot.xBinCount),
    data,
    instanceCount: populated.length,
  };
}

interface AggregateUniformInput {
  cacheScaleX: number;
  cacheScaleY: number;
  canvasHeight: number;
  canvasWidth: number;
  cellHeightPx: number;
  cellWidthPx: number;
  devicePixelRatio: number;
  mode: 'bubble' | 'heatmap' | 'point';
  opacityScale: number;
  plotHeight: number;
  plotWidth: number;
  plotX: number;
  plotY: number;
  pointSizeScale: number;
  theme: FastScatterTheme;
  xRange: FastScatterRange;
  yRange: FastScatterRange;
}

function writeAggregateUniforms(
  device: GPUDevice,
  buffer: GPUBuffer,
  input: AggregateUniformInput,
): void {
  const values = new Float32Array(AGGREGATE_UNIFORM_BYTES / Float32Array.BYTES_PER_ELEMENT);
  values.set([input.xRange.min, input.xRange.max, input.yRange.min, input.yRange.max], 0);
  values.set([input.canvasWidth, input.canvasHeight, input.plotX, input.plotY], 4);
  values.set([
    input.plotWidth,
    input.plotHeight,
    input.devicePixelRatio * input.cacheScaleX,
    input.devicePixelRatio * input.cacheScaleY,
  ], 8);
  values.set(input.theme.selectedOverlayColor, 12);
  values.set(resolveAggregateHoverColor(input.theme), 16);
  values.set([
    (input.theme.colorMixColor?.[0] ?? 255) / 255,
    (input.theme.colorMixColor?.[1] ?? 255) / 255,
    (input.theme.colorMixColor?.[2] ?? 255) / 255,
    input.theme.colorMixAmount ?? 0,
  ], 20);
  values.set(
    input.mode === 'bubble'
      ? normalizeRgba8Color(input.theme.bubbleColor ?? DEFAULT_THEME.bubbleColor ?? [6, 150, 125, 220])
      : resolveHeatmapBorderColor(input.theme),
    24,
  );
  values.set([
    input.mode === 'bubble' ? 0 : input.mode === 'point' ? 2 : 1,
    input.mode === 'heatmap'
      ? resolveFastScatterHeatmapBorderAlpha(input.cellWidthPx, input.cellHeightPx, input.theme)
      : 0,
    input.opacityScale,
    input.theme.alphaScaleMultiplier ?? 1,
  ], 28);
  values.set([
    input.cellWidthPx * input.devicePixelRatio * input.cacheScaleX,
    input.cellHeightPx * input.devicePixelRatio * input.cacheScaleY,
    input.mode !== 'heatmap'
      ? normalizeFastScatterPointSizeScale(input.pointSizeScale)
      : 1,
    0,
  ], 32);
  device.queue.writeBuffer(buffer, 0, values);
}

function packRgba8(color: readonly [number, number, number, number]): number {
  return (
    clampByte(color[0]) |
    (clampByte(color[1]) << 8) |
    (clampByte(color[2]) << 16) |
    (clampByte(color[3]) << 24)
  ) >>> 0;
}

function updateEasterEggInstancePositions(resources: EasterEggResources): void {
  const floats = new Float32Array(resources.instanceData);
  const instanceWordCount = AGGREGATE_INSTANCE_BYTES / Float32Array.BYTES_PER_ELEMENT;
  for (let index = 0; index < resources.pointCount; index += 1) {
    const wordOffset = index * instanceWordCount;
    floats[wordOffset] = resources.currentX[index] ?? 0;
    floats[wordOffset + 1] = resources.currentY[index] ?? 0;
  }
}

function normalizeRgba8Color(
  color: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  return [color[0] / 255, color[1] / 255, color[2] / 255, color[3] / 255];
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizeHeatmapBinSize(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value)
    ? 12
    : Math.max(1, Math.floor(value));
}

function resolveAggregateHoverColor(
  theme: FastScatterTheme,
): readonly [number, number, number, number] {
  return isDarkTheme(theme)
    ? [0.98, 0.99, 1, 0.96]
    : [0.08, 0.12, 0.18, 0.95];
}

function resolveHeatmapBorderColor(
  theme: FastScatterTheme,
): readonly [number, number, number, number] {
  return isDarkTheme(theme)
    ? [0.93, 0.96, 1, 0.38]
    : [0.05, 0.08, 0.12, 0.28];
}

function isDarkTheme(theme: FastScatterTheme): boolean {
  const [red, green, blue] = theme.subplotBackgroundColor;
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 < 0.5;
}

export function createFastScatterWebgpuSelectedBitset(
  pointIndices: Uint32Array,
  pointCount: number,
): Uint32Array {
  const bitset = new Uint32Array(Math.ceil(pointCount / 32));
  for (const pointIndex of pointIndices) {
    if (pointIndex >= pointCount) continue;
    const wordIndex = pointIndex >>> 5;
    bitset[wordIndex] = ((bitset[wordIndex] ?? 0) | (1 << (pointIndex & 31))) >>> 0;
  }
  return bitset;
}

function createStaticIndexBuffer(
  device: GPUDevice,
  indices: Uint32Array,
  label: string,
): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    mappedAtCreation: true,
    size: Math.max(EMPTY_BUFFER_BYTES, indices.byteLength),
    usage: GPUBufferUsage.STORAGE,
  });
  if (indices.length > 0) new Uint32Array(buffer.getMappedRange()).set(indices);
  buffer.unmap();
  return buffer;
}

function mergeSortedUniqueIndices(left: Uint32Array, right: Uint32Array): Uint32Array {
  const merged = new Uint32Array(left.length + right.length);
  let leftIndex = 0;
  let rightIndex = 0;
  let writeIndex = 0;
  let previous = INVALID_POINT_INDEX;
  while (leftIndex < left.length || rightIndex < right.length) {
    const leftValue = left[leftIndex] ?? Number.POSITIVE_INFINITY;
    const rightValue = right[rightIndex] ?? Number.POSITIVE_INFINITY;
    const value = Math.min(leftValue, rightValue);
    if (leftValue === value) leftIndex += 1;
    if (rightValue === value) rightIndex += 1;
    if (value === previous || !Number.isFinite(value)) continue;
    merged[writeIndex] = value;
    writeIndex += 1;
    previous = value;
  }
  return merged.slice(0, writeIndex);
}

export function fastScatterWebgpuUpdateRequiresDraw(
  options: Partial<FastScatterControllerOptions>,
): boolean {
  return (
    options.aggregation !== undefined ||
    options.focusedPlotId !== undefined ||
    options.heatmapBinSizePx !== undefined ||
    options.heatmapPalette !== undefined ||
    options.opacityScale !== undefined ||
    options.pointSizeScale !== undefined ||
    options.renderingMode !== undefined ||
    options.theme !== undefined ||
    options.visualizationMode !== undefined ||
    options.viewport !== undefined
  );
}

async function createGpuResources(
  context: WebgpuContext,
  columns: FastScatterPointColumns,
  spec: FastScatterPlotSpec,
  requestedTheme: FastScatterTheme | undefined,
  indexedStyle: boolean,
  packedStyles: FastScatterWebgpuPackedStyles | undefined,
  hoverIndex: FastScatterControllerOptions['hoverIndex'],
  requestedPointCapacity = columns.x.length,
): Promise<GpuResources> {
  const { device } = context;
  const theme = requestedTheme ?? DEFAULT_THEME;
  const pointCapacity = normalizePointCapacity(requestedPointCapacity, columns.x.length);
  const yKeys = [...new Set(spec.plots.map((plot) => plot.yKey))];
  const indexedXMode = await resolveIndexedXMode(columns.x);
  const [x, styles, sourceMapping, encodedYColumns] = await Promise.all([
    indexedXMode !== 0
      ? createIdentityEncodedColumn(device, 'm-scatter-webgpu/x-identity')
      : createEncodedColumn(device, columns.x, 'm-scatter-webgpu/x', pointCapacity),
    createStyleBuffer(device, columns, theme, packedStyles, pointCapacity),
    createSourceMapping(columns),
    Promise.all(yKeys.map(async (yKey) => {
      const values = columns.y[yKey];
      if (values === undefined) throw new Error(`Fast scatter y column "${yKey}" is missing.`);
      return [
        yKey,
        await createEncodedColumn(
          device,
          values,
          `m-scatter-webgpu/y/${yKey}`,
          pointCapacity,
        ),
      ] as const;
    })),
  ]);
  const yByKey = new Map<string, EncodedColumn>(encodedYColumns);
  const styleBuffer = styles.buffer;
  const styleBufferHigh = styles.bufferHigh;
  const styleSplitBytes = styles.splitBytes;
  const rotationBuffer = createRotationLookupBuffer(device);
  const selectedBuffer = device.createBuffer({
    label: 'm-scatter-webgpu/selected-indices',
    size: EMPTY_BUFFER_BYTES,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
  });
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'uniform' }, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX },
      { binding: 1, buffer: { type: 'read-only-storage' }, visibility: GPUShaderStage.VERTEX },
      { binding: 2, buffer: { type: 'read-only-storage' }, visibility: GPUShaderStage.VERTEX },
      { binding: 3, buffer: { type: 'read-only-storage' }, visibility: GPUShaderStage.VERTEX },
      { binding: 4, buffer: { type: 'read-only-storage' }, visibility: GPUShaderStage.VERTEX },
      { binding: 5, buffer: { type: 'read-only-storage' }, visibility: GPUShaderStage.VERTEX },
      { binding: 6, buffer: { type: 'read-only-storage' }, visibility: GPUShaderStage.VERTEX },
      { binding: 7, buffer: { type: 'read-only-storage' }, visibility: GPUShaderStage.VERTEX },
    ],
    label: 'm-scatter-webgpu/point-bindings',
  });
  const shaderModule = device.createShaderModule({
    code: FAST_SCATTER_WEBGPU_SHADER,
    label: 'm-scatter-webgpu/point-shader',
  });
  const compilationInfo = await shaderModule.getCompilationInfo();
  const shaderErrors = compilationInfo.messages.filter(
    (message) => message.type === 'error',
  );
  if (shaderErrors.length > 0) {
    throw new Error(
      `m-scatter-webgpu WGSL compilation failed: ${shaderErrors
        .map((message) => `${message.lineNum}:${message.linePos} ${message.message}`)
        .join('; ')}`,
    );
  }
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const pointPipeline = await device.createRenderPipelineAsync({
      fragment: {
        entryPoint: 'pointFragment',
        module: shaderModule,
        targets: [{
          blend: {
            alpha: { dstFactor: 'one-minus-src-alpha', operation: 'add', srcFactor: 'one' },
            color: { dstFactor: 'one-minus-src-alpha', operation: 'add', srcFactor: 'src-alpha' },
          },
          format: context.format,
        }],
      },
      label: 'm-scatter-webgpu/point-pipeline',
      layout: pipelineLayout,
      primitive: { topology: 'triangle-strip' },
      vertex: {
        constants: {
          STYLE_MODE: styles.constant ? (indexedStyle ? 2 : 1) : 0,
          STYLE_SPLIT_POINT: styleSplitBytes === 0
            ? 0xffff_ffff
            : styleSplitBytes / STYLE_STRIDE_BYTES,
          X_STORAGE_MODE: indexedXMode,
        },
        entryPoint: 'pointVertex',
        module: shaderModule,
      },
    });
  const backgroundPipeline = device.createRenderPipeline({
    fragment: {
      entryPoint: 'backgroundFragment',
      module: shaderModule,
      targets: [{ format: context.format }],
    },
    label: 'm-scatter-webgpu/background-pipeline',
    layout: pipelineLayout,
    primitive: { topology: 'triangle-list' },
    vertex: { entryPoint: 'backgroundVertex', module: shaderModule },
  });
  const aggregateBindGroupLayout = device.createBindGroupLayout({
    label: 'm-scatter-webgpu/aggregate-bindings',
    entries: [
      {
        binding: 0,
        buffer: { type: 'uniform' },
        visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX,
      },
      {
        binding: 1,
        buffer: { type: 'read-only-storage' },
        visibility: GPUShaderStage.VERTEX,
      },
    ],
  });
  const aggregateModule = device.createShaderModule({
    code: FAST_SCATTER_WEBGPU_AGGREGATE_SHADER,
    label: 'm-scatter-webgpu/aggregate-shader',
  });
  const aggregateCompilationInfo = await aggregateModule.getCompilationInfo();
  const aggregateShaderErrors = aggregateCompilationInfo.messages.filter(
    (message) => message.type === 'error',
  );
  if (aggregateShaderErrors.length > 0) {
    throw new Error(
      `m-scatter-webgpu aggregate WGSL compilation failed: ${aggregateShaderErrors
        .map((message) => `${message.lineNum}:${message.linePos} ${message.message}`)
        .join('; ')}`,
    );
  }
  const aggregatePipeline = await device.createRenderPipelineAsync({
    fragment: {
      entryPoint: 'aggregateFragment',
      module: aggregateModule,
      targets: [{
        blend: {
          alpha: { dstFactor: 'one-minus-src-alpha', operation: 'add', srcFactor: 'one' },
          color: { dstFactor: 'one-minus-src-alpha', operation: 'add', srcFactor: 'src-alpha' },
        },
        format: context.format,
      }],
    },
    label: 'm-scatter-webgpu/aggregate-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [aggregateBindGroupLayout] }),
    primitive: { topology: 'triangle-strip' },
    vertex: { entryPoint: 'aggregateVertex', module: aggregateModule },
  });
  const compositeBindGroupLayout = device.createBindGroupLayout({
    label: 'm-scatter-webgpu/composite-bindings',
    entries: [
      { binding: 0, sampler: { type: 'filtering' }, visibility: GPUShaderStage.FRAGMENT },
      { binding: 1, texture: { sampleType: 'float' }, visibility: GPUShaderStage.FRAGMENT },
      {
        binding: 2,
        buffer: { type: 'uniform' },
        visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX,
      },
    ],
  });
  const compositeModule = device.createShaderModule({
    code: FAST_SCATTER_WEBGPU_COMPOSITE_SHADER,
    label: 'm-scatter-webgpu/composite-shader',
  });
  const compositePipeline = device.createRenderPipeline({
    fragment: {
      entryPoint: 'compositeFragment',
      module: compositeModule,
      targets: [{ format: context.format }],
    },
    label: 'm-scatter-webgpu/composite-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [compositeBindGroupLayout] }),
    primitive: { topology: 'triangle-strip' },
    vertex: { entryPoint: 'compositeVertex', module: compositeModule },
  });
  const compositeSampler = device.createSampler({
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    magFilter: 'linear',
    minFilter: 'linear',
  });
  const cacheTexture = createCacheTexture(device, context.format, 1, 1);
  const cacheView = cacheTexture.createView();
  const workTexture = createCacheTexture(device, context.format, 1, 1);
  const workView = workTexture.createView();
  const overviewByYKey = new Map(yKeys.map((yKey) => {
    const yIndices = hoverIndex?.pointCount === columns.x.length
      ? hoverIndex.compactByYKey?.[yKey]?.overviewIndices ?? new Uint32Array(0)
      : new Uint32Array(0);
    const indices = mergeSortedUniqueIndices(yIndices, styles.overviewIndices);
    return [yKey, {
      buffer: createStaticIndexBuffer(device, indices, `m-scatter-webgpu/overview/${yKey}`),
      count: indices.length,
      indices,
    }] as const;
  }));

  const plots = spec.plots.map((plot) => {
    const y = yByKey.get(plot.yKey);
    const overview = overviewByYKey.get(plot.yKey);
    if (y === undefined) throw new Error(`Fast scatter y column "${plot.yKey}" is missing.`);
    if (overview === undefined) throw new Error(`Fast scatter overview "${plot.yKey}" is missing.`);
    const uniformBuffer = device.createBuffer({
      label: `m-scatter-webgpu/uniforms/${plot.id}`,
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });
    const selectedUniformBuffer = device.createBuffer({
      label: `m-scatter-webgpu/selected-uniforms/${plot.id}`,
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });
    const overviewUniformBuffer = device.createBuffer({
      label: `m-scatter-webgpu/overview-uniforms/${plot.id}`,
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });
    const selectedOverviewUniformBuffer = device.createBuffer({
      label: `m-scatter-webgpu/selected-overview-uniforms/${plot.id}`,
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });
    const compositeUniformBuffer = device.createBuffer({
      label: `m-scatter-webgpu/composite-uniforms/${plot.id}`,
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });
    return {
      bindGroup: createPlotBindGroup(
        device, bindGroupLayout, uniformBuffer, x.buffer, y.buffer,
        styleBuffer, styleBufferHigh, styles.byteLength, styleSplitBytes,
        selectedBuffer, rotationBuffer, selectedBuffer,
      ),
      compositeBindGroup: createCompositeBindGroup(
        device,
        compositeBindGroupLayout,
        compositeSampler,
        cacheView,
        compositeUniformBuffer,
      ),
      compositeUniformBuffer,
      overviewBindGroup: createPlotBindGroup(
        device,
        bindGroupLayout,
        overviewUniformBuffer,
        x.buffer,
        y.buffer,
        styleBuffer,
        styleBufferHigh,
        styles.byteLength,
        styleSplitBytes,
        overview.buffer,
        rotationBuffer,
        selectedBuffer,
      ),
      overviewBuffer: overview.buffer,
      overviewCount: overview.count,
      overviewIndices: overview.indices,
      overviewUniformBuffer,
      plotId: plot.id,
      selectedBindGroup: createPlotBindGroup(
        device,
        bindGroupLayout,
        selectedUniformBuffer,
        x.buffer,
        y.buffer,
        styleBuffer,
        styleBufferHigh,
        styles.byteLength,
        styleSplitBytes,
        selectedBuffer,
        rotationBuffer,
        selectedBuffer,
      ),
      selectedOverviewBindGroup: createPlotBindGroup(
        device,
        bindGroupLayout,
        selectedOverviewUniformBuffer,
        x.buffer,
        y.buffer,
        styleBuffer,
        styleBufferHigh,
        styles.byteLength,
        styleSplitBytes,
        overview.buffer,
        rotationBuffer,
        selectedBuffer,
      ),
      selectedOverviewUniformBuffer,
      selectedUniformBuffer,
      uniformBuffer,
      y,
      yKey: plot.yKey,
    };
  });
  const uniqueYBytes = [...yByKey.values()].reduce((total, value) => total + value.byteLength, 0);
  const overviewBytes = [...overviewByYKey.values()].reduce(
    (total, value) => total + value.count * Uint32Array.BYTES_PER_ELEMENT,
    0,
  );

  return {
    aggregateBindGroupLayout,
    aggregatePipeline,
    backgroundPipeline,
    bindGroupLayout,
    cacheHeight: 1,
    cacheTexture,
    cacheView,
    cacheWidth: 1,
    compositeBindGroupLayout,
    compositePipeline,
    compositeSampler,
    identitySourceOrder: sourceMapping.identity,
    inverseSourceIndex: sourceMapping.inverse,
    maxPointSize: indexedStyle && styles.constant ? 5 : styles.maxPointSize,
    pipelines: [pointPipeline, pointPipeline, pointPipeline],
    plots,
    pointCapacity,
    rotationBuffer,
    selectedBuffer,
    selectedCapacity: 1,
    selectedCount: 0,
    selectedDense: false,
    selectedDensePipelines: [pointPipeline, pointPipeline, pointPipeline],
    selectedPipelines: [pointPipeline, pointPipeline, pointPipeline],
    shaderModule,
    styleBuffer,
    styleBufferHigh,
    styleByteLength: styles.byteLength,
    styleMode: styles.constant ? (indexedStyle ? 2 : 1) : 0,
    styleSplitBytes,
    uploadBytes: x.byteLength + uniqueYBytes + styles.byteLength + overviewBytes,
    workTexture,
    workView,
    x,
    xIndexedMode: indexedXMode,
    xSorted: (indexedXMode !== 0 || isNondecreasing(columns.x)) && columns.xOrder === undefined,
  };
}

async function createEncodedColumn(
  device: GPUDevice,
  values: ArrayLike<number>,
  label: string,
  requestedCapacity = values.length,
): Promise<EncodedColumn> {
  const pointCount = values.length;
  const pointCapacity = normalizePointCapacity(requestedCapacity, pointCount);
  const compactUint8 = values instanceof Uint8Array;
  const compactUint16 = values instanceof Uint16Array;
  const compactInteger = compactUint8 || compactUint16;
  const directFloat32 = values instanceof Float32Array;
  const byteLength = Math.max(
    EMPTY_BUFFER_BYTES,
    compactInteger
      ? Math.ceil(pointCapacity / (compactUint8 ? 4 : 2)) * Uint32Array.BYTES_PER_ELEMENT
      : pointCapacity * Float32Array.BYTES_PER_ELEMENT,
  );
  if (byteLength > device.limits.maxStorageBufferBindingSize) {
    throw new Error(
      `${label} requires ${byteLength} bytes, exceeding maxStorageBufferBindingSize ${device.limits.maxStorageBufferBindingSize}.`,
    );
  }
  let min = 0;
  let max = 1;
  if (!compactInteger && !directFloat32) {
    min = Number.POSITIVE_INFINITY;
    max = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < pointCount; index += 1) {
      const value = values[index] ?? Number.NaN;
      if (Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      if (index > 0 && index % BUILD_YIELD_INTERVAL === 0) await yieldToBrowser();
    }
  }
  const offset = compactInteger || directFloat32 ? 0 : Number.isFinite(min) ? min : 0;
  const scale = compactInteger || directFloat32
    ? 1
    : Number.isFinite(max) && max > offset ? max - offset : 1;
  const buffer = device.createBuffer({
    label,
    mappedAtCreation: true,
    size: byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE,
  });
  const mapped = buffer.getMappedRange();
  if (compactUint8) {
    new Uint8Array(mapped).set(values as Uint8Array);
  } else if (compactUint16) {
    new Uint16Array(mapped).set(values as Uint16Array);
  } else if (directFloat32) {
    new Float32Array(mapped).set(values as Float32Array);
  } else {
    const target = new Float32Array(mapped);
    for (let index = 0; index < pointCount; index += 1) {
      const value = values[index] ?? Number.NaN;
      target[index] = Number.isFinite(value) ? (value - offset) / scale : Number.NaN;
      if (index > 0 && index % BUILD_YIELD_INTERVAL === 0) await yieldToBrowser();
    }
  }
  buffer.unmap();
  return {
    buffer,
    byteLength: compactInteger
      ? Math.ceil(pointCount / (compactUint8 ? 4 : 2)) * Uint32Array.BYTES_PER_ELEMENT
      : pointCount * Float32Array.BYTES_PER_ELEMENT,
    encoding: { offset, scale },
    storageMode: compactUint8 ? 1 : compactUint16 ? 2 : 0,
  };
}

function growGpuPointResources(
  device: GPUDevice,
  gpu: GpuResources,
  requestedCapacity: number,
  pointCount: number,
): void {
  const capacity = normalizePointCapacity(requestedCapacity, pointCount);
  if (capacity <= gpu.pointCapacity) return;
  const encoder = device.createCommandEncoder({
    label: 'm-scatter-webgpu/stream-capacity-growth',
  });
  const replacements = new Map<GPUBuffer, GPUBuffer>();
  const replaceEncoded = (column: EncodedColumn, label: string) => {
    const size = encodedColumnAllocationBytes(column.storageMode, capacity);
    if (
      size > device.limits.maxBufferSize ||
      size > device.limits.maxStorageBufferBindingSize
    ) {
      throw new Error(
        `Streamed scatter capacity ${capacity} requires a ${size}-byte ${label} buffer, exceeding this device's limits.`,
      );
    }
    const next = device.createBuffer({
      label,
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE,
    });
    encoder.copyBufferToBuffer(column.buffer, 0, next, 0, column.byteLength);
    replacements.set(column.buffer, next);
  };

  if (gpu.xIndexedMode === 0) replaceEncoded(gpu.x, 'm-scatter-webgpu/x-stream-grown');
  const uniqueY = new Set<EncodedColumn>();
  for (const plot of gpu.plots) uniqueY.add(plot.y);
  for (const column of uniqueY) {
    replaceEncoded(column, 'm-scatter-webgpu/y-stream-grown');
  }

  let nextStyles: StyleGpuBuffers | null = null;
  if (gpu.styleMode === 0) {
    const nextStyleBytes = Math.max(STYLE_STRIDE_BYTES, capacity * STYLE_STRIDE_BYTES);
    nextStyles = createStyleGpuBuffers(device, nextStyleBytes);
    encodeStyleBufferCopies(
      encoder,
      gpu.styleBuffer,
      gpu.styleBufferHigh,
      gpu.styleSplitBytes,
      nextStyles,
      pointCount * STYLE_STRIDE_BYTES,
    );
  }

  device.queue.submit([encoder.finish()]);

  const oldBuffers = [...replacements.keys()];
  if (gpu.xIndexedMode === 0) gpu.x.buffer = replacements.get(gpu.x.buffer)!;
  for (const column of uniqueY) column.buffer = replacements.get(column.buffer)!;
  if (nextStyles !== null) {
    const oldLow = gpu.styleBuffer;
    const oldHigh = gpu.styleBufferHigh;
    gpu.styleBuffer = nextStyles.buffer;
    gpu.styleBufferHigh = nextStyles.bufferHigh;
    gpu.styleSplitBytes = nextStyles.splitBytes;
    gpu.styleByteLength = Math.max(STYLE_STRIDE_BYTES, capacity * STYLE_STRIDE_BYTES);
    oldLow.destroy();
    oldHigh.destroy();
  }
  gpu.pointCapacity = capacity;
  recreatePlotBindGroups(device, gpu);
  for (const buffer of oldBuffers) buffer.destroy();
}

function encodedColumnAllocationBytes(storageMode: 0 | 1 | 2, capacity: number): number {
  return Math.max(
    EMPTY_BUFFER_BYTES,
    storageMode === 1
      ? Math.ceil(capacity / 4) * Uint32Array.BYTES_PER_ELEMENT
      : storageMode === 2
        ? Math.ceil(capacity / 2) * Uint32Array.BYTES_PER_ELEMENT
        : capacity * Float32Array.BYTES_PER_ELEMENT,
  );
}

function uploadEncodedColumnRange(
  queue: GPUQueue,
  column: EncodedColumn,
  values: FastScatterPointColumns['x'],
  startPoint: number,
  endPoint: number,
): number {
  if (endPoint <= startPoint) return 0;
  const pointsPerWord = column.storageMode === 1 ? 4 : column.storageMode === 2 ? 2 : 1;
  const alignedStart = Math.floor(startPoint / pointsPerWord) * pointsPerWord;
  const alignedEnd = Math.ceil(endPoint / pointsPerWord) * pointsPerWord;
  let upload: ArrayBufferView;
  if (column.storageMode === 1) {
    if (alignedStart === startPoint && alignedEnd === endPoint) {
      upload = (values as Uint8Array).subarray(alignedStart, endPoint);
    } else {
      const bytes = new Uint8Array(alignedEnd - alignedStart);
      bytes.set((values as Uint8Array).subarray(alignedStart, endPoint));
      upload = bytes;
    }
  } else if (column.storageMode === 2) {
    if (alignedStart === startPoint && alignedEnd === endPoint) {
      upload = (values as Uint16Array).subarray(alignedStart, endPoint);
    } else {
      const words = new Uint16Array(alignedEnd - alignedStart);
      words.set((values as Uint16Array).subarray(alignedStart, endPoint));
      upload = words;
    }
  } else if (
    values instanceof Float32Array &&
    column.encoding.offset === 0 && column.encoding.scale === 1
  ) {
    upload = values.subarray(alignedStart, endPoint);
  } else {
    const encoded = new Float32Array(endPoint - alignedStart);
    for (let index = alignedStart; index < endPoint; index += 1) {
      encoded[index - alignedStart] = encodeFastScatterWebgpuValue(
        values[index] ?? Number.NaN,
        column.encoding,
      );
    }
    upload = encoded;
  }
  const destinationOffset = encodedColumnByteOffset(column.storageMode, alignedStart);
  queue.writeBuffer(
    column.buffer,
    destinationOffset,
    upload.buffer,
    upload.byteOffset,
    upload.byteLength,
  );
  column.byteLength = encodedColumnAllocationBytes(column.storageMode, endPoint);
  return upload.byteLength;
}

function encodedColumnByteOffset(storageMode: 0 | 1 | 2, pointIndex: number): number {
  return storageMode === 1
    ? Math.floor(pointIndex / 4) * Uint32Array.BYTES_PER_ELEMENT
    : storageMode === 2
      ? Math.floor(pointIndex / 2) * Uint32Array.BYTES_PER_ELEMENT
      : pointIndex * Float32Array.BYTES_PER_ELEMENT;
}

function encodeStyleBufferCopies(
  encoder: GPUCommandEncoder,
  sourceLow: GPUBuffer,
  sourceHigh: GPUBuffer,
  sourceSplitBytes: number,
  destination: StyleGpuBuffers,
  byteLength: number,
): void {
  let offset = 0;
  while (offset < byteLength) {
    const sourceBoundary = sourceSplitBytes === 0 ? byteLength : sourceSplitBytes;
    const destinationBoundary = destination.splitBytes === 0
      ? byteLength
      : destination.splitBytes;
    const sourceBuffer = sourceSplitBytes !== 0 && offset >= sourceSplitBytes
      ? sourceHigh
      : sourceLow;
    const destinationBuffer = destination.splitBytes !== 0 && offset >= destination.splitBytes
      ? destination.bufferHigh
      : destination.buffer;
    const sourceOffset = sourceBuffer === sourceHigh ? offset - sourceSplitBytes : offset;
    const destinationOffset = destinationBuffer === destination.bufferHigh
      ? offset - destination.splitBytes
      : offset;
    const nextBoundary = Math.min(
      byteLength,
      sourceBuffer === sourceHigh ? byteLength : sourceBoundary,
      destinationBuffer === destination.bufferHigh ? byteLength : destinationBoundary,
    );
    const count = nextBoundary - offset;
    encoder.copyBufferToBuffer(
      sourceBuffer,
      sourceOffset,
      destinationBuffer,
      destinationOffset,
      count,
    );
    offset = nextBoundary;
  }
}

function writeStyleQueueData(
  queue: GPUQueue,
  gpu: Pick<GpuResources, 'styleBuffer' | 'styleBufferHigh' | 'styleSplitBytes'>,
  destinationOffset: number,
  data: Uint32Array,
): void {
  const queueData: Uint32Array<ArrayBuffer> = data.buffer instanceof ArrayBuffer
    ? new Uint32Array(data.buffer, data.byteOffset, data.length)
    : new Uint32Array(data);
  const split = gpu.styleSplitBytes;
  if (split === 0 || destinationOffset + queueData.byteLength <= split) {
    queue.writeBuffer(gpu.styleBuffer, destinationOffset, queueData);
    return;
  }
  if (destinationOffset >= split) {
    queue.writeBuffer(gpu.styleBufferHigh, destinationOffset - split, queueData);
    return;
  }
  const lowWords = (split - destinationOffset) / Uint32Array.BYTES_PER_ELEMENT;
  queue.writeBuffer(gpu.styleBuffer, destinationOffset, queueData.subarray(0, lowWords));
  queue.writeBuffer(gpu.styleBufferHigh, 0, queueData.subarray(lowWords));
}

function isNondecreasingRange(values: ArrayLike<number>, startPoint: number): boolean {
  const start = Math.max(1, startPoint);
  for (let index = start; index < values.length; index += 1) {
    if ((values[index] ?? Number.NaN) < (values[index - 1] ?? Number.NaN)) return false;
  }
  return true;
}

function createIdentityEncodedColumn(device: GPUDevice, label: string): EncodedColumn {
  const buffer = device.createBuffer({
    label,
    size: EMPTY_BUFFER_BYTES,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
  });
  return {
    buffer,
    byteLength: EMPTY_BUFFER_BYTES,
    encoding: { offset: 0, scale: 1 },
    storageMode: 0,
  };
}

async function resolveIndexedXMode(values: ArrayLike<number>): Promise<0 | 1 | 2> {
  if ((values as ArrayLike<number> & { generatedOverlapIndex?: boolean }).generatedOverlapIndex) {
    return 2;
  }
  if (!(values instanceof Uint32Array)) return 0;
  let identity = true;
  let overlapPattern = true;
  for (let index = 0; index < values.length; index += 1) {
    const blockStart = Math.floor(index / 24) * 24;
    const offset = index - blockStart;
    const expectedOverlap = offset >= 2 && offset < 5
      ? blockStart + 2
      : offset >= 14 && offset < 16
        ? blockStart + 14
        : index;
    identity &&= values[index] === index;
    overlapPattern &&= values[index] === expectedOverlap;
    if (!identity && !overlapPattern) return 0;
    if (index > 0 && index % BUILD_YIELD_INTERVAL === 0) await yieldToBrowser();
  }
  return identity ? 1 : overlapPattern ? 2 : 0;
}

async function createStyleBuffer(
  device: GPUDevice,
  columns: FastScatterPointColumns,
  theme: FastScatterTheme,
  packedStyles?: FastScatterWebgpuPackedStyles,
  requestedCapacity = columns.x.length,
): Promise<{
  buffer: GPUBuffer;
  bufferHigh: GPUBuffer;
  byteLength: number;
  constant: boolean;
  maxPointSize: number;
  overviewIndices: Uint32Array;
  splitBytes: number;
}> {
  const pointCount = columns.x.length;
  const pointCapacity = normalizePointCapacity(requestedCapacity, pointCount);
  const overviewIndices: number[] = [];
  let overviewBlock = -1;
  let overviewMaxSize = -1;
  let overviewMaxSizeIndex = -1;
  const collectOverviewStyle = (pointIndex: number, packed: number) => {
    const block = Math.floor(pointIndex / OVERVIEW_REPRESENTATIVE_BLOCK_SIZE);
    if (block !== overviewBlock) {
      if (overviewMaxSizeIndex >= 0) overviewIndices.push(overviewMaxSizeIndex);
      overviewBlock = block;
      overviewMaxSize = -1;
      overviewMaxSizeIndex = -1;
    }
    const size = (packed >>> 29) & 0x7;
    if (size > overviewMaxSize) {
      overviewMaxSize = size;
      overviewMaxSizeIndex = pointIndex;
    }
  };
  const finishOverviewStyles = () => {
    if (overviewMaxSizeIndex >= 0) overviewIndices.push(overviewMaxSizeIndex);
    return Uint32Array.from(overviewIndices);
  };
  if (packedStyles !== undefined) {
    const inputStrideBytes = packedStyles.styleStrideBytes ?? (
      'data' in packedStyles && packedStyles.data.length === pointCount * 3
        ? 12
        : 'data' in packedStyles && packedStyles.data.length === pointCount * 2
          ? 8
          : STYLE_STRIDE_BYTES
    );
    const inputWordsPerPoint = inputStrideBytes / Uint32Array.BYTES_PER_ELEMENT;
    const expectedWordCount = pointCount * inputWordsPerPoint;
    if ('data' in packedStyles && packedStyles.data.length !== expectedWordCount) {
      throw new Error(
        `Packed WebGPU styles contain ${packedStyles.data.length} words; expected ${expectedWordCount}.`,
      );
    }
    if ('pointCount' in packedStyles && packedStyles.pointCount !== pointCount) {
      throw new Error(
        `Streamed WebGPU styles contain ${packedStyles.pointCount} points; expected ${pointCount}.`,
      );
    }
    const byteLength = Math.max(STYLE_STRIDE_BYTES, pointCapacity * STYLE_STRIDE_BYTES);
    const buffers = createStyleGpuBuffers(device, byteLength, true);
    const mapped = mapStyleBuffers(buffers);
    if ('data' in packedStyles) {
      const chunkWords = UPLOAD_CHUNK_POINTS * inputWordsPerPoint;
      for (let start = 0; start < packedStyles.data.length; start += chunkWords) {
        const count = Math.min(chunkWords, packedStyles.data.length - start);
        const source = packedStyles.data.subarray(start, start + count);
        const upload = toInternalPackedStyleWords(
          source,
          inputStrideBytes,
          start / inputWordsPerPoint,
          collectOverviewStyle,
        );
        writeMappedStyleData(
          mapped,
          (start / inputWordsPerPoint) * STYLE_STRIDE_BYTES,
          upload,
        );
        await yieldToBrowser();
      }
    } else {
      let nextPoint = 0;
      for await (const page of packedStyles.createPages()) {
        if (page.startPoint !== nextPoint || page.data.length % inputWordsPerPoint !== 0) {
          throw new Error(
            `Streamed WebGPU style page starts at ${page.startPoint}; expected ${nextPoint}.`,
          );
        }
        const pagePointCount = page.data.length / inputWordsPerPoint;
        if (nextPoint + pagePointCount > pointCount) {
          throw new Error('Streamed WebGPU style pages exceed the plot point count.');
        }
        const upload = toInternalPackedStyleWords(
          page.data,
          inputStrideBytes,
          nextPoint,
          collectOverviewStyle,
        );
        writeMappedStyleData(
          mapped,
          nextPoint * STYLE_STRIDE_BYTES,
          upload,
        );
        nextPoint += pagePointCount;
        await yieldToBrowser();
      }
      if (nextPoint !== pointCount) {
        throw new Error(
          `Streamed WebGPU styles ended after ${nextPoint} points; expected ${pointCount}.`,
        );
      }
    }
    unmapStyleBuffers(buffers);
    return {
      ...buffers,
      byteLength,
      constant: false,
      maxPointSize: Math.max(0, packedStyles.maxPointSize),
      overviewIndices: finishOverviewStyles(),
    };
  }
  const constant =
    columns.color === undefined && columns.opacity === undefined &&
    columns.rotation === undefined && columns.shape === undefined && columns.size === undefined;
  const styleCount = constant ? 1 : pointCapacity;
  const byteLength = Math.max(STYLE_STRIDE_BYTES, styleCount * STYLE_STRIDE_BYTES);
  const buffers = createStyleGpuBuffers(device, byteLength, true);
  const mapped = mapStyleBuffers(buffers);
  const chunkPointCount = Math.min(UPLOAD_CHUNK_POINTS, Math.max(1, styleCount));
  const chunk = new ArrayBuffer(chunkPointCount * STYLE_STRIDE_BYTES);
  const words = new Uint32Array(chunk);
  let maxPointSize = 0;
  const populatedStyleCount = constant ? 1 : pointCount;
  for (let start = 0; start < populatedStyleCount; start += chunkPointCount) {
    const count = Math.min(chunkPointCount, populatedStyleCount - start);
    for (let index = 0; index < count; index += 1) {
      const style = packFastScatterWebgpuStyle(columns, start + index, theme.defaultPointColor);
      words[index] = compactStyleWords(style.color, style.meta);
      if (!constant) collectOverviewStyle(start + index, words[index]!);
      maxPointSize = Math.max(maxPointSize, style.size);
    }
    writeMappedStyleData(
      mapped,
      start * STYLE_STRIDE_BYTES,
      new Uint8Array(chunk, 0, count * STYLE_STRIDE_BYTES),
    );
    await yieldToBrowser();
  }
  unmapStyleBuffers(buffers);
  return {
    ...buffers,
    byteLength,
    constant,
    maxPointSize,
    overviewIndices: constant ? new Uint32Array(0) : finishOverviewStyles(),
  };
}

interface StyleGpuBuffers {
  buffer: GPUBuffer;
  bufferHigh: GPUBuffer;
  splitBytes: number;
}

function createStyleGpuBuffers(
  device: GPUDevice,
  byteLength: number,
  mappedAtCreation = false,
): StyleGpuBuffers {
  const splitBytes = byteLength > device.limits.maxStorageBufferBindingSize
    ? Math.ceil(byteLength / (STYLE_STRIDE_BYTES * 2)) * STYLE_STRIDE_BYTES
    : 0;
  const lowBytes = splitBytes === 0 ? byteLength : splitBytes;
  const highBytes = splitBytes === 0 ? STYLE_STRIDE_BYTES : byteLength - splitBytes;
  if (
    lowBytes > device.limits.maxBufferSize || highBytes > device.limits.maxBufferSize ||
    lowBytes > device.limits.maxStorageBufferBindingSize ||
    highBytes > device.limits.maxStorageBufferBindingSize
  ) {
    throw new Error(
      `Packed styles require ${byteLength} bytes, exceeding the two-buffer storage capacity on this device.`,
    );
  }
  const usage = GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE;
  return {
    buffer: device.createBuffer({
      label: 'm-scatter-webgpu/styles-low',
      mappedAtCreation,
      size: Math.max(STYLE_STRIDE_BYTES, lowBytes),
      usage,
    }),
    bufferHigh: device.createBuffer({
      label: 'm-scatter-webgpu/styles-high',
      mappedAtCreation,
      size: Math.max(STYLE_STRIDE_BYTES, highBytes),
      usage,
    }),
    splitBytes,
  };
}

interface MappedStyleBuffers {
  high: Uint8Array;
  low: Uint8Array;
  splitBytes: number;
}

function mapStyleBuffers(buffers: StyleGpuBuffers): MappedStyleBuffers {
  return {
    high: new Uint8Array(buffers.bufferHigh.getMappedRange()),
    low: new Uint8Array(buffers.buffer.getMappedRange()),
    splitBytes: buffers.splitBytes,
  };
}

function unmapStyleBuffers(buffers: StyleGpuBuffers): void {
  buffers.buffer.unmap();
  buffers.bufferHigh.unmap();
}

function writeMappedStyleData(
  buffers: MappedStyleBuffers,
  destinationOffset: number,
  data: ArrayBufferView,
): void {
  const source = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const splitBytes = buffers.splitBytes;
  if (splitBytes === 0 || destinationOffset + data.byteLength <= splitBytes) {
    buffers.low.set(source, destinationOffset);
    return;
  }
  if (destinationOffset >= splitBytes) {
    buffers.high.set(source, destinationOffset - splitBytes);
    return;
  }
  const lowByteLength = splitBytes - destinationOffset;
  buffers.low.set(source.subarray(0, lowByteLength), destinationOffset);
  buffers.high.set(source.subarray(lowByteLength), 0);
}

async function createSourceMapping(columns: FastScatterPointColumns): Promise<{
  identity: boolean;
  inverse?: Uint32Array;
}> {
  const source = columns.sourceIndex;
  if (source === undefined) return { identity: true };
  let identity = true;
  let maxSourceIndex = 0;
  for (let index = 0; index < source.length; index += 1) {
    identity &&= source[index] === index;
    maxSourceIndex = Math.max(maxSourceIndex, source[index] ?? 0);
    if (index > 0 && index % BUILD_YIELD_INTERVAL === 0) await yieldToBrowser();
  }
  if (identity) return { identity: true };
  if (maxSourceIndex > columns.x.length * 4) {
    return { identity: false };
  }
  const inverse = new Uint32Array(maxSourceIndex + 1);
  inverse.fill(INVALID_POINT_INDEX);
  for (let pointIndex = 0; pointIndex < source.length; pointIndex += 1) {
    const sourceIndex = source[pointIndex];
    if (sourceIndex !== undefined) inverse[sourceIndex] = pointIndex;
  }
  return { identity: false, inverse };
}

function toInternalPackedStyleWords(
  source: Uint32Array,
  inputStrideBytes: 4 | 8 | 12,
  startPoint = 0,
  collect?: (pointIndex: number, packed: number) => void,
): Uint32Array {
  if (inputStrideBytes === STYLE_STRIDE_BYTES) {
    if (collect !== undefined) {
      for (let pointIndex = 0; pointIndex < source.length; pointIndex += 1) {
        collect(startPoint + pointIndex, source[pointIndex] ?? 0);
      }
    }
    return source;
  }
  const expanded = inputStrideBytes === 12 ? convertLegacyPackedStyleWords(source) : source;
  const pointCount = expanded.length / 2;
  const compact = new Uint32Array(pointCount);
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    compact[pointIndex] = compactStyleWords(
      expanded[pointIndex * 2] ?? 0,
      expanded[pointIndex * 2 + 1] ?? 0,
    );
    collect?.(startPoint + pointIndex, compact[pointIndex] ?? 0);
  }
  return compact;
}

function compactStyleWords(color: number, meta: number): number {
  const red = color & 0xff;
  const green = (color >>> 8) & 0xff;
  const blue = (color >>> 16) & 0xff;
  const alpha = (color >>> 24) & 0xff;
  const rgb565 = Math.round((red / 255) * 31) |
    (Math.round((green / 255) * 63) << 5) |
    (Math.round((blue / 255) * 31) << 11);
  const opacity = meta & 0xff;
  const effectiveOpacity = Math.round(((opacity * alpha) / (255 * 255)) * 15);
  const shape = (meta >>> 8) & 0x7;
  const rotation = Math.round((((meta >>> 11) & 0x3ff) / 1023) * 63);
  const size = ((meta >>> 21) & 0x7ff) / 4;
  const encodedSize = Math.max(0, Math.min(7, Math.round(size - 1)));
  return (
    rgb565 |
    (effectiveOpacity << 16) |
    (shape << 20) |
    (rotation << 23) |
    (encodedSize << 29)
  ) >>> 0;
}

function convertLegacyPackedStyleWords(legacy: Uint32Array): Uint32Array {
  const pointCount = Math.floor(legacy.length / 3);
  const converted = new Uint32Array(pointCount * 2);
  const legacyFloats = new Float32Array(
    legacy.buffer,
    legacy.byteOffset,
    legacy.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const legacyOffset = pointIndex * 3;
    const outputOffset = pointIndex * 2;
    const legacyMeta = legacy[legacyOffset + 1] ?? 0;
    const opacity = legacyMeta & 0xff;
    const shape = (legacyMeta >>> 8) & 0x7;
    const rotation = Math.round((((legacyMeta >>> 16) & 0xffff) / 65535) * 1023);
    const size = Math.max(0, legacyFloats[legacyOffset + 2] ?? 0);
    const encodedSize = Math.min(2047, Math.round(size * 4));
    converted[outputOffset] = legacy[legacyOffset] ?? 0;
    converted[outputOffset + 1] =
      (opacity | (shape << 8) | (rotation << 11) | (encodedSize << 21)) >>> 0;
  }
  return converted;
}

function materializePointIndices(
  gpu: GpuResources,
  sourceIndices: Uint32Array,
  pointCount: number,
): Uint32Array {
  if (sourceIndices.length === 0) return sourceIndices;
  if (gpu.identitySourceOrder) {
    const valid = sourceIndices.filter((sourceIndex) => sourceIndex < pointCount);
    return valid.length === sourceIndices.length ? sourceIndices : valid;
  }
  const inverse = gpu.inverseSourceIndex;
  if (inverse !== undefined) {
    const output = new Uint32Array(sourceIndices.length);
    let count = 0;
    for (const sourceIndex of sourceIndices) {
      const pointIndex = inverse[sourceIndex];
      if (pointIndex !== undefined && pointIndex !== INVALID_POINT_INDEX) output[count++] = pointIndex;
    }
    return output.subarray(0, count);
  }
  return new Uint32Array(0);
}

function recreatePlotBindGroups(device: GPUDevice, gpu: GpuResources): void {
  for (const plot of gpu.plots) {
    plot.bindGroup = createPlotBindGroup(
      device,
      gpu.bindGroupLayout,
      plot.uniformBuffer,
      gpu.x.buffer,
      plot.y.buffer,
      gpu.styleBuffer,
      gpu.styleBufferHigh,
      gpu.styleByteLength,
      gpu.styleSplitBytes,
      gpu.selectedBuffer,
      gpu.rotationBuffer,
      gpu.selectedBuffer,
    );
    plot.selectedBindGroup = createPlotBindGroup(
      device,
      gpu.bindGroupLayout,
      plot.selectedUniformBuffer,
      gpu.x.buffer,
      plot.y.buffer,
      gpu.styleBuffer,
      gpu.styleBufferHigh,
      gpu.styleByteLength,
      gpu.styleSplitBytes,
      gpu.selectedBuffer,
      gpu.rotationBuffer,
      gpu.selectedBuffer,
    );
    plot.overviewBindGroup = createPlotBindGroup(
      device,
      gpu.bindGroupLayout,
      plot.overviewUniformBuffer,
      gpu.x.buffer,
      plot.y.buffer,
      gpu.styleBuffer,
      gpu.styleBufferHigh,
      gpu.styleByteLength,
      gpu.styleSplitBytes,
      plot.overviewBuffer,
      gpu.rotationBuffer,
      gpu.selectedBuffer,
    );
    plot.selectedOverviewBindGroup = createPlotBindGroup(
      device,
      gpu.bindGroupLayout,
      plot.selectedOverviewUniformBuffer,
      gpu.x.buffer,
      plot.y.buffer,
      gpu.styleBuffer,
      gpu.styleBufferHigh,
      gpu.styleByteLength,
      gpu.styleSplitBytes,
      plot.overviewBuffer,
      gpu.rotationBuffer,
      gpu.selectedBuffer,
    );
  }
}

function createPlotBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  uniformBuffer: GPUBuffer,
  xBuffer: GPUBuffer,
  yBuffer: GPUBuffer,
  styleBuffer: GPUBuffer,
  styleBufferHigh: GPUBuffer,
  styleByteLength: number,
  styleSplitBytes: number,
  pointIndexBuffer: GPUBuffer,
  rotationBuffer: GPUBuffer,
  selectedMembershipBuffer: GPUBuffer,
): GPUBindGroup {
  return device.createBindGroup({
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: xBuffer } },
      { binding: 2, resource: { buffer: yBuffer } },
      {
        binding: 3,
        resource: {
          buffer: styleBuffer,
          size: styleSplitBytes === 0 ? styleByteLength : styleSplitBytes,
        },
      },
      { binding: 4, resource: { buffer: pointIndexBuffer } },
      { binding: 5, resource: { buffer: rotationBuffer } },
      {
        binding: 6,
        resource: styleSplitBytes === 0
          ? { buffer: styleBuffer, size: styleByteLength }
          : {
              buffer: styleBufferHigh,
              size: styleByteLength - styleSplitBytes,
            },
      },
      { binding: 7, resource: { buffer: selectedMembershipBuffer } },
    ],
    layout,
  });
}

function createRotationLookupBuffer(device: GPUDevice): GPUBuffer {
  const values = new Float32Array(ROTATION_LUT_SIZE * 2);
  for (let index = 0; index < ROTATION_LUT_SIZE; index += 1) {
    const angle = (index / (ROTATION_LUT_SIZE - 1)) * Math.PI * 2 - Math.PI;
    values[index * 2] = Math.cos(angle);
    values[index * 2 + 1] = Math.sin(angle);
  }
  const buffer = device.createBuffer({
    label: 'm-scatter-webgpu/rotation-lut',
    size: values.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
  });
  device.queue.writeBuffer(buffer, 0, values);
  return buffer;
}

export function calculateFastScatterWebgpuAlignedStyleWindowBytes(
  maxStorageBufferBindingSize: number,
  minStorageBufferOffsetAlignment: number,
): number {
  const alignment = Math.max(STYLE_STRIDE_BYTES, minStorageBufferOffsetAlignment);
  return Math.floor(maxStorageBufferBindingSize / alignment) * alignment;
}

function createCacheTexture(
  device: GPUDevice,
  format: GPUTextureFormat,
  width: number,
  height: number,
): GPUTexture {
  return device.createTexture({
    format,
    label: 'm-scatter-webgpu/cached-frame',
    size: { height: Math.max(1, height), width: Math.max(1, width) },
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
}

function createCompositeBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  sampler: GPUSampler,
  view: GPUTextureView,
  uniformBuffer: GPUBuffer,
): GPUBindGroup {
  return device.createBindGroup({
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: view },
      { binding: 2, resource: { buffer: uniformBuffer } },
    ],
    layout,
  });
}

interface CompositeUniformInput {
  cachedX: FastScatterRange;
  cachedY: FastScatterRange;
  cacheCanvasHeight: number;
  cacheCanvasWidth: number;
  cachePlotHeight: number;
  cachePlotWidth: number;
  cachePlotX: number;
  cachePlotY: number;
  canvasHeight: number;
  canvasWidth: number;
  currentX: FastScatterRange;
  currentY: FastScatterRange;
  plotHeight: number;
  plotWidth: number;
  plotX: number;
  plotY: number;
  subplotColor: readonly [number, number, number, number];
}

function writeCompositeUniforms(
  device: GPUDevice,
  buffer: GPUBuffer,
  input: CompositeUniformInput,
): void {
  const values = COMPOSITE_UNIFORM_SCRATCH;
  values.fill(0);
  values.set([input.currentX.min, input.currentX.max, input.currentY.min, input.currentY.max], 0);
  values.set([input.cachedX.min, input.cachedX.max, input.cachedY.min, input.cachedY.max], 4);
  values.set([input.canvasWidth, input.canvasHeight, input.plotX, input.plotY], 8);
  values.set([input.plotWidth, input.plotHeight, 0, 0], 12);
  values.set(input.subplotColor, 16);
  values.set([
    0,
    1 / Math.max(1, input.cacheCanvasWidth),
    1 / Math.max(1, input.cacheCanvasHeight),
    0,
  ], 20);
  values.set([
    input.cacheCanvasWidth,
    input.cacheCanvasHeight,
    input.cachePlotX,
    input.cachePlotY,
  ], 24);
  values.set([input.cachePlotWidth, input.cachePlotHeight, 0, 0], 28);
  device.queue.writeBuffer(buffer, 0, values);
}

interface PlotUniformInput {
  alphaWeight: number;
  alphaScale: number;
  canvasHeight: number;
  canvasWidth: number;
  devicePixelRatio: number;
  indexedPass: boolean;
  opacityScale: number;
  plotHeight: number;
  plotWidth: number;
  plotX: number;
  plotY: number;
  pointIndexBase: number;
  pointIndexStride: number;
  pointSizeScale: number;
  selectedIndexMode: 0 | 1;
  selectedPass: boolean;
  theme: FastScatterTheme;
  xIndexOrigin: number;
  xRange: FastScatterRange;
  yRange: FastScatterRange;
  yStorageMode: 0 | 1 | 2;
}

function writePlotUniforms(
  device: GPUDevice,
  plot: PlotResources,
  input: PlotUniformInput,
  target: 'default' | 'selected-overview' = 'default',
): void {
  const storage = PLOT_UNIFORM_SCRATCH;
  const f32 = new Float32Array(storage);
  const u32 = new Uint32Array(storage);
  f32.fill(0);
  f32.set([input.xRange.min, input.xRange.max, input.yRange.min, input.yRange.max], 0);
  f32.set([input.canvasWidth, input.canvasHeight, input.plotX, input.plotY], 4);
  f32.set([input.plotWidth, input.plotHeight, input.devicePixelRatio, input.pointSizeScale], 8);
  f32.set([
    input.opacityScale,
    input.alphaScale,
    input.theme.alphaScaleMultiplier ?? 1,
    input.theme.colorMixAmount ?? 0,
  ], 12);
  f32.set([
    (input.theme.colorMixColor?.[0] ?? 255) / 255,
    (input.theme.colorMixColor?.[1] ?? 255) / 255,
    (input.theme.colorMixColor?.[2] ?? 255) / 255,
    0,
  ], 16);
  f32.set(input.theme.selectedOverlayColor, 20);
  u32[24] = input.pointIndexBase >>> 0;
  u32[25] = Math.max(1, input.pointIndexStride) >>> 0;
  u32[26] = (
    (Math.max(1, input.alphaWeight) & 0x07ff_ffff) |
    (input.selectedIndexMode === 1 ? 0x0800_0000 : 0) |
    (input.yStorageMode << 28) |
    (input.indexedPass ? 0x4000_0000 : 0) |
    (input.selectedPass ? 0x8000_0000 : 0)
  ) >>> 0;
  u32[27] = input.xIndexOrigin >>> 0;
  f32.set(input.theme.subplotBackgroundColor, 28);
  const uniformBuffer = target === 'selected-overview'
    ? plot.selectedOverviewUniformBuffer
    : input.selectedPass
      ? plot.selectedUniformBuffer
    : input.indexedPass
      ? plot.overviewUniformBuffer
      : plot.uniformBuffer;
  device.queue.writeBuffer(
    uniformBuffer,
    0,
    storage,
  );
}

export function encodeFastScatterWebgpuIndexedRange(
  range: FastScatterRange,
): { origin: number; range: FastScatterRange } {
  const origin = clampInteger(Math.floor(Math.min(range.min, range.max)), 0, 0xffff_ffff);
  return {
    origin,
    range: {
      max: range.max - origin,
      min: range.min - origin,
    },
  };
}

export function calculateFastScatterWebgpuLodRange(
  visibleStart: number,
  visibleEnd: number,
  maxPoints = FAST_SCATTER_WEBGPU_MAX_RENDERED_POINTS_PER_SUBPLOT,
): { count: number; start: number; stride: number } {
  const start = Math.max(0, Math.floor(visibleStart));
  const end = Math.max(start, Math.floor(visibleEnd));
  const visibleCount = end - start;
  const budget = Math.max(1, Math.floor(maxPoints));
  const stride = Math.max(1, Math.ceil(visibleCount / budget));
  if (stride === 1) return { count: visibleCount, start, stride };
  const alignedStart = Math.floor(start / stride) * stride;
  const count = Math.max(1, Math.floor((end - alignedStart) / stride));
  return { count, start: alignedStart, stride };
}

export function calculateFastScatterWebgpuLodPointIndex(
  start: number,
  instanceIndex: number,
  stride: number,
): number {
  const normalizedStart = Math.max(0, Math.floor(start));
  const normalizedInstanceIndex = Math.max(0, Math.floor(instanceIndex));
  const normalizedStride = Math.max(1, Math.floor(stride));
  if (normalizedStride === 1) return normalizedStart + normalizedInstanceIndex;
  const bucketIndex = Math.floor(normalizedStart / normalizedStride) + normalizedInstanceIndex;
  let value = (Math.imul(bucketIndex, 747_796_405) + 2_891_336_453) >>> 0;
  value = Math.imul(
    ((value >>> ((value >>> 28) + 4)) ^ value) >>> 0,
    277_803_737,
  ) >>> 0;
  value = ((value >>> 22) ^ value) >>> 0;
  return normalizedStart + normalizedInstanceIndex * normalizedStride +
    (value % normalizedStride);
}

export function isFastScatterWebgpuLodPoint(
  pointIndex: number,
  start: number,
  count: number,
  stride: number,
): boolean {
  if (!Number.isInteger(pointIndex) || pointIndex < start || count <= 0) return false;
  const normalizedStride = Math.max(1, Math.floor(stride));
  const instanceIndex = Math.floor((pointIndex - start) / normalizedStride);
  return instanceIndex >= 0 && instanceIndex < count &&
    calculateFastScatterWebgpuLodPointIndex(start, instanceIndex, normalizedStride) === pointIndex;
}

function sortedUint32ArrayIncludes(values: Uint32Array, target: number): boolean {
  const index = lowerBoundUint32(values, target);
  return values[index] === target;
}

function countSortedUint32ValuesInRange(
  values: Uint32Array,
  start: number,
  end: number,
): number {
  return Math.max(0, lowerBoundUint32(values, end) - lowerBoundUint32(values, start));
}

function lowerBoundUint32(values: Uint32Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const value = values[middle] ?? 0;
    if (value < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function encodeXRangeForRender(
  range: FastScatterRange,
  encoding: ColumnEncoding,
  indexedMode: 0 | 1 | 2,
): { origin: number; range: FastScatterRange } {
  return indexedMode === 0
    ? { origin: 0, range: encodeFastScatterWebgpuRange(range, encoding) }
    : encodeFastScatterWebgpuIndexedRange(range);
}

function encodeXRangesForComposite(
  current: FastScatterRange,
  cached: FastScatterRange,
  encoding: ColumnEncoding,
  indexedMode: 0 | 1 | 2,
): { cached: FastScatterRange; current: FastScatterRange } {
  if (indexedMode === 0) {
    return {
      cached: encodeFastScatterWebgpuRange(cached, encoding),
      current: encodeFastScatterWebgpuRange(current, encoding),
    };
  }
  const origin = clampInteger(
    Math.floor(Math.min(current.min, current.max, cached.min, cached.max)),
    0,
    0xffff_ffff,
  );
  return {
    cached: { max: cached.max - origin, min: cached.min - origin },
    current: { max: current.max - origin, min: current.min - origin },
  };
}

function resolveVisibleRange(
  columns: FastScatterPointColumns,
  range: FastScatterRange,
  sorted: boolean,
): { end: number; start: number } {
  if (!sorted) return { end: columns.x.length, start: 0 };
  const min = Math.min(range.min, range.max);
  const max = Math.max(range.min, range.max);
  return {
    end: upperBound(columns.x, max),
    start: lowerBound(columns.x, min),
  };
}

function lowerBound(values: ArrayLike<number>, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((values[mid] ?? Number.POSITIVE_INFINITY) < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function upperBound(values: ArrayLike<number>, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((values[mid] ?? Number.POSITIVE_INFINITY) <= target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function validatePointColumns(columns: FastScatterPointColumns, spec: FastScatterPlotSpec): void {
  const pointCount = columns.x.length;
  for (const plot of spec.plots) {
    if (columns.y[plot.yKey]?.length !== pointCount) {
      throw new Error(`Fast scatter y column "${plot.yKey}" must contain ${pointCount} values.`);
    }
  }
  if (columns.color instanceof Uint8Array && columns.color.length !== pointCount * 4) {
    throw new Error('Fast scatter rgba8 color columns must contain four bytes per point.');
  }
  for (const [name, values] of [
    ['opacity', columns.opacity],
    ['rotation', columns.rotation],
    ['shape', columns.shape],
    ['size', columns.size],
    ['sourceIndex', columns.sourceIndex],
  ] as const) {
    if (values !== undefined && values.length !== pointCount) {
      throw new Error(`Fast scatter ${name} column must contain ${pointCount} values.`);
    }
  }
}

function isNondecreasing(values: ArrayLike<number>): boolean {
  let previous = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? Number.NaN;
    if (Number.isFinite(value) && value < previous) return false;
    if (Number.isFinite(value)) previous = value;
  }
  return true;
}

function isIndexedXRangeCompatible(
  values: ArrayLike<number>,
  startPoint: number,
  indexedMode: 0 | 1 | 2,
): boolean {
  if (indexedMode === 0) return true;
  for (let index = startPoint; index < values.length; index += 1) {
    if (indexedMode === 1) {
      if (values[index] !== index) return false;
      continue;
    }
    const blockStart = Math.floor(index / 24) * 24;
    const offset = index - blockStart;
    const expected = offset >= 2 && offset < 5
      ? blockStart + 2
      : offset >= 14 && offset < 16
        ? blockStart + 14
        : index;
    if (values[index] !== expected) return false;
  }
  return true;
}

function destroyGpuResources(gpu: GpuResources): void {
  const destroyedY = new Set<GPUBuffer>();
  const destroyedOverview = new Set<GPUBuffer>();
  gpu.x.buffer.destroy();
  gpu.styleBuffer.destroy();
  gpu.styleBufferHigh.destroy();
  gpu.rotationBuffer.destroy();
  gpu.selectedBuffer.destroy();
  gpu.cacheTexture.destroy();
  gpu.workTexture.destroy();
  for (const plot of gpu.plots) {
    plot.compositeUniformBuffer.destroy();
    plot.overviewUniformBuffer.destroy();
    plot.uniformBuffer.destroy();
    plot.selectedOverviewUniformBuffer.destroy();
    plot.selectedUniformBuffer.destroy();
    if (!destroyedOverview.has(plot.overviewBuffer)) {
      destroyedOverview.add(plot.overviewBuffer);
      plot.overviewBuffer.destroy();
    }
    if (!destroyedY.has(plot.y.buffer)) {
      destroyedY.add(plot.y.buffer);
      plot.y.buffer.destroy();
    }
  }
}

function calculateGpuResidentBytes(gpu: GpuResources): number {
  const uniformBytes = gpu.plots.length * UNIFORM_BYTES * 5;
  const coordinateBytes = gpu.xIndexedMode === 0
    ? encodedColumnAllocationBytes(gpu.x.storageMode, gpu.pointCapacity)
    : EMPTY_BUFFER_BYTES;
  const uniqueY = new Set(gpu.plots.map((plot) => plot.y));
  const yBytes = [...uniqueY].reduce(
    (total, column) => total + encodedColumnAllocationBytes(
      column.storageMode,
      gpu.pointCapacity,
    ),
    0,
  );
  const overviewBuffers = new Map<GPUBuffer, number>();
  for (const plot of gpu.plots) {
    overviewBuffers.set(
      plot.overviewBuffer,
      Math.max(EMPTY_BUFFER_BYTES, plot.overviewCount * Uint32Array.BYTES_PER_ELEMENT),
    );
  }
  const overviewBytes = [...overviewBuffers.values()].reduce(
    (total, bytes) => total + bytes,
    0,
  );
  return coordinateBytes + yBytes + gpu.styleByteLength + overviewBytes +
    gpu.cacheWidth * gpu.cacheHeight * 8 +
    gpu.selectedCapacity * Uint32Array.BYTES_PER_ELEMENT + uniformBytes +
    ROTATION_LUT_BYTES;
}

function cloneViewport(viewport: FastScatterViewport): FastScatterViewport {
  return {
    x: { ...viewport.x },
    yByPlot: Object.fromEntries(
      Object.entries(viewport.yByPlot).map(([plotId, range]) => [plotId, { ...range }]),
    ),
  };
}

function createOverscanViewport(
  viewport: FastScatterViewport,
  xScale: number,
  yScale: number,
): FastScatterViewport {
  return {
    x: expandRange(viewport.x, xScale),
    yByPlot: Object.fromEntries(
      Object.entries(viewport.yByPlot).map(([plotId, range]) => [
        plotId,
        expandRange(range, yScale),
      ]),
    ),
  };
}

function expandRange(range: FastScatterRange, scale: number): FastScatterRange {
  const center = (range.min + range.max) / 2;
  const halfSpan = ((range.max - range.min) * Math.max(1, scale)) / 2;
  return { max: center + halfSpan, min: center - halfSpan };
}

function scaleDeviceRect(
  rect: ReturnType<typeof rectToDevicePixels>,
  xScale: number,
  yScale: number,
): ReturnType<typeof rectToDevicePixels> {
  return {
    ...rect,
    heightCssPx: Math.max(1, Math.round(rect.heightCssPx * yScale)),
    widthCssPx: Math.max(1, Math.round(rect.widthCssPx * xScale)),
    xCssPx: Math.round(rect.xCssPx * xScale),
    yCssPx: Math.round(rect.yCssPx * yScale),
  };
}

function areViewportsEqual(
  first: FastScatterViewport,
  second: FastScatterViewport,
): boolean {
  if (first === second) return true;
  if (first.x.min !== second.x.min || first.x.max !== second.x.max) return false;
  const firstIds = Object.keys(first.yByPlot);
  const secondIds = Object.keys(second.yByPlot);
  if (firstIds.length !== secondIds.length) return false;
  return firstIds.every((plotId) => {
    const firstRange = first.yByPlot[plotId];
    const secondRange = second.yByPlot[plotId];
    return firstRange !== undefined && secondRange !== undefined &&
      firstRange.min === secondRange.min && firstRange.max === secondRange.max;
  });
}

function areThemesEqual(
  first: FastScatterTheme | undefined,
  second: FastScatterTheme | undefined,
): boolean {
  if (first === second) return true;
  const left = first ?? DEFAULT_THEME;
  const right = second ?? DEFAULT_THEME;
  return left.alphaScaleMultiplier === right.alphaScaleMultiplier &&
    left.colorMixAmount === right.colorMixAmount &&
    areNumericArraysEqual(left.backgroundColor, right.backgroundColor) &&
    areNumericArraysEqual(left.colorMixColor, right.colorMixColor) &&
    areNumericArraysEqual(left.defaultPointColor, right.defaultPointColor) &&
    areNumericArraysEqual(left.selectedOverlayColor, right.selectedOverlayColor) &&
    areNumericArraysEqual(left.subplotBackgroundColor, right.subplotBackgroundColor);
}

function areNumericArraysEqual(
  first: ArrayLike<number> | undefined,
  second: ArrayLike<number> | undefined,
): boolean {
  if (first === second) return true;
  if (first === undefined || second === undefined || first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

function toGpuColor(color: readonly [number, number, number, number]): GPUColor {
  return { a: color[3], b: color[2], g: color[1], r: color[0] };
}

function nextPowerOfTwo(value: number): number {
  return value <= 1 ? 1 : 2 ** Math.ceil(Math.log2(value));
}

function normalizeDevicePixelRatio(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(4, value) : 1;
}

function normalizePointCapacity(value: number | undefined, pointCount: number): number {
  const minimum = Math.max(1, pointCount);
  if (value === undefined || !Number.isSafeInteger(value) || value < minimum) return minimum;
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.floor(clamp(value, min, Math.max(min, max)));
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}
