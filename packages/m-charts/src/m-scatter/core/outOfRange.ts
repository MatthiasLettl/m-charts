import type {
  FastScatterPlotSpec,
  FastScatterPointColumns,
  FastScatterViewport,
} from './types.js';
import type { FastScatterPlotRect } from './transforms.js';
import { axisToPixel } from './transforms.js';

export interface FastScatterOutOfRangeInput {
  columns: FastScatterPointColumns;
  spec: FastScatterPlotSpec;
  viewport: FastScatterViewport;
  plotRects: readonly FastScatterPlotRect[];
  maxMarkersPerSide?: number;
  minBinSizeCssPx?: number;
}

export interface FastScatterOutOfRangeMarker {
  axis: 'x' | 'y';
  count: number;
  plotId: string;
  side: 'left' | 'right' | 'top' | 'bottom';
  sourceIndex: number;
  xCssPx: number;
  yCssPx: number;
}

export interface FastScatterOutOfRangeResult {
  candidateCount: number;
  durationMs: number;
  markers: readonly FastScatterOutOfRangeMarker[];
  markerCount: number;
}

interface OverflowBin {
  count: number;
  distanceToBoundary: number;
  positionCssPx: number;
  sourceIndex: number;
}

const DEFAULT_MAX_MARKERS_PER_SIDE = 32;
const DEFAULT_MIN_BIN_SIZE_CSS_PX = 24;
const EDGE_INSET_CSS_PX = 6;

export function computeFastScatterOutOfRangeMarkers(
  input: FastScatterOutOfRangeInput,
): FastScatterOutOfRangeResult {
  const startedAt = performance.now();
  const maxMarkersPerSide = Math.max(
    0,
    Math.floor(input.maxMarkersPerSide ?? DEFAULT_MAX_MARKERS_PER_SIDE),
  );
  const minBinSizeCssPx = Math.max(1, input.minBinSizeCssPx ?? DEFAULT_MIN_BIN_SIZE_CSS_PX);

  if (maxMarkersPerSide === 0 || input.columns.x.length === 0) {
    return {
      candidateCount: 0,
      durationMs: performance.now() - startedAt,
      markerCount: 0,
      markers: [],
    };
  }

  const rectByPlotId = new Map(input.plotRects.map((rect) => [rect.id, rect]));
  const markers: FastScatterOutOfRangeMarker[] = [];
  let candidateCount = 0;

  for (const plot of input.spec.plots) {
    const rect = rectByPlotId.get(plot.id);
    const yValues = input.columns.y[plot.yKey];
    const yRange = input.viewport.yByPlot[plot.id];

    if (rect === undefined || yValues === undefined || yRange === undefined) {
      continue;
    }

    const xRange = input.viewport.x;
    const xBinCount = createBinCount(rect.widthCssPx, minBinSizeCssPx);
    const yBinCount = createBinCount(rect.heightCssPx, minBinSizeCssPx);
    const topBins = new Array<OverflowBin | undefined>(xBinCount);
    const bottomBins = new Array<OverflowBin | undefined>(xBinCount);
    const leftBins = new Array<OverflowBin | undefined>(yBinCount);
    const rightBins = new Array<OverflowBin | undefined>(yBinCount);
    const pointCount = Math.min(input.columns.x.length, yValues.length);

    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      const x = input.columns.x[pointIndex];
      const y = yValues[pointIndex];

      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }

      const sourceIndex = input.columns.sourceIndex?.[pointIndex] ?? pointIndex;
      const xVisible = x >= xRange.min && x <= xRange.max;
      const yVisible = y >= yRange.min && y <= yRange.max;

      if (xVisible && y > yRange.max) {
        candidateCount += 1;
        const xCssPx = axisToPixel(x, xRange, rect.xCssPx, rect.xCssPx + rect.widthCssPx);
        const binIndex = cssPxToBinIndex(xCssPx, rect.xCssPx, rect.widthCssPx, xBinCount);
        addOverflowBin({
          bins: topBins,
          binIndex,
          distanceToBoundary: y - yRange.max,
          positionCssPx: binCenterCssPx(topBins, binIndex, rect.xCssPx, rect.widthCssPx),
          sourceIndex,
        });
      } else if (xVisible && y < yRange.min) {
        candidateCount += 1;
        const xCssPx = axisToPixel(x, xRange, rect.xCssPx, rect.xCssPx + rect.widthCssPx);
        const binIndex = cssPxToBinIndex(xCssPx, rect.xCssPx, rect.widthCssPx, xBinCount);
        addOverflowBin({
          bins: bottomBins,
          binIndex,
          distanceToBoundary: yRange.min - y,
          positionCssPx: binCenterCssPx(bottomBins, binIndex, rect.xCssPx, rect.widthCssPx),
          sourceIndex,
        });
      }

      if (yVisible && x < xRange.min) {
        candidateCount += 1;
        const yCssPx = axisToPixel(y, yRange, rect.yCssPx + rect.heightCssPx, rect.yCssPx);
        const binIndex = cssPxToBinIndex(yCssPx, rect.yCssPx, rect.heightCssPx, yBinCount);
        addOverflowBin({
          bins: leftBins,
          binIndex,
          distanceToBoundary: xRange.min - x,
          positionCssPx: binCenterCssPx(leftBins, binIndex, rect.yCssPx, rect.heightCssPx),
          sourceIndex,
        });
      } else if (yVisible && x > xRange.max) {
        candidateCount += 1;
        const yCssPx = axisToPixel(y, yRange, rect.yCssPx + rect.heightCssPx, rect.yCssPx);
        const binIndex = cssPxToBinIndex(yCssPx, rect.yCssPx, rect.heightCssPx, yBinCount);
        addOverflowBin({
          bins: rightBins,
          binIndex,
          distanceToBoundary: x - xRange.max,
          positionCssPx: binCenterCssPx(rightBins, binIndex, rect.yCssPx, rect.heightCssPx),
          sourceIndex,
        });
      }
    }

    appendMarkers(markers, topBins, maxMarkersPerSide, (bin) => ({
      axis: 'y',
      count: bin.count,
      plotId: plot.id,
      side: 'top',
      sourceIndex: bin.sourceIndex,
      xCssPx: bin.positionCssPx,
      yCssPx: rect.yCssPx + EDGE_INSET_CSS_PX,
    }));
    appendMarkers(markers, bottomBins, maxMarkersPerSide, (bin) => ({
      axis: 'y',
      count: bin.count,
      plotId: plot.id,
      side: 'bottom',
      sourceIndex: bin.sourceIndex,
      xCssPx: bin.positionCssPx,
      yCssPx: rect.yCssPx + rect.heightCssPx - EDGE_INSET_CSS_PX,
    }));
    appendMarkers(markers, leftBins, maxMarkersPerSide, (bin) => ({
      axis: 'x',
      count: bin.count,
      plotId: plot.id,
      side: 'left',
      sourceIndex: bin.sourceIndex,
      xCssPx: rect.xCssPx + EDGE_INSET_CSS_PX,
      yCssPx: bin.positionCssPx,
    }));
    appendMarkers(markers, rightBins, maxMarkersPerSide, (bin) => ({
      axis: 'x',
      count: bin.count,
      plotId: plot.id,
      side: 'right',
      sourceIndex: bin.sourceIndex,
      xCssPx: rect.xCssPx + rect.widthCssPx - EDGE_INSET_CSS_PX,
      yCssPx: bin.positionCssPx,
    }));
  }

  return {
    candidateCount,
    durationMs: performance.now() - startedAt,
    markerCount: markers.length,
    markers,
  };
}

function createBinCount(sizeCssPx: number, minBinSizeCssPx: number): number {
  return Math.max(1, Math.ceil(Math.max(1, sizeCssPx) / minBinSizeCssPx));
}

function cssPxToBinIndex(
  cssPx: number,
  minCssPx: number,
  sizeCssPx: number,
  binCount: number,
): number {
  const normalized = sizeCssPx === 0 ? 0 : (cssPx - minCssPx) / sizeCssPx;
  return Math.min(binCount - 1, Math.max(0, Math.floor(normalized * binCount)));
}

function binCenterCssPx(
  bins: readonly (OverflowBin | undefined)[],
  binIndex: number,
  minCssPx: number,
  sizeCssPx: number,
): number {
  return minCssPx + ((binIndex + 0.5) / bins.length) * sizeCssPx;
}

function addOverflowBin({
  bins,
  binIndex,
  distanceToBoundary,
  positionCssPx,
  sourceIndex,
}: {
  bins: Array<OverflowBin | undefined>;
  binIndex: number;
  distanceToBoundary: number;
  positionCssPx: number;
  sourceIndex: number;
}): void {
  const bin = bins[binIndex];

  if (bin === undefined) {
    bins[binIndex] = {
      count: 1,
      distanceToBoundary,
      positionCssPx,
      sourceIndex,
    };
    return;
  }

  bin.count += 1;
  if (distanceToBoundary < bin.distanceToBoundary) {
    bin.distanceToBoundary = distanceToBoundary;
    bin.sourceIndex = sourceIndex;
  }
}

function appendMarkers(
  markers: FastScatterOutOfRangeMarker[],
  bins: readonly (OverflowBin | undefined)[],
  maxMarkersPerSide: number,
  createMarker: (bin: OverflowBin) => FastScatterOutOfRangeMarker,
): void {
  const occupiedBins = bins.filter((bin): bin is OverflowBin => bin !== undefined);
  const cappedBins =
    occupiedBins.length <= maxMarkersPerSide
      ? occupiedBins
      : [...occupiedBins]
          .sort((a, b) => b.count - a.count || a.positionCssPx - b.positionCssPx)
          .slice(0, maxMarkersPerSide);

  for (const bin of [...cappedBins].sort((a, b) => a.positionCssPx - b.positionCssPx)) {
    markers.push(createMarker(bin));
  }
}
