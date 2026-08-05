import {
  PARALLEL_ABOVE_VIEWPORT_DISPLAY_VALUE,
  PARALLEL_AXIS_MAX_DISPLAY_VALUE,
  PARALLEL_AXIS_MIN_DISPLAY_VALUE,
  PARALLEL_BELOW_VIEWPORT_DISPLAY_VALUE,
  PARALLEL_MISSING_AXIS_DISPLAY_VALUE,
  readParallelNormalizedValue,
  type ParallelBuffers,
  type ParallelAxisViewports,
  type ParallelWebgl2HoverDrawMetrics,
  type ParallelWebgl2HoverOverlayRendererOptions,
  type ParallelWebgl2HoverUpdateMetrics,
} from '../../m-parallel/core/index.js';
import type { ParallelFastHoverRendererLike } from '../../m-parallel/engine/index.js';
import type { ParallelFastTheme } from '../../m-parallel/index.js';

const DEFAULT_HOVER = [0.98, 0.72, 0.08, 1] as const;

export class ParallelCanvasHoverRenderer implements ParallelFastHoverRendererLike {
  private axisViewports: ParallelAxisViewports = {};
  private sourceIndex: number | null = null;
  private theme?: ParallelFastTheme;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly buffers: ParallelBuffers,
    options: ParallelWebgl2HoverOverlayRendererOptions,
  ) {
    this.theme = options.theme;
  }

  clear(): ParallelWebgl2HoverDrawMetrics | null {
    this.sourceIndex = null;
    return this.draw();
  }

  dispose(): void {
    this.sourceIndex = null;
    this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(): ParallelWebgl2HoverDrawMetrics | null {
    const startedAt = performance.now();
    const context = this.canvas.getContext('2d');
    if (context === null) return null;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const sourceIndex = this.sourceIndex;
    if (sourceIndex !== null && this.buffers.axisCount > 0) {
      const color = this.theme?.selectedColor ?? DEFAULT_HOVER;
      context.strokeStyle = `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${color[3]})`;
      context.lineWidth = Math.max(2, globalThis.devicePixelRatio || 1);
      context.beginPath();
      for (let axisIndex = 0; axisIndex < this.buffers.axisCount; axisIndex += 1) {
        const axis = this.buffers.axisOrder[axisIndex]!;
        const raw = this.buffers.rawValuesByAxis[axis]?.[sourceIndex] ?? Number.NaN;
        const domain = this.buffers.domainsByAxis[axis];
        const viewport = this.axisViewports[axis];
        const value =
          viewport !== null && viewport !== undefined && domain !== undefined
            ? (raw - viewport.min) /
              Math.max(Number.EPSILON, viewport.max - viewport.min)
            : readParallelNormalizedValue(this.buffers, axis, sourceIndex);
        const display = !Number.isFinite(value)
          ? PARALLEL_MISSING_AXIS_DISPLAY_VALUE
          : value < 0
            ? PARALLEL_BELOW_VIEWPORT_DISPLAY_VALUE
            : value > 1
              ? PARALLEL_ABOVE_VIEWPORT_DISPLAY_VALUE
              : PARALLEL_AXIS_MIN_DISPLAY_VALUE +
                value *
                  (PARALLEL_AXIS_MAX_DISPLAY_VALUE -
                    PARALLEL_AXIS_MIN_DISPLAY_VALUE);
        const x = this.buffers.axisCount <= 1
          ? this.canvas.width / 2
          : (axisIndex / (this.buffers.axisCount - 1)) * this.canvas.width;
        const y = (1 - display) * this.canvas.height;
        if (axisIndex === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }
    return {
      drawCallCount: sourceIndex === null ? 0 : 1,
      redrawMs: performance.now() - startedAt,
    };
  }

  setHoverSourceIndex(
    _buffers: ParallelBuffers,
    sourceIndex: number | null,
  ): ParallelWebgl2HoverUpdateMetrics {
    const startedAt = performance.now();
    const changed = sourceIndex !== this.sourceIndex;
    this.sourceIndex = sourceIndex;
    return {
      baseRedrawMs: null,
      changed,
      gpuUploadMs: 0,
      hoverRecordIndex: sourceIndex,
      hoverSegmentCount:
        sourceIndex === null ? 0 : Math.max(0, this.buffers.axisCount - 1),
      hoverVertexCount:
        sourceIndex === null ? 0 : Math.max(0, this.buffers.axisCount - 1) * 2,
      skipped: !changed,
      updateMs: performance.now() - startedAt,
      uploadBytes: 0,
    };
  }

  updateTheme(theme: ParallelFastTheme | undefined): void {
    this.theme = theme;
  }

  updateAxisViewports(axisViewports: ParallelAxisViewports): void {
    this.axisViewports = axisViewports;
  }
}
