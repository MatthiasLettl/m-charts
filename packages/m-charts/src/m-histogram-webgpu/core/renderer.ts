import {
  buildHistogramRendererBuffers,
  resolveHistogramRendererTheme,
  type HistogramMetricsEvent,
  type HistogramRendererBufferBuildInput,
  type HistogramRendererBuffers,
  type HistogramRendererHoverBin,
  type HistogramRendererRenderMetrics,
  type HistogramRendererUpdate,
} from '../../m-histogram/core/index.js';
import type { HistogramRendererLike } from '../../m-histogram/engine/index.js';
import {
  createWebgpuContext,
  WebgpuTimestampProfiler,
  type WebgpuContext,
} from '../../plot-engine-webgpu/index.js';
import { HISTOGRAM_WEBGPU_SHADER } from './shaders.js';
import type {
  HistogramWebgpuDiagnostics,
  HistogramWebgpuRendererOptions,
} from './types.js';

const UNIT_QUAD = new Float32Array([
  0, 0, 1, 0, 0, 1,
  0, 1, 1, 0, 1, 1,
]);
const EMPTY_BUFFER_BYTES = 16;

interface GpuResources {
  bindGroup: GPUBindGroup;
  colorBuffer: GPUBuffer;
  instanceCapacity: number;
  pipeline: GPURenderPipeline;
  rectBuffer: GPUBuffer;
  uniformBuffer: GPUBuffer;
  unitQuadBuffer: GPUBuffer;
}

export class HistogramWebgpuRenderer implements HistogramRendererLike {
  readonly interactive: Promise<void>;
  readonly ready: Promise<void>;
  private buffersDirty = true;
  private context: WebgpuContext | null = null;
  private currentBuffers: HistogramRendererBuffers | null = null;
  private devicePixelRatio: number;
  private disposed = false;
  private gpu: GpuResources | null = null;
  private gpuTimer: WebgpuTimestampProfiler | null = null;
  private hoverBin: HistogramRendererHoverBin | null;
  private onMetrics?: (metrics: HistogramMetricsEvent) => void;
  private options: HistogramRendererBufferBuildInput;
  private selectedBinKeys: readonly string[];
  private resolveInteractive!: () => void;
  private rejectInteractive!: (error: unknown) => void;
  private diagnostics: HistogramWebgpuDiagnostics = {
    aggregationBackend: 'typescript',
    aggregationBackendPreference: 'auto',
    aggregationBuildCount: 0,
    initialized: false,
    lastAggregationMs: 0,
    lastRenderMs: 0,
    timestampQuerySupported: false,
    uploadBytes: 0,
  };

  constructor({
    canvas,
    devicePixelRatio,
    lifecycle,
    onMetrics,
    requestTimestampQuery,
    ...options
  }: HistogramWebgpuRendererOptions) {
    this.canvas = canvas;
    this.options = options;
    this.hoverBin = options.hoverBin ?? null;
    this.selectedBinKeys = options.selectedBinKeys ?? [];
    this.devicePixelRatio = normalizeDpr(devicePixelRatio);
    this.onMetrics = onMetrics;
    this.interactive = new Promise<void>((resolve, reject) => {
      this.resolveInteractive = resolve;
      this.rejectInteractive = reject;
    });
    this.ready = this.interactive;
    this.emitAggregationMetrics(options.aggregation);
    void this.initialize(requestTimestampQuery === true, lifecycle).catch((error: unknown) => {
      if (this.disposed) return;
      this.rejectInteractive(error);
      lifecycle?.onError?.(error);
    });
  }

  private readonly canvas: HTMLCanvasElement;

  getDiagnostics(): HistogramWebgpuDiagnostics {
    return { ...this.diagnostics };
  }

  update(update: HistogramRendererUpdate): void {
    if (this.disposed) return;
    const aggregationChanged =
      update.aggregation !== undefined &&
      update.aggregation !== this.options.aggregation;
    const dirty =
      aggregationChanged ||
      (update.layout !== undefined && update.layout !== this.options.layout) ||
      (update.viewport !== undefined && update.viewport !== this.options.viewport) ||
      (update.theme !== undefined && update.theme !== this.options.theme) ||
      update.hoverBin !== undefined ||
      update.selectedBinKeys !== undefined;
    this.options = {
      aggregation: update.aggregation ?? this.options.aggregation,
      hoverBin: update.hoverBin === undefined ? this.hoverBin : update.hoverBin,
      layout: update.layout ?? this.options.layout,
      selectedBinKeys: update.selectedBinKeys ?? this.selectedBinKeys,
      theme: update.theme ?? this.options.theme,
      viewport: update.viewport ?? this.options.viewport,
    };
    if (update.hoverBin !== undefined) this.hoverBin = update.hoverBin;
    if (update.selectedBinKeys !== undefined) this.selectedBinKeys = update.selectedBinKeys;
    if (update.devicePixelRatio !== undefined) {
      this.devicePixelRatio = normalizeDpr(update.devicePixelRatio);
    }
    if (aggregationChanged) this.emitAggregationMetrics(this.options.aggregation);
    this.buffersDirty ||= dirty;
  }

  render(): HistogramRendererRenderMetrics | null {
    if (
      this.disposed || this.context === null || this.gpu === null ||
      this.options.layout.widthCssPx <= 0 || this.options.layout.heightCssPx <= 0
    ) return null;
    const startedAt = performance.now();
    this.syncCanvasSize();
    const buffers = this.uploadBuffersIfNeeded();
    const { device, canvasContext } = this.context;
    const encoder = device.createCommandEncoder({ label: 'histogram frame encoder' });
    const timingFrame = this.gpuTimer?.beginFrame();
    const theme = resolveHistogramRendererTheme(this.options.theme);
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        clearValue: {
          r: theme.backgroundColor[0],
          g: theme.backgroundColor[1],
          b: theme.backgroundColor[2],
          a: theme.backgroundColor[3],
        },
        loadOp: 'clear',
        storeOp: 'store',
        view: canvasContext.getCurrentTexture().createView(),
      }],
      ...(timingFrame === null || timingFrame === undefined
        ? {}
        : { timestampWrites: timingFrame.timestampWrites }),
    });
    pass.setPipeline(this.gpu.pipeline);
    pass.setBindGroup(0, this.gpu.bindGroup);
    pass.setVertexBuffer(0, this.gpu.unitQuadBuffer);
    pass.setVertexBuffer(1, this.gpu.rectBuffer);
    pass.setVertexBuffer(2, this.gpu.colorBuffer);
    if (buffers.metrics.instanceCount > 0) pass.draw(6, buffers.metrics.instanceCount);
    pass.end();
    timingFrame?.resolve(encoder);
    device.queue.submit([encoder.finish()]);
    timingFrame?.submitted();
    const durationMs = performance.now() - startedAt;
    this.diagnostics = { ...this.diagnostics, lastRenderMs: durationMs };
    const metrics: HistogramRendererRenderMetrics = {
      drawCalls: buffers.metrics.instanceCount > 0 ? 1 : 0,
      durationMs,
      gpuDurationMs: this.gpuTimer?.lastDurationMs,
      gpuTimerSupported: this.context.timestampQuerySupported,
      instanceCount: buffers.metrics.instanceCount,
      uploadBytes: buffers.metrics.uploadBytes,
      visibleBinCount: buffers.metrics.visibleBinCount,
    };
    this.emitMetrics({
      binCount: this.options.aggregation.metrics.binCount,
      colorSegmentCount: this.options.aggregation.metrics.colorSegmentCount,
      drawCalls: metrics.drawCalls,
      durationMs,
      gpuDurationMs: metrics.gpuDurationMs,
      gpuTimerSupported: metrics.gpuTimerSupported,
      mode: this.options.aggregation.mode,
      phase: 'render',
      pointCount: this.options.aggregation.pointCount,
      stackSegmentCount: buffers.metrics.stackSegmentCount,
      subplotCount: this.options.aggregation.subplots.length,
      uploadBytes: buffers.metrics.uploadBytes,
      visibleBinCount: buffers.metrics.visibleBinCount,
    });
    return metrics;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.destroyGpuResources();
    this.gpuTimer?.dispose();
    this.gpuTimer = null;
    this.context?.device.destroy();
    this.context = null;
    this.emitMetrics({ phase: 'dispose' });
  }

  private async initialize(
    requestTimestampQuery: boolean,
    lifecycle: HistogramWebgpuRendererOptions['lifecycle'],
  ): Promise<void> {
    const startedAt = performance.now();
    const context = await createWebgpuContext({
      canvas: this.canvas,
      onDeviceLost: (info) => this.handleDeviceLost(info, requestTimestampQuery, lifecycle),
      requestTimestampQuery,
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
    this.gpu = this.createGpuResources(context, 1);
    this.diagnostics = {
      ...this.diagnostics,
      canvasFormat: context.format,
      deviceLimits: {
        maxBufferSize: context.limits.maxBufferSize,
        maxStorageBufferBindingSize: context.limits.maxStorageBufferBindingSize,
      },
      initialized: true,
      timestampQuerySupported: context.timestampQuerySupported,
    };
    this.emitMetrics({
      binCount: this.options.aggregation.metrics.binCount,
      colorSegmentCount: this.options.aggregation.metrics.colorSegmentCount,
      durationMs: performance.now() - startedAt,
      gpuTimerSupported: context.timestampQuerySupported,
      mode: this.options.aggregation.mode,
      phase: 'init',
      pointCount: this.options.aggregation.pointCount,
      subplotCount: this.options.aggregation.subplots.length,
    });
    this.render();
    await context.device.queue.onSubmittedWorkDone();
    if (!this.disposed) this.resolveInteractive();
  }

  private handleDeviceLost(
    info: GPUDeviceLostInfo,
    requestTimestampQuery: boolean,
    lifecycle: HistogramWebgpuRendererOptions['lifecycle'],
  ): void {
    if (this.disposed) return;
    this.destroyGpuResources();
    this.gpuTimer?.dispose();
    this.gpuTimer = null;
    this.context = null;
    this.buffersDirty = true;
    lifecycle?.onContextLost?.(info);
    if (info.reason === 'destroyed') return;
    void this.initialize(requestTimestampQuery, lifecycle).then(
      () => lifecycle?.onContextRestored?.(),
      (error: unknown) => lifecycle?.onError?.(error),
    );
  }

  private createGpuResources(context: WebgpuContext, instanceCapacity: number): GpuResources {
    const { device } = context;
    const shader = device.createShaderModule({
      code: HISTOGRAM_WEBGPU_SHADER,
      label: 'histogram shader',
    });
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        buffer: { type: 'uniform' },
        visibility: GPUShaderStage.VERTEX,
      }],
    });
    const pipeline = device.createRenderPipeline({
      fragment: {
        entryPoint: 'fragmentMain',
        module: shader,
        targets: [{
          blend: {
            alpha: { dstFactor: 'one-minus-src-alpha', operation: 'add', srcFactor: 'one' },
            color: { dstFactor: 'one-minus-src-alpha', operation: 'add', srcFactor: 'src-alpha' },
          },
          format: context.format,
        }],
      },
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      primitive: { topology: 'triangle-list' },
      vertex: {
        buffers: [
          {
            arrayStride: 8,
            attributes: [{ format: 'float32x2', offset: 0, shaderLocation: 0 }],
            stepMode: 'vertex',
          },
          {
            arrayStride: 16,
            attributes: [{ format: 'float32x4', offset: 0, shaderLocation: 1 }],
            stepMode: 'instance',
          },
          {
            arrayStride: 16,
            attributes: [{ format: 'float32x4', offset: 0, shaderLocation: 2 }],
            stepMode: 'instance',
          },
        ],
        entryPoint: 'vertexMain',
        module: shader,
      },
    });
    const unitQuadBuffer = createBuffer(
      device,
      UNIT_QUAD.byteLength,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX,
    );
    device.queue.writeBuffer(unitQuadBuffer, 0, UNIT_QUAD);
    const uniformBuffer = createBuffer(
      device,
      EMPTY_BUFFER_BYTES,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    );
    return {
      bindGroup: device.createBindGroup({
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
        layout: bindGroupLayout,
      }),
      colorBuffer: createBuffer(
        device,
        Math.max(EMPTY_BUFFER_BYTES, instanceCapacity * 16),
        GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX,
      ),
      instanceCapacity,
      pipeline,
      rectBuffer: createBuffer(
        device,
        Math.max(EMPTY_BUFFER_BYTES, instanceCapacity * 16),
        GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX,
      ),
      uniformBuffer,
      unitQuadBuffer,
    };
  }

  private uploadBuffersIfNeeded(): HistogramRendererBuffers {
    if (!this.buffersDirty && this.currentBuffers !== null) return this.currentBuffers;
    const buffers = buildHistogramRendererBuffers({
      ...this.options,
      hoverBin: this.hoverBin,
      selectedBinKeys: this.selectedBinKeys,
    });
    const context = this.context!;
    if (buffers.metrics.instanceCount > this.gpu!.instanceCapacity) {
      this.destroyGpuResources();
      this.gpu = this.createGpuResources(
        context,
        nextPowerOfTwo(buffers.metrics.instanceCount),
      );
    }
    if (buffers.rects.byteLength > 0) {
      context.device.queue.writeBuffer(
        this.gpu!.rectBuffer,
        0,
        buffers.rects.buffer as ArrayBuffer,
        buffers.rects.byteOffset,
        buffers.rects.byteLength,
      );
      context.device.queue.writeBuffer(
        this.gpu!.colorBuffer,
        0,
        buffers.colors.buffer as ArrayBuffer,
        buffers.colors.byteOffset,
        buffers.colors.byteLength,
      );
    }
    context.device.queue.writeBuffer(
      this.gpu!.uniformBuffer,
      0,
      new Float32Array([
        Math.max(1, this.options.layout.widthCssPx),
        Math.max(1, this.options.layout.heightCssPx),
        0,
        0,
      ]),
    );
    this.currentBuffers = buffers;
    this.buffersDirty = false;
    this.diagnostics = { ...this.diagnostics, uploadBytes: buffers.metrics.uploadBytes };
    this.emitMetrics({
      binCount: this.options.aggregation.metrics.binCount,
      colorSegmentCount: this.options.aggregation.metrics.colorSegmentCount,
      mode: this.options.aggregation.mode,
      phase: 'buffer-upload',
      pointCount: this.options.aggregation.pointCount,
      stackSegmentCount: buffers.metrics.stackSegmentCount,
      subplotCount: this.options.aggregation.subplots.length,
      uploadBytes: buffers.metrics.uploadBytes,
      visibleBinCount: buffers.metrics.visibleBinCount,
    });
    return buffers;
  }

  private syncCanvasSize(): void {
    const width = Math.max(1, Math.floor(this.options.layout.widthCssPx * this.devicePixelRatio));
    const height = Math.max(1, Math.floor(this.options.layout.heightCssPx * this.devicePixelRatio));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  private destroyGpuResources(): void {
    if (this.gpu === null) return;
    this.gpu.unitQuadBuffer.destroy();
    this.gpu.rectBuffer.destroy();
    this.gpu.colorBuffer.destroy();
    this.gpu.uniformBuffer.destroy();
    this.gpu = null;
  }

  private emitMetrics(metrics: Omit<HistogramMetricsEvent, 'at'>): void {
    this.onMetrics?.({ at: performance.now(), ...metrics });
  }

  private emitAggregationMetrics(
    aggregation: HistogramRendererBufferBuildInput['aggregation'],
  ): void {
    this.emitMetrics({
      aggregateBuildMs: aggregation.metrics.aggregateBuildMs,
      binCount: aggregation.metrics.binCount,
      colorSegmentCount: aggregation.metrics.colorSegmentCount,
      detail: JSON.stringify({
        backend: 'webgpu',
        excludedValueCount: aggregation.metrics.excludedValueCount,
        invalidValueCount: aggregation.metrics.invalidValueCount,
        missingValueCount: aggregation.metrics.missingValueCount,
        outOfDomainValueCount: aggregation.metrics.outOfDomainValueCount,
        sourceIndexCount: aggregation.metrics.sourceIndexCount,
        totalCount: aggregation.metrics.totalCount,
      }),
      mode: aggregation.mode,
      phase: 'aggregation',
      pointCount: aggregation.pointCount,
      stackSegmentCount: aggregation.metrics.colorSegmentCount,
      subplotCount: aggregation.subplots.length,
    });
  }
}

function createBuffer(device: GPUDevice, size: number, usage: GPUBufferUsageFlags): GPUBuffer {
  return device.createBuffer({ size: Math.ceil(size / 4) * 4, usage });
}

function normalizeDpr(value?: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value! : 1;
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}
