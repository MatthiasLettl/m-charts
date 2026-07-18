import {
  createFastScatterLayout,
  rectToDevicePixels,
  type FastScatterPlotRect,
} from './transforms.js';
import {
  resolveFastScatterAlphaPolicy,
  type FastScatterAlphaPolicy,
} from './alphaPolicy.js';
import { buildFastScatterAggregation } from './aggregation.js';
import { FAST_SCATTER_MAX_OPACITY_SCALE } from './opacityScale.js';
import {
  createFastScatterEasterEggColorArray,
  createFastScatterEasterEggPlayback,
  getFastScatterEasterEggTotalDurationMs,
  updateFastScatterEasterEggPositions,
  type FastScatterEasterEggPlayback,
} from './easterEgg.js';
import type {
  FastScatterAggregationSet,
  FastScatterAggregationRequest,
  FastScatterBubbleAggregationSet,
  FastScatterEasterEggPlaybackOptions,
  FastScatterHeatmapAggregationSet,
  FastScatterHeatmapPalette,
  FastScatterController,
  FastScatterControllerOptions,
  FastScatterMetricsEvent,
  FastScatterPlotSpec,
  FastScatterPointColumns,
  FastScatterRendererOptions,
  FastScatterTheme,
  FastScatterVisualizationMode,
} from './types.js';
import {
  createFastScatterBubbleProgram,
  createFastScatterHeatmapProgram,
  createFastScatterPointProgram,
  type FastScatterBubbleProgram,
  type FastScatterHeatmapProgram,
  type FastScatterPointProgram,
} from './webgl/programs.js';
import { createFastScatterGpuTimer, type FastScatterGpuTimer } from './webgl/timing.js';

export interface FastScatterWebglRendererOptions
  extends FastScatterRendererOptions {
  preserveDrawingBuffer?: boolean;
}

interface PlotBuffers {
  buffer: WebGLBuffer;
  plotId: string;
  vao: WebGLVertexArrayObject;
  yKey: string;
}

interface BubbleAggregateBuffers {
  colorBuffer: WebGLBuffer;
  hoveredBuffer: WebGLBuffer;
  instanceCount: number;
  plotId: string;
  radiusBuffer: WebGLBuffer;
  selectedFractionBuffer: WebGLBuffer;
  uploadBytes: number;
  vao: WebGLVertexArrayObject;
  xBuffer: WebGLBuffer;
  yBuffer: WebGLBuffer;
  yKey: string;
}

interface HeatmapAggregateBuffers {
  centerXBuffer: WebGLBuffer;
  centerYBuffer: WebGLBuffer;
  cellHeightPx: number;
  cellWidthPx: number;
  colorBuffer: WebGLBuffer;
  halfHeightAxisBuffer: WebGLBuffer;
  halfWidthAxisBuffer: WebGLBuffer;
  hoveredBuffer: WebGLBuffer;
  instanceCount: number;
  plotId: string;
  selectedFractionBuffer: WebGLBuffer;
  subtleBorderAlpha: number;
  uploadBytes: number;
  vao: WebGLVertexArrayObject;
  yKey: string;
}

interface AggregateUploadMetrics {
  aggregateBuildMs: number;
  aggregateDrawCalls: number;
  displayMode: 'bubble' | 'heatmap';
  totalAggregateCount: number;
  totalCellCount: number;
  totalPopulatedCellCount: number;
  totalVisiblePointCount: number;
  uploadBytes: number;
}

interface EasterEggBuffers {
  colorBuffer: WebGLBuffer;
  currentX: Float32Array;
  currentY: Float32Array;
  opacityBuffer: WebGLBuffer;
  pointCount: number;
  rotationBuffer: WebGLBuffer;
  shapeBuffer: WebGLBuffer;
  sizeBuffer: WebGLBuffer;
  uploadBytes: number;
  vao: WebGLVertexArrayObject;
  xBuffer: WebGLBuffer;
  yBuffer: WebGLBuffer;
}

interface EasterEggFrame {
  elapsedMs: number;
  item: FastScatterSubplotRenderPlanItem;
  playback: FastScatterEasterEggPlayback;
}

export interface FastScatterSubplotRenderPlanItem {
  bufferIndex: number;
  cssRect: FastScatterPlotRect;
  deviceRect: FastScatterPlotRect;
  plotId: string;
  sharedXRange: FastScatterControllerOptions['viewport']['x'];
  yKey: string;
  yRange: FastScatterControllerOptions['viewport']['yByPlot'][string];
}

export interface FastScatterSubplotRenderPlan {
  items: FastScatterSubplotRenderPlanItem[];
  plotAreaPx: number;
  sharedSourceBuffers: true;
  subplotCount: number;
}

export interface FastScatterSelectedMaskBuildResult {
  selectedPointCount: number;
}

const UNIT_QUAD_TRIANGLES = new Float32Array([
  -1, -1,
  1, -1,
  -1, 1,
  -1, 1,
  1, -1,
  1, 1,
]);
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
const DEFAULT_OPACITY = 1;
const DEFAULT_POINT_SIZE_PX = 4;
const DEFAULT_ROTATION_RADIANS = 0;
const DEFAULT_EASTER_EGG_COLOR_RGBA8: readonly [number, number, number, number] = [
  22,
  124,
  219,
  235,
];
const HEATMAP_PALETTES = {
  magma: [
    [0, 0, 4],
    [81, 18, 124],
    [183, 55, 121],
    [251, 136, 97],
    [252, 253, 191],
  ],
  turbo: [
    [48, 18, 59],
    [50, 101, 192],
    [40, 188, 235],
    [164, 252, 60],
    [251, 128, 34],
    [122, 4, 3],
  ],
  viridis: [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ],
} as const satisfies Record<
  Exclude<FastScatterHeatmapPalette, 'mono'>,
  readonly (readonly [number, number, number])[]
>;
const MIN_POINT_SIZE_SCALE = 0.1;
const MAX_POINT_SIZE_SCALE = 10;
const MIN_OPACITY_SCALE = 0.05;
const MAX_OPACITY_SCALE = FAST_SCATTER_MAX_OPACITY_SCALE;
const DEFAULT_HEATMAP_BIN_SIZE_PX = 12;
const BUBBLE_MIN_RADIUS_PX = 4;
const BUBBLE_COUNT_TWO_RADIUS_DELTA_PX = 0.75;
const BUBBLE_MAX_RADIUS_COUNT_STEP_PX = 3;
const BUBBLE_MAX_RADIUS_RATIO = 0.18;
const BUBBLE_MAX_RADIUS_CAP_PX = 56;
const BUBBLE_UNIFORM_COLOR_RGBA8: readonly [number, number, number, number] = [
  6,
  150,
  125,
  220,
];
const HEATMAP_BORDER_MIN_BIN_PX = 18;
const HEATMAP_LIGHT_BORDER_ALPHA = 0.16;
const HEATMAP_DARK_BORDER_ALPHA = 0.22;
const HOVER_OVERLAY_COLOR_LIGHT: readonly [number, number, number, number] = [
  0.08,
  0.12,
  0.18,
  0.95,
];
const HOVER_OVERLAY_COLOR_DARK: readonly [number, number, number, number] = [
  0.98,
  0.99,
  1,
  0.96,
];

export class FastScatterWebglRenderer implements FastScatterController {
  private readonly canvas: HTMLCanvasElement;
  private readonly bubbleProgram: FastScatterBubbleProgram;
  private readonly heatmapProgram: FastScatterHeatmapProgram;
  private readonly gl: WebGL2RenderingContext;
  private readonly gpuTimer: FastScatterGpuTimer;
  private readonly pointProgram: FastScatterPointProgram;
  private readonly colorBuffer: WebGLBuffer;
  private readonly opacityBuffer: WebGLBuffer;
  private readonly rotationBuffer: WebGLBuffer;
  private readonly shapeBuffer: WebGLBuffer;
  private readonly sizeBuffer: WebGLBuffer;
  private readonly selectedMaskTexture: WebGLTexture;
  private readonly unitQuadBuffer: WebGLBuffer;
  private readonly xBuffer: WebGLBuffer;
  private aggregateBuffersDirty = true;
  private bubbleBuffers: BubbleAggregateBuffers[] = [];
  private heatmapBuffers: HeatmapAggregateBuffers[] = [];
  private lastAggregation: FastScatterAggregationSet | null = null;
  private lastAggregateUploadMetrics: AggregateUploadMetrics | null = null;
  private plotBuffers: PlotBuffers[] = [];
  private options: FastScatterControllerOptions;
  private animationFrame = 0;
  private drawScheduledAt = 0;
  private disposed = false;
  private easterEggBuffers: EasterEggBuffers | null = null;
  private easterEggPlayback: FastScatterEasterEggPlayback | null = null;
  private firstCanvasRenderScheduleMs: number | null = null;
  private heightCssPx = 0;
  private hoverSourceIndex: number | null = null;
  private plotRects: FastScatterPlotRect[] = [];
  private lastRenderDrawCalls: number | undefined;
  private lastRenderSubplotCount: number | undefined;
  private selectedMask = new Uint8Array(1);
  private selectedMaskHeight = 1;
  private selectedMaskWidth = 1;
  private selectedPointCount = 0;
  private selectedSourceIndices?: Uint32Array;
  private widthCssPx = 0;

  constructor({
    canvas,
    preserveDrawingBuffer = false,
    ...options
  }: FastScatterWebglRendererOptions) {
    this.canvas = canvas;
    this.options = options;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer,
    });

    if (gl === null) {
      throw new Error('WebGL2 is unavailable in this browser.');
    }

    this.gl = gl;
    const setupStartedAt = performance.now();
    this.pointProgram = createFastScatterPointProgram(gl);
    this.bubbleProgram = createFastScatterBubbleProgram(gl);
    this.heatmapProgram = createFastScatterHeatmapProgram(gl);
    this.gpuTimer = createFastScatterGpuTimer(gl);
    this.emitMetrics({
      durationMs: performance.now() - setupStartedAt,
      gpuTimerSupported: this.gpuTimer.supported,
      phase: 'init',
      pointCount: options.columns.x.length,
      detail: JSON.stringify({
        bufferCreateCount: 7,
        fragmentCompileMs: {
          bubble: this.bubbleProgram.metrics.fragmentCompileMs,
          heatmap: this.heatmapProgram.metrics.fragmentCompileMs,
          points: this.pointProgram.metrics.fragmentCompileMs,
        },
        gpuTimerSupported: this.gpuTimer.supported,
        linkMs: {
          bubble: this.bubbleProgram.metrics.linkMs,
          heatmap: this.heatmapProgram.metrics.linkMs,
          points: this.pointProgram.metrics.linkMs,
        },
        shaderCompileMs: {
          bubble: this.bubbleProgram.metrics.shaderCompileMs,
          heatmap: this.heatmapProgram.metrics.shaderCompileMs,
          points: this.pointProgram.metrics.shaderCompileMs,
        },
        vertexCompileMs: {
          bubble: this.bubbleProgram.metrics.vertexCompileMs,
          heatmap: this.heatmapProgram.metrics.vertexCompileMs,
          points: this.pointProgram.metrics.vertexCompileMs,
        },
      }),
    });
    const xBuffer = gl.createBuffer();
    const colorBuffer = gl.createBuffer();
    const opacityBuffer = gl.createBuffer();
    const rotationBuffer = gl.createBuffer();
    const shapeBuffer = gl.createBuffer();
    const sizeBuffer = gl.createBuffer();
    const selectedMaskTexture = gl.createTexture();
    const unitQuadBuffer = gl.createBuffer();

    if (
      xBuffer === null ||
      colorBuffer === null ||
      opacityBuffer === null ||
      rotationBuffer === null ||
      shapeBuffer === null ||
      sizeBuffer === null ||
      selectedMaskTexture === null ||
      unitQuadBuffer === null
    ) {
      throw new Error('Fast scatter WebGL2 glyph buffers could not be allocated.');
    }

    this.xBuffer = xBuffer;
    this.colorBuffer = colorBuffer;
    this.opacityBuffer = opacityBuffer;
    this.rotationBuffer = rotationBuffer;
    this.shapeBuffer = shapeBuffer;
    this.sizeBuffer = sizeBuffer;
    this.selectedMaskTexture = selectedMaskTexture;
    this.unitQuadBuffer = unitQuadBuffer;
    this.hoverSourceIndex = normalizeHoverSourceIndex(
      options.hoverSourceIndex,
      options.columns.x.length,
    );
    this.selectedSourceIndices = options.selectedSourceIndices;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, UNIT_QUAD_TRIANGLES, gl.STATIC_DRAW);
    this.uploadColumnsWithMetrics(options.columns, options.spec);
    this.resizeSelectedMask(options.columns.x.length);
    this.updateSelectedMask(options.selectedSourceIndices ?? new Uint32Array(0));
  }

  update(options: Partial<FastScatterControllerOptions>): void {
    if (this.disposed) {
      return;
    }

    const columnsChanged =
      options.columns !== undefined && options.columns !== this.options.columns;
    const specChanged = options.spec !== undefined && options.spec !== this.options.spec;
    const focusedPlotChanged =
      options.focusedPlotId !== undefined &&
      options.focusedPlotId !== this.options.focusedPlotId;
    const selectionChanged =
      options.selectedSourceIndices !== undefined &&
      options.selectedSourceIndices !== this.selectedSourceIndices;
    const viewportChanged =
      options.viewport !== undefined && options.viewport !== this.options.viewport;
    const renderingModeChanged =
      options.renderingMode !== undefined &&
      options.renderingMode !== this.options.renderingMode;
    const visualizationModeChanged =
      options.visualizationMode !== undefined &&
      normalizeFastScatterVisualizationMode(options.visualizationMode) !==
        normalizeFastScatterVisualizationMode(this.options.visualizationMode);
    const heatmapBinSizeChanged =
      options.heatmapBinSizePx !== undefined &&
      normalizeFastScatterHeatmapBinSizePx(options.heatmapBinSizePx) !==
        normalizeFastScatterHeatmapBinSizePx(this.options.heatmapBinSizePx);
    const heatmapPaletteChanged =
      options.heatmapPalette !== undefined &&
      normalizeFastScatterHeatmapPalette(options.heatmapPalette) !==
        normalizeFastScatterHeatmapPalette(this.options.heatmapPalette);
    const aggregationChanged =
      options.aggregation !== undefined &&
      options.aggregation !== this.options.aggregation;
    const pointSizeScaleChanged =
      options.pointSizeScale !== undefined &&
      normalizeFastScatterPointSizeScale(options.pointSizeScale) !==
        normalizeFastScatterPointSizeScale(this.options.pointSizeScale);
    const opacityScaleChanged =
      options.opacityScale !== undefined &&
      normalizeFastScatterOpacityScale(options.opacityScale) !==
        normalizeFastScatterOpacityScale(this.options.opacityScale);
    const themeChanged =
      options.theme !== undefined && options.theme !== this.options.theme;
    const nextColumns = options.columns ?? this.options.columns;
    const hoverChanged =
      options.hoverSourceIndex !== undefined &&
      normalizeHoverSourceIndex(options.hoverSourceIndex, nextColumns.x.length) !==
        this.hoverSourceIndex;
    this.options = {
      ...this.options,
      ...options,
    };

    if (columnsChanged || specChanged) {
      this.deletePlotBuffers();
      this.deleteAggregateBuffers();
      this.uploadColumnsWithMetrics(this.options.columns, this.options.spec);
      this.resizeSelectedMask(this.options.columns.x.length);
      this.updateSelectedMask(this.selectedSourceIndices ?? new Uint32Array(0));
      this.hoverSourceIndex = normalizeHoverSourceIndex(
        this.options.hoverSourceIndex,
        this.options.columns.x.length,
      );
      this.aggregateBuffersDirty = true;
    }

    if (selectionChanged) {
      this.selectedSourceIndices = options.selectedSourceIndices;
      this.updateSelectedMask(options.selectedSourceIndices ?? new Uint32Array(0));
      this.aggregateBuffersDirty = true;
    }

    if (hoverChanged) {
      this.updateHoverSourceIndex(options.hoverSourceIndex ?? null);
    }

    if (specChanged || focusedPlotChanged) {
      this.updatePlotRects();
      this.aggregateBuffersDirty = true;
    }

    if (
      columnsChanged ||
      specChanged ||
      focusedPlotChanged ||
      selectionChanged ||
      viewportChanged ||
      renderingModeChanged ||
      visualizationModeChanged ||
      heatmapBinSizeChanged ||
      heatmapPaletteChanged ||
      aggregationChanged ||
      pointSizeScaleChanged ||
      opacityScaleChanged ||
      themeChanged
    ) {
      if (
        columnsChanged ||
        specChanged ||
        focusedPlotChanged ||
        selectionChanged ||
        viewportChanged ||
        visualizationModeChanged ||
        heatmapBinSizeChanged ||
        heatmapPaletteChanged ||
        aggregationChanged ||
        pointSizeScaleChanged ||
        themeChanged
      ) {
        this.aggregateBuffersDirty = true;
      }
      this.scheduleDraw();
    }
  }

  resize(
    widthCssPx: number,
    heightCssPx: number,
    devicePixelRatio: number,
  ): void {
    if (this.disposed) {
      return;
    }

    this.widthCssPx = Math.max(0, widthCssPx);
    this.heightCssPx = Math.max(0, heightCssPx);
    const pixelRatio = normalizeDevicePixelRatio(devicePixelRatio);
    const width =
      this.widthCssPx > 0 ? Math.max(1, Math.floor(this.widthCssPx * pixelRatio)) : 0;
    const height =
      this.heightCssPx > 0
        ? Math.max(1, Math.floor(this.heightCssPx * pixelRatio))
        : 0;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    this.updatePlotRects();
    this.aggregateBuffersDirty = true;
    this.scheduleDraw();
  }

  render(): void {
    if (this.disposed) {
      return;
    }

    this.draw();
  }

  getAggregation(): FastScatterAggregationSet | null {
    return this.lastAggregation;
  }

  playEasterEgg(options: FastScatterEasterEggPlaybackOptions = {}): boolean {
    if (this.disposed || this.easterEggPlayback !== null) {
      return false;
    }

    this.easterEggPlayback = createFastScatterEasterEggPlayback(options);
    this.scheduleDraw();
    return true;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    if (this.animationFrame !== 0) {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }

    const gl = this.gl;
    this.deletePlotBuffers();
    this.deleteAggregateBuffers();
    this.deleteEasterEggBuffers();
    gl.deleteBuffer(this.xBuffer);
    gl.deleteBuffer(this.colorBuffer);
    gl.deleteBuffer(this.opacityBuffer);
    gl.deleteBuffer(this.rotationBuffer);
    gl.deleteBuffer(this.shapeBuffer);
    gl.deleteBuffer(this.sizeBuffer);
    gl.deleteTexture(this.selectedMaskTexture);
    gl.deleteBuffer(this.unitQuadBuffer);
    gl.deleteProgram(this.pointProgram.program);
    gl.deleteProgram(this.bubbleProgram.program);
    gl.deleteProgram(this.heatmapProgram.program);
    this.emitMetrics({ phase: 'dispose' });
  }

  private uploadColumnsWithMetrics(
    columns: FastScatterPointColumns,
    spec: FastScatterPlotSpec,
  ): void {
    const startedAt = performance.now();
    this.uploadColumns(columns, spec);
    this.emitMetrics({
      durationMs: performance.now() - startedAt,
      phase: 'buffer-upload',
      pointCount: columns.x.length,
      detail: JSON.stringify({
        bufferCount: 6 + spec.plots.length + 1,
        uploadBytes: estimateUploadBytes(columns, spec),
        vaoCount: spec.plots.length,
        yBufferCount: spec.plots.length,
      }),
    });
  }

  private updatePlotRects(): void {
    this.plotRects =
      this.widthCssPx > 0 && this.heightCssPx > 0
        ? createFastScatterLayout(this.options.spec, {
            focusedPlotId: this.options.focusedPlotId,
            heightCssPx: this.heightCssPx,
            widthCssPx: this.widthCssPx,
          }).plotRects
        : [];
  }

  private uploadColumns(
    columns: FastScatterPointColumns,
    spec: FastScatterPlotSpec,
  ): void {
    const gl = this.gl;
    const pointCount = columns.x.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.xBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, toFloat32Array(columns.x), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      toRgba8Array(
        columns.color,
        columns.colorFormat,
        pointCount,
        this.options.theme?.defaultPointColor,
      ),
      gl.STATIC_DRAW,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, this.opacityBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      toFloat32Array(columns.opacity ?? createDefaultFloat32(pointCount, DEFAULT_OPACITY)),
      gl.STATIC_DRAW,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rotationBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      toFloat32Array(
        columns.rotation ?? createDefaultFloat32(pointCount, DEFAULT_ROTATION_RADIANS),
      ),
      gl.STATIC_DRAW,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shapeBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      columns.shape ?? createDefaultShapeCodes(pointCount),
      gl.STATIC_DRAW,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      toFloat32Array(columns.size ?? createDefaultFloat32(pointCount, DEFAULT_POINT_SIZE_PX)),
      gl.STATIC_DRAW,
    );

    this.plotBuffers = spec.plots.map((plot) => {
      const buffer = gl.createBuffer();
      const column = columns.y[plot.yKey];

      if (buffer === null) {
        throw new Error(`Fast scatter WebGL2 y buffer for ${plot.id} could not be allocated.`);
      }
      if (column === undefined) {
        gl.deleteBuffer(buffer);
        throw new Error(`Fast scatter y column "${plot.yKey}" is missing.`);
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, toFloat32Array(column), gl.STATIC_DRAW);

      return {
        buffer,
        plotId: plot.id,
        vao: this.createPlotVertexArray(buffer),
        yKey: plot.yKey,
      };
    });
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  private createPlotVertexArray(yBuffer: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (vao === null) {
      throw new Error('Fast scatter WebGL2 vertex array could not be allocated.');
    }

    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuadBuffer);
    gl.enableVertexAttribArray(this.pointProgram.attributes.corner);
    gl.vertexAttribPointer(
      this.pointProgram.attributes.corner,
      2,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.pointProgram.attributes.corner, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.xBuffer);
    gl.enableVertexAttribArray(this.pointProgram.attributes.x);
    gl.vertexAttribPointer(this.pointProgram.attributes.x, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.pointProgram.attributes.x, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.enableVertexAttribArray(this.pointProgram.attributes.color);
    gl.vertexAttribPointer(
      this.pointProgram.attributes.color,
      4,
      gl.UNSIGNED_BYTE,
      true,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.pointProgram.attributes.color, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.opacityBuffer);
    gl.enableVertexAttribArray(this.pointProgram.attributes.opacity);
    gl.vertexAttribPointer(
      this.pointProgram.attributes.opacity,
      1,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.pointProgram.attributes.opacity, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.rotationBuffer);
    gl.enableVertexAttribArray(this.pointProgram.attributes.rotation);
    gl.vertexAttribPointer(
      this.pointProgram.attributes.rotation,
      1,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.pointProgram.attributes.rotation, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.shapeBuffer);
    gl.enableVertexAttribArray(this.pointProgram.attributes.shape);
    gl.vertexAttribPointer(
      this.pointProgram.attributes.shape,
      1,
      gl.UNSIGNED_BYTE,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.pointProgram.attributes.shape, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer);
    gl.enableVertexAttribArray(this.pointProgram.attributes.size);
    gl.vertexAttribPointer(
      this.pointProgram.attributes.size,
      1,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.pointProgram.attributes.size, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, yBuffer);
    gl.enableVertexAttribArray(this.pointProgram.attributes.y);
    gl.vertexAttribPointer(
      this.pointProgram.attributes.y,
      1,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.pointProgram.attributes.y, 1);

    return vao;
  }

  private scheduleDraw(): void {
    if (this.animationFrame !== 0) {
      return;
    }

    this.drawScheduledAt = performance.now();
    this.animationFrame = window.requestAnimationFrame(() => {
      const scheduleMs = performance.now() - this.drawScheduledAt;
      if (this.firstCanvasRenderScheduleMs === null) {
        this.firstCanvasRenderScheduleMs = scheduleMs;
      }
      this.animationFrame = 0;
      this.draw();
    });
  }

  private draw(): void {
    if (
      this.widthCssPx <= 0 ||
      this.heightCssPx <= 0 ||
      this.canvas.width <= 0 ||
      this.canvas.height <= 0 ||
      this.gl.isContextLost()
    ) {
      return;
    }

    const startedAt = performance.now();
    const gl = this.gl;
    const pointCount = this.options.columns.x.length;
    const pixelRatio = normalizeDevicePixelRatio(this.canvas.width / this.widthCssPx);
    let drawCalls = 0;
    const previousGpuTiming = this.gpuTimer.poll();

    this.gpuTimer.begin();
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.scissor(0, 0, this.canvas.width, this.canvas.height);
    const theme = this.options.theme ?? DEFAULT_THEME;
    gl.clearColor(...theme.backgroundColor);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const renderPlan = createFastScatterSubplotRenderPlan({
      pixelRatio,
      plotBuffers: this.plotBuffers,
      plotRects: this.plotRects,
      viewport: this.options.viewport,
    });
    const easterEggFrame = this.createEasterEggFrame(renderPlan);
    const easterEggPlotId = easterEggFrame?.item.plotId ?? null;
    const userPointSizeScale = normalizeFastScatterPointSizeScale(
      this.options.pointSizeScale,
    );
    const userOpacityScale = normalizeFastScatterOpacityScale(this.options.opacityScale);
    const visualizationMode = normalizeFastScatterVisualizationMode(
      this.options.visualizationMode,
    );
    const aggregateMode =
      visualizationMode === 'points' ? null : visualizationMode;
    const alphaPolicy =
      aggregateMode === null || aggregateMode === 'bubble'
        ? resolveFastScatterAlphaPolicy({
            plotAreaPx: renderPlan.plotAreaPx,
            pointCount,
            requestedRenderingMode: this.options.renderingMode,
          })
        : null;
    const effectivePointSizeScale =
      alphaPolicy === null
        ? userPointSizeScale
        : userPointSizeScale * alphaPolicy.pointSizeScale;
    const effectiveOpacityScale =
      alphaPolicy === null
        ? userOpacityScale
        : userOpacityScale * alphaPolicy.alphaScale;
    let visiblePointCount = pointCount;
    let aggregateDrawCalls = 0;

    if (aggregateMode === null) {
      const pointAlphaPolicy = alphaPolicy;
      if (pointAlphaPolicy === null) {
        throw new Error('Fast scatter point render policy was not resolved.');
      }
      drawCalls = this.drawPoints({
        alphaPolicy: pointAlphaPolicy,
        clearBackground: true,
        effectivePointSizeScale,
        pixelRatio,
        pointCount,
        renderPlan,
        skipPlotId: easterEggPlotId,
        theme,
        userOpacityScale,
        userPointSizeScale,
      });
      if (easterEggFrame !== null) {
        drawCalls += this.drawEasterEgg(easterEggFrame, pixelRatio, theme);
      }
    } else {
      this.ensureAggregateBuffers(renderPlan, aggregateMode);
      if (aggregateMode === 'bubble') {
        clearSubplotBackgrounds(this.gl, this.canvas.height, renderPlan, theme);
        aggregateDrawCalls = this.drawBubbleAggregates({
          clearBackground: false,
          pixelRatio,
          renderPlan,
          skipPlotId: easterEggPlotId,
          theme,
          userOpacityScale,
        });
        drawCalls += aggregateDrawCalls;
        if (easterEggFrame !== null) {
          drawCalls += this.drawEasterEgg(easterEggFrame, pixelRatio, theme);
        }
      } else {
        aggregateDrawCalls = this.drawHeatmapAggregates({
          renderPlan,
          skipPlotId: easterEggPlotId,
          theme,
          userOpacityScale,
        });
        drawCalls = aggregateDrawCalls;
        if (easterEggFrame !== null) {
          this.clearEasterEggSubplot(easterEggFrame.item, theme);
          drawCalls += this.drawEasterEgg(easterEggFrame, pixelRatio, theme);
        }
      }
      visiblePointCount =
        this.lastAggregateUploadMetrics?.totalVisiblePointCount ?? pointCount;
    }

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.flush();
    this.gpuTimer.end();
    const cpuDurationMs = performance.now() - startedAt;
    this.lastRenderDrawCalls = drawCalls;
    this.lastRenderSubplotCount = renderPlan.subplotCount;
    const aggregateReady =
      aggregateMode === null || this.lastAggregation?.kind === aggregateMode;

    this.emitMetrics({
      drawCalls,
      durationMs: cpuDurationMs,
      gpuDurationMs: previousGpuTiming?.disjoint ? undefined : previousGpuTiming?.durationMs,
      gpuTimerSupported: this.gpuTimer.supported,
      phase: 'render',
      pointCount,
      aggregateCount:
        aggregateMode === 'bubble' && aggregateReady
          ? this.lastAggregateUploadMetrics?.totalAggregateCount
          : undefined,
      aggregateDrawCalls:
        aggregateMode === null || !aggregateReady ? undefined : aggregateDrawCalls,
      cellCount:
        aggregateMode === 'heatmap' && aggregateReady
          ? this.lastAggregateUploadMetrics?.totalCellCount
          : undefined,
      populatedCellCount:
        aggregateMode === 'heatmap' && aggregateReady
          ? this.lastAggregateUploadMetrics?.totalPopulatedCellCount
          : undefined,
      displayMode: aggregateMode ?? 'points',
      subplotCount: renderPlan.subplotCount,
      uploadBytes:
        aggregateMode === null || !aggregateReady
          ? undefined
          : this.lastAggregateUploadMetrics?.uploadBytes,
      visiblePointCount,
      detail: JSON.stringify({
        aggregate:
          aggregateMode === null
            ? null
            : !aggregateReady
              ? undefined
              : {
                aggregateBuildMs: this.lastAggregateUploadMetrics?.aggregateBuildMs ?? 0,
                aggregateDrawCalls,
                displayMode: aggregateMode,
                totalAggregateCount:
                  this.lastAggregateUploadMetrics?.totalAggregateCount ?? 0,
                totalCellCount: this.lastAggregateUploadMetrics?.totalCellCount ?? 0,
                totalPopulatedCellCount:
                  this.lastAggregateUploadMetrics?.totalPopulatedCellCount ?? 0,
                totalVisiblePointCount:
                  this.lastAggregateUploadMetrics?.totalVisiblePointCount ?? 0,
                uploadBytes: this.lastAggregateUploadMetrics?.uploadBytes ?? 0,
              },
        cpuDurationMs,
        gpuDurationMs: previousGpuTiming?.disjoint
          ? null
          : previousGpuTiming?.durationMs ?? null,
        gpuTimerDisjoint: previousGpuTiming?.disjoint ?? false,
        gpuTimerSupported: this.gpuTimer.supported,
        firstCanvasRenderScheduleMs: this.firstCanvasRenderScheduleMs,
        plotIds: renderPlan.items.map((item) => item.plotId),
        renderPolicy: {
          alphaScale: alphaPolicy?.alphaScale ?? 1,
          blendMode: alphaPolicy?.blendMode ?? 'src-alpha-one-minus-src-alpha',
          densityPointsPerPixel: alphaPolicy?.densityPointsPerPixel ?? 0,
          effectivePointSizeScale,
          effectiveOpacityScale,
          effectiveRenderingMode:
            alphaPolicy?.effectiveRenderingMode ?? visualizationMode,
          mode: alphaPolicy?.mode ?? 'normal',
          pointSizeScale: alphaPolicy?.pointSizeScale ?? 1,
          renderingPolicy: alphaPolicy?.renderingPolicy ?? 'normal',
          requestedRenderingMode: alphaPolicy?.requestedRenderingMode ?? null,
          userOpacityScale,
          userPointSizeScale,
          visualizationMode,
        },
        sharedSourceBuffers: renderPlan.sharedSourceBuffers,
        selectedOverlay: {
          drawCalls:
            (aggregateMode === null || aggregateMode === 'bubble') &&
            this.selectedPointCount > 0
              ? renderPlan.subplotCount
              : 0,
          maskHeight: this.selectedMaskHeight,
          maskWidth: this.selectedMaskWidth,
          selectedPointCount: this.selectedPointCount,
        },
        hoverOverlay: {
          drawCalls: 0,
          sourceIndex: this.hoverSourceIndex,
        },
        easterEgg: {
          active: easterEggFrame !== null,
          plotId: easterEggFrame?.item.plotId ?? null,
          pointCount: this.easterEggBuffers?.pointCount ?? 0,
        },
        sharedXRange: renderPlan.items.every(
          (item) => item.sharedXRange === this.options.viewport.x,
        ),
        yRanges: Object.fromEntries(
          renderPlan.items.map((item) => [item.plotId, item.yRange]),
        ),
      }),
    });

    if (this.easterEggPlayback !== null) {
      this.scheduleDraw();
    }
  }

  private drawPoints({
    alphaPolicy,
    clearBackground,
    effectivePointSizeScale,
    pixelRatio,
    pointCount,
    renderPlan,
    skipPlotId,
    theme,
    userOpacityScale,
    userPointSizeScale,
  }: {
    alphaPolicy: FastScatterAlphaPolicy;
    clearBackground: boolean;
    effectivePointSizeScale: number;
    pixelRatio: number;
    pointCount: number;
    renderPlan: FastScatterSubplotRenderPlan;
    skipPlotId?: string | null;
    theme: FastScatterTheme;
    userOpacityScale: number;
    userPointSizeScale: number;
  }): number {
    const gl = this.gl;
    let drawCalls = 0;

    gl.useProgram(this.pointProgram.program);
    gl.uniform2f(
      this.pointProgram.uniforms.xRange,
      this.options.viewport.x.min,
      this.options.viewport.x.max,
    );
    gl.uniform1f(this.pointProgram.uniforms.devicePixelRatio, pixelRatio);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.selectedMaskTexture);
    gl.uniform1i(this.pointProgram.uniforms.selectedMask, 0);
    gl.uniform1i(this.pointProgram.uniforms.selectedMaskWidth, this.selectedMaskWidth);
    gl.uniform4f(
      this.pointProgram.uniforms.selectedOverlayColor,
      ...theme.selectedOverlayColor,
    );
    gl.uniform1f(
      this.pointProgram.uniforms.themeAlphaScaleMultiplier,
      theme.alphaScaleMultiplier ?? 1,
    );
    gl.uniform1f(
      this.pointProgram.uniforms.themeColorMixAmount,
      theme.colorMixAmount ?? 0,
    );
    gl.uniform3f(
      this.pointProgram.uniforms.themeColorMixColor,
      (theme.colorMixColor?.[0] ?? 255) / 255,
      (theme.colorMixColor?.[1] ?? 255) / 255,
      (theme.colorMixColor?.[2] ?? 255) / 255,
    );
    gl.uniform1i(this.pointProgram.uniforms.selectedOverlayEnabled, 0);
    applyFastScatterBlendPolicy(gl, alphaPolicy);
    gl.uniform1f(this.pointProgram.uniforms.alphaScale, alphaPolicy.alphaScale);
    gl.uniform1f(this.pointProgram.uniforms.opacityScale, userOpacityScale);
    gl.uniform1f(
      this.pointProgram.uniforms.pointSizeScale,
      effectivePointSizeScale,
    );

    for (const item of renderPlan.items) {
      const plotBuffer = this.plotBuffers[item.bufferIndex];
      if (plotBuffer === undefined) {
        continue;
      }

      applyDeviceViewport(this.gl, this.canvas.height, item.deviceRect);
      if (clearBackground) {
        gl.clearColor(...theme.subplotBackgroundColor);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      if (item.plotId === skipPlotId) {
        continue;
      }
      gl.uniform2f(
        this.pointProgram.uniforms.yRange,
        item.yRange.min,
        item.yRange.max,
      );
      gl.uniform2f(
        this.pointProgram.uniforms.viewportSizePx,
        item.deviceRect.widthCssPx,
        item.deviceRect.heightCssPx,
      );
      gl.bindVertexArray(plotBuffer.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, UNIT_QUAD_TRIANGLES.length / 2, pointCount);
      drawCalls += 1;
    }

    if (this.selectedPointCount > 0) {
      applyFastScatterBlendPolicy(gl, { blendMode: 'src-alpha-one-minus-src-alpha' });
      gl.uniform1f(this.pointProgram.uniforms.alphaScale, 1);
      gl.uniform1f(this.pointProgram.uniforms.opacityScale, 1);
      gl.uniform1f(this.pointProgram.uniforms.pointSizeScale, userPointSizeScale);
      gl.uniform1i(this.pointProgram.uniforms.selectedOverlayEnabled, 1);

      for (const item of renderPlan.items) {
        const plotBuffer = this.plotBuffers[item.bufferIndex];
        if (plotBuffer === undefined || item.plotId === skipPlotId) {
          continue;
        }

        applyDeviceViewport(this.gl, this.canvas.height, item.deviceRect);
        gl.uniform2f(
          this.pointProgram.uniforms.yRange,
          item.yRange.min,
          item.yRange.max,
        );
        gl.uniform2f(
          this.pointProgram.uniforms.viewportSizePx,
          item.deviceRect.widthCssPx,
          item.deviceRect.heightCssPx,
        );
        gl.bindVertexArray(plotBuffer.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, UNIT_QUAD_TRIANGLES.length / 2, pointCount);
        drawCalls += 1;
      }

      gl.uniform1i(this.pointProgram.uniforms.selectedOverlayEnabled, 0);
    }

    return drawCalls;
  }

  private createEasterEggFrame(
    renderPlan: FastScatterSubplotRenderPlan,
  ): EasterEggFrame | null {
    const playback = this.easterEggPlayback;
    if (playback === null) {
      return null;
    }

    const item = renderPlan.items[0];
    if (item === undefined) {
      return null;
    }

    const elapsedMs = performance.now() - playback.startedAt;
    if (elapsedMs >= getFastScatterEasterEggTotalDurationMs(playback)) {
      this.easterEggPlayback = null;
      this.deleteEasterEggBuffers();
      return null;
    }

    return {
      elapsedMs,
      item,
      playback,
    };
  }

  private drawEasterEgg(
    frame: EasterEggFrame,
    pixelRatio: number,
    theme: FastScatterTheme,
  ): number {
    const buffers = this.ensureEasterEggBuffers(frame.playback, theme);
    if (buffers.pointCount === 0) {
      return 0;
    }

    updateFastScatterEasterEggPositions(
      frame.playback,
      frame.elapsedMs,
      buffers.currentX,
      buffers.currentY,
    );
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.xBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, buffers.currentX);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.yBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, buffers.currentY);

    gl.useProgram(this.pointProgram.program);
    gl.uniform2f(this.pointProgram.uniforms.xRange, 0, 1);
    gl.uniform2f(this.pointProgram.uniforms.yRange, 0, 1);
    gl.uniform1f(this.pointProgram.uniforms.devicePixelRatio, pixelRatio);
    gl.uniform2f(
      this.pointProgram.uniforms.viewportSizePx,
      frame.item.deviceRect.widthCssPx,
      frame.item.deviceRect.heightCssPx,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.selectedMaskTexture);
    gl.uniform1i(this.pointProgram.uniforms.selectedMask, 0);
    gl.uniform1i(this.pointProgram.uniforms.selectedMaskWidth, this.selectedMaskWidth);
    gl.uniform4f(
      this.pointProgram.uniforms.selectedOverlayColor,
      ...theme.selectedOverlayColor,
    );
    gl.uniform1i(this.pointProgram.uniforms.selectedOverlayEnabled, 0);
    gl.uniform1f(this.pointProgram.uniforms.alphaScale, 1);
    gl.uniform1f(this.pointProgram.uniforms.opacityScale, 1);
    gl.uniform1f(this.pointProgram.uniforms.themeAlphaScaleMultiplier, 1);
    gl.uniform1f(this.pointProgram.uniforms.themeColorMixAmount, 0);
    gl.uniform3f(this.pointProgram.uniforms.themeColorMixColor, 1, 1, 1);
    gl.uniform1f(this.pointProgram.uniforms.pointSizeScale, 1);
    applyFastScatterBlendPolicy(gl, { blendMode: 'src-alpha-one-minus-src-alpha' });
    applyDeviceViewport(gl, this.canvas.height, frame.item.deviceRect);
    gl.bindVertexArray(buffers.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, UNIT_QUAD_TRIANGLES.length / 2, buffers.pointCount);
    return 1;
  }

  private clearEasterEggSubplot(
    item: FastScatterSubplotRenderPlanItem,
    theme: FastScatterTheme,
  ): void {
    this.gl.clearColor(...theme.subplotBackgroundColor);
    applyDeviceViewport(this.gl, this.canvas.height, item.deviceRect);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  private ensureAggregateBuffers(
    renderPlan: FastScatterSubplotRenderPlan,
    displayMode: 'bubble' | 'heatmap',
  ): void {
    if (
      !this.aggregateBuffersDirty &&
      this.lastAggregateUploadMetrics?.displayMode === displayMode
    ) {
      return;
    }

    this.deleteAggregateBuffers();

    if (renderPlan.items.length === 0) {
      this.aggregateBuffersDirty = false;
      this.lastAggregation = null;
      this.lastAggregateUploadMetrics = {
        aggregateBuildMs: 0,
        aggregateDrawCalls: 0,
        displayMode,
        totalAggregateCount: 0,
        totalCellCount: 0,
        totalPopulatedCellCount: 0,
        totalVisiblePointCount: 0,
        uploadBytes: 0,
      };
      return;
    }

    const externalAggregation = this.options.aggregation;
    const aggregation =
      externalAggregation === undefined
        ? buildFastScatterAggregation(
            this.options.columns,
            createFastScatterAggregationRequest({
              displayMode,
              heatmapBinSizePx: this.options.heatmapBinSizePx,
              hoverSourceIndex: null,
              renderPlan,
              selectedSourceIndices: this.selectedSourceIndices,
              viewport: this.options.viewport,
            }),
          )
        : externalAggregation?.kind === displayMode
          ? externalAggregation
          : null;
    this.lastAggregation = aggregation;

    if (aggregation === null) {
      this.aggregateBuffersDirty = false;
      this.lastAggregateUploadMetrics = {
        aggregateBuildMs: 0,
        aggregateDrawCalls: 0,
        displayMode,
        totalAggregateCount: 0,
        totalCellCount: 0,
        totalPopulatedCellCount: 0,
        totalVisiblePointCount: 0,
        uploadBytes: 0,
      };
      return;
    }

    if (aggregation.kind === 'bubble') {
      this.bubbleBuffers = aggregation.subplots.map((subplot, index) =>
        this.createBubbleAggregateBuffers(
          subplot,
          renderPlan.items[index]?.cssRect ?? renderPlan.items[0]!.cssRect,
          this.options.theme ?? DEFAULT_THEME,
          normalizeFastScatterPointSizeScale(this.options.pointSizeScale),
          getMaxBubbleCount(aggregation.subplots),
        ),
      );
      this.lastAggregateUploadMetrics = {
        aggregateBuildMs: aggregation.metrics.aggregateBuildMs,
        aggregateDrawCalls: 0,
        displayMode: 'bubble',
        totalAggregateCount: aggregation.totalAggregateCount,
        totalCellCount: 0,
        totalPopulatedCellCount: 0,
        totalVisiblePointCount: sumBubbleVisiblePointCount(aggregation.subplots),
        uploadBytes: sumUploadBytes(this.bubbleBuffers),
      };
    } else {
      this.heatmapBuffers = aggregation.subplots.map((subplot) =>
        this.createHeatmapAggregateBuffers(
          subplot,
          this.options.theme ?? DEFAULT_THEME,
          normalizeFastScatterHeatmapPalette(this.options.heatmapPalette),
        ),
      );
      this.lastAggregateUploadMetrics = {
        aggregateBuildMs: aggregation.metrics.aggregateBuildMs,
        aggregateDrawCalls: 0,
        displayMode: 'heatmap',
        totalAggregateCount: 0,
        totalCellCount: aggregation.totalCellCount,
        totalPopulatedCellCount: aggregation.totalPopulatedCellCount,
        totalVisiblePointCount: sumHeatmapVisiblePointCount(aggregation.subplots),
        uploadBytes: sumUploadBytes(this.heatmapBuffers),
      };
    }

    this.aggregateBuffersDirty = false;
  }

  private drawBubbleAggregates({
    clearBackground,
    pixelRatio,
    renderPlan,
    skipPlotId,
    theme,
    userOpacityScale,
  }: {
    clearBackground: boolean;
    pixelRatio: number;
    renderPlan: FastScatterSubplotRenderPlan;
    skipPlotId?: string | null;
    theme: FastScatterTheme;
    userOpacityScale: number;
  }): number {
    const gl = this.gl;
    const hoverOverlayColor = getHoverOverlayColor(theme);
    let drawCalls = 0;

    gl.useProgram(this.bubbleProgram.program);
    gl.uniform2f(
      this.bubbleProgram.uniforms.xRange,
      this.options.viewport.x.min,
      this.options.viewport.x.max,
    );
    gl.uniform1f(this.bubbleProgram.uniforms.devicePixelRatio, pixelRatio);
    gl.uniform4f(this.bubbleProgram.uniforms.hoverOverlayColor, ...hoverOverlayColor);
    gl.uniform1f(this.bubbleProgram.uniforms.opacityScale, userOpacityScale);
    gl.uniform4f(
      this.bubbleProgram.uniforms.selectedOverlayColor,
      ...theme.selectedOverlayColor,
    );
    gl.uniform1f(
      this.bubbleProgram.uniforms.themeAlphaScaleMultiplier,
      theme.alphaScaleMultiplier ?? 1,
    );
    gl.uniform1f(
      this.bubbleProgram.uniforms.themeColorMixAmount,
      theme.colorMixAmount ?? 0,
    );
    gl.uniform3f(
      this.bubbleProgram.uniforms.themeColorMixColor,
      (theme.colorMixColor?.[0] ?? 255) / 255,
      (theme.colorMixColor?.[1] ?? 255) / 255,
      (theme.colorMixColor?.[2] ?? 255) / 255,
    );
    applyFastScatterBlendPolicy(gl, { blendMode: 'src-alpha-one-minus-src-alpha' });

    for (const item of renderPlan.items) {
      if (item.plotId === skipPlotId) {
        continue;
      }
      const buffers = this.findBubbleBuffers(item.plotId, item.yKey);
      if (buffers === null) {
        continue;
      }

      applyDeviceViewport(gl, this.canvas.height, item.deviceRect);
      if (clearBackground) {
        gl.clearColor(...theme.subplotBackgroundColor);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.uniform2f(
        this.bubbleProgram.uniforms.yRange,
        item.yRange.min,
        item.yRange.max,
      );
      gl.uniform2f(
        this.bubbleProgram.uniforms.viewportSizePx,
        item.deviceRect.widthCssPx,
        item.deviceRect.heightCssPx,
      );
      gl.bindVertexArray(buffers.vao);
      gl.drawArraysInstanced(
        gl.TRIANGLES,
        0,
        UNIT_QUAD_TRIANGLES.length / 2,
        buffers.instanceCount,
      );
      drawCalls += 1;
    }

    if (this.lastAggregateUploadMetrics !== null) {
      this.lastAggregateUploadMetrics = {
        ...this.lastAggregateUploadMetrics,
        aggregateDrawCalls: drawCalls,
      };
    }

    return drawCalls;
  }

  private drawHeatmapAggregates({
    renderPlan,
    skipPlotId,
    theme,
    userOpacityScale,
  }: {
    renderPlan: FastScatterSubplotRenderPlan;
    skipPlotId?: string | null;
    theme: FastScatterTheme;
    userOpacityScale: number;
  }): number {
    const gl = this.gl;
    const hoverOverlayColor = getHoverOverlayColor(theme);
    const borderColor = getHeatmapBorderColor(theme);
    let drawCalls = 0;

    gl.useProgram(this.heatmapProgram.program);
    gl.uniform2f(
      this.heatmapProgram.uniforms.xRange,
      this.options.viewport.x.min,
      this.options.viewport.x.max,
    );
    gl.uniform4f(this.heatmapProgram.uniforms.hoverOverlayColor, ...hoverOverlayColor);
    gl.uniform1f(this.heatmapProgram.uniforms.opacityScale, userOpacityScale);
    gl.uniform4f(
      this.heatmapProgram.uniforms.selectedOverlayColor,
      ...theme.selectedOverlayColor,
    );

    for (const item of renderPlan.items) {
      if (item.plotId === skipPlotId) {
        continue;
      }
      const buffers = this.findHeatmapBuffers(item.plotId, item.yKey);
      if (buffers === null) {
        continue;
      }

      applyDeviceViewport(gl, this.canvas.height, item.deviceRect);
      gl.clearColor(...theme.subplotBackgroundColor);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(
        this.heatmapProgram.uniforms.yRange,
        item.yRange.min,
        item.yRange.max,
      );
      gl.uniform1f(this.heatmapProgram.uniforms.borderAlpha, buffers.subtleBorderAlpha);
      gl.uniform4f(this.heatmapProgram.uniforms.borderColor, ...borderColor);
      gl.uniform2f(
        this.heatmapProgram.uniforms.cellSizePx,
        buffers.cellWidthPx,
        buffers.cellHeightPx,
      );
      gl.bindVertexArray(buffers.vao);
      gl.drawArraysInstanced(
        gl.TRIANGLES,
        0,
        UNIT_QUAD_TRIANGLES.length / 2,
        buffers.instanceCount,
      );
      drawCalls += 1;
    }

    if (this.lastAggregateUploadMetrics !== null) {
      this.lastAggregateUploadMetrics = {
        ...this.lastAggregateUploadMetrics,
        aggregateDrawCalls: drawCalls,
      };
    }

    return drawCalls;
  }

  private createBubbleAggregateBuffers(
    aggregation: FastScatterBubbleAggregationSet['subplots'][number],
    plotRect: FastScatterPlotRect,
    theme: FastScatterTheme,
    pointSizeScale: number,
    maxCount: number,
  ): BubbleAggregateBuffers {
    const gl = this.gl;
    const xBuffer = createRequiredBuffer(gl, `bubble x buffer for ${aggregation.plotId}`);
    const yBuffer = createRequiredBuffer(gl, `bubble y buffer for ${aggregation.plotId}`);
    const colorBuffer = createRequiredBuffer(
      gl,
      `bubble color buffer for ${aggregation.plotId}`,
    );
    const radiusBuffer = createRequiredBuffer(
      gl,
      `bubble radius buffer for ${aggregation.plotId}`,
    );
    const selectedFractionBuffer = createRequiredBuffer(
      gl,
      `bubble selected fraction buffer for ${aggregation.plotId}`,
    );
    const hoveredBuffer = createRequiredBuffer(
      gl,
      `bubble hovered buffer for ${aggregation.plotId}`,
    );
    const radiusValues = createFastScatterBubbleRadiusPx(
      aggregation.counts,
      plotRect.widthCssPx,
      plotRect.heightCssPx,
      pointSizeScale,
      { maxCount },
    );
    const selectedFractions = createSelectedFractionArray(
      aggregation.selectedCounts,
      aggregation.counts,
    );
    const colors = toRgba8Array(
      undefined,
      undefined,
      aggregation.aggregateCount,
      theme.bubbleColor ?? BUBBLE_UNIFORM_COLOR_RGBA8,
    );

    gl.bindBuffer(gl.ARRAY_BUFFER, xBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(aggregation.centerX), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, yBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(aggregation.centerY), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, radiusBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, radiusValues, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, selectedFractionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, selectedFractions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, hoveredBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, aggregation.hovered, gl.STATIC_DRAW);

    return {
      colorBuffer,
      hoveredBuffer,
      instanceCount: aggregation.aggregateCount,
      plotId: aggregation.plotId,
      radiusBuffer,
      selectedFractionBuffer,
      uploadBytes:
        Float32Array.BYTES_PER_ELEMENT *
          (aggregation.centerX.length + aggregation.centerY.length + radiusValues.length + selectedFractions.length) +
        colors.byteLength +
        aggregation.hovered.byteLength,
      vao: this.createBubbleVertexArray({
        colorBuffer,
        hoveredBuffer,
        radiusBuffer,
        selectedFractionBuffer,
        xBuffer,
        yBuffer,
      }),
      xBuffer,
      yBuffer,
      yKey: aggregation.yKey,
    };
  }

  private createHeatmapAggregateBuffers(
    aggregation: FastScatterHeatmapAggregationSet['subplots'][number],
    theme: FastScatterTheme,
    palette: FastScatterHeatmapPalette,
  ): HeatmapAggregateBuffers {
    const populatedCellIndices = collectPopulatedHeatmapCellIndices(aggregation);
    const gl = this.gl;
    const centerXBuffer = createRequiredBuffer(
      gl,
      `heat-map centerX buffer for ${aggregation.plotId}`,
    );
    const centerYBuffer = createRequiredBuffer(
      gl,
      `heat-map centerY buffer for ${aggregation.plotId}`,
    );
    const halfWidthAxisBuffer = createRequiredBuffer(
      gl,
      `heat-map half-width buffer for ${aggregation.plotId}`,
    );
    const halfHeightAxisBuffer = createRequiredBuffer(
      gl,
      `heat-map half-height buffer for ${aggregation.plotId}`,
    );
    const colorBuffer = createRequiredBuffer(
      gl,
      `heat-map color buffer for ${aggregation.plotId}`,
    );
    const selectedFractionBuffer = createRequiredBuffer(
      gl,
      `heat-map selected fraction buffer for ${aggregation.plotId}`,
    );
    const hoveredBuffer = createRequiredBuffer(
      gl,
      `heat-map hovered buffer for ${aggregation.plotId}`,
    );
    const centerX = new Float32Array(populatedCellIndices.length);
    const centerY = new Float32Array(populatedCellIndices.length);
    const halfWidthAxis = new Float32Array(populatedCellIndices.length);
    const halfHeightAxis = new Float32Array(populatedCellIndices.length);
    const selectedFractions = new Float32Array(populatedCellIndices.length);
    const hovered = new Uint8Array(populatedCellIndices.length);

    for (let index = 0; index < populatedCellIndices.length; index += 1) {
      const cellIndex = populatedCellIndices[index] ?? 0;
      const xBin = cellIndex % aggregation.xBinCount;
      const yBin = Math.floor(cellIndex / aggregation.xBinCount);
      centerX[index] = aggregation.xRange.min + (xBin + 0.5) * aggregation.xBinSize;
      centerY[index] = aggregation.yRange.min + (yBin + 0.5) * aggregation.yBinSize;
      halfWidthAxis[index] = aggregation.xBinSize * 0.5;
      halfHeightAxis[index] = aggregation.yBinSize * 0.5;
      selectedFractions[index] =
        clampUnitFraction(
          (aggregation.selectedCounts[cellIndex] ?? 0) /
            Math.max(1, aggregation.counts[cellIndex] ?? 0),
        );
      hovered[index] = aggregation.hovered[cellIndex] ?? 0;
    }

    const colors = createFastScatterHeatmapColors(
      aggregation.counts,
      populatedCellIndices,
      theme,
      palette,
    );

    gl.bindBuffer(gl.ARRAY_BUFFER, centerXBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, centerX, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, centerYBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, centerY, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, halfWidthAxisBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, halfWidthAxis, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, halfHeightAxisBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, halfHeightAxis, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, selectedFractionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, selectedFractions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, hoveredBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, hovered, gl.STATIC_DRAW);

    const cellWidthPx =
      aggregation.xBinCount <= 0
        ? aggregation.plotWidthPx
        : aggregation.plotWidthPx / aggregation.xBinCount;
    const cellHeightPx =
      aggregation.yBinCount <= 0
        ? aggregation.plotHeightPx
        : aggregation.plotHeightPx / aggregation.yBinCount;

    return {
      centerXBuffer,
      centerYBuffer,
      cellHeightPx,
      cellWidthPx,
      colorBuffer,
      halfHeightAxisBuffer,
      halfWidthAxisBuffer,
      hoveredBuffer,
      instanceCount: populatedCellIndices.length,
      plotId: aggregation.plotId,
      selectedFractionBuffer,
      subtleBorderAlpha: resolveFastScatterHeatmapBorderAlpha(
        cellWidthPx,
        cellHeightPx,
        theme,
      ),
      uploadBytes:
        centerX.byteLength +
        centerY.byteLength +
        halfWidthAxis.byteLength +
        halfHeightAxis.byteLength +
        colors.byteLength +
        selectedFractions.byteLength +
        hovered.byteLength,
      vao: this.createHeatmapVertexArray({
        centerXBuffer,
        centerYBuffer,
        colorBuffer,
        halfHeightAxisBuffer,
        halfWidthAxisBuffer,
        hoveredBuffer,
        selectedFractionBuffer,
      }),
      yKey: aggregation.yKey,
    };
  }

  private createBubbleVertexArray({
    colorBuffer,
    hoveredBuffer,
    radiusBuffer,
    selectedFractionBuffer,
    xBuffer,
    yBuffer,
  }: {
    colorBuffer: WebGLBuffer;
    hoveredBuffer: WebGLBuffer;
    radiusBuffer: WebGLBuffer;
    selectedFractionBuffer: WebGLBuffer;
    xBuffer: WebGLBuffer;
    yBuffer: WebGLBuffer;
  }): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (vao === null) {
      throw new Error('Fast scatter WebGL2 bubble vertex array could not be allocated.');
    }

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuadBuffer);
    gl.enableVertexAttribArray(this.bubbleProgram.attributes.corner);
    gl.vertexAttribPointer(this.bubbleProgram.attributes.corner, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.bubbleProgram.attributes.corner, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, xBuffer);
    gl.enableVertexAttribArray(this.bubbleProgram.attributes.x);
    gl.vertexAttribPointer(this.bubbleProgram.attributes.x, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.bubbleProgram.attributes.x, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, yBuffer);
    gl.enableVertexAttribArray(this.bubbleProgram.attributes.y);
    gl.vertexAttribPointer(this.bubbleProgram.attributes.y, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.bubbleProgram.attributes.y, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.enableVertexAttribArray(this.bubbleProgram.attributes.color);
    gl.vertexAttribPointer(
      this.bubbleProgram.attributes.color,
      4,
      gl.UNSIGNED_BYTE,
      true,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.bubbleProgram.attributes.color, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, radiusBuffer);
    gl.enableVertexAttribArray(this.bubbleProgram.attributes.radiusPx);
    gl.vertexAttribPointer(
      this.bubbleProgram.attributes.radiusPx,
      1,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.bubbleProgram.attributes.radiusPx, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, selectedFractionBuffer);
    gl.enableVertexAttribArray(this.bubbleProgram.attributes.selectedFraction);
    gl.vertexAttribPointer(
      this.bubbleProgram.attributes.selectedFraction,
      1,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.bubbleProgram.attributes.selectedFraction, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, hoveredBuffer);
    gl.enableVertexAttribArray(this.bubbleProgram.attributes.hovered);
    gl.vertexAttribPointer(
      this.bubbleProgram.attributes.hovered,
      1,
      gl.UNSIGNED_BYTE,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.bubbleProgram.attributes.hovered, 1);

    return vao;
  }

  private createHeatmapVertexArray({
    centerXBuffer,
    centerYBuffer,
    colorBuffer,
    halfHeightAxisBuffer,
    halfWidthAxisBuffer,
    hoveredBuffer,
    selectedFractionBuffer,
  }: {
    centerXBuffer: WebGLBuffer;
    centerYBuffer: WebGLBuffer;
    colorBuffer: WebGLBuffer;
    halfHeightAxisBuffer: WebGLBuffer;
    halfWidthAxisBuffer: WebGLBuffer;
    hoveredBuffer: WebGLBuffer;
    selectedFractionBuffer: WebGLBuffer;
  }): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (vao === null) {
      throw new Error('Fast scatter WebGL2 heat-map vertex array could not be allocated.');
    }

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuadBuffer);
    gl.enableVertexAttribArray(this.heatmapProgram.attributes.corner);
    gl.vertexAttribPointer(
      this.heatmapProgram.attributes.corner,
      2,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.heatmapProgram.attributes.corner, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, centerXBuffer);
    gl.enableVertexAttribArray(this.heatmapProgram.attributes.centerX);
    gl.vertexAttribPointer(
      this.heatmapProgram.attributes.centerX,
      1,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.heatmapProgram.attributes.centerX, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, centerYBuffer);
    gl.enableVertexAttribArray(this.heatmapProgram.attributes.centerY);
    gl.vertexAttribPointer(
      this.heatmapProgram.attributes.centerY,
      1,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.heatmapProgram.attributes.centerY, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.enableVertexAttribArray(this.heatmapProgram.attributes.color);
    gl.vertexAttribPointer(
      this.heatmapProgram.attributes.color,
      4,
      gl.UNSIGNED_BYTE,
      true,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.heatmapProgram.attributes.color, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, halfWidthAxisBuffer);
    gl.enableVertexAttribArray(this.heatmapProgram.attributes.halfWidthAxis);
    gl.vertexAttribPointer(
      this.heatmapProgram.attributes.halfWidthAxis,
      1,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.heatmapProgram.attributes.halfWidthAxis, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, halfHeightAxisBuffer);
    gl.enableVertexAttribArray(this.heatmapProgram.attributes.halfHeightAxis);
    gl.vertexAttribPointer(
      this.heatmapProgram.attributes.halfHeightAxis,
      1,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.heatmapProgram.attributes.halfHeightAxis, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, selectedFractionBuffer);
    gl.enableVertexAttribArray(this.heatmapProgram.attributes.selectedFraction);
    gl.vertexAttribPointer(
      this.heatmapProgram.attributes.selectedFraction,
      1,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.heatmapProgram.attributes.selectedFraction, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, hoveredBuffer);
    gl.enableVertexAttribArray(this.heatmapProgram.attributes.hovered);
    gl.vertexAttribPointer(
      this.heatmapProgram.attributes.hovered,
      1,
      gl.UNSIGNED_BYTE,
      false,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.heatmapProgram.attributes.hovered, 1);

    return vao;
  }

  private ensureEasterEggBuffers(
    playback: FastScatterEasterEggPlayback,
    theme: FastScatterTheme,
  ): EasterEggBuffers {
    const existing = this.easterEggBuffers;
    if (existing !== null && existing.pointCount === playback.layout.points.length) {
      return existing;
    }

    this.deleteEasterEggBuffers();
    const gl = this.gl;
    const pointCount = playback.layout.points.length;
    const xBuffer = createRequiredBuffer(gl, 'scatter easter egg x buffer');
    const yBuffer = createRequiredBuffer(gl, 'scatter easter egg y buffer');
    const colorBuffer = createRequiredBuffer(gl, 'scatter easter egg color buffer');
    const opacityBuffer = createRequiredBuffer(gl, 'scatter easter egg opacity buffer');
    const rotationBuffer = createRequiredBuffer(gl, 'scatter easter egg rotation buffer');
    const shapeBuffer = createRequiredBuffer(gl, 'scatter easter egg shape buffer');
    const sizeBuffer = createRequiredBuffer(gl, 'scatter easter egg size buffer');
    const currentX = new Float32Array(pointCount);
    const currentY = new Float32Array(pointCount);
    const color =
      playback.options.color === undefined
        ? undefined
        : normalizeEasterEggColor(playback.options.color, theme);
    const colors = createFastScatterEasterEggColorArray(playback.layout, color);
    const opacity = createDefaultFloat32(pointCount, DEFAULT_OPACITY);
    const rotation = createDefaultFloat32(pointCount, DEFAULT_ROTATION_RADIANS);
    const shape = createDefaultShapeCodes(pointCount);
    const size = createDefaultFloat32(pointCount, playback.options.pointSizePx);

    gl.bindBuffer(gl.ARRAY_BUFFER, xBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, currentX, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, yBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, currentY, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, opacityBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, opacity, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, rotationBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rotation, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, shapeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, shape, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, size, gl.STATIC_DRAW);

    const buffers = {
      colorBuffer,
      currentX,
      currentY,
      opacityBuffer,
      pointCount,
      rotationBuffer,
      shapeBuffer,
      sizeBuffer,
      uploadBytes:
        currentX.byteLength +
        currentY.byteLength +
        colors.byteLength +
        opacity.byteLength +
        rotation.byteLength +
        shape.byteLength +
        size.byteLength,
      vao: this.createEasterEggVertexArray({
        colorBuffer,
        opacityBuffer,
        rotationBuffer,
        shapeBuffer,
        sizeBuffer,
        xBuffer,
        yBuffer,
      }),
      xBuffer,
      yBuffer,
    };
    this.easterEggBuffers = buffers;
    return buffers;
  }

  private createEasterEggVertexArray({
    colorBuffer,
    opacityBuffer,
    rotationBuffer,
    shapeBuffer,
    sizeBuffer,
    xBuffer,
    yBuffer,
  }: {
    colorBuffer: WebGLBuffer;
    opacityBuffer: WebGLBuffer;
    rotationBuffer: WebGLBuffer;
    shapeBuffer: WebGLBuffer;
    sizeBuffer: WebGLBuffer;
    xBuffer: WebGLBuffer;
    yBuffer: WebGLBuffer;
  }): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (vao === null) {
      throw new Error('Fast scatter WebGL2 easter egg vertex array could not be allocated.');
    }

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuadBuffer);
    gl.enableVertexAttribArray(this.pointProgram.attributes.corner);
    gl.vertexAttribPointer(this.pointProgram.attributes.corner, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.pointProgram.attributes.corner, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, xBuffer);
    gl.enableVertexAttribArray(this.pointProgram.attributes.x);
    gl.vertexAttribPointer(this.pointProgram.attributes.x, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.pointProgram.attributes.x, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, yBuffer);
    gl.enableVertexAttribArray(this.pointProgram.attributes.y);
    gl.vertexAttribPointer(this.pointProgram.attributes.y, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.pointProgram.attributes.y, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.enableVertexAttribArray(this.pointProgram.attributes.color);
    gl.vertexAttribPointer(
      this.pointProgram.attributes.color,
      4,
      gl.UNSIGNED_BYTE,
      true,
      0,
      0,
    );
    gl.vertexAttribDivisor(this.pointProgram.attributes.color, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, opacityBuffer);
    gl.enableVertexAttribArray(this.pointProgram.attributes.opacity);
    gl.vertexAttribPointer(this.pointProgram.attributes.opacity, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.pointProgram.attributes.opacity, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, rotationBuffer);
    gl.enableVertexAttribArray(this.pointProgram.attributes.rotation);
    gl.vertexAttribPointer(this.pointProgram.attributes.rotation, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.pointProgram.attributes.rotation, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, shapeBuffer);
    gl.enableVertexAttribArray(this.pointProgram.attributes.shape);
    gl.vertexAttribPointer(this.pointProgram.attributes.shape, 1, gl.UNSIGNED_BYTE, false, 0, 0);
    gl.vertexAttribDivisor(this.pointProgram.attributes.shape, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuffer);
    gl.enableVertexAttribArray(this.pointProgram.attributes.size);
    gl.vertexAttribPointer(this.pointProgram.attributes.size, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.pointProgram.attributes.size, 1);

    return vao;
  }

  private findBubbleBuffers(plotId: string, yKey: string): BubbleAggregateBuffers | null {
    return this.bubbleBuffers.find((buffers) => buffers.plotId === plotId && buffers.yKey === yKey)
      ?? null;
  }

  private findHeatmapBuffers(plotId: string, yKey: string): HeatmapAggregateBuffers | null {
    return this.heatmapBuffers.find(
      (buffers) => buffers.plotId === plotId && buffers.yKey === yKey,
    ) ?? null;
  }

  private deleteAggregateBuffers(): void {
    for (const buffers of this.bubbleBuffers) {
      this.gl.deleteVertexArray(buffers.vao);
      this.gl.deleteBuffer(buffers.xBuffer);
      this.gl.deleteBuffer(buffers.yBuffer);
      this.gl.deleteBuffer(buffers.colorBuffer);
      this.gl.deleteBuffer(buffers.radiusBuffer);
      this.gl.deleteBuffer(buffers.selectedFractionBuffer);
      this.gl.deleteBuffer(buffers.hoveredBuffer);
    }

    for (const buffers of this.heatmapBuffers) {
      this.gl.deleteVertexArray(buffers.vao);
      this.gl.deleteBuffer(buffers.centerXBuffer);
      this.gl.deleteBuffer(buffers.centerYBuffer);
      this.gl.deleteBuffer(buffers.colorBuffer);
      this.gl.deleteBuffer(buffers.halfWidthAxisBuffer);
      this.gl.deleteBuffer(buffers.halfHeightAxisBuffer);
      this.gl.deleteBuffer(buffers.selectedFractionBuffer);
      this.gl.deleteBuffer(buffers.hoveredBuffer);
    }

    this.bubbleBuffers = [];
    this.heatmapBuffers = [];
    this.lastAggregation = null;
    this.lastAggregateUploadMetrics = null;
  }

  private deleteEasterEggBuffers(): void {
    const buffers = this.easterEggBuffers;
    if (buffers === null) {
      return;
    }
    this.gl.deleteVertexArray(buffers.vao);
    this.gl.deleteBuffer(buffers.xBuffer);
    this.gl.deleteBuffer(buffers.yBuffer);
    this.gl.deleteBuffer(buffers.colorBuffer);
    this.gl.deleteBuffer(buffers.opacityBuffer);
    this.gl.deleteBuffer(buffers.rotationBuffer);
    this.gl.deleteBuffer(buffers.shapeBuffer);
    this.gl.deleteBuffer(buffers.sizeBuffer);
    this.easterEggBuffers = null;
  }

  private deletePlotBuffers(): void {
    for (const plotBuffer of this.plotBuffers) {
      this.gl.deleteVertexArray(plotBuffer.vao);
      this.gl.deleteBuffer(plotBuffer.buffer);
    }
    this.plotBuffers = [];
  }

  private resizeSelectedMask(pointCount: number): void {
    const gl = this.gl;
    const maxTextureSize = Math.max(
      1,
      Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    );
    this.selectedMaskWidth = Math.max(1, Math.min(maxTextureSize, 4096));
    this.selectedMaskHeight = Math.max(1, Math.ceil(pointCount / this.selectedMaskWidth));
    this.selectedMask = new Uint8Array(this.selectedMaskWidth * this.selectedMaskHeight);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.selectedMaskTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      this.selectedMaskWidth,
      this.selectedMaskHeight,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      this.selectedMask,
    );
    this.selectedPointCount = 0;
  }

  private updateSelectedMask(selectedSourceIndices: Uint32Array): void {
    const pointCount = this.options.columns.x.length;
    const maskBuildStartedAt = performance.now();
    const { selectedPointCount } = buildFastScatterSelectedMask(
      this.selectedMask,
      selectedSourceIndices,
      pointCount,
    );

    const maskBuildMs = performance.now() - maskBuildStartedAt;
    const uploadStartedAt = performance.now();
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.selectedMaskTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.selectedMaskWidth,
      this.selectedMaskHeight,
      gl.RED,
      gl.UNSIGNED_BYTE,
      this.selectedMask,
    );
    const maskGpuUploadMs = performance.now() - uploadStartedAt;
    const durationMs = maskBuildMs + maskGpuUploadMs;
    this.selectedPointCount = selectedPointCount;
    this.emitMetrics({
      durationMs,
      phase: 'selection',
      pointCount,
      selectedPointCount,
      detail: JSON.stringify({
        maskBuildMs,
        maskGpuUploadMs,
        maskHeight: this.selectedMaskHeight,
        maskWidth: this.selectedMaskWidth,
        operation: 'selected-mask-overlay',
        uploadBytes: this.selectedMask.byteLength,
      }),
    });
  }

  private updateHoverSourceIndex(hoverSourceIndex: number | null | undefined): void {
    const startedAt = performance.now();
    this.hoverSourceIndex = normalizeHoverSourceIndex(
      hoverSourceIndex,
      this.options.columns.x.length,
    );
    this.emitMetrics({
      drawCalls: this.lastRenderDrawCalls,
      durationMs: performance.now() - startedAt,
      phase: 'hover',
      pointCount: this.options.columns.x.length,
      subplotCount: this.lastRenderSubplotCount,
      detail: JSON.stringify({
        operation: 'hover-source-index-overlay',
        sourceIndex: this.hoverSourceIndex,
        uploadBytes: 0,
        webglDrawCalls: 0,
      }),
    });
  }

  private emitMetrics(metrics: Omit<FastScatterMetricsEvent, 'at'>): void {
    this.options.onMetrics?.({
      at: performance.now(),
      ...metrics,
    });
  }
}

export function normalizeFastScatterPointSizeScale(
  value: number | undefined,
): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Math.min(MAX_POINT_SIZE_SCALE, Math.max(MIN_POINT_SIZE_SCALE, value));
}

export function normalizeFastScatterOpacityScale(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Math.min(MAX_OPACITY_SCALE, Math.max(MIN_OPACITY_SCALE, value));
}

export function normalizeFastScatterVisualizationMode(
  value: FastScatterVisualizationMode | undefined,
): FastScatterVisualizationMode {
  return value === 'bubble' || value === 'heatmap' ? value : 'points';
}

export function normalizeFastScatterHeatmapBinSizePx(
  value: number | undefined,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_HEATMAP_BIN_SIZE_PX;
  }

  return Math.max(1, Math.floor(value));
}

export function normalizeFastScatterHeatmapPalette(
  value: FastScatterHeatmapPalette | undefined,
): FastScatterHeatmapPalette {
  return value === 'viridis' || value === 'magma' || value === 'turbo'
    ? value
    : 'mono';
}

export function createFastScatterAggregationRequest({
  displayMode,
  heatmapBinSizePx,
  hoverSourceIndex,
  renderPlan,
  selectedSourceIndices,
  viewport,
}: {
  displayMode: 'bubble' | 'heatmap';
  heatmapBinSizePx: number | undefined;
  hoverSourceIndex: number | null;
  renderPlan: FastScatterSubplotRenderPlan;
  selectedSourceIndices: Uint32Array | undefined;
  viewport: FastScatterControllerOptions['viewport'];
}): FastScatterAggregationRequest {
  const subplots = renderPlan.items.map((item) => ({
    plotHeightPx: item.cssRect.heightCssPx,
    plotId: item.plotId,
    plotWidthPx: item.cssRect.widthCssPx,
    yKey: item.yKey,
    yRange: item.yRange,
  }));

  if (displayMode === 'bubble') {
    return {
      hoverSourceIndex,
      mode: 'bubble',
      selectedSourceIndices,
      subplots,
      xRange: viewport.x,
    };
  }

  return {
    heatBinPx: normalizeFastScatterHeatmapBinSizePx(heatmapBinSizePx),
    hoverSourceIndex,
    mode: 'heatmap',
    selectedSourceIndices,
    subplots,
    xRange: viewport.x,
  };
}

function clearSubplotBackgrounds(
  gl: WebGL2RenderingContext,
  canvasHeight: number,
  renderPlan: FastScatterSubplotRenderPlan,
  theme: FastScatterTheme,
): void {
  gl.clearColor(...theme.subplotBackgroundColor);
  for (const item of renderPlan.items) {
    applyDeviceViewport(gl, canvasHeight, item.deviceRect);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}

function normalizeEasterEggColor(
  color: readonly [number, number, number, number] | undefined,
  theme?: FastScatterTheme,
): readonly [number, number, number, number] {
  const fallback = theme?.defaultPointColor ?? DEFAULT_EASTER_EGG_COLOR_RGBA8;
  return [
    normalizeRgba8Channel(color?.[0] ?? fallback[0]),
    normalizeRgba8Channel(color?.[1] ?? fallback[1]),
    normalizeRgba8Channel(color?.[2] ?? fallback[2]),
    normalizeRgba8Channel(color?.[3] ?? fallback[3]),
  ];
}

function normalizeRgba8Channel(value: number): number {
  if (!Number.isFinite(value)) {
    return 255;
  }
  return Math.max(0, Math.min(255, Math.round(value)));
}

function getMaxBubbleCount(
  subplots: readonly FastScatterBubbleAggregationSet['subplots'][number][],
): number {
  let maxCount = 0;
  for (const subplot of subplots) {
    for (let index = 0; index < subplot.counts.length; index += 1) {
      maxCount = Math.max(maxCount, subplot.counts[index] ?? 0);
    }
  }
  return maxCount;
}

function normalizeBubbleMaxCount(
  value: number | undefined,
  counts: Uint32Array,
): number {
  if (value !== undefined && Number.isFinite(value) && value > 0) {
    return Math.max(1, Math.floor(value));
  }

  let maxCount = 1;
  for (let index = 0; index < counts.length; index += 1) {
    maxCount = Math.max(maxCount, counts[index] ?? 0);
  }
  return maxCount;
}

export function createFastScatterBubbleRadiusPx(
  counts: Uint32Array,
  plotWidthPx: number,
  plotHeightPx: number,
  pointSizeScale = 1,
  options: {
    maxCount?: number;
  } = {},
): Float32Array {
  const radii = new Float32Array(counts.length);
  if (counts.length === 0) {
    return radii;
  }

  const normalizedScale = normalizeFastScatterPointSizeScale(pointSizeScale);
  const maxCount = normalizeBubbleMaxCount(options.maxCount, counts);
  const baseMaxRadiusPx = Math.min(
    BUBBLE_MAX_RADIUS_CAP_PX,
    Math.max(0, Math.min(plotWidthPx, plotHeightPx)) * BUBBLE_MAX_RADIUS_RATIO,
  );
  const countDrivenMaxRadiusPx =
    BUBBLE_MIN_RADIUS_PX +
    (maxCount <= 1
      ? 0
      : BUBBLE_COUNT_TWO_RADIUS_DELTA_PX +
        Math.sqrt(Math.max(0, maxCount - 2)) * BUBBLE_MAX_RADIUS_COUNT_STEP_PX);
  const maxRadiusPx =
    Math.min(Math.max(0, baseMaxRadiusPx), countDrivenMaxRadiusPx) *
    normalizedScale;
  const minRadiusPx = Math.min(BUBBLE_MIN_RADIUS_PX * normalizedScale, maxRadiusPx);

  for (let index = 0; index < counts.length; index += 1) {
    const count = counts[index] ?? 0;
    if (count <= 0) {
      radii[index] = 0;
      continue;
    }
    if (maxCount <= 1 || count === 1) {
      radii[index] = minRadiusPx;
      continue;
    }

    const normalizedCount = (count - 1) / Math.max(1, maxCount - 1);
    radii[index] =
      minRadiusPx + normalizedCount * Math.max(0, maxRadiusPx - minRadiusPx);
  }

  return radii;
}

export function resolveFastScatterHeatmapBorderAlpha(
  cellWidthPx: number,
  cellHeightPx: number,
  theme: FastScatterTheme = DEFAULT_THEME,
): number {
  if (Math.min(cellWidthPx, cellHeightPx) < HEATMAP_BORDER_MIN_BIN_PX) {
    return 0;
  }

  return isDarkTheme(theme)
    ? HEATMAP_DARK_BORDER_ALPHA
    : HEATMAP_LIGHT_BORDER_ALPHA;
}

export function createFastScatterHeatmapColors(
  counts: Uint32Array,
  populatedCellIndices: readonly number[],
  theme: FastScatterTheme = DEFAULT_THEME,
  palette: FastScatterHeatmapPalette = 'mono',
): Uint8Array {
  const colors = new Uint8Array(populatedCellIndices.length * 4);
  if (populatedCellIndices.length === 0) {
    return colors;
  }

  let maxCount = 0;
  for (const index of populatedCellIndices) {
    maxCount = Math.max(maxCount, counts[index] ?? 0);
  }

  const normalizedPalette = normalizeFastScatterHeatmapPalette(palette);
  const baseRgb = theme.defaultPointColor;
  const backgroundRgb = theme.subplotBackgroundColor;

  for (let outputIndex = 0; outputIndex < populatedCellIndices.length; outputIndex += 1) {
    const cellIndex = populatedCellIndices[outputIndex] ?? 0;
    const count = counts[cellIndex] ?? 0;
    const intensity =
      maxCount <= 0 ? 0 : Math.sqrt(count / Math.max(1, maxCount));
    const rgbMix = 0.2 + intensity * 0.8;
    const alpha = 48 + intensity * 176;
    const offset = outputIndex * 4;
    const [red, green, blue] =
      normalizedPalette === 'mono'
        ? [
            backgroundRgb[0] * (1 - rgbMix) + baseRgb[0] * rgbMix,
            backgroundRgb[1] * (1 - rgbMix) + baseRgb[1] * rgbMix,
            backgroundRgb[2] * (1 - rgbMix) + baseRgb[2] * rgbMix,
          ]
        : interpolateHeatmapPalette(normalizedPalette, intensity);
    colors[offset] = Math.round(red);
    colors[offset + 1] = Math.round(green);
    colors[offset + 2] = Math.round(blue);
    colors[offset + 3] = Math.round(alpha);
  }

  return colors;
}

function interpolateHeatmapPalette(
  palette: Exclude<FastScatterHeatmapPalette, 'mono'>,
  value: number,
): readonly [number, number, number] {
  const stops = HEATMAP_PALETTES[palette];
  const scaled = clampUnitFraction(value) * (stops.length - 1);
  const lowerIndex = Math.floor(scaled);
  const upperIndex = Math.min(stops.length - 1, lowerIndex + 1);
  const fraction = scaled - lowerIndex;
  const lower = stops[lowerIndex]!;
  const upper = stops[upperIndex]!;

  return [
    lower[0] + (upper[0] - lower[0]) * fraction,
    lower[1] + (upper[1] - lower[1]) * fraction,
    lower[2] + (upper[2] - lower[2]) * fraction,
  ];
}

function normalizeHoverSourceIndex(
  hoverSourceIndex: number | null | undefined,
  pointCount: number,
): number | null {
  if (hoverSourceIndex === null || hoverSourceIndex === undefined) {
    return null;
  }

  const normalized = Math.floor(hoverSourceIndex);
  if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized >= pointCount) {
    return null;
  }

  return normalized;
}

export function buildFastScatterSelectedMask(
  mask: Uint8Array,
  selectedSourceIndices: Uint32Array,
  pointCount: number,
): FastScatterSelectedMaskBuildResult {
  mask.fill(0);
  let selectedPointCount = 0;

  for (const sourceIndex of selectedSourceIndices) {
    if (sourceIndex < pointCount && mask[sourceIndex] === 0) {
      mask[sourceIndex] = 255;
      selectedPointCount += 1;
    }
  }

  return { selectedPointCount };
}

export function createFastScatterSubplotRenderPlan({
  pixelRatio,
  plotBuffers,
  plotRects,
  viewport,
}: {
  pixelRatio: number;
  plotBuffers: readonly Pick<PlotBuffers, 'plotId' | 'yKey'>[];
  plotRects: readonly FastScatterPlotRect[];
  viewport: FastScatterControllerOptions['viewport'];
}): FastScatterSubplotRenderPlan {
  const items: FastScatterSubplotRenderPlanItem[] = [];
  let plotAreaPx = 0;

  for (const [plotIndex, plotBuffer] of plotBuffers.entries()) {
    const cssRect = plotRects[plotIndex];
    const yRange = viewport.yByPlot[plotBuffer.plotId];

    if (cssRect === undefined || yRange === undefined) {
      continue;
    }

    items.push({
      bufferIndex: plotIndex,
      cssRect,
      deviceRect: rectToDevicePixels(cssRect, pixelRatio),
      plotId: plotBuffer.plotId,
      sharedXRange: viewport.x,
      yKey: plotBuffer.yKey,
      yRange,
    });
    plotAreaPx +=
      Math.max(0, Math.floor(cssRect.widthCssPx * pixelRatio)) *
      Math.max(0, Math.floor(cssRect.heightCssPx * pixelRatio));
  }

  return {
    items,
    plotAreaPx,
    sharedSourceBuffers: true,
    subplotCount: items.length,
  };
}

function applyFastScatterBlendPolicy(
  gl: WebGL2RenderingContext,
  policy: Pick<FastScatterAlphaPolicy, 'blendMode'>,
): void {
  if (policy.blendMode === 'one-zero') {
    gl.disable(gl.BLEND);
    return;
  }

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

function applyDeviceViewport(
  gl: WebGL2RenderingContext,
  canvasHeight: number,
  deviceRect: FastScatterPlotRect,
): void {
  const y = Math.max(0, canvasHeight - deviceRect.yCssPx - deviceRect.heightCssPx);
  gl.viewport(
    deviceRect.xCssPx,
    y,
    deviceRect.widthCssPx,
    deviceRect.heightCssPx,
  );
  gl.scissor(
    deviceRect.xCssPx,
    y,
    deviceRect.widthCssPx,
    deviceRect.heightCssPx,
  );
}

function clampUnitFraction(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function createSelectedFractionArray(
  selectedCounts: Uint32Array,
  counts: Uint32Array,
): Float32Array {
  const values = new Float32Array(counts.length);
  for (let index = 0; index < counts.length; index += 1) {
    values[index] = clampUnitFraction(
      (selectedCounts[index] ?? 0) / Math.max(1, counts[index] ?? 0),
    );
  }

  return values;
}

function collectPopulatedHeatmapCellIndices(
  aggregation: FastScatterHeatmapAggregationSet['subplots'][number],
): number[] {
  const indices: number[] = [];
  for (let index = 0; index < aggregation.cellCount; index += 1) {
    if ((aggregation.counts[index] ?? 0) > 0) {
      indices.push(index);
    }
  }

  return indices;
}

function createRequiredBuffer(
  gl: WebGL2RenderingContext,
  label: string,
): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (buffer === null) {
    throw new Error(`Fast scatter WebGL2 ${label} could not be allocated.`);
  }

  return buffer;
}

function getHoverOverlayColor(
  theme: FastScatterTheme,
): readonly [number, number, number, number] {
  return isDarkTheme(theme) ? HOVER_OVERLAY_COLOR_DARK : HOVER_OVERLAY_COLOR_LIGHT;
}

function getHeatmapBorderColor(
  theme: FastScatterTheme,
): readonly [number, number, number, number] {
  return isDarkTheme(theme)
    ? [1, 1, 1, 1]
    : [0.08, 0.12, 0.18, 1];
}

function isDarkTheme(theme: FastScatterTheme): boolean {
  const background = theme.backgroundColor;
  const luminance =
    0.2126 * background[0] + 0.7152 * background[1] + 0.0722 * background[2];

  return luminance < 0.5;
}

function sumBubbleVisiblePointCount(
  subplots: readonly FastScatterBubbleAggregationSet['subplots'][number][],
): number {
  let total = 0;
  for (const subplot of subplots) {
    total += subplot.singletonCount;
    for (const count of subplot.counts) {
      total += count;
    }
  }

  return total;
}

function sumHeatmapVisiblePointCount(
  subplots: readonly FastScatterHeatmapAggregationSet['subplots'][number][],
): number {
  let total = 0;
  for (const subplot of subplots) {
    for (const count of subplot.counts) {
      total += count;
    }
  }

  return total;
}

function sumUploadBytes(
  buffers: readonly Pick<BubbleAggregateBuffers | HeatmapAggregateBuffers, 'uploadBytes'>[],
): number {
  return buffers.reduce((total, buffer) => total + buffer.uploadBytes, 0);
}

function toFloat32Array(values: ArrayLike<number>): Float32Array {
  if (values instanceof Float32Array) {
    return values;
  }

  return Float32Array.from(values);
}

function createDefaultShapeCodes(pointCount: number): Uint8Array {
  return new Uint8Array(pointCount);
}

function createDefaultFloat32(pointCount: number, value: number): Float32Array {
  const values = new Float32Array(pointCount);
  values.fill(value);

  return values;
}

function estimateUploadBytes(
  columns: FastScatterPointColumns,
  spec: FastScatterPlotSpec,
): number {
  const pointCount = columns.x.length;
  let bytes =
    pointCount * Float32Array.BYTES_PER_ELEMENT + // x
    pointCount * DEFAULT_THEME.defaultPointColor.length + // color
    pointCount * Float32Array.BYTES_PER_ELEMENT * 3 + // opacity, rotation, size
    pointCount * Uint8Array.BYTES_PER_ELEMENT + // shape
    UNIT_QUAD_TRIANGLES.byteLength;

  for (const plot of spec.plots) {
    const column = columns.y[plot.yKey];
    if (column !== undefined) {
      bytes += column.length * Float32Array.BYTES_PER_ELEMENT;
    }
  }

  return bytes;
}

function normalizeDevicePixelRatio(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
    return 1;
  }

  return Math.min(4, devicePixelRatio);
}

function toRgba8Array(
  color: FastScatterPointColumns['color'],
  colorFormat: FastScatterPointColumns['colorFormat'],
  pointCount: number,
  defaultColor: readonly [number, number, number, number] =
    DEFAULT_THEME.defaultPointColor,
): Uint8Array {
  if (color === undefined) {
    const colors = new Uint8Array(pointCount * defaultColor.length);

    for (let offset = 0; offset < colors.length; offset += defaultColor.length) {
      colors.set(defaultColor, offset);
    }

    return colors;
  }

  if (color instanceof Uint8Array) {
    if (colorFormat !== undefined && colorFormat !== 'rgba8') {
      throw new Error('Fast scatter Uint8 color columns must use rgba8 format.');
    }

    return color;
  }

  if (colorFormat !== 'rgba32') {
    throw new Error('Fast scatter Uint32 color columns must use rgba32 format.');
  }

  const colors = new Uint8Array(pointCount * defaultColor.length);
  for (let index = 0; index < pointCount; index += 1) {
    const packed = color[index] ?? 0x000000ff;
    const offset = index * defaultColor.length;
    colors[offset] = (packed >>> 24) & 0xff;
    colors[offset + 1] = (packed >>> 16) & 0xff;
    colors[offset + 2] = (packed >>> 8) & 0xff;
    colors[offset + 3] = packed & 0xff;
  }

  return colors;
}
