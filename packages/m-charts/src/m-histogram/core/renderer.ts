import { histogramAxisToPixel } from './transforms.js';
import type {
  HistogramAggregationSet,
  HistogramBin,
  HistogramMetricsEvent,
  HistogramSubplotBins,
  HistogramViewport,
} from './types.js';
import type { HistogramLayout, HistogramPlotRect } from './transforms.js';

export type HistogramRendererColor = readonly [
  r: number,
  g: number,
  b: number,
  a: number,
];

export interface HistogramRendererTheme {
  readonly backgroundColor?: HistogramRendererColor;
  readonly defaultBarColor?: HistogramRendererColor;
  readonly gridLineColor?: HistogramRendererColor;
  readonly hoverOverlayColor?: HistogramRendererColor;
  readonly outOfRangeMarkerColor?: HistogramRendererColor;
  readonly selectedOverlayColor?: HistogramRendererColor;
  readonly subplotBackgroundColor?: HistogramRendererColor;
}

export interface HistogramRendererHoverBin {
  readonly binIndex: number;
  readonly subplotId: string;
}

export interface HistogramRendererBufferBuildInput {
  readonly aggregation: HistogramAggregationSet;
  readonly hoverBin?: HistogramRendererHoverBin | null;
  readonly layout: HistogramLayout;
  readonly selectedBinKeys?: readonly string[];
  readonly theme?: HistogramRendererTheme;
  readonly viewport: HistogramViewport;
}

export interface HistogramRendererBufferMetrics {
  readonly backgroundInstanceCount: number;
  readonly barInstanceCount: number;
  readonly gridInstanceCount: number;
  readonly instanceCount: number;
  readonly overlayInstanceCount: number;
  readonly outOfRangeMarkerInstanceCount: number;
  readonly separatorInstanceCount: number;
  readonly selectedBinCount: number;
  readonly selectedSourceCount: number;
  readonly stackSegmentCount: number;
  readonly uploadBytes: number;
  readonly visibleBinCount: number;
}

export interface HistogramRendererBuffers {
  readonly colors: Float32Array;
  readonly metrics: HistogramRendererBufferMetrics;
  readonly rects: Float32Array;
}

export interface HistogramWebglRendererOptions
  extends HistogramRendererBufferBuildInput {
  readonly canvas: HTMLCanvasElement;
  readonly devicePixelRatio?: number;
  readonly onMetrics?: (metrics: HistogramMetricsEvent) => void;
  readonly preserveDrawingBuffer?: boolean;
}

export interface HistogramRendererUpdate {
  readonly aggregation?: HistogramAggregationSet;
  readonly devicePixelRatio?: number;
  readonly hoverBin?: HistogramRendererHoverBin | null;
  readonly layout?: HistogramLayout;
  readonly selectedBinKeys?: readonly string[];
  readonly theme?: HistogramRendererTheme;
  readonly viewport?: HistogramViewport;
}

export interface HistogramRendererRenderMetrics {
  readonly drawCalls: number;
  readonly durationMs: number;
  readonly gpuDurationMs?: number;
  readonly gpuTimerSupported: boolean;
  readonly instanceCount: number;
  readonly uploadBytes: number;
  readonly visibleBinCount: number;
}

interface HistogramGlProgram {
  readonly attributes: {
    readonly color: number;
    readonly corner: number;
    readonly rect: number;
  };
  readonly metrics: {
    readonly fragmentCompileMs: number;
    readonly linkMs: number;
    readonly shaderCompileMs: number;
    readonly vertexCompileMs: number;
  };
  readonly program: WebGLProgram;
  readonly uniforms: {
    readonly canvasSize: WebGLUniformLocation;
  };
}

interface HistogramGpuTimer {
  readonly supported: boolean;
  begin(): void;
  dispose(): void;
  end(): void;
  poll(): number | undefined;
}

interface WebglTimerExtension {
  readonly GPU_DISJOINT_EXT: GLenum;
  readonly TIME_ELAPSED_EXT: GLenum;
}

interface MutableBufferMetrics {
  backgroundInstanceCount: number;
  barInstanceCount: number;
  gridInstanceCount: number;
  overlayInstanceCount: number;
  outOfRangeMarkerInstanceCount: number;
  separatorInstanceCount: number;
  selectedBinCount: number;
  selectedSourceCount: number;
  stackSegmentCount: number;
  visibleBinCount: number;
}

const UNIT_QUAD_TRIANGLES = new Float32Array([
  0, 0,
  1, 0,
  0, 1,
  0, 1,
  1, 0,
  1, 1,
]);

const DEFAULT_THEME = {
  backgroundColor: [0.976, 0.98, 0.988, 1],
  defaultBarColor: [0.12, 0.42, 0.68, 0.92],
  gridLineColor: [0.72, 0.76, 0.82, 0.34],
  hoverOverlayColor: [0.04, 0.08, 0.12, 0.22],
  outOfRangeMarkerColor: [0.545, 0.361, 0.965, 0.82],
  selectedOverlayColor: [0.98, 0.72, 0.08, 0.95],
  subplotBackgroundColor: [1, 1, 1, 1],
} as const satisfies Required<HistogramRendererTheme>;

const AXIS_GRID_LINE_COUNT = 4;
const BAR_MIN_WIDTH_CSS_PX = 0.75;
const GRID_LINE_WIDTH_CSS_PX = 1;
const OUT_OF_RANGE_EDGE_INSET_CSS_PX = 3;
const OUT_OF_RANGE_EDGE_MARKER_LONG_CSS_PX = 24;
const OUT_OF_RANGE_EDGE_MARKER_SHORT_CSS_PX = 4;
const OUT_OF_RANGE_Y_MARKER_WIDTH_CSS_PX = 10;
const SEPARATOR_LINE_WIDTH_CSS_PX = 1;

const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_corner;
in vec4 a_rect;
in vec4 a_color;
uniform vec2 u_canvasSize;
out vec4 v_color;

void main() {
  vec2 pixel = a_rect.xy + a_corner * a_rect.zw;
  vec2 clip = vec2(
    (pixel.x / u_canvasSize.x) * 2.0 - 1.0,
    1.0 - (pixel.y / u_canvasSize.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  v_color = a_color;
}`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 outColor;

void main() {
  outColor = v_color;
}`;

export class HistogramWebglRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly colorBuffer: WebGLBuffer;
  private readonly gl: WebGL2RenderingContext;
  private readonly gpuTimer: HistogramGpuTimer;
  private readonly program: HistogramGlProgram;
  private readonly rectBuffer: WebGLBuffer;
  private readonly unitQuadBuffer: WebGLBuffer;
  private readonly vao: WebGLVertexArrayObject;
  private buffersDirty = true;
  private currentBuffers: HistogramRendererBuffers | null = null;
  private devicePixelRatio: number;
  private disposed = false;
  private hoverBin: HistogramRendererHoverBin | null;
  private onMetrics?: (metrics: HistogramMetricsEvent) => void;
  private options: HistogramRendererBufferBuildInput;
  private selectedBinKeys: readonly string[];

  constructor({
    canvas,
    devicePixelRatio,
    onMetrics,
    preserveDrawingBuffer = false,
    ...options
  }: HistogramWebglRendererOptions) {
    this.canvas = canvas;
    this.options = options;
    this.hoverBin = options.hoverBin ?? null;
    this.selectedBinKeys = options.selectedBinKeys ?? [];
    this.devicePixelRatio = normalizeDevicePixelRatio(devicePixelRatio);
    this.onMetrics = onMetrics;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer,
    });

    if (gl === null) {
      throw new Error('WebGL2 is unavailable for histogram rendering.');
    }

    this.gl = gl;
    const setupStartedAt = now();
    this.program = createHistogramProgram(gl);
    this.gpuTimer = createHistogramGpuTimer(gl);
    this.unitQuadBuffer = createRequiredBuffer(
      gl,
      'histogram unit quad buffer',
    );
    this.rectBuffer = createRequiredBuffer(gl, 'histogram rect buffer');
    this.colorBuffer = createRequiredBuffer(gl, 'histogram color buffer');
    this.vao = createRequiredVertexArray(gl, 'histogram vertex array');

    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, UNIT_QUAD_TRIANGLES, gl.STATIC_DRAW);
    this.configureVertexArray();
    this.syncCanvasSize();

    this.emitMetrics({
      binCount: options.aggregation.metrics.binCount,
      colorSegmentCount: options.aggregation.metrics.colorSegmentCount,
      durationMs: now() - setupStartedAt,
      gpuTimerSupported: this.gpuTimer.supported,
      mode: options.aggregation.mode,
      phase: 'init',
      pointCount: options.aggregation.pointCount,
      stackSegmentCount: options.aggregation.metrics.colorSegmentCount,
      subplotCount: options.aggregation.subplots.length,
      detail: JSON.stringify({
        fragmentCompileMs: this.program.metrics.fragmentCompileMs,
        gpuTimerSupported: this.gpuTimer.supported,
        linkMs: this.program.metrics.linkMs,
        shaderCompileMs: this.program.metrics.shaderCompileMs,
        vertexCompileMs: this.program.metrics.vertexCompileMs,
      }),
    });
    this.emitAggregationMetrics(options.aggregation);
  }

  update(update: HistogramRendererUpdate): void {
    if (this.disposed) {
      return;
    }

    const aggregationChanged =
      update.aggregation !== undefined &&
      update.aggregation !== this.options.aggregation;
    const layoutChanged =
      update.layout !== undefined && update.layout !== this.options.layout;
    const viewportChanged =
      update.viewport !== undefined && update.viewport !== this.options.viewport;
    const themeChanged =
      update.theme !== undefined && update.theme !== this.options.theme;
    const hoverChanged =
      update.hoverBin !== undefined &&
      !sameHoverBin(update.hoverBin, this.hoverBin);
    const selectedBinsChanged =
      update.selectedBinKeys !== undefined &&
      !sameSelectedBinKeys(update.selectedBinKeys, this.selectedBinKeys);
    const devicePixelRatioChanged =
      update.devicePixelRatio !== undefined &&
      normalizeDevicePixelRatio(update.devicePixelRatio) !== this.devicePixelRatio;

    this.options = {
      aggregation: update.aggregation ?? this.options.aggregation,
      hoverBin: update.hoverBin === undefined ? this.hoverBin : update.hoverBin,
      layout: update.layout ?? this.options.layout,
      selectedBinKeys:
        update.selectedBinKeys === undefined
          ? this.selectedBinKeys
          : update.selectedBinKeys,
      theme: update.theme ?? this.options.theme,
      viewport: update.viewport ?? this.options.viewport,
    };
    if (update.hoverBin !== undefined) {
      this.hoverBin = update.hoverBin;
    }
    if (update.selectedBinKeys !== undefined) {
      this.selectedBinKeys = update.selectedBinKeys;
    }
    if (update.devicePixelRatio !== undefined) {
      this.devicePixelRatio = normalizeDevicePixelRatio(update.devicePixelRatio);
    }

    if (aggregationChanged) {
      this.emitAggregationMetrics(this.options.aggregation);
    }

    if (layoutChanged || devicePixelRatioChanged) {
      this.syncCanvasSize();
    }

    if (
      aggregationChanged ||
      layoutChanged ||
      viewportChanged ||
      themeChanged ||
      hoverChanged ||
      selectedBinsChanged
    ) {
      this.buffersDirty = true;
    }
  }

  render(): HistogramRendererRenderMetrics | null {
    if (
      this.disposed ||
      this.options.layout.widthCssPx <= 0 ||
      this.options.layout.heightCssPx <= 0 ||
      this.gl.isContextLost()
    ) {
      return null;
    }

    this.syncCanvasSize();
    const previousGpuDurationMs = this.gpuTimer.poll();
    const startedAt = now();
    const gl = this.gl;
    const buffers = this.uploadBuffersIfNeeded();
    const theme = resolveHistogramRendererTheme(this.options.theme);

    this.gpuTimer.begin();
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(...theme.backgroundColor);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program.program);
    gl.uniform2f(
      this.program.uniforms.canvasSize,
      this.options.layout.widthCssPx,
      this.options.layout.heightCssPx,
    );
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, buffers.metrics.instanceCount);
    gl.bindVertexArray(null);
    gl.useProgram(null);
    this.gpuTimer.end();

    const durationMs = now() - startedAt;
    const metrics: HistogramRendererRenderMetrics = {
      drawCalls: buffers.metrics.instanceCount > 0 ? 1 : 0,
      durationMs,
      gpuDurationMs: previousGpuDurationMs,
      gpuTimerSupported: this.gpuTimer.supported,
      instanceCount: buffers.metrics.instanceCount,
      uploadBytes: buffers.metrics.uploadBytes,
      visibleBinCount: buffers.metrics.visibleBinCount,
    };

    this.emitMetrics({
      binCount: this.options.aggregation.metrics.binCount,
      colorSegmentCount: this.options.aggregation.metrics.colorSegmentCount,
      drawCalls: metrics.drawCalls,
      durationMs,
      gpuDurationMs: previousGpuDurationMs,
      gpuTimerSupported: this.gpuTimer.supported,
      mode: this.options.aggregation.mode,
      phase: 'render',
      pointCount: this.options.aggregation.pointCount,
      selectedBinCount: buffers.metrics.selectedBinCount,
      selectedSourceCount: buffers.metrics.selectedSourceCount,
      stackSegmentCount: buffers.metrics.stackSegmentCount,
      subplotCount: this.options.aggregation.subplots.length,
      uploadBytes: buffers.metrics.uploadBytes,
      visibleBinCount: buffers.metrics.visibleBinCount,
      detail: JSON.stringify({
        backgroundInstanceCount: buffers.metrics.backgroundInstanceCount,
        barInstanceCount: buffers.metrics.barInstanceCount,
        gridInstanceCount: buffers.metrics.gridInstanceCount,
        instanceCount: buffers.metrics.instanceCount,
        overlayInstanceCount: buffers.metrics.overlayInstanceCount,
        outOfRangeMarkerInstanceCount:
          buffers.metrics.outOfRangeMarkerInstanceCount,
        separatorInstanceCount: buffers.metrics.separatorInstanceCount,
      }),
    });

    return metrics;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    const gl = this.gl;
    this.gpuTimer.dispose();
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.unitQuadBuffer);
    gl.deleteBuffer(this.rectBuffer);
    gl.deleteBuffer(this.colorBuffer);
    gl.deleteProgram(this.program.program);
    this.currentBuffers = null;
    this.emitMetrics({ phase: 'dispose' });
  }

  private configureVertexArray(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuadBuffer);
    gl.enableVertexAttribArray(this.program.attributes.corner);
    gl.vertexAttribPointer(
      this.program.attributes.corner,
      2,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.program.attributes.corner, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectBuffer);
    gl.enableVertexAttribArray(this.program.attributes.rect);
    gl.vertexAttribPointer(
      this.program.attributes.rect,
      4,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.program.attributes.rect, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.enableVertexAttribArray(this.program.attributes.color);
    gl.vertexAttribPointer(
      this.program.attributes.color,
      4,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.program.attributes.color, 1);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  private uploadBuffersIfNeeded(): HistogramRendererBuffers {
    if (!this.buffersDirty && this.currentBuffers !== null) {
      return this.currentBuffers;
    }

    const startedAt = now();
    const buffers = buildHistogramRendererBuffers({
      ...this.options,
      hoverBin: this.hoverBin,
      selectedBinKeys: this.selectedBinKeys,
    });
    const gl = this.gl;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, buffers.rects, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, buffers.colors, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.currentBuffers = buffers;
    this.buffersDirty = false;
    this.emitMetrics({
      binCount: this.options.aggregation.metrics.binCount,
      colorSegmentCount: this.options.aggregation.metrics.colorSegmentCount,
      durationMs: now() - startedAt,
      mode: this.options.aggregation.mode,
      phase: 'buffer-upload',
      pointCount: this.options.aggregation.pointCount,
      selectedBinCount: buffers.metrics.selectedBinCount,
      selectedSourceCount: buffers.metrics.selectedSourceCount,
      stackSegmentCount: buffers.metrics.stackSegmentCount,
      subplotCount: this.options.aggregation.subplots.length,
      uploadBytes: buffers.metrics.uploadBytes,
      visibleBinCount: buffers.metrics.visibleBinCount,
      detail: JSON.stringify({
        backgroundInstanceCount: buffers.metrics.backgroundInstanceCount,
        barInstanceCount: buffers.metrics.barInstanceCount,
        gridInstanceCount: buffers.metrics.gridInstanceCount,
        instanceCount: buffers.metrics.instanceCount,
        overlayInstanceCount: buffers.metrics.overlayInstanceCount,
        outOfRangeMarkerInstanceCount:
          buffers.metrics.outOfRangeMarkerInstanceCount,
        separatorInstanceCount: buffers.metrics.separatorInstanceCount,
      }),
    });

    return buffers;
  }

  private syncCanvasSize(): void {
    const width = Math.max(
      1,
      Math.floor(this.options.layout.widthCssPx * this.devicePixelRatio),
    );
    const height = Math.max(
      1,
      Math.floor(this.options.layout.heightCssPx * this.devicePixelRatio),
    );

    if (this.canvas.width !== width) {
      this.canvas.width = width;
    }
    if (this.canvas.height !== height) {
      this.canvas.height = height;
    }
  }

  private emitMetrics(metrics: Omit<HistogramMetricsEvent, 'at'>): void {
    this.onMetrics?.({
      at: now(),
      ...metrics,
    });
  }

  private emitAggregationMetrics(aggregation: HistogramAggregationSet): void {
    this.emitMetrics({
      aggregateBuildMs: aggregation.metrics.aggregateBuildMs,
      binCount: aggregation.metrics.binCount,
      colorSegmentCount: aggregation.metrics.colorSegmentCount,
      detail: JSON.stringify({
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

export function buildHistogramRendererBuffers({
  aggregation,
  hoverBin,
  layout,
  selectedBinKeys,
  theme,
  viewport,
}: HistogramRendererBufferBuildInput): HistogramRendererBuffers {
  const resolvedTheme = resolveHistogramRendererTheme(theme);
  const selectedBinKeySet =
    selectedBinKeys === undefined || selectedBinKeys.length === 0
      ? null
      : new Set(selectedBinKeys);
  const rects: number[] = [];
  const colors: number[] = [];
  const metrics: MutableBufferMetrics = {
    backgroundInstanceCount: 0,
    barInstanceCount: 0,
    gridInstanceCount: 0,
    overlayInstanceCount: 0,
    outOfRangeMarkerInstanceCount: 0,
    separatorInstanceCount: 0,
    selectedBinCount: 0,
    selectedSourceCount: 0,
    stackSegmentCount: 0,
    visibleBinCount: 0,
  };

  for (const plotRect of layout.plotRects) {
    const subplot = findHistogramSubplot(aggregation.subplots, plotRect.id);
    const subplotViewport = viewport.subplotById[plotRect.id];
    if (subplot === null || subplotViewport === undefined) {
      continue;
    }

    addRectInstance(rects, colors, plotRect, resolvedTheme.subplotBackgroundColor);
    metrics.backgroundInstanceCount += 1;
    addGridInstances(rects, colors, plotRect, resolvedTheme.gridLineColor, metrics);
    addBarInstances({
      colors,
      hoverBin,
      metrics,
      plotRect,
      rects,
      selectedBinKeySet,
      subplot,
      theme: resolvedTheme,
      viewport: subplotViewport,
    });
    addOutOfRangeMarkerInstances({
      colors,
      metrics,
      plotRect,
      rects,
      subplot,
      theme: resolvedTheme,
      viewport: subplotViewport,
    });
  }

  const rectBuffer = new Float32Array(rects);
  const colorBuffer = new Float32Array(colors);
  const uploadBytes = rectBuffer.byteLength + colorBuffer.byteLength;

  return {
    colors: colorBuffer,
    metrics: {
      ...metrics,
      instanceCount: rectBuffer.length / 4,
      uploadBytes,
    },
    rects: rectBuffer,
  };
}

export function resolveHistogramRendererTheme(
  theme: HistogramRendererTheme | undefined,
): Required<HistogramRendererTheme> {
  return {
    backgroundColor: normalizeColor(
      theme?.backgroundColor,
      DEFAULT_THEME.backgroundColor,
    ),
    defaultBarColor: normalizeColor(
      theme?.defaultBarColor,
      DEFAULT_THEME.defaultBarColor,
    ),
    gridLineColor: normalizeColor(
      theme?.gridLineColor,
      DEFAULT_THEME.gridLineColor,
    ),
    hoverOverlayColor: normalizeColor(
      theme?.hoverOverlayColor,
      DEFAULT_THEME.hoverOverlayColor,
    ),
    outOfRangeMarkerColor: normalizeColor(
      theme?.outOfRangeMarkerColor,
      DEFAULT_THEME.outOfRangeMarkerColor,
    ),
    selectedOverlayColor: normalizeColor(
      theme?.selectedOverlayColor,
      DEFAULT_THEME.selectedOverlayColor,
    ),
    subplotBackgroundColor: normalizeColor(
      theme?.subplotBackgroundColor,
      DEFAULT_THEME.subplotBackgroundColor,
    ),
  };
}

function addBarInstances(input: {
  readonly colors: number[];
  readonly hoverBin?: HistogramRendererHoverBin | null;
  readonly metrics: MutableBufferMetrics;
  readonly plotRect: HistogramPlotRect;
  readonly rects: number[];
  readonly selectedBinKeySet: ReadonlySet<string> | null;
  readonly subplot: HistogramSubplotBins;
  readonly theme: Required<HistogramRendererTheme>;
  readonly viewport: HistogramViewport['subplotById'][string];
}): void {
  for (let binIndex = 0; binIndex < input.subplot.bins.length; binIndex += 1) {
    const bin = input.subplot.bins[binIndex];
    if (bin === undefined || bin.totalCount <= 0) {
      continue;
    }

    const xRange = clipRange(
      bin.descriptor.min,
      bin.descriptor.max,
      input.viewport.x.min,
      input.viewport.x.max,
    );
    if (xRange === null) {
      continue;
    }

    const selectedCount = normalizeSelectedCount(bin.selectedCount, bin.totalCount);
    const selectedByKey =
      input.selectedBinKeySet?.has(createHistogramBinKey(bin.descriptor)) ?? false;
    if (selectedCount > 0 || selectedByKey) {
      input.metrics.selectedBinCount += 1;
      input.metrics.selectedSourceCount += selectedByKey
        ? bin.totalCount
        : selectedCount;
    }

    const beforeBarInstances = input.metrics.barInstanceCount;
    const stack = createRenderableStack(bin);
    const renderedSegmentRects: HistogramPlotRect[] = [];
    const renderedSegmentColors: HistogramRendererColor[] = [];

    for (const segment of stack) {
      const segmentRect = axisRectToCssRect({
        axisXMax: xRange.max,
        axisXMin: xRange.min,
        axisYMax: segment.endCount,
        axisYMin: segment.startCount,
        plotRect: input.plotRect,
        viewport: input.viewport,
      });
      if (segmentRect === null) {
        continue;
      }

      const fillColor =
        segment.color === null
          ? input.theme.defaultBarColor
          : packedRgba32ToColor(segment.color);
      addRectInstance(
        input.rects,
        input.colors,
        segmentRect,
        fillColor,
      );
      input.metrics.barInstanceCount += 1;
      input.metrics.stackSegmentCount += 1;
      renderedSegmentRects.push(segmentRect);
      renderedSegmentColors.push(fillColor);
    }

    if (input.metrics.barInstanceCount > beforeBarInstances) {
      input.metrics.visibleBinCount += 1;
      addBarSeparators(
        input.rects,
        input.colors,
        renderedSegmentRects,
        renderedSegmentColors,
        input.metrics,
      );
      addSelectedOverlay(
        input,
        bin,
        xRange.min,
        xRange.max,
        selectedByKey ? bin.totalCount : selectedCount,
      );
      addHoverOverlay(input, bin, binIndex, xRange.min, xRange.max);
    }
  }
}

function addOutOfRangeMarkerInstances(input: {
  readonly colors: number[];
  readonly metrics: MutableBufferMetrics;
  readonly plotRect: HistogramPlotRect;
  readonly rects: number[];
  readonly subplot: HistogramSubplotBins;
  readonly theme: Required<HistogramRendererTheme>;
  readonly viewport: HistogramViewport['subplotById'][string];
}): void {
  let hasLeftOverflow =
    input.subplot.domain !== undefined &&
    input.subplot.domain.min < input.viewport.x.min;
  let hasRightOverflow =
    input.subplot.domain !== undefined &&
    input.subplot.domain.max > input.viewport.x.max;

  for (const bin of input.subplot.bins) {
    if (bin.totalCount <= 0) {
      continue;
    }

    if (bin.descriptor.min < input.viewport.x.min) {
      hasLeftOverflow = true;
    }
    if (bin.descriptor.max > input.viewport.x.max) {
      hasRightOverflow = true;
    }
    if (
      bin.descriptor.max > input.viewport.x.min &&
      bin.descriptor.min < input.viewport.x.max
    ) {
      addVerticalOutOfRangeMarkers(input, bin);
    }
  }

  if (hasLeftOverflow) {
    addEdgeOutOfRangeMarker(input, 'left');
  }
  if (hasRightOverflow) {
    addEdgeOutOfRangeMarker(input, 'right');
  }
}

function addVerticalOutOfRangeMarkers(
  input: {
    readonly colors: number[];
    readonly metrics: MutableBufferMetrics;
    readonly plotRect: HistogramPlotRect;
    readonly rects: number[];
    readonly theme: Required<HistogramRendererTheme>;
    readonly viewport: HistogramViewport['subplotById'][string];
  },
  bin: HistogramBin,
): void {
  const xRange = clipRange(
    bin.descriptor.min,
    bin.descriptor.max,
    input.viewport.x.min,
    input.viewport.x.max,
  );
  if (xRange === null) {
    return;
  }

  const x0 = histogramAxisToPixel(
    xRange.min,
    input.viewport.x,
    input.plotRect.xCssPx,
    input.plotRect.xCssPx + input.plotRect.widthCssPx,
  );
  const x1 = histogramAxisToPixel(
    xRange.max,
    input.viewport.x,
    input.plotRect.xCssPx,
    input.plotRect.xCssPx + input.plotRect.widthCssPx,
  );
  const markerWidth = Math.min(
    OUT_OF_RANGE_Y_MARKER_WIDTH_CSS_PX,
    Math.max(BAR_MIN_WIDTH_CSS_PX, x1 - x0),
  );
  const xCenter = clamp(
    (x0 + x1) / 2,
    input.plotRect.xCssPx,
    input.plotRect.xCssPx + input.plotRect.widthCssPx,
  );
  const xCssPx = clamp(
    xCenter - markerWidth / 2,
    input.plotRect.xCssPx,
    input.plotRect.xCssPx + input.plotRect.widthCssPx - markerWidth,
  );

  if (bin.totalCount > input.viewport.y.max) {
    addOutOfRangeMarkerRect(input, {
      heightCssPx: OUT_OF_RANGE_EDGE_MARKER_SHORT_CSS_PX,
      id: input.plotRect.id,
      widthCssPx: markerWidth,
      xCssPx,
      yCssPx: input.plotRect.yCssPx + OUT_OF_RANGE_EDGE_INSET_CSS_PX,
    });
  }

  if (input.viewport.y.min > 0 && bin.totalCount > input.viewport.y.min) {
    addOutOfRangeMarkerRect(input, {
      heightCssPx: OUT_OF_RANGE_EDGE_MARKER_SHORT_CSS_PX,
      id: input.plotRect.id,
      widthCssPx: markerWidth,
      xCssPx,
      yCssPx:
        input.plotRect.yCssPx +
        input.plotRect.heightCssPx -
        OUT_OF_RANGE_EDGE_INSET_CSS_PX -
        OUT_OF_RANGE_EDGE_MARKER_SHORT_CSS_PX,
    });
  }
}

function addEdgeOutOfRangeMarker(
  input: {
    readonly colors: number[];
    readonly metrics: MutableBufferMetrics;
    readonly plotRect: HistogramPlotRect;
    readonly rects: number[];
    readonly theme: Required<HistogramRendererTheme>;
  },
  side: 'left' | 'right',
): void {
  const markerHeight = Math.min(
    OUT_OF_RANGE_EDGE_MARKER_LONG_CSS_PX,
    input.plotRect.heightCssPx,
  );
  const markerWidth = Math.min(
    OUT_OF_RANGE_EDGE_MARKER_SHORT_CSS_PX,
    input.plotRect.widthCssPx,
  );
  const xCssPx =
    side === 'left'
      ? input.plotRect.xCssPx + OUT_OF_RANGE_EDGE_INSET_CSS_PX
      : input.plotRect.xCssPx +
        input.plotRect.widthCssPx -
        OUT_OF_RANGE_EDGE_INSET_CSS_PX -
        markerWidth;

  addOutOfRangeMarkerRect(input, {
    heightCssPx: markerHeight,
    id: input.plotRect.id,
    widthCssPx: markerWidth,
    xCssPx,
    yCssPx:
      input.plotRect.yCssPx + input.plotRect.heightCssPx / 2 - markerHeight / 2,
  });
}

function addOutOfRangeMarkerRect(
  input: {
    readonly colors: number[];
    readonly metrics: MutableBufferMetrics;
    readonly rects: number[];
    readonly theme: Required<HistogramRendererTheme>;
  },
  rect: HistogramPlotRect,
): void {
  const beforeLength = input.rects.length;
  addRectInstance(
    input.rects,
    input.colors,
    rect,
    input.theme.outOfRangeMarkerColor,
  );
  if (input.rects.length > beforeLength) {
    input.metrics.outOfRangeMarkerInstanceCount += 1;
  }
}

function createRenderableStack(
  bin: HistogramBin,
): readonly {
  readonly color: number | null;
  readonly endCount: number;
  readonly startCount: number;
}[] {
  if (bin.stack.length === 0) {
    return [{ color: null, endCount: bin.totalCount, startCount: 0 }];
  }

  const stack: {
    color: number | null;
    endCount: number;
    startCount: number;
  }[] = bin.stack.map((segment) => ({
    color: segment.color,
    endCount: Math.min(bin.totalCount, segment.endCount),
    startCount: Math.max(0, segment.startCount),
  }));
  const lastEndCount = stack.at(-1)?.endCount ?? 0;
  if (lastEndCount < bin.totalCount) {
    stack.push({
      color: null,
      endCount: bin.totalCount,
      startCount: lastEndCount,
    });
  }

  return stack;
}

function addSelectedOverlay(
  input: {
    readonly colors: number[];
    readonly metrics: MutableBufferMetrics;
    readonly plotRect: HistogramPlotRect;
    readonly rects: number[];
    readonly theme: Required<HistogramRendererTheme>;
    readonly viewport: HistogramViewport['subplotById'][string];
  },
  bin: HistogramBin,
  axisXMin: number,
  axisXMax: number,
  selectedCount: number,
): void {
  if (selectedCount <= 0 || bin.totalCount <= 0) {
    return;
  }

  const overlayRect = axisRectToCssRect({
    axisXMax,
    axisXMin,
    axisYMax: selectedCount,
    axisYMin: 0,
    plotRect: input.plotRect,
    viewport: input.viewport,
  });
  if (overlayRect === null) {
    return;
  }

  addRectInstance(
    input.rects,
    input.colors,
    overlayRect,
    input.theme.selectedOverlayColor,
  );
  input.metrics.overlayInstanceCount += 1;
}

function addHoverOverlay(
  input: {
    readonly colors: number[];
    readonly hoverBin?: HistogramRendererHoverBin | null;
    readonly metrics: MutableBufferMetrics;
    readonly plotRect: HistogramPlotRect;
    readonly rects: number[];
    readonly subplot: HistogramSubplotBins;
    readonly theme: Required<HistogramRendererTheme>;
    readonly viewport: HistogramViewport['subplotById'][string];
  },
  bin: HistogramBin,
  binIndex: number,
  axisXMin: number,
  axisXMax: number,
): void {
  const isHovered =
    bin.hovered === true ||
    (input.hoverBin?.subplotId === input.subplot.subplotId &&
      input.hoverBin.binIndex === binIndex);
  if (!isHovered) {
    return;
  }

  const overlayRect = axisRectToCssRect({
    axisXMax,
    axisXMin,
    axisYMax: bin.totalCount,
    axisYMin: 0,
    plotRect: input.plotRect,
    viewport: input.viewport,
  });
  if (overlayRect === null) {
    return;
  }

  addRectInstance(
    input.rects,
    input.colors,
    overlayRect,
    input.theme.hoverOverlayColor,
  );
  input.metrics.overlayInstanceCount += 1;
}

function addGridInstances(
  rects: number[],
  colors: number[],
  plotRect: HistogramPlotRect,
  color: HistogramRendererColor,
  metrics: MutableBufferMetrics,
): void {
  const bottom = plotRect.yCssPx + plotRect.heightCssPx;
  for (let index = 0; index <= AXIS_GRID_LINE_COUNT; index += 1) {
    const y =
      plotRect.yCssPx +
      (index / AXIS_GRID_LINE_COUNT) * plotRect.heightCssPx -
      GRID_LINE_WIDTH_CSS_PX / 2;
    addRectInstance(
      rects,
      colors,
      {
        heightCssPx: GRID_LINE_WIDTH_CSS_PX,
        id: plotRect.id,
        widthCssPx: plotRect.widthCssPx,
        xCssPx: plotRect.xCssPx,
        yCssPx: clamp(y, plotRect.yCssPx, bottom - GRID_LINE_WIDTH_CSS_PX),
      },
      color,
    );
    metrics.gridInstanceCount += 1;
  }
}

function addBarSeparators(
  rects: number[],
  colors: number[],
  segmentRects: readonly HistogramPlotRect[],
  segmentColors: readonly HistogramRendererColor[],
  metrics: MutableBufferMetrics,
): void {
  for (let index = 0; index < segmentRects.length; index += 1) {
    const segmentRect = segmentRects[index];
    const segmentColor = segmentColors[index];
    if (segmentRect === undefined || segmentColor === undefined) {
      continue;
    }

    const separatorColor = createSeparatorColor(segmentColor);
    const verticalSeparatorWidth = Math.min(
      SEPARATOR_LINE_WIDTH_CSS_PX,
      segmentRect.widthCssPx,
    );
    if (segmentRect.widthCssPx > verticalSeparatorWidth) {
      addRectInstance(
        rects,
        colors,
        {
          heightCssPx: segmentRect.heightCssPx,
          id: segmentRect.id,
          widthCssPx: verticalSeparatorWidth,
          xCssPx:
            segmentRect.xCssPx + segmentRect.widthCssPx - verticalSeparatorWidth,
          yCssPx: segmentRect.yCssPx,
        },
        separatorColor,
      );
      metrics.separatorInstanceCount += 1;
    }

    const horizontalSeparatorHeight = Math.min(
      SEPARATOR_LINE_WIDTH_CSS_PX,
      segmentRect.heightCssPx,
    );
    if (segmentRect.heightCssPx > horizontalSeparatorHeight) {
      addRectInstance(
        rects,
        colors,
        {
          heightCssPx: horizontalSeparatorHeight,
          id: segmentRect.id,
          widthCssPx: segmentRect.widthCssPx,
          xCssPx: segmentRect.xCssPx,
          yCssPx: segmentRect.yCssPx,
        },
        separatorColor,
      );
      metrics.separatorInstanceCount += 1;
    }
  }
}

function axisRectToCssRect(input: {
  readonly axisXMax: number;
  readonly axisXMin: number;
  readonly axisYMax: number;
  readonly axisYMin: number;
  readonly plotRect: HistogramPlotRect;
  readonly viewport: HistogramViewport['subplotById'][string];
}): HistogramPlotRect | null {
  const yRange = clipRange(
    input.axisYMin,
    input.axisYMax,
    input.viewport.y.min,
    input.viewport.y.max,
  );
  if (yRange === null) {
    return null;
  }

  const x0 = histogramAxisToPixel(
    input.axisXMin,
    input.viewport.x,
    input.plotRect.xCssPx,
    input.plotRect.xCssPx + input.plotRect.widthCssPx,
  );
  const x1 = histogramAxisToPixel(
    input.axisXMax,
    input.viewport.x,
    input.plotRect.xCssPx,
    input.plotRect.xCssPx + input.plotRect.widthCssPx,
  );
  const y0 = histogramAxisToPixel(
    yRange.max,
    input.viewport.y,
    input.plotRect.yCssPx + input.plotRect.heightCssPx,
    input.plotRect.yCssPx,
  );
  const y1 = histogramAxisToPixel(
    yRange.min,
    input.viewport.y,
    input.plotRect.yCssPx + input.plotRect.heightCssPx,
    input.plotRect.yCssPx,
  );
  const width = Math.max(BAR_MIN_WIDTH_CSS_PX, x1 - x0);
  const height = y1 - y0;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    heightCssPx: height,
    id: input.plotRect.id,
    widthCssPx: width,
    xCssPx: x0,
    yCssPx: y0,
  };
}

function addRectInstance(
  rects: number[],
  colors: number[],
  rect: HistogramPlotRect,
  color: HistogramRendererColor,
): void {
  if (
    rect.widthCssPx <= 0 ||
    rect.heightCssPx <= 0 ||
    !Number.isFinite(rect.xCssPx) ||
    !Number.isFinite(rect.yCssPx)
  ) {
    return;
  }

  rects.push(rect.xCssPx, rect.yCssPx, rect.widthCssPx, rect.heightCssPx);
  colors.push(color[0], color[1], color[2], color[3]);
}

function clipRange(
  min: number,
  max: number,
  clipMin: number,
  clipMax: number,
): { readonly max: number; readonly min: number } | null {
  const normalizedMin = Math.min(min, max);
  const normalizedMax = Math.max(min, max);
  const clippedMin = Math.max(normalizedMin, clipMin);
  const clippedMax = Math.min(normalizedMax, clipMax);

  return clippedMax > clippedMin ? { max: clippedMax, min: clippedMin } : null;
}

function normalizeSelectedCount(
  selectedCount: number | undefined,
  totalCount: number,
): number {
  if (selectedCount === undefined || selectedCount <= 0 || totalCount <= 0) {
    return 0;
  }

  return Math.min(totalCount, Math.floor(selectedCount));
}

function createSeparatorColor(
  color: HistogramRendererColor,
): HistogramRendererColor {
  const luminance =
    color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;

  return luminance < 0.45 ? [1, 1, 1, 0.42] : [0.04, 0.08, 0.12, 0.26];
}

function findHistogramSubplot(
  subplots: readonly HistogramSubplotBins[],
  subplotId: string,
): HistogramSubplotBins | null {
  return subplots.find((subplot) => subplot.subplotId === subplotId) ?? null;
}

function packedRgba32ToColor(packed: number): HistogramRendererColor {
  return [
    ((packed >>> 24) & 0xff) / 255,
    ((packed >>> 16) & 0xff) / 255,
    ((packed >>> 8) & 0xff) / 255,
    (packed & 0xff) / 255,
  ];
}

function normalizeColor(
  color: HistogramRendererColor | undefined,
  fallback: HistogramRendererColor,
): HistogramRendererColor {
  if (color === undefined) {
    return fallback;
  }

  return [
    clamp(color[0], 0, 1),
    clamp(color[1], 0, 1),
    clamp(color[2], 0, 1),
    clamp(color[3], 0, 1),
  ];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function sameHoverBin(
  next: HistogramRendererHoverBin | null | undefined,
  current: HistogramRendererHoverBin | null,
): boolean {
  const normalizedNext = next ?? null;
  return (
    normalizedNext?.subplotId === current?.subplotId &&
    normalizedNext?.binIndex === current?.binIndex
  );
}

function sameSelectedBinKeys(
  next: readonly string[],
  current: readonly string[],
): boolean {
  if (next === current || next.length === current.length && next.every((value, index) => value === current[index])) {
    return true;
  }
  return false;
}

function createHistogramBinKey(descriptor: HistogramBin['descriptor']): string {
  return [
    descriptor.subplotId,
    descriptor.parameterKey,
    descriptor.index,
    descriptor.min,
    descriptor.max,
    descriptor.table ?? '',
    descriptor.source ?? '',
  ].join('\u0000');
}

function createHistogramProgram(gl: WebGL2RenderingContext): HistogramGlProgram {
  const vertexStartedAt = now();
  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    VERTEX_SHADER_SOURCE,
    'histogram vertex shader',
  );
  const vertexCompileMs = now() - vertexStartedAt;
  const fragmentStartedAt = now();
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    FRAGMENT_SHADER_SOURCE,
    'histogram fragment shader',
  );
  const fragmentCompileMs = now() - fragmentStartedAt;
  const linkStartedAt = now();
  const program = gl.createProgram();
  if (program === null) {
    throw new Error('Histogram WebGL2 program could not be allocated.');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'unknown link error';
    gl.deleteProgram(program);
    throw new Error(`Histogram WebGL2 program failed to link: ${message}`);
  }

  const linkMs = now() - linkStartedAt;
  const canvasSize = getRequiredUniform(gl, program, 'u_canvasSize');

  return {
    attributes: {
      color: getRequiredAttribute(gl, program, 'a_color'),
      corner: getRequiredAttribute(gl, program, 'a_corner'),
      rect: getRequiredAttribute(gl, program, 'a_rect'),
    },
    metrics: {
      fragmentCompileMs,
      linkMs,
      shaderCompileMs: vertexCompileMs + fragmentCompileMs,
      vertexCompileMs,
    },
    program,
    uniforms: {
      canvasSize,
    },
  };
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string,
  label: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new Error(`${label} could not be allocated.`);
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'unknown compile error';
    gl.deleteShader(shader);
    throw new Error(`${label} failed to compile: ${message}`);
  }

  return shader;
}

function getRequiredAttribute(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): number {
  const location = gl.getAttribLocation(program, name);
  if (location < 0) {
    throw new Error(`Histogram WebGL2 attribute "${name}" is missing.`);
  }

  return location;
}

function getRequiredUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (location === null) {
    throw new Error(`Histogram WebGL2 uniform "${name}" is missing.`);
  }

  return location;
}

function createRequiredBuffer(
  gl: WebGL2RenderingContext,
  label: string,
): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (buffer === null) {
    throw new Error(`${label} could not be allocated.`);
  }

  return buffer;
}

function createRequiredVertexArray(
  gl: WebGL2RenderingContext,
  label: string,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (vao === null) {
    throw new Error(`${label} could not be allocated.`);
  }

  return vao;
}

function createHistogramGpuTimer(gl: WebGL2RenderingContext): HistogramGpuTimer {
  const extension = gl.getExtension(
    'EXT_disjoint_timer_query_webgl2',
  ) as WebglTimerExtension | null;
  if (extension === null) {
    return {
      supported: false,
      begin: () => undefined,
      dispose: () => undefined,
      end: () => undefined,
      poll: () => undefined,
    };
  }

  let activeQuery: WebGLQuery | null = null;
  let pendingQuery: WebGLQuery | null = null;

  return {
    supported: true,
    begin: () => {
      if (activeQuery !== null || pendingQuery !== null) {
        return;
      }

      activeQuery = gl.createQuery();
      if (activeQuery !== null) {
        gl.beginQuery(extension.TIME_ELAPSED_EXT, activeQuery);
      }
    },
    dispose: () => {
      if (activeQuery !== null) {
        gl.deleteQuery(activeQuery);
        activeQuery = null;
      }
      if (pendingQuery !== null) {
        gl.deleteQuery(pendingQuery);
        pendingQuery = null;
      }
    },
    end: () => {
      if (activeQuery === null) {
        return;
      }

      gl.endQuery(extension.TIME_ELAPSED_EXT);
      pendingQuery = activeQuery;
      activeQuery = null;
    },
    poll: () => {
      if (pendingQuery === null) {
        return undefined;
      }

      const available = Boolean(
        gl.getQueryParameter(pendingQuery, gl.QUERY_RESULT_AVAILABLE),
      );
      const disjoint = Boolean(gl.getParameter(extension.GPU_DISJOINT_EXT));
      if (!available || disjoint) {
        return undefined;
      }

      const elapsedNs = Number(
        gl.getQueryParameter(pendingQuery, gl.QUERY_RESULT),
      );
      gl.deleteQuery(pendingQuery);
      pendingQuery = null;

      return Number.isFinite(elapsedNs) ? elapsedNs / 1_000_000 : undefined;
    },
  };
}

function normalizeDevicePixelRatio(value: number | undefined): number {
  if (value !== undefined && Number.isFinite(value) && value > 0) {
    return Math.min(4, value);
  }

  const globalPixelRatio = globalThis.devicePixelRatio;
  return typeof globalPixelRatio === 'number' &&
    Number.isFinite(globalPixelRatio) &&
    globalPixelRatio > 0
    ? Math.min(4, globalPixelRatio)
    : 1;
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}
