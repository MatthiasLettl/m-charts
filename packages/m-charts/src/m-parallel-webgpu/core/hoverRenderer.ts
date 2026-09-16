import { clientRowIsActive } from '../../client-data-view/core/chartProjection.js';
import {
  PARALLEL_ABOVE_VIEWPORT_DISPLAY_VALUE,
  PARALLEL_AXIS_MAX_DISPLAY_VALUE,
  PARALLEL_AXIS_MIN_DISPLAY_VALUE,
  PARALLEL_BELOW_VIEWPORT_DISPLAY_VALUE,
  PARALLEL_MISSING_AXIS_DISPLAY_VALUE,
  type ParallelCompactNumericView,
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
  private sourceIndices: Uint32Array = new Uint32Array(0);
  private theme?: ParallelFastTheme;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private buffers: ParallelBuffers,
    options: ParallelWebgl2HoverOverlayRendererOptions,
    private readonly drawGpuGroup?: (canvas: HTMLCanvasElement, indices: Uint32Array, color: readonly number[]) => boolean,
  ) {
    this.theme = options.theme;
  }

  clear(): ParallelWebgl2HoverDrawMetrics | null {
    this.sourceIndices = new Uint32Array(0);
    return this.draw();
  }

  dispose(): void {
    this.sourceIndices = new Uint32Array(0);
    this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(): ParallelWebgl2HoverDrawMetrics | null {
    const startedAt = performance.now();
    const context = this.canvas.getContext('2d');
    if (context === null) return null;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const sourceIndices = this.sourceIndices;
    if (sourceIndices.length > 0 && this.buffers.axisCount > 0) {
      const color = this.theme?.selectedColor ?? DEFAULT_HOVER;
      if (sourceIndices.length >= 4096 && this.drawGpuGroup?.(this.canvas, sourceIndices, color)) {
        return { drawCallCount: 1, redrawMs: performance.now() - startedAt };
      }
      context.strokeStyle = `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${color[3]})`;
      const grouped = sourceIndices.length > 1;
      context.globalAlpha = grouped ? 0.7 : 1;
      context.lineWidth = (grouped ? 1 : 2) * (globalThis.devicePixelRatio || 1);
      context.beginPath();
      // The overlay is a union of paths, not an opacity/count encoding. Merge
      // repeated screen segments at quarter-device-pixel resolution so dense
      // categorical bundles do not send millions of identical Canvas commands.
      // Every record still contributes; endpoint displacement is at most 1/8 px.
      const segmentKeys = grouped
        ? Array.from({ length: this.buffers.axisCount - 1 }, () => new Set<number>())
        : null;
      const coordinateSpan = this.canvas.height * 4 + 1;
      const xByAxis = Array.from({ length: this.buffers.axisCount }, (_, axisIndex) =>
        this.buffers.axisCount <= 1 ? this.canvas.width / 2 :
          (axisIndex / (this.buffers.axisCount - 1)) * this.canvas.width);
      const readers = this.buffers.axisOrder.map((axis) => {
        const domain = this.buffers.domainsByAxis[axis];
        const viewport = this.axisViewports[axis];
        const projected = viewport != null && domain !== undefined;
        const derived = projected || this.buffers.normalizedValuesDerivedFromRaw === true;
        const values = derived ? this.buffers.rawValuesByAxis[axis] :
          this.buffers.normalizedValuesByAxis[axis];
        const compactGetter = (values as ParallelCompactNumericView | undefined)?.__parallelCompactGetValue;
        const read = compactGetter ?? ((index: number) => values?.[index] ?? Number.NaN);
        if (!derived) return read;
        const min = projected ? viewport.min : domain?.min ?? Number.NaN;
        const span = projected ? Math.max(Number.EPSILON, viewport.max - viewport.min) :
          domain?.span ?? Number.NaN;
        return (index: number) => {
          const raw = read(index);
          return !Number.isFinite(raw) ? Number.NaN : span === 0 ? 0.5 : (raw - min) / span;
        };
      });
      for (const sourceIndex of sourceIndices) {
        if (!clientRowIsActive(this.buffers.activeMask, sourceIndex)) continue;
        let previousY = 0;
        for (let axisIndex = 0; axisIndex < this.buffers.axisCount; axisIndex += 1) {
          const value = readers[axisIndex]!(sourceIndex);
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
          const y = (1 - display) * this.canvas.height;
          if (segmentKeys === null) {
            if (axisIndex === 0) context.moveTo(xByAxis[axisIndex]!, y);
            else context.lineTo(xByAxis[axisIndex]!, y);
          } else if (axisIndex > 0) {
            const startY = Math.round(previousY * 4);
            const endY = Math.round(y * 4);
            const key = startY * coordinateSpan + endY;
            const keys = segmentKeys[axisIndex - 1]!;
            if (!keys.has(key)) {
              keys.add(key);
              context.moveTo(xByAxis[axisIndex - 1]!, startY / 4);
              context.lineTo(xByAxis[axisIndex]!, endY / 4);
            }
          }
          previousY = y;
        }
      }
      context.stroke();
      context.globalAlpha = 1;
    }
    return {
      drawCallCount: sourceIndices.length === 0 ? 0 : 1,
      redrawMs: performance.now() - startedAt,
    };
  }

  setHoverSourceIndex(
    buffers: ParallelBuffers,
    sourceIndex: number | null,
  ): ParallelWebgl2HoverUpdateMetrics {
    if (buffers === this.buffers &&
      (sourceIndex === null ? this.sourceIndices.length === 0 :
        this.sourceIndices.length === 1 && this.sourceIndices[0] === sourceIndex)) {
      return this.setHoverSourceIndices(buffers, this.sourceIndices);
    }
    return this.setHoverSourceIndices(
      buffers, sourceIndex === null ? new Uint32Array(0) : new Uint32Array([sourceIndex]),
    );
  }

  setHoverSourceIndices(
    buffers: ParallelBuffers,
    sourceIndices: Uint32Array,
  ): ParallelWebgl2HoverUpdateMetrics {
    const startedAt = performance.now();
    const changed = buffers !== this.buffers || (sourceIndices !== this.sourceIndices &&
      (sourceIndices.length >= 4096 || sourceIndices.length !== this.sourceIndices.length ||
        sourceIndices.some((index, position) => index !== this.sourceIndices[position])));
    this.buffers = buffers;
    this.sourceIndices = sourceIndices;
    const segmentCount = sourceIndices.length * Math.max(0, buffers.axisCount - 1);
    return {
      baseRedrawMs: null,
      changed,
      gpuUploadMs: 0,
      hoverRecordIndex: sourceIndices[0] ?? null,
      hoverSegmentCount: segmentCount,
      hoverVertexCount: segmentCount * 2,
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
