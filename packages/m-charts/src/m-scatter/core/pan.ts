import { pixelToAxis, type FastScatterPlotRect } from './transforms.js';
import type {
  FastScatterAxisMode,
  FastScatterRange,
  FastScatterViewport,
} from './types.js';
import { findFastScatterPlotRectAtPoint } from './zoom.js';

export interface FastScatterStepPanInput {
  axisMode: FastScatterAxisMode;
  fraction: number;
  plotId: string;
  viewport: FastScatterViewport;
}

export interface FastScatterFramePanInput {
  fraction?: number;
  viewport: FastScatterViewport;
}

export interface FastScatterDragPanInput {
  axisMode: FastScatterAxisMode;
  currentPointerCssX: number;
  currentPointerCssY: number;
  plotId: string;
  plotRects: readonly FastScatterPlotRect[];
  startPointerCssX: number;
  startPointerCssY: number;
  startViewport: FastScatterViewport;
}

export interface FastScatterDragPanResult {
  deltaX: number;
  deltaY: number;
  plotId: string;
  viewport: FastScatterViewport;
}

export function startFastScatterDragPan(
  plotRects: readonly FastScatterPlotRect[],
  pointerCssX: number,
  pointerCssY: number,
): FastScatterPlotRect | null {
  return findFastScatterPlotRectAtPoint(plotRects, pointerCssX, pointerCssY);
}

export function panFastScatterViewportFromDrag(
  input: FastScatterDragPanInput,
): FastScatterDragPanResult | null {
  const plotRect =
    input.plotRects.find((rect) => rect.id === input.plotId) ?? null;

  if (plotRect === null) {
    return null;
  }

  const panX = input.axisMode === 'x' || input.axisMode === 'xy';
  const panY = input.axisMode === 'y' || input.axisMode === 'xy';
  const yRange = input.startViewport.yByPlot[plotRect.id];

  if ((panX && input.startViewport.x === undefined) || (panY && yRange === undefined)) {
    return null;
  }

  const deltaX = panX
    ? calculatePanDelta(
        input.startViewport.x,
        input.startPointerCssX,
        input.currentPointerCssX,
        plotRect.xCssPx,
        plotRect.xCssPx + plotRect.widthCssPx,
      )
    : 0;
  const deltaY =
    panY && yRange !== undefined
      ? calculatePanDelta(
          yRange,
          input.startPointerCssY,
          input.currentPointerCssY,
          plotRect.yCssPx + plotRect.heightCssPx,
          plotRect.yCssPx,
        )
      : 0;

  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    return null;
  }

  return {
    deltaX,
    deltaY,
    plotId: plotRect.id,
    viewport: {
      x: panX
        ? shiftRange(input.startViewport.x, deltaX)
        : input.startViewport.x,
      yByPlot:
        panY && yRange !== undefined
          ? {
              ...input.startViewport.yByPlot,
              [plotRect.id]: shiftRange(yRange, deltaY),
            }
          : input.startViewport.yByPlot,
    },
  };
}

export function panFastScatterViewportByStep(
  input: FastScatterStepPanInput,
): FastScatterViewport | null {
  if (!Number.isFinite(input.fraction) || input.fraction === 0) {
    return null;
  }

  const nextX =
    input.axisMode === 'x' || input.axisMode === 'xy'
      ? shiftRangeByFraction(input.viewport.x, input.fraction)
      : input.viewport.x;
  const plotYRange = input.viewport.yByPlot[input.plotId];

  if (
    (input.axisMode === 'y' || input.axisMode === 'xy') &&
    plotYRange === undefined
  ) {
    return null;
  }

  return {
    x: nextX,
    yByPlot:
      input.axisMode === 'y' || input.axisMode === 'xy'
        ? {
            ...input.viewport.yByPlot,
            [input.plotId]: shiftRangeByFraction(plotYRange!, input.fraction),
          }
        : input.viewport.yByPlot,
  };
}

export function panFastScatterViewportByFrame(
  input: FastScatterFramePanInput,
): FastScatterViewport | null {
  const fraction = input.fraction ?? 1;

  if (!Number.isFinite(fraction) || fraction === 0) {
    return null;
  }

  return {
    x: shiftRangeByFraction(input.viewport.x, fraction),
    yByPlot: input.viewport.yByPlot,
  };
}

function calculatePanDelta(
  range: FastScatterRange,
  startPointerCssPx: number,
  currentPointerCssPx: number,
  pixelMin: number,
  pixelMax: number,
): number {
  return (
    pixelToAxis(startPointerCssPx, range, pixelMin, pixelMax) -
    pixelToAxis(currentPointerCssPx, range, pixelMin, pixelMax)
  );
}

function shiftRange(range: FastScatterRange, delta: number): FastScatterRange {
  const min = range.min + delta;
  const max = range.max + delta;

  return Number.isFinite(min) && Number.isFinite(max) && min < max
    ? { min, max }
    : range;
}

function shiftRangeByFraction(
  range: FastScatterRange,
  fraction: number,
): FastScatterRange {
  return shiftRange(range, (range.max - range.min) * fraction);
}
