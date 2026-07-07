import { pixelToAxis, type FastScatterPlotRect } from './transforms.js';
import type {
  FastScatterAxisMode,
  FastScatterRange,
  FastScatterViewport,
} from './types.js';

export interface FastScatterWheelZoomInput {
  axisMode: FastScatterAxisMode;
  deltaMode: number;
  deltaY: number;
  plotRects: readonly FastScatterPlotRect[];
  pointerCssX: number;
  pointerCssY: number;
  viewport: FastScatterViewport;
}

export interface FastScatterWheelZoomResult {
  plotId: string;
  scale: number;
  viewport: FastScatterViewport;
}

export interface FastScatterRectangleZoomFeedbackInput {
  axisMode: FastScatterAxisMode;
  axisModeStrategy?: FastScatterRectangleZoomAxisModeStrategy;
  currentPointerCssX: number;
  currentPointerCssY: number;
  plotRect: FastScatterPlotRect;
  startPointerCssX: number;
  startPointerCssY: number;
}

export interface FastScatterRectangleZoomInput
  extends FastScatterRectangleZoomFeedbackInput {
  minSpanCssPx?: number;
  viewport: FastScatterViewport;
}

export interface FastScatterRectangleZoomFeedback {
  heightCssPx: number;
  plotId: string;
  widthCssPx: number;
  xCssPx: number;
  yCssPx: number;
}

export interface FastScatterRectangleZoomResult {
  plotId: string;
  viewport: FastScatterViewport;
  zoomRect: FastScatterRectangleZoomFeedback;
}

export type FastScatterRectangleZoomAxisModeStrategy = 'auto' | 'fixed';

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const LINE_DELTA_PX = 16;
const PAGE_DELTA_PX = 640;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const MIN_ZOOM_SPAN = 1e-9;
const DEFAULT_RECTANGLE_ZOOM_MIN_SPAN_CSS_PX = 4;

export function resolveFastScatterRectangleZoomAxisMode({
  currentPointerCssX,
  currentPointerCssY,
  startPointerCssX,
  startPointerCssY,
}: Pick<
  FastScatterRectangleZoomFeedbackInput,
  'currentPointerCssX' | 'currentPointerCssY' | 'startPointerCssX' | 'startPointerCssY'
>): FastScatterAxisMode {
  const deltaX = Math.abs(currentPointerCssX - startPointerCssX);
  const deltaY = Math.abs(currentPointerCssY - startPointerCssY);

  return deltaX >= deltaY ? 'x' : 'y';
}

export function resolveFastScatterRectangleZoomEffectiveAxisMode(
  input: Pick<
    FastScatterRectangleZoomFeedbackInput,
    | 'axisMode'
    | 'axisModeStrategy'
    | 'currentPointerCssX'
    | 'currentPointerCssY'
    | 'startPointerCssX'
    | 'startPointerCssY'
  >,
): FastScatterAxisMode {
  if (input.axisMode !== 'xy' || input.axisModeStrategy === 'fixed') {
    return input.axisMode;
  }

  return resolveFastScatterRectangleZoomAxisMode(input);
}

export function zoomFastScatterViewportAtPointer(
  input: FastScatterWheelZoomInput,
): FastScatterWheelZoomResult | null {
  if (!Number.isFinite(input.deltaY) || input.deltaY === 0) {
    return null;
  }

  const plotRect = findFastScatterPlotRectAtPoint(
    input.plotRects,
    input.pointerCssX,
    input.pointerCssY,
  );

  if (plotRect === null) {
    return null;
  }

  const scale = Math.exp(
    normalizeWheelDeltaY(input.deltaY, input.deltaMode) * WHEEL_ZOOM_SENSITIVITY,
  );
  const zoomX = input.axisMode === 'x' || input.axisMode === 'xy';
  const zoomY = input.axisMode === 'y' || input.axisMode === 'xy';
  const yRange = input.viewport.yByPlot[plotRect.id];

  if ((zoomX && input.viewport.x === undefined) || (zoomY && yRange === undefined)) {
    return null;
  }

  return {
    plotId: plotRect.id,
    scale,
    viewport: {
      x: zoomX
        ? zoomRangeAtPixel(
            input.viewport.x,
            input.pointerCssX,
            plotRect.xCssPx,
            plotRect.xCssPx + plotRect.widthCssPx,
            scale,
          )
        : input.viewport.x,
      yByPlot:
        zoomY && yRange !== undefined
          ? {
              ...input.viewport.yByPlot,
              [plotRect.id]: zoomRangeAtPixel(
                yRange,
                input.pointerCssY,
                plotRect.yCssPx + plotRect.heightCssPx,
                plotRect.yCssPx,
                scale,
              ),
            }
          : input.viewport.yByPlot,
    },
  };
}

export function findFastScatterPlotRectAtPoint(
  plotRects: readonly FastScatterPlotRect[],
  pointerCssX: number,
  pointerCssY: number,
): FastScatterPlotRect | null {
  if (!Number.isFinite(pointerCssX) || !Number.isFinite(pointerCssY)) {
    return null;
  }

  return (
    plotRects.find(
      (rect) =>
        pointerCssX >= rect.xCssPx &&
        pointerCssX <= rect.xCssPx + rect.widthCssPx &&
        pointerCssY >= rect.yCssPx &&
        pointerCssY <= rect.yCssPx + rect.heightCssPx,
    ) ?? null
  );
}

export function createFastScatterRectangleZoomFeedback(
  input: FastScatterRectangleZoomFeedbackInput,
): FastScatterRectangleZoomFeedback | null {
  if (
    !Number.isFinite(input.startPointerCssX) ||
    !Number.isFinite(input.startPointerCssY) ||
    !Number.isFinite(input.currentPointerCssX) ||
    !Number.isFinite(input.currentPointerCssY)
  ) {
    return null;
  }

  const plotXMin = input.plotRect.xCssPx;
  const plotXMax = input.plotRect.xCssPx + input.plotRect.widthCssPx;
  const plotYMin = input.plotRect.yCssPx;
  const plotYMax = input.plotRect.yCssPx + input.plotRect.heightCssPx;
  const startX = clamp(input.startPointerCssX, plotXMin, plotXMax);
  const currentX = clamp(input.currentPointerCssX, plotXMin, plotXMax);
  const startY = clamp(input.startPointerCssY, plotYMin, plotYMax);
  const currentY = clamp(input.currentPointerCssY, plotYMin, plotYMax);

  const zoomAxisMode = resolveFastScatterRectangleZoomEffectiveAxisMode(input);
  const zoomX = zoomAxisMode === 'x' || zoomAxisMode === 'xy';
  const zoomY = zoomAxisMode === 'y' || zoomAxisMode === 'xy';
  const xMin = zoomX ? Math.min(startX, currentX) : plotXMin;
  const xMax = zoomX ? Math.max(startX, currentX) : plotXMax;
  const yMin = zoomY ? Math.min(startY, currentY) : plotYMin;
  const yMax = zoomY ? Math.max(startY, currentY) : plotYMax;

  return {
    heightCssPx: yMax - yMin,
    plotId: input.plotRect.id,
    widthCssPx: xMax - xMin,
    xCssPx: xMin,
    yCssPx: yMin,
  };
}

export function zoomFastScatterViewportToRectangle(
  input: FastScatterRectangleZoomInput,
): FastScatterRectangleZoomResult | null {
  const zoomRect = createFastScatterRectangleZoomFeedback(input);

  if (zoomRect === null) {
    return null;
  }

  const minSpanCssPx =
    input.minSpanCssPx ?? DEFAULT_RECTANGLE_ZOOM_MIN_SPAN_CSS_PX;
  const zoomAxisMode = resolveFastScatterRectangleZoomEffectiveAxisMode(input);
  const zoomX = zoomAxisMode === 'x' || zoomAxisMode === 'xy';
  const zoomY = zoomAxisMode === 'y' || zoomAxisMode === 'xy';
  const yRange = input.viewport.yByPlot[input.plotRect.id];

  if ((zoomX && zoomRect.widthCssPx < minSpanCssPx) || (zoomY && zoomRect.heightCssPx < minSpanCssPx)) {
    return null;
  }

  if ((zoomX && input.viewport.x === undefined) || (zoomY && yRange === undefined)) {
    return null;
  }

  const xRange = zoomX
    ? rangeFromPixels(
        zoomRect.xCssPx,
        zoomRect.xCssPx + zoomRect.widthCssPx,
        input.viewport.x,
        input.plotRect.xCssPx,
        input.plotRect.xCssPx + input.plotRect.widthCssPx,
      )
    : input.viewport.x;
  const nextYRange =
    zoomY && yRange !== undefined
      ? rangeFromPixels(
          zoomRect.yCssPx + zoomRect.heightCssPx,
          zoomRect.yCssPx,
          yRange,
          input.plotRect.yCssPx + input.plotRect.heightCssPx,
          input.plotRect.yCssPx,
        )
      : undefined;

  if (xRange === null || (zoomY && nextYRange === null)) {
    return null;
  }

  const yByPlot =
    zoomY && nextYRange !== null && nextYRange !== undefined
      ? {
          ...input.viewport.yByPlot,
          [input.plotRect.id]: nextYRange,
        }
      : input.viewport.yByPlot;

  return {
    plotId: input.plotRect.id,
    viewport: {
      x: xRange,
      yByPlot,
    },
    zoomRect,
  };
}

function normalizeWheelDeltaY(deltaY: number, deltaMode: number): number {
  if (deltaMode === DOM_DELTA_LINE) {
    return deltaY * LINE_DELTA_PX;
  }

  if (deltaMode === DOM_DELTA_PAGE) {
    return deltaY * PAGE_DELTA_PX;
  }

  return deltaY;
}

function zoomRangeAtPixel(
  range: FastScatterRange,
  pointerCssPx: number,
  pixelMin: number,
  pixelMax: number,
  scale: number,
): FastScatterRange {
  const anchor = pixelToAxis(pointerCssPx, range, pixelMin, pixelMax);
  const min = anchor - (anchor - range.min) * scale;
  const max = anchor + (range.max - anchor) * scale;

  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    return range;
  }

  if (max - min < MIN_ZOOM_SPAN) {
    const center = (min + max) / 2;
    return { min: center - MIN_ZOOM_SPAN / 2, max: center + MIN_ZOOM_SPAN / 2 };
  }

  return { min, max };
}

function rangeFromPixels(
  firstCssPx: number,
  secondCssPx: number,
  range: FastScatterRange,
  pixelMin: number,
  pixelMax: number,
): FastScatterRange | null {
  const first = pixelToAxis(firstCssPx, range, pixelMin, pixelMax);
  const second = pixelToAxis(secondCssPx, range, pixelMin, pixelMax);
  const min = Math.min(first, second);
  const max = Math.max(first, second);

  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    return null;
  }

  if (max - min < MIN_ZOOM_SPAN) {
    const center = (min + max) / 2;
    return { min: center - MIN_ZOOM_SPAN / 2, max: center + MIN_ZOOM_SPAN / 2 };
  }

  return { min, max };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
