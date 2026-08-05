import {
  normalizeParallelBrushIntervals,
  selectParallelRecordIdsByBrushes,
  findNearestParallelRecordByPoint,
  type ParallelAxisViewports,
  type ParallelBrushIntervals,
  type ParallelBrushSelectionResult,
  type ParallelBuffers,
  type ParallelFastTheme,
  type ParallelNearestRecordResult,
  type ParallelRawValuesByAxis,
  type ParallelWebgl2RendererDrawMetrics,
  type ParallelWebgl2RendererSetupMetrics,
  type ParallelWebgl2SelectedUpdateMetrics,
} from '../../m-parallel/index.js';
import type { ParallelFastRendererLike } from '../../m-parallel/engine/index.js';
import {
  createWebgpuContext,
  type WebgpuContext,
} from '../../plot-engine-webgpu/index.js';
import {
  PARALLEL_WEBGPU_COMPUTE_SHADER,
  PARALLEL_WEBGPU_DIRECT_SHADER,
  PARALLEL_WEBGPU_HOVER_SHADER,
  PARALLEL_WEBGPU_RENDER_SHADER,
  PARALLEL_WEBGPU_SELECTION_SHADER,
} from './shaders.js';
import { selectParallelRecordsFromCandidateMask } from './selectionCandidates.js';
import { createParallelRepresentativeSourceIndices } from './representativeSampling.js';
import {
  filterParallelWebgpuRefinedSourceIndices,
  packParallelWebgpuRefinedViewportValues,
} from './refinedValues.js';
import {
  createParallelWebgpuInspectionResult,
  resolveParallelWebgpuHoverPairRange,
  resolveParallelWebgpuHoverSourceIndex,
  resolveParallelWebgpuInspectionGeometry,
} from './inspection.js';
import type {
  ParallelWebgpuDiagnostics,
  ParallelWebgpuRendererOptions,
} from './types.js';
import { ParallelWebgpuWasmSelectionSession } from './wasmSelection.js';

const BIN_WORDS = 8;
const BIN_BYTES = BIN_WORDS * Uint32Array.BYTES_PER_ELEMENT;
const AXIS_CONFIG_BYTES = 64;
const COMPUTE_UNIFORM_BYTES = 64;
const RENDER_UNIFORM_BYTES = 96;
const DIRECT_UNIFORM_BYTES = 48;
const HOVER_UNIFORM_BYTES = 48;
const EMPTY_BUFFER_BYTES = 16;
const MAX_BRUSH_INTERVALS_PER_AXIS = 4;
const DEFAULT_BIN_RESOLUTION = 256;
const DEFAULT_DIRECT_SEGMENT_LIMIT = 2_000_000;
const DEFAULT_REPRESENTATIVE_RECORD_LIMIT = 120_000;
const SPECIAL_AXIS_BIN_COUNT = 3;
const DEFAULT_THEME: ParallelFastTheme = {
  backgroundColor: [1, 1, 1, 1],
  lineColor: [25 / 255, 95 / 255, 170 / 255, 1],
  preselectedColor: [234 / 255, 179 / 255, 8 / 255, 0.7],
  selectedColor: [0.98, 0.72, 0.08, 0.95],
};

interface ParallelGpuPage {
  computeBindGroup?: GPUBindGroup;
  computeUniformBuffer?: GPUBuffer;
  count: number;
  directBindGroup: GPUBindGroup;
  directUniformBuffer: GPUBuffer;
  selectionBindGroup?: GPUBindGroup;
  start: number;
  representativeOnly?: boolean;
  representativeSourceIndices?: Uint32Array;
  sourceIndicesBuffer: GPUBuffer;
  sourceIndicesOffset?: number;
  styleBuffer: GPUBuffer;
  valueEncoding: 1 | 2;
  valuesBuffer: GPUBuffer;
}

interface ParallelGpuResources {
  axisBuffer: GPUBuffer;
  binBuffer: GPUBuffer;
  binByteLength: number;
  computeBindGroupLayout: GPUBindGroupLayout;
  computePipeline: GPUComputePipeline;
  directBindGroupLayout: GPUBindGroupLayout;
  directPipeline: GPURenderPipeline;
  directPages: ParallelGpuPage[];
  refinedPage?: ParallelGpuPage;
  refinementReadBuffer?: GPUBuffer;
  refinementRecordBuffer: GPUBuffer;
  refinementSourceOffsetBytes: number;
  refinementStateBuffer: GPUBuffer;
  refinementStyleOffsetBytes: number;
  staticDirectPages: ParallelGpuPage[];
  hoverBindGroupLayout: GPUBindGroupLayout;
  hoverDistancePipeline: GPUComputePipeline;
  hoverSourcePipeline: GPUComputePipeline;
  pages: ParallelGpuPage[];
  preselectedMaskBuffer: GPUBuffer;
  renderBindGroup: GPUBindGroup;
  renderPipeline: GPURenderPipeline;
  renderUniformBuffer: GPUBuffer;
  selectionClearPipeline: GPUComputePipeline;
  selectionPipeline: GPUComputePipeline;
  selectedMaskBuffer: GPUBuffer;
}

interface ParallelPairRange {
  count: number;
  start: number;
}

interface ParallelHoverQuery {
  axisPosition: number;
  maxDistancePx: number;
  normalizedValue: number;
  plotHeightPx: number;
  plotWidthPx: number;
}

interface ParallelHoverCandidate {
  distancePx: number;
  sourceIndex: number;
}

export class ParallelWebgpuRenderer implements ParallelFastRendererLike {
  readonly interactive: Promise<void>;
  readonly ready: Promise<void>;
  readonly setupMetrics: ParallelWebgl2RendererSetupMetrics;

  private aggregationInFlight: Promise<void> | null = null;
  private aggregationRequested = false;
  private aggregationRequestedRange: ParallelPairRange | null = null;
  private axisViewportVersion = 0;
  private axisViewports: ParallelAxisViewports = {};
  private pendingViewportPairRange: ParallelPairRange | null = null;
  private brushIntervals: ParallelBrushIntervals = {};
  private context: WebgpuContext | null = null;
  private disposed = false;
  private densityVisible = false;
  private gpu: ParallelGpuResources | null = null;
  private hoverFallbackInFlight: Promise<ParallelHoverCandidate | null> | null = null;
  private hoverFallbackVersion = 0;
  private lineOpacityScale: number;
  private preselectedSourceIndices: Uint32Array;
  private selectedSourceIndices: Uint32Array<ArrayBufferLike> =
    new Uint32Array(0);
  private selectionFromBrushes = false;
  private selectionAggregationRequested: boolean | null = null;
  private theme: ParallelFastTheme;
  private wasmSelection: ParallelWebgpuWasmSelectionSession | null = null;
  private resolveInteractive!: () => void;
  private rejectInteractive!: (error: unknown) => void;
  private resolveReady!: () => void;
  private rejectReady!: (error: unknown) => void;

  private diagnostics: ParallelWebgpuDiagnostics;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly buffers: ParallelBuffers,
    private readonly options: ParallelWebgpuRendererOptions = {},
  ) {
    this.theme = options.theme ?? DEFAULT_THEME;
    this.lineOpacityScale = normalizeOpacityScale(options.lineOpacityScale);
    this.preselectedSourceIndices = buffers.preselectedSourceIndices;
    const resolution = normalizeResolution(options.binResolution);
    const pairCount = Math.max(0, buffers.axisCount - 1);
    const logicalResolution = resolution + SPECIAL_AXIS_BIN_COUNT;
    const binCount = pairCount * logicalResolution * logicalResolution;
    const directRecordCount = resolveDirectRecordCount(
      buffers,
      options.directSegmentLimit,
    );
    const renderMode = resolveRenderMode(buffers, options);
    const representativeRecordCount = resolveRepresentativeRecordCount(
      buffers,
      options.representativeRecordLimit,
    );
    this.setupMetrics = {
      blendMode: 'src-alpha-one-minus-src-alpha',
      densityMode: 'webgpu-pairwise-screen-bin-continuous-color',
      lineAlpha: 0.1,
      lineOpacityScale: this.lineOpacityScale,
      selectedLineAlpha: 0.92,
      segmentCount: pairCount * buffers.recordCount,
      uploadMs: 0,
      vertexCount: pairCount * buffers.recordCount * 2,
    };
    this.diagnostics = {
      aggregationBackend: 'typescript',
      aggregationBackendPreference: options.aggregationBackend ?? 'auto',
      backend: 'webgpu',
      binCount,
      binResolution: resolution,
      coordinateQuantizationBits: 16,
      refinedCoordinatePrecisionBits: 32,
      densityVisible: false,
      directRecordCount,
      hoverFallbackCount: 0,
      hoverSearchRecordCount:
        renderMode === 'hybrid' ? representativeRecordCount : buffers.recordCount,
      initialized: false,
      lastAggregationMs: 0,
      lastAggregationPairCount: pairCount,
      lastHoverResolveMs: 0,
      lastHoverUsedFullPopulation: false,
      lastRenderMs: 0,
      pageCount: 0,
      refinedRecordCount: 0,
      refinementQualifiedRecordCount: 0,
      refinementStride: 1,
      renderMode,
      representativeRecordCount,
      residentBytes: 0,
      selectedCount: 0,
      styleMode:
        buffers.styleBuffers === undefined
          ? 'uniform'
          : 'continuous-aggregate-plus-representatives',
      timestampQuerySupported: false,
      uploadBytes: 0,
    };
    this.interactive = new Promise<void>((resolve, reject) => {
      this.resolveInteractive = resolve;
      this.rejectInteractive = reject;
    });
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.ready.catch(() => undefined);
    void this.initialize().catch((error: unknown) => {
      if (this.disposed) return;
      this.rejectInteractive(error);
      this.rejectReady(error);
      options.lifecycle?.onError?.(error);
    });
  }

  getDiagnostics(): ParallelWebgpuDiagnostics {
    return { ...this.diagnostics, densityVisible: this.densityVisible };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.destroyGpuResources();
    this.context?.device.destroy();
    this.context = null;
  }

  draw(): ParallelWebgl2RendererDrawMetrics | null {
    if (this.disposed || this.context === null || this.gpu === null) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const startedAt = performance.now();
    this.syncCanvasSize();
    this.writeRenderUniform();
    const { device, canvasContext } = this.context;
    const encoder = device.createCommandEncoder({
      label: 'parallel WebGPU frame encoder',
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        clearValue: rgbaObject(this.theme.backgroundColor),
        loadOp: 'clear',
        storeOp: 'store',
        view: canvasContext.getCurrentTexture().createView(),
      }],
    });
    let drawCallCount = 0;
    if (this.densityVisible && this.diagnostics.renderMode !== 'direct') {
      pass.setPipeline(this.gpu.renderPipeline);
      pass.setBindGroup(0, this.gpu.renderBindGroup);
      pass.draw(2, this.diagnostics.binCount);
      drawCallCount += 1;
    }
    if (this.diagnostics.renderMode !== 'density') {
      pass.setPipeline(this.gpu.directPipeline);
      for (const page of this.gpu.directPages) {
        const representativeCount = this.writeDirectUniform(page);
        if (representativeCount === 0) continue;
        pass.setBindGroup(0, page.directBindGroup);
        pass.draw(
          2,
          representativeCount * Math.max(0, this.buffers.axisCount - 1),
        );
        drawCallCount += 1;
      }
    }
    if (this.densityVisible && this.diagnostics.binCount > 0) {
      pass.setPipeline(this.gpu.renderPipeline);
      pass.setBindGroup(0, this.gpu.renderBindGroup);
      pass.draw(
        2,
        this.diagnostics.binCount * 5,
        0,
        this.diagnostics.binCount,
      );
      drawCallCount += 1;
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
    const redrawMs = performance.now() - startedAt;
    this.diagnostics = { ...this.diagnostics, lastRenderMs: redrawMs };
    this.options.onMetrics?.({
      aggregationResolution: this.diagnostics.binResolution,
      densityBinCount: this.diagnostics.binCount,
      directRecordCount: this.diagnostics.directRecordCount,
      drawCallCount,
      rendererKind: 'webgpu-parallel-density',
      rendererRedrawMs: redrawMs,
      rendererState: 'ready',
      webgpuResidentBytes: this.diagnostics.residentBytes,
      webgpuUploadBytes: this.diagnostics.uploadBytes,
    });
    return { drawCallCount, redrawMs };
  }

  setHoverFocusActive(): boolean {
    return false;
  }

  updateLineOpacityScale(lineOpacityScale: number): void {
    this.lineOpacityScale = normalizeOpacityScale(lineOpacityScale);
    this.draw();
  }

  updatePreselectedSourceIndices(
    _buffers: ParallelBuffers,
    preselectedSourceIndices: Uint32Array,
  ): void {
    if (uint32ArraysEqual(this.preselectedSourceIndices, preselectedSourceIndices)) {
      return;
    }
    this.preselectedSourceIndices = preselectedSourceIndices;
    this.writeMask('preselected', preselectedSourceIndices);
    this.scheduleAggregation();
  }

  updateSelectedSourceIndices(
    _buffers: ParallelBuffers,
    selectedSourceIndices: Uint32Array,
  ): ParallelWebgl2SelectedUpdateMetrics {
    const startedAt = performance.now();
    const nextSelectionFromBrushes =
      normalizeParallelBrushIntervals(
        this.brushIntervals,
        this.buffers.axisOrder,
      ).length > 0;
    const selectionAlreadyRendered =
      this.selectionFromBrushes === nextSelectionFromBrushes &&
      uint32ArraysEqual(selectedSourceIndices, this.selectedSourceIndices);
    this.selectedSourceIndices = selectedSourceIndices;
    this.selectionFromBrushes = nextSelectionFromBrushes;
    const maskStartedAt = performance.now();
    if (!selectionAlreadyRendered) {
      this.writeMask('selected', selectedSourceIndices);
      this.scheduleSelectionAggregation(false);
    }
    const maskBuildMs = performance.now() - maskStartedAt;
    this.diagnostics = {
      ...this.diagnostics,
      selectedCount: selectedSourceIndices.length,
    };
    const updateMs = performance.now() - startedAt;
    const selectedSegmentCount =
      selectedSourceIndices.length * Math.max(0, this.buffers.axisCount - 1);
    return {
      bufferCreationMs: 0,
      gpuUploadMs: 0,
      maskBuildMs,
      maskGpuUploadMs: 0,
      selectedLineAlpha: 0.92,
      selectedRecordCount: selectedSourceIndices.length,
      selectedSegmentCount,
      selectedVertexCount: selectedSegmentCount * 2,
      updateMs,
    };
  }

  updateTheme(theme: ParallelFastTheme | undefined): void {
    this.theme = theme ?? DEFAULT_THEME;
    if (
      this.buffers.styleBuffers === undefined &&
      this.context !== null &&
      this.gpu !== null
    ) {
      if (this.diagnostics.renderMode === 'direct') {
        for (const page of this.gpu.pages) {
          this.context.device.queue.writeBuffer(
            page.styleBuffer,
            0,
            packDensityStyles(this.buffers, this.theme, page.start, page.count),
          );
        }
      } else {
        for (const page of this.gpu.directPages) {
          const sourceIndices = page.representativeSourceIndices;
          if (sourceIndices === undefined) continue;
          this.context.device.queue.writeBuffer(
            page.styleBuffer,
            0,
            packSampledStyles(this.buffers, this.theme, sourceIndices),
          );
        }
      }
      this.draw();
      return;
    }
    this.draw();
  }

  updateAxisViewports(
    axisViewports: ParallelAxisViewports,
    options: { phase: 'commit' | 'preview' } = { phase: 'commit' },
  ): void {
    const changedPairRange = changedViewportPairRange(
      this.axisViewports,
      axisViewports,
      this.buffers.axisOrder,
    );
    this.pendingViewportPairRange = mergePairRanges(
      this.pendingViewportPairRange,
      changedPairRange,
    );
    this.axisViewports = axisViewports;
    if (changedPairRange !== null) {
      this.axisViewportVersion += 1;
      this.densityVisible = false;
      if (this.gpu !== null && this.diagnostics.renderMode === 'hybrid') {
        this.gpu.directPages = this.gpu.staticDirectPages;
        this.diagnostics = {
          ...this.diagnostics,
          hoverSearchRecordCount: this.diagnostics.representativeRecordCount,
        };
      }
      this.writeAxisConfigs();
    }
    if (options.phase === 'commit') {
      const pairRange = this.pendingViewportPairRange;
      this.pendingViewportPairRange = null;
      if (pairRange !== null) {
        this.scheduleAggregation(pairRange);
      }
    }
  }

  updateBrushIntervals(brushIntervals: ParallelBrushIntervals): void {
    this.brushIntervals = brushIntervals;
    this.selectionFromBrushes =
      normalizeParallelBrushIntervals(brushIntervals, this.buffers.axisOrder)
        .length > 0;
    this.writeAxisConfigs();
  }

  async selectByBrushes(
    buffers: ParallelBuffers,
    brushIntervals: ParallelBrushIntervals,
  ): Promise<ParallelBrushSelectionResult> {
    this.brushIntervals = brushIntervals;
    this.selectionFromBrushes = true;
    this.writeAxisConfigs();
    await this.waitForAggregationIdle();
    const useCandidateMask =
      this.wasmSelection === null &&
      gpuCandidateMaskCoversBrushIntervals(buffers, brushIntervals);
    const selectionAggregation = this.aggregateSelection(true, useCandidateMask);
    const trackedAggregation = selectionAggregation.then(
      () => undefined,
      () => undefined,
    );
    this.aggregationInFlight = trackedAggregation;
    let candidateMask: Uint32Array | null;
    try {
      candidateMask = await selectionAggregation;
    } finally {
      if (this.aggregationInFlight === trackedAggregation) {
        this.aggregationInFlight = null;
        this.drainAggregationRequests();
      }
    }

    // The GPU mask is a padded candidate set. Exact Float64-compatible public
    // selection only revisits those candidates instead of scanning every row.
    await yieldToMainThread();
    const exact =
      this.wasmSelection?.select(brushIntervals) ??
      (candidateMask === null
        ? selectParallelRecordIdsByBrushes(buffers, brushIntervals)
        : selectParallelRecordsFromCandidateMask(
            buffers,
            brushIntervals,
            candidateMask,
          ));
    this.selectedSourceIndices = exact.sourceIndices;
    this.diagnostics = { ...this.diagnostics, selectedCount: exact.selectedCount };
    return exact;
  }

  async resolveInspection(
    query: ParallelHoverQuery,
  ): Promise<ParallelNearestRecordResult | null> {
    const startedAt = performance.now();
    const result = await this.resolveInspectionOnGpu(query) ??
      (this.gpu === null
        ? findNearestParallelRecordByPoint({
            ...query,
            buffers: this.buffers,
          })
        : null);
    this.diagnostics = {
      ...this.diagnostics,
      lastHoverResolveMs: performance.now() - startedAt,
    };
    return result;
  }

  private async resolveInspectionOnGpu(
    query: ParallelHoverQuery,
  ): Promise<ParallelNearestRecordResult | null> {
    this.diagnostics = {
      ...this.diagnostics,
      lastHoverUsedFullPopulation: false,
    };
    const gpu = this.gpu;
    const context = this.context;
    if (
      gpu === null ||
      context === null ||
      this.buffers.axisCount < 2 ||
      this.buffers.recordCount === 0 ||
      (
        this.diagnostics.renderMode === 'hybrid' &&
        !this.densityVisible &&
        hasActiveParallelAxisViewports(
          this.axisViewports,
          this.buffers.axisOrder,
        )
      )
    ) {
      return null;
    }
    const pairRange = resolveParallelWebgpuHoverPairRange(
      this.buffers.axisCount,
      query.axisPosition,
      query.maxDistancePx,
      query.plotWidthPx,
    );
    const primaryPages = this.diagnostics.renderMode === 'hybrid'
      ? gpu.directPages
      : gpu.pages;
    const primaryCandidate = await this.resolveHoverCandidateOnGpu(
      query,
      pairRange,
      primaryPages,
    );
    const primary = this.createInspectionFromHoverCandidate(
      query,
      pairRange,
      primaryCandidate,
    );
    const exactHitDistancePx = Math.min(2, query.maxDistancePx);
    if (
      primary !== null &&
      (
        this.diagnostics.renderMode !== 'hybrid' ||
        primary.distancePx <= exactHitDistancePx
      )
    ) {
      return primary;
    }
    if (this.diagnostics.renderMode !== 'hybrid' || !this.densityVisible) {
      return primary;
    }
    const fallbackCandidate = await this.resolveFullPopulationHoverCandidate(
      query,
      pairRange,
      gpu.pages,
    );
    const fallback = this.createInspectionFromHoverCandidate(
      query,
      pairRange,
      fallbackCandidate,
    );
    const reliableHitDistancePx = Math.min(6, query.maxDistancePx);
    const reliablePrimary = primary !== null &&
        primary.distancePx <= reliableHitDistancePx
      ? primary
      : null;
    const reliableFallback = fallback !== null &&
        fallback.distancePx <= reliableHitDistancePx
      ? fallback
      : null;
    if (
      reliableFallback !== null &&
      (
        reliablePrimary === null ||
        reliableFallback.distancePx < reliablePrimary.distancePx
      )
    ) {
      this.diagnostics = {
        ...this.diagnostics,
        hoverFallbackCount: this.diagnostics.hoverFallbackCount + 1,
        lastHoverUsedFullPopulation: true,
      };
      return reliableFallback;
    }
    return reliablePrimary;
  }

  private createInspectionFromHoverCandidate(
    query: ParallelHoverQuery,
    pairRange: ParallelPairRange,
    candidate: ParallelHoverCandidate | null,
  ): ParallelNearestRecordResult | null {
    if (candidate === null) return null;
    const geometry = resolveParallelWebgpuInspectionGeometry(
      this.buffers,
      candidate.sourceIndex,
      query,
      this.axisViewports,
      pairRange,
    );
    if (geometry === null || geometry.distancePx > query.maxDistancePx) {
      return null;
    }
    return createParallelWebgpuInspectionResult(
      this.buffers,
      candidate.sourceIndex,
      geometry.pair,
      query.axisPosition,
      geometry.distancePx,
      this.axisViewports,
    );
  }

  private async resolveFullPopulationHoverCandidate(
    query: ParallelHoverQuery,
    pairRange: ParallelPairRange,
    pages: ParallelGpuPage[],
  ): Promise<ParallelHoverCandidate | null> {
    const version = ++this.hoverFallbackVersion;
    if (this.hoverFallbackInFlight !== null) {
      await this.hoverFallbackInFlight;
      if (version !== this.hoverFallbackVersion) return null;
    }
    const inFlight = this.resolveHoverCandidateOnGpu(query, pairRange, pages);
    this.hoverFallbackInFlight = inFlight;
    try {
      return await inFlight;
    } finally {
      if (this.hoverFallbackInFlight === inFlight) {
        this.hoverFallbackInFlight = null;
      }
    }
  }

  private async resolveHoverCandidateOnGpu(
    query: ParallelHoverQuery,
    pairRange: ParallelPairRange,
    hoverPages: ParallelGpuPage[],
  ): Promise<ParallelHoverCandidate | null> {
    const gpu = this.gpu;
    const context = this.context;
    if (
      gpu === null ||
      context === null ||
      pairRange.count === 0 ||
      hoverPages.length === 0
    ) {
      return null;
    }
    const resultBuffer = createBuffer(
      context.device,
      16,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE,
      'parallel hover result',
    );
    const readBuffer = createBuffer(
      context.device,
      16,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      'parallel hover readback',
    );
    context.device.queue.writeBuffer(
      resultBuffer,
      0,
      new Uint32Array([0x7f80_0000, 0xffff_ffff, 0, 0]),
    );
    const uniforms: GPUBuffer[] = [];
    const bindGroups: GPUBindGroup[] = [];
    for (const page of hoverPages) {
      const uniform = createBuffer(
        context.device,
        HOVER_UNIFORM_BYTES,
        GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
        'parallel hover page uniform',
      );
      const data = new ArrayBuffer(HOVER_UNIFORM_BYTES);
      const uints = new Uint32Array(data);
      const floats = new Float32Array(data);
      uints[0] = page.count;
      uints[1] = page.start;
      uints[2] = this.buffers.axisCount;
      uints[3] = pairRange.start;
      floats[4] = query.axisPosition;
      floats[5] = query.normalizedValue;
      floats[6] = query.plotWidthPx;
      floats[7] = query.plotHeightPx;
      uints[8] = page.valueEncoding;
      uints[9] = page.representativeOnly === true ? 1 : 0;
      uints[10] = pairRange.count;
      context.device.queue.writeBuffer(uniform, 0, data);
      uniforms.push(uniform);
      bindGroups.push(
        context.device.createBindGroup({
          entries: [
            { binding: 0, resource: { buffer: page.valuesBuffer } },
            { binding: 1, resource: { buffer: gpu.axisBuffer } },
            { binding: 2, resource: { buffer: uniform } },
            { binding: 3, resource: { buffer: resultBuffer } },
            {
              binding: 4,
              resource: {
                buffer: page.sourceIndicesBuffer,
                offset: page.sourceIndicesOffset ?? 0,
              },
            },
          ],
          layout: gpu.hoverBindGroupLayout,
        }),
      );
    }
    const encoder = context.device.createCommandEncoder({
      label: 'parallel hover reduction encoder',
    });
    let pass = encoder.beginComputePass({
      label: 'parallel hover distance pass',
    });
    pass.setPipeline(gpu.hoverDistancePipeline);
    for (let index = 0; index < hoverPages.length; index += 1) {
      pass.setBindGroup(0, bindGroups[index]!);
      pass.dispatchWorkgroups(Math.ceil(hoverPages[index]!.count / 256));
    }
    pass.end();
    pass = encoder.beginComputePass({
      label: 'parallel hover source pass',
    });
    pass.setPipeline(gpu.hoverSourcePipeline);
    for (let index = 0; index < hoverPages.length; index += 1) {
      pass.setBindGroup(0, bindGroups[index]!);
      pass.dispatchWorkgroups(Math.ceil(hoverPages[index]!.count / 256));
    }
    pass.end();
    encoder.copyBufferToBuffer(resultBuffer, 0, readBuffer, 0, 16);
    context.device.queue.submit([encoder.finish()]);
    await readBuffer.mapAsync(GPUMapMode.READ);
    const result = new Uint32Array(readBuffer.getMappedRange().slice(0));
    readBuffer.unmap();
    for (const uniform of uniforms) uniform.destroy();
    resultBuffer.destroy();
    readBuffer.destroy();
    const distancePx = Math.sqrt(
      new Float32Array(new Uint32Array([result[0]!]).buffer)[0]!,
    );
    const sourceIndex = resolveParallelWebgpuHoverSourceIndex(
      result[1]!,
    );
    if (
      sourceIndex === null ||
      sourceIndex === 0xffff_ffff ||
      sourceIndex >= this.buffers.recordCount ||
      distancePx > query.maxDistancePx
    ) {
      return null;
    }
    return { distancePx, sourceIndex };
  }

  private async initialize(): Promise<void> {
    const context = await createWebgpuContext({
      alphaMode: 'opaque',
      canvas: this.canvas,
      onDeviceLost: (info) => this.handleDeviceLost(info),
      requestTimestampQuery: this.options.requestTimestampQuery,
    });
    if (this.disposed) {
      context.device.destroy();
      return;
    }
    this.context = context;
    const gpu = await this.createGpuResources(context);
    if (this.disposed || this.context !== context) {
      destroyParallelGpuResources(gpu);
      return;
    }
    this.gpu = gpu;
    if (this.options.aggregationBackend !== 'typescript') {
      this.wasmSelection = ParallelWebgpuWasmSelectionSession.create(
        this.buffers,
      );
      this.diagnostics = {
        ...this.diagnostics,
        aggregationBackend:
          this.wasmSelection === null ? 'typescript' : 'rust-wasm',
      };
    }
    this.writeAxisConfigs();
    this.writeMask('selected', this.selectedSourceIndices);
    this.writeMask('preselected', this.preselectedSourceIndices);
    if (
      this.diagnostics.renderMode === 'hybrid' &&
      gpu.directPages.some((page) => page.count > 0)
    ) {
      this.draw();
      await context.device.queue.onSubmittedWorkDone();
      if (this.disposed || this.context !== context || this.gpu !== gpu) return;
      this.resolveInteractive();
    }
    await this.aggregate(false);
    await context.device.queue.onSubmittedWorkDone();
    if (this.disposed || this.context !== context || this.gpu !== gpu) return;
    this.diagnostics = {
      ...this.diagnostics,
      deviceLimits: context.limits,
      initialized: true,
      pageCount: gpu.pages.length,
      timestampQuerySupported: context.timestampQuerySupported,
    };
    this.resolveInteractive();
    this.resolveReady();
  }

  private handleDeviceLost(info: GPUDeviceLostInfo): void {
    if (this.disposed) return;
    this.destroyGpuResources();
    this.context = null;
    this.diagnostics = { ...this.diagnostics, initialized: false };
    this.options.lifecycle?.onContextLost?.(info);
    if (info.reason === 'destroyed') return;
    void this.initialize().then(
      () => this.options.lifecycle?.onContextRestored?.(),
      (error: unknown) => this.options.lifecycle?.onError?.(error),
    );
  }

  private async createGpuResources(
    context: WebgpuContext,
  ): Promise<ParallelGpuResources> {
    const { device } = context;
    const pairCount = Math.max(1, this.buffers.axisCount - 1);
    const maximumBinBytes = Math.min(
      context.limits.maxBufferSize,
      context.limits.maxStorageBufferBindingSize,
    );
    const maximumLogicalResolution = Math.max(
      SPECIAL_AXIS_BIN_COUNT + 1,
      Math.floor(Math.sqrt(maximumBinBytes / (BIN_BYTES * pairCount))),
    );
    const resolution = Math.max(
      1,
      Math.min(
        this.diagnostics.binResolution,
        maximumLogicalResolution - SPECIAL_AXIS_BIN_COUNT,
      ),
    );
    const binCount =
      Math.max(0, this.buffers.axisCount - 1) *
      (resolution + SPECIAL_AXIS_BIN_COUNT) *
      (resolution + SPECIAL_AXIS_BIN_COUNT);
    this.diagnostics = {
      ...this.diagnostics,
      binCount,
      binResolution: resolution,
    };
    const binByteLength = Math.max(
      EMPTY_BUFFER_BYTES,
      binCount * BIN_BYTES,
    );
    const binBuffer = createBuffer(
      device,
      binByteLength,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
      'parallel density bins',
    );
    const maskByteLength = Math.max(
      EMPTY_BUFFER_BYTES,
      Math.ceil(this.buffers.recordCount / 32) * Uint32Array.BYTES_PER_ELEMENT,
    );
    const selectedMaskBuffer = createBuffer(
      device,
      maskByteLength,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE,
      'parallel selected membership',
    );
    const preselectedMaskBuffer = createBuffer(
      device,
      maskByteLength,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
      'parallel preselected membership',
    );
    const axisBuffer = createBuffer(
      device,
      Math.max(EMPTY_BUFFER_BYTES, this.buffers.axisCount * AXIS_CONFIG_BYTES),
      GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
      'parallel axis configs',
    );
    const refinementLimit = Math.max(
      1,
      this.diagnostics.renderMode === 'hybrid'
        ? this.diagnostics.representativeRecordCount
        : 1,
    );
    const refinementAlignment = device.limits.minStorageBufferOffsetAlignment;
    const refinementValueBytes = alignTo(
      refinementLimit * this.buffers.axisCount * Uint32Array.BYTES_PER_ELEMENT,
      refinementAlignment,
    );
    const refinementStyleOffsetBytes = refinementValueBytes;
    const refinementStyleBytes = alignTo(
      refinementLimit * Uint32Array.BYTES_PER_ELEMENT,
      refinementAlignment,
    );
    const refinementSourceOffsetBytes =
      refinementStyleOffsetBytes + refinementStyleBytes;
    const refinementRecordBytes =
      refinementSourceOffsetBytes +
      refinementLimit * Uint32Array.BYTES_PER_ELEMENT;
    const refinementRecordBuffer = createBuffer(
      device,
      refinementRecordBytes,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE,
      'parallel viewport refinement records',
    );
    const refinementStateBuffer = createBuffer(
      device,
      EMPTY_BUFFER_BYTES,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE,
      'parallel viewport refinement state',
    );
    const refinementReadBuffer = this.diagnostics.renderMode === 'hybrid'
      ? createBuffer(
          device,
          EMPTY_BUFFER_BYTES +
            refinementLimit * Uint32Array.BYTES_PER_ELEMENT,
          GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          'parallel viewport refinement readback',
        )
      : undefined;
    const computeBindGroupLayout = device.createBindGroupLayout({
      entries: [
        storageEntry(0, false, GPUShaderStage.COMPUTE),
        storageEntry(1, false, GPUShaderStage.COMPUTE),
        storageEntry(2, true, GPUShaderStage.COMPUTE),
        storageEntry(3, true, GPUShaderStage.COMPUTE),
        storageEntry(4, false, GPUShaderStage.COMPUTE),
        storageEntry(5, false, GPUShaderStage.COMPUTE),
        uniformEntry(6, GPUShaderStage.COMPUTE),
        storageEntry(7, true, GPUShaderStage.COMPUTE),
        storageEntry(8, true, GPUShaderStage.COMPUTE),
      ],
      label: 'parallel compute bindings',
    });
    const computePipeline = device.createComputePipeline({
      compute: {
        entryPoint: 'aggregate',
        module: device.createShaderModule({
          code: PARALLEL_WEBGPU_COMPUTE_SHADER,
          label: 'parallel density compute shader',
        }),
      },
      layout: device.createPipelineLayout({
        bindGroupLayouts: [computeBindGroupLayout],
      }),
      label: 'parallel density compute pipeline',
    });
    const selectionBindGroupLayout = device.createBindGroupLayout({
      entries: [
        storageEntry(0, false, GPUShaderStage.COMPUTE),
        storageEntry(1, true, GPUShaderStage.COMPUTE),
        storageEntry(2, true, GPUShaderStage.COMPUTE),
        storageEntry(3, false, GPUShaderStage.COMPUTE),
        uniformEntry(4, GPUShaderStage.COMPUTE),
      ],
      label: 'parallel selection compute bindings',
    });
    const selectionModule = device.createShaderModule({
      code: PARALLEL_WEBGPU_SELECTION_SHADER,
      label: 'parallel selection compute shader',
    });
    const selectionPipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [selectionBindGroupLayout],
    });
    const selectionClearPipeline = device.createComputePipeline({
      compute: { entryPoint: 'clearSelected', module: selectionModule },
      layout: selectionPipelineLayout,
      label: 'parallel selected-bin clear pipeline',
    });
    const selectionPipeline = device.createComputePipeline({
      compute: { entryPoint: 'selectRecords', module: selectionModule },
      layout: selectionPipelineLayout,
      label: 'parallel selection compute pipeline',
    });
    const renderLayout = device.createBindGroupLayout({
      entries: [
        storageEntry(0, false, GPUShaderStage.VERTEX),
        uniformEntry(1, GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT),
      ],
      label: 'parallel density render bindings',
    });
    const renderUniformBuffer = createBuffer(
      device,
      RENDER_UNIFORM_BYTES,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
      'parallel render uniform',
    );
    const renderBindGroup = device.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: binBuffer } },
        { binding: 1, resource: { buffer: renderUniformBuffer } },
      ],
      layout: renderLayout,
    });
    const renderPipeline = createLinePipeline(
      device,
      context.format,
      renderLayout,
      PARALLEL_WEBGPU_RENDER_SHADER,
      'parallel density render pipeline',
    );
    const directBindGroupLayout = device.createBindGroupLayout({
      entries: [
        storageEntry(0, false, GPUShaderStage.VERTEX),
        storageEntry(1, false, GPUShaderStage.VERTEX),
        storageEntry(2, false, GPUShaderStage.VERTEX),
        uniformEntry(3, GPUShaderStage.VERTEX),
      ],
      label: 'parallel direct render bindings',
    });
    const directPipeline = createLinePipeline(
      device,
      context.format,
      directBindGroupLayout,
      PARALLEL_WEBGPU_DIRECT_SHADER,
      'parallel direct render pipeline',
    );
    const hoverBindGroupLayout = device.createBindGroupLayout({
      entries: [
        storageEntry(0, false, GPUShaderStage.COMPUTE),
        storageEntry(1, false, GPUShaderStage.COMPUTE),
        uniformEntry(2, GPUShaderStage.COMPUTE),
        storageEntry(3, true, GPUShaderStage.COMPUTE),
        storageEntry(4, false, GPUShaderStage.COMPUTE),
      ],
      label: 'parallel hover bindings',
    });
    const hoverModule = device.createShaderModule({
      code: PARALLEL_WEBGPU_HOVER_SHADER,
      label: 'parallel hover reduction shader',
    });
    const hoverPipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [hoverBindGroupLayout],
    });
    const hoverDistancePipeline = device.createComputePipeline({
      compute: { entryPoint: 'findDistance', module: hoverModule },
      label: 'parallel hover distance pipeline',
      layout: hoverPipelineLayout,
    });
    const hoverSourcePipeline = device.createComputePipeline({
      compute: { entryPoint: 'findSource', module: hoverModule },
      label: 'parallel hover source pipeline',
      layout: hoverPipelineLayout,
    });
    const bytesPerRecord = Math.max(
      4,
      Math.ceil(this.buffers.axisCount / 2) * Uint32Array.BYTES_PER_ELEMENT,
    );
    const maximumPageBytes = Math.min(
      context.limits.maxBufferSize,
      context.limits.maxStorageBufferBindingSize,
      16 * 1024 * 1024,
    );
    const recordsPerPage = Math.max(
      1,
      Math.floor(maximumPageBytes / bytesPerRecord),
    );
    const pages: ParallelGpuPage[] = [];
    let residentBytes =
      binByteLength + maskByteLength * 2 +
      Math.max(EMPTY_BUFFER_BYTES, this.buffers.axisCount * AXIS_CONFIG_BYTES) +
      RENDER_UNIFORM_BYTES;
    let uploadBytes = 0;
    const appendPage = (
      start: number,
      count: number,
      packedValues: Uint32Array,
      packedStyles: Uint32Array,
    ) => {
      const expectedValueWords = Math.max(
        1,
        Math.ceil((count * this.buffers.axisCount) / 2),
      );
      const expectedStyleWords = Math.max(1, Math.ceil(count / 2));
      if (
        packedValues.length !== expectedValueWords ||
        packedStyles.length !== expectedStyleWords
      ) {
        throw new Error(
          `Parallel packed page ${start} has invalid coordinate or style lengths.`,
        );
      }
      const valuesBuffer = createBufferWithData(
        device,
        packedValues,
        GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
        'parallel normalized values page',
      );
      const styleBuffer = createBufferWithData(
        device,
        packedStyles,
        GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
        'parallel styles page',
      );
      const computeUniformBuffer = createBuffer(
        device,
        COMPUTE_UNIFORM_BYTES,
        GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
        'parallel compute page uniform',
      );
      const directUniformBuffer = createBuffer(
        device,
        DIRECT_UNIFORM_BYTES,
        GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
        'parallel direct page uniform',
      );
      const computeBindGroup = device.createBindGroup({
        entries: [
          { binding: 0, resource: { buffer: valuesBuffer } },
          { binding: 1, resource: { buffer: styleBuffer } },
          { binding: 2, resource: { buffer: binBuffer } },
          { binding: 3, resource: { buffer: selectedMaskBuffer } },
          { binding: 4, resource: { buffer: preselectedMaskBuffer } },
          { binding: 5, resource: { buffer: axisBuffer } },
          { binding: 6, resource: { buffer: computeUniformBuffer } },
          { binding: 7, resource: { buffer: refinementRecordBuffer } },
          { binding: 8, resource: { buffer: refinementStateBuffer } },
        ],
        layout: computeBindGroupLayout,
      });
      const directBindGroup = device.createBindGroup({
        entries: [
          { binding: 0, resource: { buffer: valuesBuffer } },
          { binding: 1, resource: { buffer: styleBuffer } },
          { binding: 2, resource: { buffer: axisBuffer } },
          { binding: 3, resource: { buffer: directUniformBuffer } },
        ],
        layout: directBindGroupLayout,
      });
      const selectionBindGroup = device.createBindGroup({
        entries: [
          { binding: 0, resource: { buffer: valuesBuffer } },
          { binding: 1, resource: { buffer: binBuffer } },
          { binding: 2, resource: { buffer: selectedMaskBuffer } },
          { binding: 3, resource: { buffer: axisBuffer } },
          { binding: 4, resource: { buffer: computeUniformBuffer } },
        ],
        layout: selectionBindGroupLayout,
      });
      pages.push({
        computeBindGroup,
        computeUniformBuffer,
        count,
        directBindGroup,
        directUniformBuffer,
        selectionBindGroup,
        sourceIndicesBuffer: valuesBuffer,
        start,
        styleBuffer,
        valueEncoding: 1,
        valuesBuffer,
      });
      residentBytes +=
        valuesBuffer.size + styleBuffer.size +
        COMPUTE_UNIFORM_BYTES + DIRECT_UNIFORM_BYTES;
      uploadBytes += packedValues.byteLength;
      uploadBytes += packedStyles.byteLength;
    };
    let nextStart = 0;
    const packedData = this.buffers.webgpuPackedData;
    if (packedData !== undefined) {
      for await (const page of packedData.createPages()) {
        if (
          page.start !== nextStart || page.count <= 0 ||
          page.start + page.count > this.buffers.recordCount
        ) {
          throw new Error(
            `Parallel packed page starts at ${page.start}; expected ${nextStart}.`,
          );
        }
        appendPage(page.start, page.count, page.values, page.densityStyles);
        nextStart += page.count;
        await yieldToMainThread();
      }
    }
    for (let start = nextStart; start < this.buffers.recordCount; start += recordsPerPage) {
      const count = Math.min(recordsPerPage, this.buffers.recordCount - start);
      appendPage(
        start,
        count,
        packRecordMajorValues(this.buffers, start, count),
        packDensityStyles(this.buffers, this.theme, start, count),
      );
      await yieldToMainThread();
    }
    const usesRepresentativePage =
      this.diagnostics.renderMode === 'hybrid';
    const representativePage = usesRepresentativePage
      ? await createRepresentativeGpuPage({
          axisBuffer,
          buffers: this.buffers,
          directBindGroupLayout,
          device,
          theme: this.theme,
          limit: this.diagnostics.representativeRecordCount,
          ...(packedData?.representativeSourceIndices !== undefined &&
              packedData.representativeRecordLimit ===
                this.diagnostics.representativeRecordCount
            ? {
                sourceIndices: await packedData.representativeSourceIndices,
              }
            : {}),
        })
      : null;
    const staticDirectPages = usesRepresentativePage
      ? [representativePage!]
      : pages;
    const refinedPage = usesRepresentativePage
      ? createRefinedGpuPage({
          axisBuffer,
          axisCount: this.buffers.axisCount,
          buffer: refinementRecordBuffer,
          directBindGroupLayout,
          device,
          limit: refinementLimit,
          sourceOffsetBytes: refinementSourceOffsetBytes,
          styleOffsetBytes: refinementStyleOffsetBytes,
          valueBytes: refinementValueBytes,
        })
      : undefined;
    const directPages = staticDirectPages;
    if (usesRepresentativePage) {
      const directPage = directPages[0]!;
      residentBytes +=
        directPage.valuesBuffer.size + directPage.styleBuffer.size +
        directPage.sourceIndicesBuffer.size +
        DIRECT_UNIFORM_BYTES + refinementRecordBuffer.size +
        refinementStateBuffer.size + (refinementReadBuffer?.size ?? 0) +
        (refinedPage?.directUniformBuffer.size ?? 0);
      uploadBytes += directPage.valuesBuffer.size + directPage.styleBuffer.size +
        directPage.sourceIndicesBuffer.size;
    }
    this.diagnostics = {
      ...this.diagnostics,
      binCount,
      pageCount: pages.length,
      residentBytes,
      uploadBytes,
    };
    return {
      axisBuffer,
      binBuffer,
      binByteLength,
      computeBindGroupLayout,
      computePipeline,
      directBindGroupLayout,
      directPipeline,
      directPages,
      refinedPage,
      refinementReadBuffer,
      refinementRecordBuffer,
      refinementSourceOffsetBytes,
      refinementStateBuffer,
      refinementStyleOffsetBytes,
      staticDirectPages,
      hoverBindGroupLayout,
      hoverDistancePipeline,
      hoverSourcePipeline,
      pages,
      preselectedMaskBuffer,
      renderBindGroup,
      renderPipeline,
      renderUniformBuffer,
      selectionClearPipeline,
      selectionPipeline,
      selectedMaskBuffer,
    };
  }

  private scheduleAggregation(pairRange?: ParallelPairRange): void {
    if (this.disposed || this.gpu === null) return;
    this.densityVisible = false;
    if (this.aggregationInFlight !== null) {
      this.aggregationRequestedRange = this.aggregationRequested
        ? mergeRequestedPairRanges(this.aggregationRequestedRange, pairRange)
        : pairRange ?? null;
      this.aggregationRequested = true;
      return;
    }
    this.aggregationInFlight = this.aggregate(
      this.selectionFromBrushes,
      pairRange,
    ).finally(() => {
      this.aggregationInFlight = null;
      this.drainAggregationRequests();
    });
  }

  private scheduleSelectionAggregation(selectionFromBrushes: boolean): void {
    if (this.disposed || this.gpu === null) return;
    if (this.aggregationInFlight !== null) {
      this.selectionAggregationRequested = selectionFromBrushes;
      return;
    }
    this.aggregationInFlight = this.aggregateSelection(
      selectionFromBrushes,
      false,
    ).then(() => undefined).finally(() => {
      this.aggregationInFlight = null;
      this.drainAggregationRequests();
    });
  }

  private drainAggregationRequests(): void {
    if (this.aggregationRequested) {
      const pairRange = this.aggregationRequestedRange;
      this.aggregationRequested = false;
      this.aggregationRequestedRange = null;
      this.selectionAggregationRequested = null;
      this.scheduleAggregation(pairRange ?? undefined);
    } else if (this.selectionAggregationRequested !== null) {
      const selectionFromBrushes = this.selectionAggregationRequested;
      this.selectionAggregationRequested = null;
      this.scheduleSelectionAggregation(selectionFromBrushes);
    }
  }

  private async waitForAggregationIdle(): Promise<void> {
    while (this.aggregationInFlight !== null) {
      await this.aggregationInFlight;
    }
  }

  private async aggregateSelection(
    selectionFromBrushes: boolean,
    readCandidateMask: boolean,
  ): Promise<Uint32Array | null> {
    const gpu = this.gpu;
    const context = this.context;
    if (
      this.disposed ||
      gpu === null ||
      context === null ||
      gpu.pages.length === 0
    ) {
      return null;
    }
    const firstSelectionBindGroup = gpu.pages[0]!.selectionBindGroup;
    if (firstSelectionBindGroup === undefined) return null;
    const startedAt = performance.now();
    if (selectionFromBrushes) {
      context.device.queue.writeBuffer(
        gpu.selectedMaskBuffer,
        0,
        new Uint8Array(gpu.selectedMaskBuffer.size),
      );
    }
    for (const page of gpu.pages) {
      writeComputeUniform(
        context.device,
        page,
        this.buffers.axisCount,
        this.diagnostics.binResolution,
        selectionFromBrushes,
        this.diagnostics.binCount,
      );
    }
    const readBuffer = readCandidateMask
      ? createBuffer(
          context.device,
          gpu.selectedMaskBuffer.size,
          GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          'parallel selection candidate readback',
        )
      : null;
    const encoder = context.device.createCommandEncoder({
      label: 'parallel selection aggregation encoder',
    });
    let pass = encoder.beginComputePass({
      label: 'parallel selected-bin clear pass',
    });
    pass.setPipeline(gpu.selectionClearPipeline);
    pass.setBindGroup(0, firstSelectionBindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.diagnostics.binCount / 256));
    pass.end();
    if (selectionFromBrushes || this.selectedSourceIndices.length > 0) {
      pass = encoder.beginComputePass({
        label: 'parallel selection aggregation pass',
      });
      pass.setPipeline(gpu.selectionPipeline);
      for (const page of gpu.pages) {
        if (page.selectionBindGroup === undefined) continue;
        pass.setBindGroup(0, page.selectionBindGroup);
        pass.dispatchWorkgroups(Math.ceil(page.count / 256));
      }
      pass.end();
    }
    if (readBuffer !== null) {
      encoder.copyBufferToBuffer(
        gpu.selectedMaskBuffer,
        0,
        readBuffer,
        0,
        gpu.selectedMaskBuffer.size,
      );
    }
    context.device.queue.submit([encoder.finish()]);
    this.draw();
    let candidateMask: Uint32Array | null = null;
    if (readBuffer !== null) {
      await readBuffer.mapAsync(GPUMapMode.READ);
      candidateMask = new Uint32Array(readBuffer.getMappedRange().slice(0));
      readBuffer.unmap();
      readBuffer.destroy();
    } else {
      await context.device.queue.onSubmittedWorkDone();
    }
    this.diagnostics = {
      ...this.diagnostics,
      lastAggregationMs: performance.now() - startedAt,
    };
    this.options.onMetrics?.({
      aggregationResolution: this.diagnostics.binResolution,
      densityBinCount: this.diagnostics.binCount,
      rendererKind: 'webgpu-parallel-density',
      rendererState: 'ready',
    });
    return candidateMask;
  }

  private async aggregate(
    selectionFromBrushes: boolean,
    pairRange?: ParallelPairRange,
  ): Promise<void> {
    const gpu = this.gpu;
    const context = this.context;
    if (this.disposed || gpu === null || context === null) return;
    const startedAt = performance.now();
    const axisViewportVersion = this.axisViewportVersion;
    const refinementActive =
      this.diagnostics.renderMode === 'hybrid' &&
      hasActiveParallelAxisViewports(this.axisViewports, this.buffers.axisOrder);
    const refinementStride = refinementActive
      ? calculateParallelWebgpuRefinementStride(
          this.buffers,
          this.axisViewports,
          this.diagnostics.representativeRecordCount,
        )
      : 1;
    if (refinementActive) {
      context.device.queue.writeBuffer(
        gpu.refinementStateBuffer,
        0,
        new Uint32Array(4),
      );
    }
    if (selectionFromBrushes) {
      context.device.queue.writeBuffer(
        gpu.selectedMaskBuffer,
        0,
        new Uint8Array(gpu.selectedMaskBuffer.size),
      );
    }
    const totalPairCount = Math.max(0, this.buffers.axisCount - 1);
    const activePairRange = clampPairRange(
      pairRange ?? { count: totalPairCount, start: 0 },
      totalPairCount,
    );
    const binsPerPair =
      (this.diagnostics.binResolution + SPECIAL_AXIS_BIN_COUNT) ** 2;
    const clearOffset = activePairRange.start * binsPerPair * BIN_BYTES;
    const clearByteLength = activePairRange.count * binsPerPair * BIN_BYTES;
    if (clearByteLength > 0) {
      context.device.queue.writeBuffer(
        gpu.binBuffer,
        clearOffset,
        new Uint8Array(clearByteLength),
      );
    }
    const encoder = context.device.createCommandEncoder({
      label: 'parallel density aggregation encoder',
    });
    const pass = encoder.beginComputePass({
      label: 'parallel density aggregation pass',
    });
    pass.setPipeline(gpu.computePipeline);
    for (const page of gpu.pages) {
      writeComputeUniform(
        context.device,
        page,
        this.buffers.axisCount,
        this.diagnostics.binResolution,
        selectionFromBrushes,
        0,
        activePairRange,
        this.selectedSourceIndices.length > 0,
        this.preselectedSourceIndices.length > 0,
        this.buffers.styleBuffers === undefined,
        refinementActive
          ? {
              limit: this.diagnostics.representativeRecordCount,
              sourceOffsetWords:
                gpu.refinementSourceOffsetBytes / Uint32Array.BYTES_PER_ELEMENT,
              stride: refinementStride,
              styleOffsetWords:
                gpu.refinementStyleOffsetBytes / Uint32Array.BYTES_PER_ELEMENT,
              uniformStyle: packRgba8(this.theme.lineColor),
            }
          : undefined,
      );
      pass.setBindGroup(0, page.computeBindGroup!);
      pass.dispatchWorkgroups(Math.ceil(page.count / 256));
    }
    pass.end();
    if (refinementActive && gpu.refinementReadBuffer !== undefined) {
      encoder.copyBufferToBuffer(
        gpu.refinementStateBuffer,
        0,
        gpu.refinementReadBuffer,
        0,
        EMPTY_BUFFER_BYTES,
      );
      encoder.copyBufferToBuffer(
        gpu.refinementRecordBuffer,
        gpu.refinementSourceOffsetBytes,
        gpu.refinementReadBuffer,
        EMPTY_BUFFER_BYTES,
        Math.max(1, this.diagnostics.representativeRecordCount) *
          Uint32Array.BYTES_PER_ELEMENT,
      );
    }
    context.device.queue.submit([encoder.finish()]);
    await context.device.queue.onSubmittedWorkDone();
    let refinementQualifiedRecordCount = 0;
    let refinedRecordCount = 0;
    if (refinementActive && gpu.refinementReadBuffer !== undefined) {
      await gpu.refinementReadBuffer.mapAsync(GPUMapMode.READ);
      const refinementReadback = new Uint32Array(
        gpu.refinementReadBuffer.getMappedRange(),
      );
      refinementQualifiedRecordCount = refinementReadback[0] ?? 0;
      const candidateCount = Math.min(
        refinementReadback[1] ?? 0,
        this.diagnostics.representativeRecordCount,
      );
      const candidateSourceIndices = refinementReadback.slice(
        EMPTY_BUFFER_BYTES / Uint32Array.BYTES_PER_ELEMENT,
        EMPTY_BUFFER_BYTES / Uint32Array.BYTES_PER_ELEMENT + candidateCount,
      );
      gpu.refinementReadBuffer.unmap();
      const refinedSourceIndices = filterParallelWebgpuRefinedSourceIndices(
        this.buffers,
        candidateSourceIndices,
        this.axisViewports,
      );
      const refinedValues = packParallelWebgpuRefinedViewportValues(
        this.buffers,
        refinedSourceIndices,
        this.axisViewports,
      );
      const refinedStyles = packSampledStyles(
        this.buffers,
        this.theme,
        refinedSourceIndices,
      );
      refinedRecordCount = refinedSourceIndices.length;
      if (refinementStride === 1 && candidateCount <
        this.diagnostics.representativeRecordCount) {
        refinementQualifiedRecordCount = refinedRecordCount;
      }
      if (refinedValues.byteLength > 0) {
        context.device.queue.writeBuffer(
          gpu.refinementRecordBuffer,
          0,
          refinedValues,
        );
      }
      if (refinedStyles.byteLength > 0) {
        context.device.queue.writeBuffer(
          gpu.refinementRecordBuffer,
          gpu.refinementStyleOffsetBytes,
          refinedStyles,
        );
      }
      if (refinedSourceIndices.byteLength > 0) {
        context.device.queue.writeBuffer(
          gpu.refinementRecordBuffer,
          gpu.refinementSourceOffsetBytes,
          refinedSourceIndices,
        );
      }
    }
    if (
      axisViewportVersion === this.axisViewportVersion &&
      !this.aggregationRequested
    ) {
      this.densityVisible = true;
      if (refinementActive && gpu.refinedPage !== undefined) {
        gpu.refinedPage.count = refinedRecordCount;
        gpu.directPages = [gpu.refinedPage];
      } else {
        gpu.directPages = gpu.staticDirectPages;
      }
    }
    this.diagnostics = {
      ...this.diagnostics,
      hoverSearchRecordCount: refinementActive
        ? refinedRecordCount
        : this.diagnostics.renderMode === 'hybrid'
          ? this.diagnostics.representativeRecordCount
          : this.buffers.recordCount,
      lastAggregationMs: performance.now() - startedAt,
      lastAggregationPairCount: activePairRange.count,
      refinedRecordCount: refinementActive ? refinedRecordCount : 0,
      refinementQualifiedRecordCount:
        refinementActive ? refinementQualifiedRecordCount : 0,
      refinementStride,
    };
    this.options.onMetrics?.({
      aggregationResolution: this.diagnostics.binResolution,
      densityBinCount: this.diagnostics.binCount,
      rendererKind: 'webgpu-parallel-density',
      rendererState: 'ready',
    });
    this.draw();
  }

  private writeAxisConfigs(): void {
    if (this.gpu === null || this.context === null) return;
    const data = new ArrayBuffer(
      Math.max(EMPTY_BUFFER_BYTES, this.buffers.axisCount * AXIS_CONFIG_BYTES),
    );
    const floats = new Float32Array(data);
    const uints = new Uint32Array(data);
    const normalizedBrushes = groupBrushesByAxis(
      this.buffers,
      this.brushIntervals,
    );
    for (let axisIndex = 0; axisIndex < this.buffers.axisCount; axisIndex += 1) {
      const axis = this.buffers.axisOrder[axisIndex]!;
      const domain = this.buffers.domainsByAxis[axis]!;
      const viewport = this.axisViewports[axis] ?? domain;
      const floatOffset = (axisIndex * AXIS_CONFIG_BYTES) / 4;
      floats[floatOffset] = normalizeRaw(viewport.min, domain);
      floats[floatOffset + 1] = normalizeRaw(viewport.max, domain);
      floats[floatOffset + 2] = 0;
      floats[floatOffset + 3] = 1;
      const brushes = normalizedBrushes[axis] ?? [];
      for (
        let brushIndex = 0;
        brushIndex < Math.min(MAX_BRUSH_INTERVALS_PER_AXIS, brushes.length);
        brushIndex += 1
      ) {
        const brush = brushes[brushIndex]!;
        floats[floatOffset + 4 + brushIndex * 2] = brush.min;
        floats[floatOffset + 5 + brushIndex * 2] = brush.max;
      }
      uints[floatOffset + 12] = Math.min(
        MAX_BRUSH_INTERVALS_PER_AXIS,
        brushes.length,
      );
      const metadata = this.buffers.axisMetadataByAxis?.[axis];
      uints[floatOffset + 13] =
        metadata?.kind === 'categorical' || metadata?.kind === 'boolean' ? 1 : 0;
      uints[floatOffset + 14] = this.axisViewports[axis] == null ? 0 : 1;
    }
    this.context.device.queue.writeBuffer(this.gpu.axisBuffer, 0, data);
  }

  private writeMask(
    kind: 'preselected' | 'selected',
    sourceIndices: Uint32Array,
  ): void {
    if (this.gpu === null || this.context === null) return;
    const target =
      kind === 'selected'
        ? this.gpu.selectedMaskBuffer
        : this.gpu.preselectedMaskBuffer;
    const words = new Uint32Array(Math.max(4, Math.ceil(this.buffers.recordCount / 32)));
    for (const sourceIndex of sourceIndices) {
      if (sourceIndex >= this.buffers.recordCount) continue;
      words[sourceIndex >>> 5] |= 1 << (sourceIndex & 31);
    }
    this.context.device.queue.writeBuffer(
      target,
      0,
      words,
    );
  }

  private writeRenderUniform(): void {
    if (this.gpu === null || this.context === null) return;
    const data = new ArrayBuffer(RENDER_UNIFORM_BYTES);
    const uints = new Uint32Array(data);
    const floats = new Float32Array(data);
    uints[0] = this.buffers.axisCount;
    uints[1] = this.diagnostics.binResolution;
    uints[2] = Math.max(0, this.buffers.axisCount - 1);
    uints[3] = this.diagnostics.binCount;
    floats[4] = this.lineOpacityScale;
    uints[5] = this.hasActiveSelection() ? 1 : 0;
    floats[6] = Math.max(1, this.canvas.width);
    floats[7] = Math.max(1, this.canvas.height);
    writeColor(
      floats,
      8,
      this.buffers.styleBuffers === undefined
        ? quantizedUniformDensityColor(this.theme.lineColor)
        : this.theme.lineColor,
    );
    writeColor(floats, 12, this.theme.preselectedColor);
    writeColor(floats, 16, this.theme.selectedColor);
    writeColor(
      floats,
      20,
      selectionHaloColorForBackground(this.theme.backgroundColor),
    );
    this.context.device.queue.writeBuffer(this.gpu.renderUniformBuffer, 0, data);
  }

  private writeDirectUniform(page: ParallelGpuPage): number {
    if (this.context === null) return 0;
    const direct = this.diagnostics.renderMode === 'direct';
    if (page.representativeOnly === true) {
      const data = new ArrayBuffer(DIRECT_UNIFORM_BYTES);
      const uints = new Uint32Array(data);
      const floats = new Float32Array(data);
      uints[0] = page.count;
      uints[1] = this.buffers.axisCount;
      uints[2] = Math.max(0, this.buffers.axisCount - 1);
      uints[3] = 1;
      uints[4] = page.count;
      floats[5] = 0.12 * this.lineOpacityScale;
      floats[6] = this.hasActiveSelection() ? 0.42 : 1;
      uints[7] = page.valueEncoding;
      uints[8] = this.buffers.styleBuffers === undefined ? 1 : 0;
      uints[9] = packRgba8(this.theme.lineColor);
      this.context.device.queue.writeBuffer(page.directUniformBuffer, 0, data);
      return page.count;
    }
    const totalBudget = direct
      ? this.buffers.recordCount
      : this.options.representativeRecordLimit ??
        DEFAULT_REPRESENTATIVE_RECORD_LIMIT;
    const pageBudget = Math.max(
      1,
      Math.round((page.count / Math.max(1, this.buffers.recordCount)) * totalBudget),
    );
    const stride = Math.max(1, Math.ceil(page.count / pageBudget));
    const representativeCount = Math.ceil(page.count / stride);
    const data = new ArrayBuffer(DIRECT_UNIFORM_BYTES);
    const uints = new Uint32Array(data);
    const floats = new Float32Array(data);
    uints[0] = page.count;
    uints[1] = this.buffers.axisCount;
    uints[2] = Math.max(0, this.buffers.axisCount - 1);
    uints[3] = stride;
    uints[4] = representativeCount;
    floats[5] = (direct ? 0.055 : 0.12) * this.lineOpacityScale;
    floats[6] = this.hasActiveSelection() ? 0.42 : 1;
    uints[7] = page.valueEncoding;
    uints[8] = this.buffers.styleBuffers === undefined ? 1 : 0;
    uints[9] = packRgba8(this.theme.lineColor);
    this.context.device.queue.writeBuffer(page.directUniformBuffer, 0, data);
    return representativeCount;
  }

  private hasActiveSelection(): boolean {
    return this.selectionFromBrushes || this.selectedSourceIndices.length > 0;
  }

  private syncCanvasSize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = globalThis.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  private destroyGpuResources(): void {
    const gpu = this.gpu;
    if (gpu === null) return;
    destroyParallelGpuResources(gpu);
    this.gpu = null;
  }
}

function destroyParallelGpuResources(gpu: ParallelGpuResources): void {
  gpu.axisBuffer.destroy();
  gpu.binBuffer.destroy();
  gpu.preselectedMaskBuffer.destroy();
  gpu.renderUniformBuffer.destroy();
  gpu.selectedMaskBuffer.destroy();
  gpu.refinementStateBuffer.destroy();
  gpu.refinementReadBuffer?.destroy();
  const pages = new Set([
    ...gpu.pages,
    ...gpu.staticDirectPages,
    ...(gpu.refinedPage === undefined ? [] : [gpu.refinedPage]),
  ]);
  const pageBuffers = new Set<GPUBuffer>([gpu.refinementRecordBuffer]);
  for (const page of pages) {
    page.computeUniformBuffer?.destroy();
    page.directUniformBuffer.destroy();
    pageBuffers.add(page.styleBuffer);
    pageBuffers.add(page.valuesBuffer);
    pageBuffers.add(page.sourceIndicesBuffer);
  }
  for (const buffer of pageBuffers) buffer.destroy();
}

function createLinePipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  bindGroupLayout: GPUBindGroupLayout,
  code: string,
  label: string,
): GPURenderPipeline {
  const module = device.createShaderModule({ code, label: `${label} shader` });
  return device.createRenderPipeline({
    fragment: {
      entryPoint: 'fragmentMain',
      module,
      targets: [{
        blend: {
          alpha: {
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
            srcFactor: 'one',
          },
          color: {
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
            srcFactor: 'src-alpha',
          },
        },
        format,
      }],
    },
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    primitive: { topology: 'line-list' },
    vertex: { entryPoint: 'vertexMain', module },
  });
}

function createBuffer(
  device: GPUDevice,
  size: number,
  usage: GPUBufferUsageFlags,
  label: string,
): GPUBuffer {
  return device.createBuffer({
    label,
    size: alignTo4(Math.max(EMPTY_BUFFER_BYTES, size)),
    usage,
  });
}

function createBufferWithData(
  device: GPUDevice,
  data: Uint32Array,
  usage: GPUBufferUsageFlags,
  label: string,
): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    mappedAtCreation: true,
    size: alignTo4(Math.max(EMPTY_BUFFER_BYTES, data.byteLength)),
    usage,
  });
  new Uint32Array(buffer.getMappedRange(), 0, data.length).set(data);
  buffer.unmap();
  return buffer;
}

async function createRepresentativeGpuPage(options: {
  axisBuffer: GPUBuffer;
  buffers: ParallelBuffers;
  device: GPUDevice;
  directBindGroupLayout: GPUBindGroupLayout;
  limit: number;
  sourceIndices?: Uint32Array;
  theme: ParallelFastTheme;
}): Promise<ParallelGpuPage> {
  const sourceIndices = options.sourceIndices ??
    await createParallelRepresentativeSourceIndices(options.buffers, options.limit);
  const count = sourceIndices.length;
  const packedValues = packSampledRecordMajorValues(
    options.buffers,
    sourceIndices,
  );
  const packedStyles = packSampledStyles(
    options.buffers,
    options.theme,
    sourceIndices,
  );
  const valuesBuffer = createBuffer(
    options.device,
    packedValues.byteLength,
    GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    'parallel representative values',
  );
  const styleBuffer = createBuffer(
    options.device,
    packedStyles.byteLength,
    GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    'parallel representative styles',
  );
  options.device.queue.writeBuffer(valuesBuffer, 0, packedValues);
  options.device.queue.writeBuffer(styleBuffer, 0, packedStyles);
  const sourceIndicesBuffer = createBufferWithData(
    options.device,
    sourceIndices,
    GPUBufferUsage.STORAGE,
    'parallel representative source indices',
  );
  const directUniformBuffer = createBuffer(
    options.device,
    DIRECT_UNIFORM_BYTES,
    GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    'parallel representative direct uniform',
  );
  return {
    count,
    directBindGroup: options.device.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: valuesBuffer } },
        { binding: 1, resource: { buffer: styleBuffer } },
        { binding: 2, resource: { buffer: options.axisBuffer } },
        { binding: 3, resource: { buffer: directUniformBuffer } },
      ],
      layout: options.directBindGroupLayout,
    }),
    directUniformBuffer,
    representativeOnly: true,
    representativeSourceIndices: sourceIndices,
    sourceIndicesBuffer,
    start: 0,
    styleBuffer,
    valueEncoding: 1,
    valuesBuffer,
  };
}

function createRefinedGpuPage(options: {
  axisBuffer: GPUBuffer;
  axisCount: number;
  buffer: GPUBuffer;
  device: GPUDevice;
  directBindGroupLayout: GPUBindGroupLayout;
  limit: number;
  sourceOffsetBytes: number;
  styleOffsetBytes: number;
  valueBytes: number;
}): ParallelGpuPage {
  const directUniformBuffer = createBuffer(
    options.device,
    DIRECT_UNIFORM_BYTES,
    GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    'parallel refined direct uniform',
  );
  return {
    count: 0,
    directBindGroup: options.device.createBindGroup({
      entries: [
        {
          binding: 0,
          resource: { buffer: options.buffer, size: options.valueBytes },
        },
        {
          binding: 1,
          resource: {
            buffer: options.buffer,
            offset: options.styleOffsetBytes,
            size: options.limit * Uint32Array.BYTES_PER_ELEMENT,
          },
        },
        { binding: 2, resource: { buffer: options.axisBuffer } },
        { binding: 3, resource: { buffer: directUniformBuffer } },
      ],
      layout: options.directBindGroupLayout,
    }),
    directUniformBuffer,
    representativeOnly: true,
    sourceIndicesBuffer: options.buffer,
    sourceIndicesOffset: options.sourceOffsetBytes,
    start: 0,
    styleBuffer: options.buffer,
    valueEncoding: 2,
    valuesBuffer: options.buffer,
  };
}

function packSampledRecordMajorValues(
  buffers: ParallelBuffers,
  sourceIndices: Uint32Array,
): Uint32Array<ArrayBuffer> {
  const count = sourceIndices.length;
  const valueCount = count * buffers.axisCount;
  const packed = new Uint32Array(
    new ArrayBuffer(Math.max(1, Math.ceil(valueCount / 2)) * 4),
  );
  const readers = createParallelNormalizedValueReaders(buffers);
  for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
    const sourceIndex = sourceIndices[sampleIndex]!;
    for (let axisIndex = 0; axisIndex < buffers.axisCount; axisIndex += 1) {
      writeQuantizedValue(
        packed,
        sampleIndex * buffers.axisCount + axisIndex,
        readers[axisIndex]!(sourceIndex),
      );
    }
  }
  return packed;
}

function packSampledStyles(
  buffers: ParallelBuffers,
  theme: ParallelFastTheme,
  sourceIndices: Uint32Array,
): Uint32Array<ArrayBuffer> {
  const count = sourceIndices.length;
  const result = new Uint32Array(new ArrayBuffer(Math.max(1, count) * 4));
  const colors = buffers.styleBuffers?.color;
  const packedGetter = getParallelPackedRgbaGetter(colors);
  const fallback = theme.lineColor;
  for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
    const sourceIndex = sourceIndices[sampleIndex]!;
    if (packedGetter !== null) {
      result[sampleIndex] = packedGetter(sourceIndex);
      continue;
    }
    const offset = sourceIndex * 4;
    const red = colors?.[offset] ?? Math.round(fallback[0] * 255);
    const green = colors?.[offset + 1] ?? Math.round(fallback[1] * 255);
    const blue = colors?.[offset + 2] ?? Math.round(fallback[2] * 255);
    const alpha = colors?.[offset + 3] ?? Math.round(fallback[3] * 255);
    result[sampleIndex] =
      (red | (green << 8) | (blue << 16) | (alpha << 24)) >>> 0;
  }
  return result;
}

function storageEntry(
  binding: number,
  writable: boolean,
  visibility: GPUShaderStageFlags,
): GPUBindGroupLayoutEntry {
  return {
    binding,
    buffer: { type: writable ? 'storage' : 'read-only-storage' },
    visibility,
  };
}

function uniformEntry(
  binding: number,
  visibility: GPUShaderStageFlags,
): GPUBindGroupLayoutEntry {
  return { binding, buffer: { type: 'uniform' }, visibility };
}

function packRecordMajorValues(
  buffers: ParallelBuffers,
  start: number,
  count: number,
): Uint32Array<ArrayBuffer> {
  const valueCount = count * buffers.axisCount;
  const packed = new Uint32Array(
    new ArrayBuffer(Math.max(1, Math.ceil(valueCount / 2)) * 4),
  );
  const readers = createParallelNormalizedValueReaders(buffers);
  for (let recordOffset = 0; recordOffset < count; recordOffset += 1) {
    for (let axisIndex = 0; axisIndex < buffers.axisCount; axisIndex += 1) {
      const linearIndex = recordOffset * buffers.axisCount + axisIndex;
      const normalized = readers[axisIndex]!(start + recordOffset);
      writeQuantizedValue(packed, linearIndex, normalized);
    }
  }
  return packed;
}

function writeQuantizedValue(
  packed: Uint32Array,
  linearIndex: number,
  normalized: number,
): void {
  const quantized = Number.isFinite(normalized)
    ? Math.round(Math.max(0, Math.min(1, normalized)) * 65534)
    : 65535;
  const wordIndex = linearIndex >>> 1;
  const shift = (linearIndex & 1) * 16;
  packed[wordIndex] = (packed[wordIndex]! | (quantized << shift)) >>> 0;
}

function packDensityStyles(
  buffers: ParallelBuffers,
  theme: ParallelFastTheme,
  start: number,
  count: number,
): Uint32Array<ArrayBuffer> {
  const colors = buffers.styleBuffers?.color;
  const packedGetter = getParallelPackedRgbaGetter(colors);
  const fallback = theme.lineColor;
  const result = new Uint32Array(
    new ArrayBuffer(Math.max(1, Math.ceil(count / 2)) * 4),
  );

  for (let offset = 0; offset < count; offset += 1) {
    const sourceIndex = start + offset;
    const colorOffset = sourceIndex * 4;
    const rgba = packedGetter?.(sourceIndex);
    const red = rgba === undefined
      ? colors?.[colorOffset] ?? Math.round(fallback[0] * 255)
      : rgba & 255;
    const green = rgba === undefined
      ? colors?.[colorOffset + 1] ?? Math.round(fallback[1] * 255)
      : (rgba >>> 8) & 255;
    const blue = rgba === undefined
      ? colors?.[colorOffset + 2] ?? Math.round(fallback[2] * 255)
      : (rgba >>> 16) & 255;
    const alpha = rgba === undefined
      ? colors?.[colorOffset + 3] ?? Math.round(fallback[3] * 255)
      : rgba >>> 24;
    const packed =
      ((red * 15 / 255) & 15) |
      (((green * 15 / 255) & 15) << 4) |
      (((blue * 15 / 255) & 15) << 8) |
      (((alpha * 15 / 255) & 15) << 12);
    const pairIndex = offset >>> 1;
    result[pairIndex] = offset % 2 === 0
      ? packed
      : (result[pairIndex]! | (packed << 16)) >>> 0;
  }

  return result;
}

function createParallelNormalizedValueReaders(
  buffers: ParallelBuffers,
): Array<(sourceIndex: number) => number> {
  return buffers.axisOrder.map((axis) => {
    const readRaw = createParallelRawValueReader(
      buffers.rawValuesByAxis[axis]!,
    );
    const domain = buffers.domainsByAxis[axis]!;

    if (domain.span === 0) {
      return (sourceIndex: number) =>
        Number.isFinite(readRaw(sourceIndex)) ? 0.5 : Number.NaN;
    }
    return (sourceIndex: number) => {
      const raw = readRaw(sourceIndex);
      return Number.isFinite(raw)
        ? (raw - domain.min) / domain.span
        : Number.NaN;
    };
  });
}

function createParallelRawValueReader(
  values: ParallelRawValuesByAxis[string],
): (sourceIndex: number) => number {
  const compactGetter = (
    values as typeof values & {
      __parallelCompactGetValue?: (index: number) => number;
    }
  ).__parallelCompactGetValue;
  return compactGetter === undefined
    ? (sourceIndex: number) => values[sourceIndex] ?? Number.NaN
    : compactGetter;
}

function getParallelPackedRgbaGetter(
  colors: { readonly [index: number]: number } | undefined,
): ((sourceIndex: number) => number) | null {
  return (
    colors as typeof colors & {
      __parallelCompactGetPackedRgba?: (sourceIndex: number) => number;
    }
  )?.__parallelCompactGetPackedRgba ?? null;
}

function groupBrushesByAxis(
  buffers: ParallelBuffers,
  brushIntervals: ParallelBrushIntervals,
): Record<string, { max: number; min: number }[]> {
  const result: Record<string, { max: number; min: number }[]> = {};
  for (const brush of normalizeParallelBrushIntervals(
    brushIntervals,
    buffers.axisOrder,
  )) {
    const domain = buffers.domainsByAxis[brush.parameter];
    if (domain === undefined) continue;
    (result[brush.parameter] ??= []).push({
      max: normalizeRaw(brush.max, domain),
      min: normalizeRaw(brush.min, domain),
    });
  }
  return result;
}

function gpuCandidateMaskCoversBrushIntervals(
  buffers: ParallelBuffers,
  brushIntervals: ParallelBrushIntervals,
): boolean {
  const counts = new Map<string, number>();
  for (const brush of normalizeParallelBrushIntervals(
    brushIntervals,
    buffers.axisOrder,
  )) {
    const count = (counts.get(brush.parameter) ?? 0) + 1;
    if (count > MAX_BRUSH_INTERVALS_PER_AXIS) return false;
    counts.set(brush.parameter, count);
  }
  return true;
}

function writeComputeUniform(
  device: GPUDevice,
  page: ParallelGpuPage,
  axisCount: number,
  resolution: number,
  selectionFromBrushes: boolean,
  binCount = 0,
  pairRange?: ParallelPairRange,
  selectedMaskActive = false,
  preselectedMaskActive = false,
  uniformStyle = false,
  refinement?: {
    limit: number;
    sourceOffsetWords: number;
    stride: number;
    styleOffsetWords: number;
    uniformStyle: number;
  },
): void {
  const values = new Uint32Array(COMPUTE_UNIFORM_BYTES / 4);
  values[0] = page.count;
  values[1] = page.start;
  values[2] = axisCount;
  values[3] = resolution;
  values[4] = pairRange?.count ?? Math.max(0, axisCount - 1);
  values[5] = selectionFromBrushes ? 1 : 0;
  values[6] = pairRange?.start ?? binCount;
  values[7] = selectedMaskActive ? 1 : 0;
  values[8] = preselectedMaskActive ? 1 : 0;
  values[9] = uniformStyle ? 1 : 0;
  values[10] = refinement === undefined ? 0 : 1;
  values[11] = refinement?.limit ?? 0;
  values[12] = refinement?.stride ?? 1;
  values[13] = refinement?.uniformStyle ?? 0;
  values[14] = refinement?.styleOffsetWords ?? 0;
  values[15] = refinement?.sourceOffsetWords ?? 0;
  device.queue.writeBuffer(page.computeUniformBuffer!, 0, values);
}

function changedViewportPairRange(
  previous: ParallelAxisViewports,
  next: ParallelAxisViewports,
  axisOrder: readonly string[],
): ParallelPairRange | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  const pairCount = Math.max(0, axisOrder.length - 1);

  for (let axisIndex = 0; axisIndex < axisOrder.length; axisIndex += 1) {
    const axis = axisOrder[axisIndex]!;
    if (viewportRangeEquals(previous[axis], next[axis])) continue;
    start = Math.min(start, Math.max(0, axisIndex - 1));
    end = Math.max(end, Math.min(pairCount - 1, axisIndex));
  }

  return start <= end ? { count: end - start + 1, start } : null;
}

function viewportRangeEquals(
  left: { max: number; min: number } | null | undefined,
  right: { max: number; min: number } | null | undefined,
): boolean {
  if (left == null || right == null) return left == null && right == null;
  return left.min === right.min && left.max === right.max;
}

function hasActiveParallelAxisViewports(
  axisViewports: ParallelAxisViewports,
  axisOrder: readonly string[],
): boolean {
  return axisOrder.some((axis) => axisViewports[axis] != null);
}

export function calculateParallelWebgpuRefinementStride(
  buffers: Pick<ParallelBuffers, 'axisOrder' | 'domainsByAxis' | 'recordCount'>,
  axisViewports: ParallelAxisViewports,
  requestedLimit: number,
): number {
  const limit = Math.max(1, Math.floor(requestedLimit));
  let estimatedFraction = 1;
  for (const axis of buffers.axisOrder) {
    const viewport = axisViewports[axis];
    const domain = buffers.domainsByAxis[axis];
    if (viewport == null || domain === undefined) continue;
    if (domain.span <= 0) {
      estimatedFraction *=
        viewport.min <= domain.min && viewport.max >= domain.max ? 1 : 0;
      continue;
    }
    const overlap = Math.max(
      0,
      Math.min(domain.max, viewport.max) - Math.max(domain.min, viewport.min),
    );
    estimatedFraction *= Math.min(1, overlap / domain.span);
  }
  const estimatedQualifiedCount = buffers.recordCount * estimatedFraction;
  const safetyBudget = Math.max(1, Math.floor(limit * 0.9));
  return Math.max(1, Math.ceil(estimatedQualifiedCount / safetyBudget));
}

function mergePairRanges(
  left: ParallelPairRange | null,
  right: ParallelPairRange | null,
): ParallelPairRange | null {
  if (left === null) return right;
  if (right === null) return left;
  const start = Math.min(left.start, right.start);
  const end = Math.max(left.start + left.count, right.start + right.count);
  return { count: end - start, start };
}

function mergeRequestedPairRanges(
  existing: ParallelPairRange | null,
  next: ParallelPairRange | undefined,
): ParallelPairRange | null {
  if (existing === null || next === undefined) return null;
  return mergePairRanges(existing, next);
}

function clampPairRange(
  range: ParallelPairRange,
  pairCount: number,
): ParallelPairRange {
  const start = Math.max(0, Math.min(pairCount, range.start));
  const end = Math.max(start, Math.min(pairCount, range.start + range.count));
  return { count: end - start, start };
}

function writeColor(
  target: Float32Array,
  offset: number,
  color: readonly [number, number, number, number],
): void {
  target.set(color, offset);
}

function quantizedUniformDensityColor(
  color: readonly [number, number, number, number],
): [number, number, number, number] {
  const nibble = (value: number) =>
    (Math.round(Math.max(0, Math.min(1, value)) * 255) * 15 / 255) & 15;
  const red = nibble(color[0]);
  const green = nibble(color[1]);
  const blue = nibble(color[2]);
  const alpha = nibble(color[3]);
  const densityAlpha = Math.floor((alpha * 127) / 15) / 127;
  return [red / 15, green / 15, blue / 15, -densityAlpha - 1];
}

function packRgba8(
  color: readonly [number, number, number, number],
): number {
  const byte = (value: number) =>
    Math.round(Math.max(0, Math.min(1, value)) * 255);
  return (
    byte(color[0]) |
    (byte(color[1]) << 8) |
    (byte(color[2]) << 16) |
    (byte(color[3]) << 24)
  ) >>> 0;
}

function selectionHaloColorForBackground(
  background: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  const luminance =
    background[0] * 0.2126 + background[1] * 0.7152 + background[2] * 0.0722;
  return luminance > 0.5
    ? [0.07, 0.09, 0.13, 0.86]
    : [0.98, 0.98, 0.94, 0.8];
}

function normalizeRaw(
  value: number,
  domain: { min: number; span: number },
): number {
  return domain.span > 0 ? (value - domain.min) / domain.span : 0.5;
}

function resolveDirectRecordCount(
  buffers: ParallelBuffers,
  limit = DEFAULT_DIRECT_SEGMENT_LIMIT,
): number {
  const pairCount = Math.max(1, buffers.axisCount - 1);
  return Math.min(buffers.recordCount, Math.floor(Math.max(0, limit) / pairCount));
}

function resolveRepresentativeRecordCount(
  buffers: ParallelBuffers,
  limit = DEFAULT_REPRESENTATIVE_RECORD_LIMIT,
): number {
  const normalizedLimit = Number.isFinite(limit)
    ? Math.max(0, Math.floor(limit))
    : DEFAULT_REPRESENTATIVE_RECORD_LIMIT;
  return Math.min(buffers.recordCount, normalizedLimit);
}

function resolveRenderMode(
  buffers: ParallelBuffers,
  options: ParallelWebgpuRendererOptions,
): ParallelWebgpuDiagnostics['renderMode'] {
  if (options.renderMode === 'density') return 'density';
  if (options.renderMode === 'direct') return 'direct';
  return buffers.recordCount <= resolveDirectRecordCount(
    buffers,
    options.directSegmentLimit,
  )
    ? 'direct'
    : 'hybrid';
}

function normalizeResolution(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_BIN_RESOLUTION;
  }
  return Math.max(32, Math.min(1024, Math.round(value)));
}

function normalizeOpacityScale(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 1;
}

function rgbaObject(color: readonly [number, number, number, number]): GPUColor {
  return { a: color[3], b: color[2], g: color[1], r: color[0] };
}

function alignTo4(value: number): number {
  return Math.ceil(value / 4) * 4;
}

function alignTo(value: number, alignment: number): number {
  const normalizedAlignment = Math.max(1, Math.floor(alignment));
  return Math.ceil(value / normalizedAlignment) * normalizedAlignment;
}

function uint32ArraysEqual(left: Uint32Array, right: Uint32Array): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}
