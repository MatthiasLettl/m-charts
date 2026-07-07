import type {
  FastScatterPlotSpec,
  FastScatterRange,
  FastScatterViewport,
} from './types.js';

export interface FastScatterViewportSyncSummary {
  changedYPlotIds: string[];
  unchangedYPlotIds: string[];
  xChanged: boolean;
}

const RANGE_EPSILON = 1e-9;

export function summarizeFastScatterViewportSync(
  previous: FastScatterViewport,
  next: FastScatterViewport,
  spec: FastScatterPlotSpec,
): FastScatterViewportSyncSummary {
  const changedYPlotIds: string[] = [];
  const unchangedYPlotIds: string[] = [];

  for (const plot of spec.plots) {
    const previousRange = previous.yByPlot[plot.id];
    const nextRange = next.yByPlot[plot.id];

    if (previousRange === undefined || nextRange === undefined) {
      changedYPlotIds.push(plot.id);
      continue;
    }

    if (areFastScatterRangesEqual(previousRange, nextRange)) {
      unchangedYPlotIds.push(plot.id);
    } else {
      changedYPlotIds.push(plot.id);
    }
  }

  return {
    changedYPlotIds,
    unchangedYPlotIds,
    xChanged: !areFastScatterRangesEqual(previous.x, next.x),
  };
}

export function createFastScatterViewportWithSharedX(
  viewport: FastScatterViewport,
  x: FastScatterRange,
): FastScatterViewport {
  return {
    x,
    yByPlot: viewport.yByPlot,
  };
}

export function areFastScatterRangesEqual(
  first: FastScatterRange,
  second: FastScatterRange,
): boolean {
  return (
    Math.abs(first.min - second.min) <= RANGE_EPSILON &&
    Math.abs(first.max - second.max) <= RANGE_EPSILON
  );
}
