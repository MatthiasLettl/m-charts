import { materializeHistogramBinSourceIndices } from './aggregation.js';
import type {
  HistogramAggregationSet,
  HistogramBin,
  HistogramBinDescriptor,
  HistogramBinRef,
  HistogramCanvasPoint,
  HistogramHoverEvent,
  HistogramMeasurementEvent,
  HistogramMeasurementReference,
  HistogramPlotSpec,
  HistogramRange,
  HistogramSelectionKind,
  HistogramSelectionTool,
  HistogramSourceIndexArray,
  HistogramSourceIndicesStatus,
  HistogramSubplotBins,
  HistogramSubplotId,
  HistogramSubplotSpec,
  HistogramSubplotViewport,
  HistogramViewport,
} from './types.js';

export type HistogramAxisMode = 'x' | 'y' | 'xy';

export interface HistogramPlotRect {
  readonly heightCssPx: number;
  readonly id: HistogramSubplotId;
  readonly widthCssPx: number;
  readonly xCssPx: number;
  readonly yCssPx: number;
}

export interface HistogramLayout {
  readonly chartRect: HistogramPlotRect;
  readonly heightCssPx: number;
  readonly plotRects: readonly HistogramPlotRect[];
  readonly widthCssPx: number;
  readonly xAxisReservedCssPx: number;
}

export interface HistogramLayoutOptions {
  readonly contextMinHeightCssPx?: number;
  readonly contextWeight?: number;
  readonly focusedSubplotId?: HistogramSubplotId | null;
  readonly focusedWeight?: number;
  readonly gapCssPx?: number;
  readonly heightCssPx: number;
  readonly leftAxisCssPx?: number;
  readonly rightPaddingCssPx?: number;
  readonly topPaddingCssPx?: number;
  readonly widthCssPx: number;
  readonly xAxisCssPx?: number;
}

export interface HistogramPixelBounds {
  readonly maxX: number;
  readonly maxY: number;
  readonly minX: number;
  readonly minY: number;
}

export interface HistogramPoint {
  readonly x: number;
  readonly y: number;
}

export interface HistogramBinHit {
  readonly axisCount: number;
  readonly axisValue: number;
  readonly bin: HistogramBin;
  readonly binIndex: number;
  readonly binRef: HistogramBinRef;
  readonly canvasPoint: HistogramCanvasPoint;
  readonly plotRect: HistogramPlotRect;
  readonly subplot: HistogramSubplotBins;
}

export interface LocateHistogramBinInput {
  readonly aggregation: Pick<HistogramAggregationSet, 'subplots'>;
  readonly canvasX: number;
  readonly canvasY: number;
  readonly ids?: readonly string[];
  readonly layout: Pick<HistogramLayout, 'plotRects'>;
  readonly sampleSize?: number;
  readonly viewport: HistogramViewport;
}

export interface HistogramSelectionResult {
  readonly binDescriptors: readonly HistogramBinDescriptor[];
  readonly candidateBinCount: number;
  readonly kind: HistogramSelectionKind;
  readonly sampleIds: readonly string[];
  readonly selectedBinCount: number;
  readonly selectedSourceCount: number;
  readonly sourceIndices: HistogramSourceIndexArray;
  readonly sourceIndicesAvailable: boolean;
  readonly sourceIndicesStatus?: HistogramSourceIndicesStatus;
  readonly subplotId?: HistogramSubplotId;
  readonly tool: HistogramSelectionTool;
  readonly viewport: HistogramViewport;
}

export interface SelectHistogramBinsInBoundsInput {
  readonly aggregation: Pick<HistogramAggregationSet, 'subplots'>;
  readonly bounds: HistogramPixelBounds;
  readonly currentSourceIndices?: HistogramSourceIndexArray | readonly number[];
  readonly ids?: readonly string[];
  readonly kind?: HistogramSelectionKind;
  readonly layout: Pick<HistogramLayout, 'plotRects'>;
  readonly materializeSourceIndices?: boolean;
  readonly sampleSize?: number;
  readonly subplotId?: HistogramSubplotId;
  readonly viewport: HistogramViewport;
}

export interface SelectHistogramBinsInPolygonInput {
  readonly aggregation: Pick<HistogramAggregationSet, 'subplots'>;
  readonly currentSourceIndices?: HistogramSourceIndexArray | readonly number[];
  readonly ids?: readonly string[];
  readonly kind?: HistogramSelectionKind;
  readonly layout: Pick<HistogramLayout, 'plotRects'>;
  readonly materializeSourceIndices?: boolean;
  readonly points: readonly HistogramPoint[];
  readonly sampleSize?: number;
  readonly subplotId?: HistogramSubplotId;
  readonly viewport: HistogramViewport;
}

export interface HistogramRectangleZoomFeedback {
  readonly heightCssPx: number;
  readonly subplotId: HistogramSubplotId;
  readonly widthCssPx: number;
  readonly xCssPx: number;
  readonly yCssPx: number;
}

export interface HistogramRectangleZoomInput {
  readonly axisMode?: HistogramAxisMode;
  readonly axisModeStrategy?: HistogramRectangleZoomAxisModeStrategy;
  readonly currentPointerCssX: number;
  readonly currentPointerCssY: number;
  readonly minSpanCssPx?: number;
  readonly plotRect: HistogramPlotRect;
  readonly startPointerCssX: number;
  readonly startPointerCssY: number;
  readonly viewport: HistogramViewport;
}

export interface HistogramRectangleZoomResult {
  readonly subplotId: HistogramSubplotId;
  readonly viewport: HistogramViewport;
  readonly zoomRect: HistogramRectangleZoomFeedback;
}

export type HistogramRectangleZoomAxisModeStrategy = 'auto' | 'fixed';

export interface HistogramWheelZoomInput {
  readonly axisMode?: HistogramAxisMode;
  readonly deltaMode: number;
  readonly deltaY: number;
  readonly layout: Pick<HistogramLayout, 'plotRects'>;
  readonly pointerCssX: number;
  readonly pointerCssY: number;
  readonly viewport: HistogramViewport;
}

export interface HistogramWheelZoomResult {
  readonly scale: number;
  readonly subplotId: HistogramSubplotId;
  readonly viewport: HistogramViewport;
}

export interface HistogramDragPanInput {
  readonly axisMode?: HistogramAxisMode;
  readonly currentPointerCssX: number;
  readonly currentPointerCssY: number;
  readonly layout: Pick<HistogramLayout, 'plotRects'>;
  readonly startPointerCssX: number;
  readonly startPointerCssY: number;
  readonly startViewport: HistogramViewport;
  readonly subplotId: HistogramSubplotId;
}

export interface HistogramDragPanResult {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly subplotId: HistogramSubplotId;
  readonly viewport: HistogramViewport;
}

export interface HistogramMeasurementComparison {
  readonly countDelta: number;
  readonly countRatio: number | null;
  readonly rangeCenterDelta: number;
  readonly rangeMaxDelta: number;
  readonly rangeMinDelta: number;
  readonly rangeWidthDelta: number;
}

const MIN_SPAN = 1e-9;
const DEFAULT_GAP_CSS_PX = 8;
const MIN_SUBPLOT_LABEL_GAP_CSS_PX = 24;
const DEFAULT_LEFT_AXIS_CSS_PX = 96;
const DEFAULT_RIGHT_PADDING_CSS_PX = 12;
const DEFAULT_TOP_PADDING_CSS_PX = 12;
const DEFAULT_X_AXIS_CSS_PX = 42;
const DEFAULT_SELECTION_SAMPLE_SIZE = 5;
const DEFAULT_RECTANGLE_ZOOM_MIN_SPAN_CSS_PX = 4;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const LINE_DELTA_PX = 16;
const PAGE_DELTA_PX = 640;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const DEFAULT_HISTOGRAM_VIEWPORT_EDGE_PADDING_RATIO = 0.5;
const DEFAULT_HISTOGRAM_VIEWPORT_Y_HEADROOM_RATIO = 0.1;

export function resolveHistogramRectangleZoomAxisMode({
  currentPointerCssX,
  currentPointerCssY,
  startPointerCssX,
  startPointerCssY,
}: Pick<
  HistogramRectangleZoomInput,
  'currentPointerCssX' | 'currentPointerCssY' | 'startPointerCssX' | 'startPointerCssY'
>): HistogramAxisMode {
  const deltaX = Math.abs(currentPointerCssX - startPointerCssX);
  const deltaY = Math.abs(currentPointerCssY - startPointerCssY);

  return deltaX >= deltaY ? 'x' : 'y';
}

export function resolveHistogramRectangleZoomEffectiveAxisMode(
  input: Pick<
    HistogramRectangleZoomInput,
    | 'axisMode'
    | 'axisModeStrategy'
    | 'currentPointerCssX'
    | 'currentPointerCssY'
    | 'startPointerCssX'
    | 'startPointerCssY'
  >,
): HistogramAxisMode {
  const requestedAxisMode = input.axisMode ?? 'xy';
  if (requestedAxisMode !== 'xy' || input.axisModeStrategy === 'fixed') {
    return requestedAxisMode;
  }

  return resolveHistogramRectangleZoomAxisMode(input);
}

export function createHistogramLayout(
  spec: Pick<HistogramPlotSpec, 'subplots'>,
  options: HistogramLayoutOptions,
): HistogramLayout {
  const focusedSubplotId = normalizeFocusedSubplotId(
    spec.subplots,
    options.focusedSubplotId,
  );
  const subplotCount = Math.max(1, spec.subplots.length);
  const requestedGap = options.gapCssPx ?? DEFAULT_GAP_CSS_PX;
  const gap =
    subplotCount > 1
      ? Math.max(requestedGap, MIN_SUBPLOT_LABEL_GAP_CSS_PX)
      : requestedGap;
  const leftAxis = options.leftAxisCssPx ?? DEFAULT_LEFT_AXIS_CSS_PX;
  const rightPadding = options.rightPaddingCssPx ?? DEFAULT_RIGHT_PADDING_CSS_PX;
  const topPadding = options.topPaddingCssPx ?? DEFAULT_TOP_PADDING_CSS_PX;
  const xAxis = options.xAxisCssPx ?? DEFAULT_X_AXIS_CSS_PX;
  const width = Math.max(1, options.widthCssPx - leftAxis - rightPadding);
  const availableHeight = Math.max(
    1,
    options.heightCssPx - topPadding - xAxis - gap * (subplotCount - 1),
  );
  const rowHeights =
    focusedSubplotId === null
      ? Array.from({ length: spec.subplots.length }, () =>
          Math.max(1, availableHeight / subplotCount),
        )
      : createFocusedRowHeights({
          availableHeight,
          contextMinHeight: Math.max(1, options.contextMinHeightCssPx ?? 64),
          contextWeight: Math.max(0.01, options.contextWeight ?? 1),
          focusedSubplotId,
          focusedWeight: Math.max(
            options.contextWeight ?? 1,
            options.focusedWeight ?? 3.25,
          ),
          subplots: spec.subplots,
        });
  let yCssPx = topPadding;
  const plotRects = spec.subplots.map((subplot, index) => {
    const heightCssPx = rowHeights[index] ?? 1;
    const rect = {
      heightCssPx,
      id: subplot.id,
      widthCssPx: width,
      xCssPx: leftAxis,
      yCssPx,
    };
    yCssPx += heightCssPx + gap;

    return rect;
  });

  return {
    chartRect: {
      heightCssPx: Math.max(1, options.heightCssPx - topPadding - xAxis),
      id: 'histogram-chart',
      widthCssPx: width,
      xCssPx: leftAxis,
      yCssPx: topPadding,
    },
    heightCssPx: Math.max(0, options.heightCssPx),
    plotRects,
    widthCssPx: Math.max(0, options.widthCssPx),
    xAxisReservedCssPx: xAxis,
  };
}

export function histogramAxisToPixel(
  value: number,
  range: HistogramRange,
  pixelMin: number,
  pixelMax: number,
): number {
  const t = (value - range.min) / safeSpan(range);

  return pixelMin + t * (pixelMax - pixelMin);
}

export function histogramPixelToAxis(
  pixel: number,
  range: HistogramRange,
  pixelMin: number,
  pixelMax: number,
): number {
  const pixelSpan = pixelMax - pixelMin;
  if (pixelSpan === 0) {
    return range.min;
  }

  return range.min + ((pixel - pixelMin) / pixelSpan) * safeSpan(range);
}

export function createDefaultHistogramViewport(
  aggregation: Pick<HistogramAggregationSet, 'subplots'>,
): HistogramViewport {
  return {
    subplotById: Object.fromEntries(
      aggregation.subplots.map((subplot) => [
        subplot.subplotId,
        createDefaultSubplotViewport(subplot),
      ]),
    ),
  };
}

export function normalizeHistogramViewport(
  viewport: HistogramViewport | null | undefined,
  fallback: HistogramViewport,
): HistogramViewport {
  return {
    subplotById: Object.fromEntries(
      Object.entries(fallback.subplotById).map(([subplotId, fallbackViewport]) => [
        subplotId,
        normalizeSubplotViewport(
          viewport?.subplotById[subplotId],
          fallbackViewport,
        ),
      ]),
    ),
  };
}

export function findHistogramPlotRectAtPoint(
  plotRects: readonly HistogramPlotRect[],
  pointerCssX: number,
  pointerCssY: number,
): HistogramPlotRect | null {
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

export function locateHistogramBinAtPixel(
  input: LocateHistogramBinInput,
): HistogramBinHit | null {
  const plotRect = findHistogramPlotRectAtPoint(
    input.layout.plotRects,
    input.canvasX,
    input.canvasY,
  );
  if (plotRect === null) {
    return null;
  }

  const subplot = findSubplot(input.aggregation.subplots, plotRect.id);
  const subplotViewport = input.viewport.subplotById[plotRect.id];
  if (subplot === null || subplotViewport === undefined) {
    return null;
  }

  const axisValue = histogramPixelToAxis(
    input.canvasX,
    subplotViewport.x,
    plotRect.xCssPx,
    plotRect.xCssPx + plotRect.widthCssPx,
  );
  const axisCount = histogramPixelToAxis(
    input.canvasY,
    subplotViewport.y,
    plotRect.yCssPx + plotRect.heightCssPx,
    plotRect.yCssPx,
  );
  const binIndex = findBinIndexAtAxisValue(subplot, axisValue);
  if (binIndex < 0) {
    return null;
  }

  const bin = subplot.bins[binIndex];
  if (
    bin === undefined ||
    bin.totalCount <= 0 ||
    axisCount < 0 ||
    axisCount > bin.totalCount
  ) {
    return null;
  }
  const pixelBounds = binToPixelBounds(bin, plotRect, subplotViewport);
  const canvasPoint =
    pixelBounds === null
      ? { canvasX: input.canvasX, canvasY: input.canvasY }
      : {
          canvasX: (pixelBounds.minX + pixelBounds.maxX) / 2,
          canvasY: (pixelBounds.minY + pixelBounds.maxY) / 2,
        };

  return {
    axisCount,
    axisValue,
    bin,
    binIndex,
    binRef: createBinRef(subplot, bin, binIndex, input.ids, input.sampleSize),
    canvasPoint,
    plotRect,
    subplot,
  };
}

export function lookupHistogramHoverAtPixel(
  input: LocateHistogramBinInput & { readonly pinned?: boolean },
): HistogramHoverEvent | null {
  const startedAt = now();
  const hit = locateHistogramBinAtPixel(input);
  if (hit === null) {
    return null;
  }

  return {
    bin: hit.binRef,
    canvasPoint: hit.canvasPoint,
    candidateCount: hit.bin.totalCount,
    durationMs: Math.max(0, now() - startedAt),
    pinned: input.pinned ?? false,
    source: 'shift-hover',
  };
}

export function createHistogramMeasurementReference(
  hit: HistogramBinHit,
): HistogramMeasurementReference | null {
  if (hit.bin.totalCount <= 0) {
    return null;
  }

  return {
    ...hit.binRef,
    canvasPoint: hit.canvasPoint,
  };
}

export function createHistogramMeasurementEvent(
  reference: HistogramMeasurementReference,
  current: HistogramMeasurementReference | null,
): HistogramMeasurementEvent {
  return { current, reference };
}

export function compareHistogramMeasurementReferences(
  reference: HistogramMeasurementReference,
  current: HistogramMeasurementReference,
): HistogramMeasurementComparison {
  const referenceWidth = reference.bin.max - reference.bin.min;
  const currentWidth = current.bin.max - current.bin.min;
  const referenceCenter = (reference.bin.min + reference.bin.max) / 2;
  const currentCenter = (current.bin.min + current.bin.max) / 2;

  return {
    countDelta: current.count - reference.count,
    countRatio: reference.count === 0 ? null : current.count / reference.count,
    rangeCenterDelta: currentCenter - referenceCenter,
    rangeMaxDelta: current.bin.max - reference.bin.max,
    rangeMinDelta: current.bin.min - reference.bin.min,
    rangeWidthDelta: currentWidth - referenceWidth,
  };
}

export function selectHistogramBinsInBounds(
  input: SelectHistogramBinsInBoundsInput,
): HistogramSelectionResult {
  const normalizedBounds = normalizePixelBounds(input.bounds);
  if (normalizedBounds === null) {
    return createSelectionResult({
      currentSourceIndices: input.currentSourceIndices,
      ids: input.ids,
      kind: input.kind,
      sampleSize: input.sampleSize,
      selectedBins: [],
      tool: 'rectangle',
      viewport: input.viewport,
    });
  }

  const selectedBins: HistogramSelectedBin[] = [];
  let candidateBinCount = 0;

  for (const subplot of input.aggregation.subplots) {
    if (input.subplotId !== undefined && subplot.subplotId !== input.subplotId) {
      continue;
    }

    const plotRect = findPlotRect(input.layout.plotRects, subplot.subplotId);
    const subplotViewport = input.viewport.subplotById[subplot.subplotId];
    if (plotRect === null || subplotViewport === undefined) {
      continue;
    }

    const clippedBounds = intersectPixelBoundsWithRect(normalizedBounds, plotRect);
    if (clippedBounds === null) {
      continue;
    }

    const axisBounds = pixelBoundsToAxisBounds(
      clippedBounds,
      plotRect,
      subplotViewport,
    );

    for (let binIndex = 0; binIndex < subplot.bins.length; binIndex += 1) {
      const bin = subplot.bins[binIndex];
      if (bin === undefined || bin.totalCount <= 0) {
        continue;
      }

      candidateBinCount += 1;
      if (axisBoundsIntersectBin(axisBounds, bin)) {
        selectedBins.push({ bin, binIndex, subplot });
      }
    }
  }

  return createSelectionResult({
    candidateBinCount,
    currentSourceIndices: input.currentSourceIndices,
    ids: input.ids,
    kind: input.kind,
    sampleSize: input.sampleSize,
    materializeSourceIndices: input.materializeSourceIndices,
    selectedBins,
    tool: 'rectangle',
    viewport: input.viewport,
  });
}

export function selectHistogramBinsInPolygon(
  input: SelectHistogramBinsInPolygonInput,
): HistogramSelectionResult {
  const polygonBounds = getPolygonBounds(input.points);
  if (polygonBounds === null) {
    return createSelectionResult({
      currentSourceIndices: input.currentSourceIndices,
      ids: input.ids,
      kind: input.kind,
      sampleSize: input.sampleSize,
      selectedBins: [],
      tool: 'lasso',
      viewport: input.viewport,
    });
  }

  const selectedBins: HistogramSelectedBin[] = [];
  let candidateBinCount = 0;

  for (const subplot of input.aggregation.subplots) {
    if (input.subplotId !== undefined && subplot.subplotId !== input.subplotId) {
      continue;
    }

    const plotRect = findPlotRect(input.layout.plotRects, subplot.subplotId);
    const subplotViewport = input.viewport.subplotById[subplot.subplotId];
    if (
      plotRect === null ||
      subplotViewport === undefined ||
      intersectPixelBoundsWithRect(polygonBounds, plotRect) === null
    ) {
      continue;
    }

    for (let binIndex = 0; binIndex < subplot.bins.length; binIndex += 1) {
      const bin = subplot.bins[binIndex];
      if (bin === undefined || bin.totalCount <= 0) {
        continue;
      }

      candidateBinCount += 1;
      const binRect = binToPixelBounds(bin, plotRect, subplotViewport);
      if (binRect !== null && rectIntersectsPolygon(binRect, input.points)) {
        selectedBins.push({ bin, binIndex, subplot });
      }
    }
  }

  return createSelectionResult({
    candidateBinCount,
    currentSourceIndices: input.currentSourceIndices,
    ids: input.ids,
    kind: input.kind,
    materializeSourceIndices: input.materializeSourceIndices,
    sampleSize: input.sampleSize,
    selectedBins,
    tool: 'lasso',
    viewport: input.viewport,
  });
}

export function createHistogramRectangleZoomFeedback(
  input: Omit<HistogramRectangleZoomInput, 'viewport'>,
): HistogramRectangleZoomFeedback | null {
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
  const axisMode = resolveHistogramRectangleZoomEffectiveAxisMode(input);
  const zoomX = axisMode === 'x' || axisMode === 'xy';
  const zoomY = axisMode === 'y' || axisMode === 'xy';
  const xMin = zoomX ? Math.min(startX, currentX) : plotXMin;
  const xMax = zoomX ? Math.max(startX, currentX) : plotXMax;
  const yMin = zoomY ? Math.min(startY, currentY) : plotYMin;
  const yMax = zoomY ? Math.max(startY, currentY) : plotYMax;

  return {
    heightCssPx: yMax - yMin,
    subplotId: input.plotRect.id,
    widthCssPx: xMax - xMin,
    xCssPx: xMin,
    yCssPx: yMin,
  };
}

export function zoomHistogramViewportToRectangle(
  input: HistogramRectangleZoomInput,
): HistogramRectangleZoomResult | null {
  const zoomRect = createHistogramRectangleZoomFeedback(input);
  const subplotViewport = input.viewport.subplotById[input.plotRect.id];
  if (zoomRect === null || subplotViewport === undefined) {
    return null;
  }

  const axisMode = resolveHistogramRectangleZoomEffectiveAxisMode(input);
  const zoomX = axisMode === 'x' || axisMode === 'xy';
  const zoomY = axisMode === 'y' || axisMode === 'xy';
  const minSpanCssPx =
    input.minSpanCssPx ?? DEFAULT_RECTANGLE_ZOOM_MIN_SPAN_CSS_PX;
  if (
    (zoomX && zoomRect.widthCssPx < minSpanCssPx) ||
    (zoomY && zoomRect.heightCssPx < minSpanCssPx)
  ) {
    return null;
  }

  const xRange = zoomX
    ? pixelSpanToAxisRange(
        zoomRect.xCssPx,
        zoomRect.xCssPx + zoomRect.widthCssPx,
        subplotViewport.x,
        input.plotRect.xCssPx,
        input.plotRect.xCssPx + input.plotRect.widthCssPx,
      )
    : subplotViewport.x;
  const yRange = zoomY
    ? pixelSpanToAxisRange(
        zoomRect.yCssPx + zoomRect.heightCssPx,
        zoomRect.yCssPx,
        subplotViewport.y,
        input.plotRect.yCssPx + input.plotRect.heightCssPx,
        input.plotRect.yCssPx,
      )
    : subplotViewport.y;

  return {
    subplotId: input.plotRect.id,
    viewport: updateViewportForSubplot(input.viewport, input.plotRect.id, {
      x: normalizeRange(xRange, subplotViewport.x),
      y: normalizeRange(yRange, subplotViewport.y),
    }),
    zoomRect,
  };
}

export function zoomHistogramViewportAtPointer(
  input: HistogramWheelZoomInput,
): HistogramWheelZoomResult | null {
  if (!Number.isFinite(input.deltaY) || input.deltaY === 0) {
    return null;
  }

  const plotRect = findHistogramPlotRectAtPoint(
    input.layout.plotRects,
    input.pointerCssX,
    input.pointerCssY,
  );
  if (plotRect === null) {
    return null;
  }

  const subplotViewport = input.viewport.subplotById[plotRect.id];
  if (subplotViewport === undefined) {
    return null;
  }

  const scale = Math.exp(
    normalizeWheelDeltaY(input.deltaY, input.deltaMode) * WHEEL_ZOOM_SENSITIVITY,
  );
  const axisMode = input.axisMode ?? 'xy';
  const zoomX = axisMode === 'x' || axisMode === 'xy';
  const zoomY = axisMode === 'y' || axisMode === 'xy';
  const nextViewport = {
    x: zoomX
      ? zoomRangeAtPixel(
          subplotViewport.x,
          input.pointerCssX,
          plotRect.xCssPx,
          plotRect.xCssPx + plotRect.widthCssPx,
          scale,
        )
      : subplotViewport.x,
    y: zoomY
      ? zoomRangeAtPixel(
          subplotViewport.y,
          input.pointerCssY,
          plotRect.yCssPx + plotRect.heightCssPx,
          plotRect.yCssPx,
          scale,
        )
      : subplotViewport.y,
  };

  return {
    scale,
    subplotId: plotRect.id,
    viewport: updateViewportForSubplot(input.viewport, plotRect.id, nextViewport),
  };
}

export function startHistogramDragPan(
  layout: Pick<HistogramLayout, 'plotRects'>,
  pointerCssX: number,
  pointerCssY: number,
): HistogramPlotRect | null {
  return findHistogramPlotRectAtPoint(
    layout.plotRects,
    pointerCssX,
    pointerCssY,
  );
}

export function panHistogramViewportFromDrag(
  input: HistogramDragPanInput,
): HistogramDragPanResult | null {
  const plotRect = findPlotRect(input.layout.plotRects, input.subplotId);
  const subplotViewport = input.startViewport.subplotById[input.subplotId];
  if (plotRect === null || subplotViewport === undefined) {
    return null;
  }

  const axisMode = input.axisMode ?? 'xy';
  const panX = axisMode === 'x' || axisMode === 'xy';
  const panY = axisMode === 'y' || axisMode === 'xy';
  const deltaX = panX
    ? calculatePanDelta(
        subplotViewport.x,
        input.startPointerCssX,
        input.currentPointerCssX,
        plotRect.xCssPx,
        plotRect.xCssPx + plotRect.widthCssPx,
      )
    : 0;
  const deltaY = panY
    ? calculatePanDelta(
        subplotViewport.y,
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
    subplotId: input.subplotId,
    viewport: updateViewportForSubplot(input.startViewport, input.subplotId, {
      x: panX ? shiftRange(subplotViewport.x, deltaX) : subplotViewport.x,
      y: panY ? shiftRange(subplotViewport.y, deltaY) : subplotViewport.y,
    }),
  };
}

interface HistogramSelectedBin {
  readonly bin: HistogramBin;
  readonly binIndex: number;
  readonly subplot: HistogramSubplotBins;
}

interface HistogramAxisBounds {
  readonly x: HistogramRange;
  readonly y: HistogramRange;
}

function createDefaultSubplotViewport(
  subplot: HistogramSubplotBins,
): HistogramSubplotViewport {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = 0;
  let firstBinWidth = Number.NaN;
  let lastBinWidth = Number.NaN;

  for (const bin of subplot.bins) {
    minX = Math.min(minX, bin.descriptor.min);
    maxX = Math.max(maxX, bin.descriptor.max);
    maxY = Math.max(maxY, bin.totalCount);
    const width = bin.descriptor.max - bin.descriptor.min;
    if (!Number.isFinite(firstBinWidth) && width > MIN_SPAN) {
      firstBinWidth = width;
    }
    if (width > MIN_SPAN) {
      lastBinWidth = width;
    }
  }

  const fallbackMinX = Number.isFinite(minX) ? minX : 0;
  const fallbackMaxX = Number.isFinite(maxX) ? maxX : 1;
  const fallbackWidth = Math.max(
    1,
    Number.isFinite(fallbackMaxX - fallbackMinX) ? fallbackMaxX - fallbackMinX : 1,
  );
  const leftPadding =
    (Number.isFinite(firstBinWidth) ? firstBinWidth : fallbackWidth) *
    DEFAULT_HISTOGRAM_VIEWPORT_EDGE_PADDING_RATIO;
  const rightPadding =
    (Number.isFinite(lastBinWidth) ? lastBinWidth : fallbackWidth) *
    DEFAULT_HISTOGRAM_VIEWPORT_EDGE_PADDING_RATIO;
  const x = normalizeRange(
    {
      max: fallbackMaxX + rightPadding,
      min: fallbackMinX - leftPadding,
    },
    { max: 1, min: 0 },
  );
  const baseMaxY = Math.max(1, maxY);
  const y = normalizeRange(
    {
      max: baseMaxY * (1 + DEFAULT_HISTOGRAM_VIEWPORT_Y_HEADROOM_RATIO),
      min: 0,
    },
    { max: 1, min: 0 },
  );

  return { x, y };
}

function normalizeSubplotViewport(
  viewport: HistogramSubplotViewport | undefined,
  fallback: HistogramSubplotViewport,
): HistogramSubplotViewport {
  return {
    x: normalizeRange(viewport?.x, fallback.x),
    y: normalizeRange(viewport?.y, fallback.y),
  };
}

function createBinRef(
  subplot: HistogramSubplotBins,
  bin: HistogramBin,
  binIndex: number,
  ids: readonly string[] | undefined,
  sampleSize: number | undefined,
): HistogramBinRef {
  return {
    bin: bin.descriptor,
    count: bin.totalCount,
    membership: bin.membership,
    sampleIds: materializeSampleIds(subplot, binIndex, ids, sampleSize),
    stack: bin.stack,
  };
}

function materializeSampleIds(
  subplot: HistogramSubplotBins,
  binIndex: number,
  ids: readonly string[] | undefined,
  sampleSize = DEFAULT_SELECTION_SAMPLE_SIZE,
): readonly string[] | undefined {
  if (ids === undefined || sampleSize <= 0) {
    return undefined;
  }

  const sourceIndices = materializeHistogramBinSourceIndices(subplot, binIndex);
  if (sourceIndices.length === 0) {
    return [];
  }

  const sampleIds: string[] = [];
  const count = Math.min(sourceIndices.length, Math.max(0, sampleSize));
  for (let index = 0; index < count; index += 1) {
    const sourceIndex = sourceIndices[index];
    const id = sourceIndex === undefined ? undefined : ids[sourceIndex];
    if (id !== undefined) {
      sampleIds.push(id);
    }
  }

  return sampleIds;
}

function createSelectionResult(input: {
  readonly candidateBinCount?: number;
  readonly currentSourceIndices?: HistogramSourceIndexArray | readonly number[];
  readonly ids?: readonly string[];
  readonly kind?: HistogramSelectionKind;
  readonly materializeSourceIndices?: boolean;
  readonly sampleSize?: number;
  readonly selectedBins: readonly HistogramSelectedBin[];
  readonly tool: HistogramSelectionTool;
  readonly viewport: HistogramViewport;
}): HistogramSelectionResult {
  const kind = input.kind ?? 'replace';
  const materializeSourceIndices = input.materializeSourceIndices ?? true;
  const sourceIndices: number[] = [];
  const binDescriptors = input.selectedBins.map(
    (selectedBin) => selectedBin.bin.descriptor,
  );
  let sourceIndicesAvailable = true;
  let selectedSourceCount = 0;

  for (const selectedBin of input.selectedBins) {
    const membership = selectedBin.bin.membership;
    if (membership === undefined) {
      sourceIndicesAvailable = false;
      continue;
    }
    selectedSourceCount += membership.count;
    if (!membership.sourceIndicesAvailable) {
      sourceIndicesAvailable = false;
      continue;
    }

    if (materializeSourceIndices) {
      const binSourceIndices = materializeHistogramBinSourceIndices(
        selectedBin.subplot,
        selectedBin.binIndex,
      );
      if (binSourceIndices.length < membership.count) {
        sourceIndicesAvailable = false;
      }
      for (const sourceIndex of binSourceIndices) {
        sourceIndices.push(sourceIndex);
      }
    }
  }

  if (kind === 'append' && materializeSourceIndices && input.currentSourceIndices !== undefined) {
    for (const sourceIndex of input.currentSourceIndices) {
      sourceIndices.push(sourceIndex);
    }
  }

  const normalizedSourceIndices = materializeSourceIndices && sourceIndicesAvailable
    ? normalizeSourceIndices(sourceIndices)
    : new Uint32Array(0);
  const sampleIds =
    materializeSourceIndices && sourceIndicesAvailable && input.ids !== undefined
      ? sampleIdsForSourceIndices(
          normalizedSourceIndices,
          input.ids,
          input.sampleSize,
        )
      : [];
  const selectedSubplotId =
    input.selectedBins.length === 0
      ? undefined
      : input.selectedBins.every(
            (selectedBin) =>
              selectedBin.subplot.subplotId === input.selectedBins[0]?.subplot.subplotId,
          )
        ? input.selectedBins[0]?.subplot.subplotId
        : undefined;

  return {
    binDescriptors,
    candidateBinCount: input.candidateBinCount ?? input.selectedBins.length,
    kind,
    sampleIds,
    selectedBinCount: input.selectedBins.length,
    selectedSourceCount:
      materializeSourceIndices && sourceIndicesAvailable
        ? normalizedSourceIndices.length
        : selectedSourceCount,
    sourceIndices: normalizedSourceIndices,
    sourceIndicesAvailable: materializeSourceIndices && sourceIndicesAvailable,
    sourceIndicesStatus: !sourceIndicesAvailable
      ? 'unavailable'
      : materializeSourceIndices
        ? 'available'
        : 'pending',
    subplotId: selectedSubplotId,
    tool: input.tool,
    viewport: input.viewport,
  };
}

function sampleIdsForSourceIndices(
  sourceIndices: HistogramSourceIndexArray,
  ids: readonly string[],
  sampleSize = DEFAULT_SELECTION_SAMPLE_SIZE,
): readonly string[] {
  const sampleIds: string[] = [];
  const count = Math.min(sourceIndices.length, Math.max(0, sampleSize));
  for (let index = 0; index < count; index += 1) {
    const sourceIndex = sourceIndices[index];
    const id = sourceIndex === undefined ? undefined : ids[sourceIndex];
    if (id !== undefined) {
      sampleIds.push(id);
    }
  }

  return sampleIds;
}

function axisBoundsIntersectBin(
  bounds: HistogramAxisBounds,
  bin: HistogramBin,
): boolean {
  return (
    rangesIntersect(bounds.x, {
      max: bin.descriptor.max,
      min: bin.descriptor.min,
    }) && rangesIntersect(bounds.y, { max: bin.totalCount, min: 0 })
  );
}

function pixelBoundsToAxisBounds(
  bounds: HistogramPixelBounds,
  plotRect: HistogramPlotRect,
  viewport: HistogramSubplotViewport,
): HistogramAxisBounds {
  return {
    x: normalizeRange(
      {
        max: histogramPixelToAxis(
          bounds.maxX,
          viewport.x,
          plotRect.xCssPx,
          plotRect.xCssPx + plotRect.widthCssPx,
        ),
        min: histogramPixelToAxis(
          bounds.minX,
          viewport.x,
          plotRect.xCssPx,
          plotRect.xCssPx + plotRect.widthCssPx,
        ),
      },
      viewport.x,
    ),
    y: normalizeRange(
      {
        max: histogramPixelToAxis(
          bounds.minY,
          viewport.y,
          plotRect.yCssPx + plotRect.heightCssPx,
          plotRect.yCssPx,
        ),
        min: histogramPixelToAxis(
          bounds.maxY,
          viewport.y,
          plotRect.yCssPx + plotRect.heightCssPx,
          plotRect.yCssPx,
        ),
      },
      viewport.y,
    ),
  };
}

function binToPixelBounds(
  bin: HistogramBin,
  plotRect: HistogramPlotRect,
  viewport: HistogramSubplotViewport,
): HistogramPixelBounds | null {
  if (bin.totalCount <= 0) {
    return null;
  }

  return normalizePixelBounds({
    maxX: histogramAxisToPixel(
      bin.descriptor.max,
      viewport.x,
      plotRect.xCssPx,
      plotRect.xCssPx + plotRect.widthCssPx,
    ),
    maxY: histogramAxisToPixel(
      0,
      viewport.y,
      plotRect.yCssPx + plotRect.heightCssPx,
      plotRect.yCssPx,
    ),
    minX: histogramAxisToPixel(
      bin.descriptor.min,
      viewport.x,
      plotRect.xCssPx,
      plotRect.xCssPx + plotRect.widthCssPx,
    ),
    minY: histogramAxisToPixel(
      bin.totalCount,
      viewport.y,
      plotRect.yCssPx + plotRect.heightCssPx,
      plotRect.yCssPx,
    ),
  });
}

function rectIntersectsPolygon(
  rect: HistogramPixelBounds,
  polygon: readonly HistogramPoint[],
): boolean {
  const polygonBounds = getPolygonBounds(polygon);
  if (polygonBounds === null || !pixelBoundsIntersect(rect, polygonBounds)) {
    return false;
  }

  const rectCorners = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ];
  if (rectCorners.some((point) => isPointInPolygon(point, polygon))) {
    return true;
  }

  if (polygon.some((point) => pointInRect(point, rect))) {
    return true;
  }

  for (let index = 0; index < polygon.length; index += 1) {
    const nextIndex = (index + 1) % polygon.length;
    const start = polygon[index];
    const end = polygon[nextIndex];
    if (start === undefined || end === undefined) {
      continue;
    }

    for (let edgeIndex = 0; edgeIndex < rectCorners.length; edgeIndex += 1) {
      const edgeStart = rectCorners[edgeIndex];
      const edgeEnd = rectCorners[(edgeIndex + 1) % rectCorners.length];
      if (
        edgeStart !== undefined &&
        edgeEnd !== undefined &&
        segmentsIntersect(start, end, edgeStart, edgeEnd)
      ) {
        return true;
      }
    }
  }

  return false;
}

function isPointInPolygon(
  point: HistogramPoint,
  polygon: readonly HistogramPoint[],
): boolean {
  if (
    polygon.length < 3 ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    return false;
  }

  let isInside = false;
  let previous = polygon[polygon.length - 1];
  for (const current of polygon) {
    if (previous === undefined) {
      previous = current;
      continue;
    }

    const crosses =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;
    if (crosses) {
      isInside = !isInside;
    }
    previous = current;
  }

  return isInside;
}

function segmentsIntersect(
  firstStart: HistogramPoint,
  firstEnd: HistogramPoint,
  secondStart: HistogramPoint,
  secondEnd: HistogramPoint,
): boolean {
  const firstDirection = orientation(firstStart, firstEnd, secondStart);
  const secondDirection = orientation(firstStart, firstEnd, secondEnd);
  const thirdDirection = orientation(secondStart, secondEnd, firstStart);
  const fourthDirection = orientation(secondStart, secondEnd, firstEnd);

  if (
    firstDirection === 0 &&
    pointOnSegment(secondStart, firstStart, firstEnd)
  ) {
    return true;
  }
  if (
    secondDirection === 0 &&
    pointOnSegment(secondEnd, firstStart, firstEnd)
  ) {
    return true;
  }
  if (
    thirdDirection === 0 &&
    pointOnSegment(firstStart, secondStart, secondEnd)
  ) {
    return true;
  }
  if (
    fourthDirection === 0 &&
    pointOnSegment(firstEnd, secondStart, secondEnd)
  ) {
    return true;
  }

  return firstDirection !== secondDirection && thirdDirection !== fourthDirection;
}

function orientation(
  first: HistogramPoint,
  second: HistogramPoint,
  third: HistogramPoint,
): number {
  const value =
    (second.y - first.y) * (third.x - second.x) -
    (second.x - first.x) * (third.y - second.y);
  if (Math.abs(value) < MIN_SPAN) {
    return 0;
  }

  return value > 0 ? 1 : 2;
}

function pointOnSegment(
  point: HistogramPoint,
  start: HistogramPoint,
  end: HistogramPoint,
): boolean {
  return (
    point.x <= Math.max(start.x, end.x) + MIN_SPAN &&
    point.x >= Math.min(start.x, end.x) - MIN_SPAN &&
    point.y <= Math.max(start.y, end.y) + MIN_SPAN &&
    point.y >= Math.min(start.y, end.y) - MIN_SPAN
  );
}

function getPolygonBounds(
  points: readonly HistogramPoint[],
): HistogramPixelBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let validPointCount = 0;

  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }

    validPointCount += 1;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  if (validPointCount < 3) {
    return null;
  }

  return { maxX, maxY, minX, minY };
}

function pointInRect(point: HistogramPoint, rect: HistogramPixelBounds): boolean {
  return (
    point.x >= rect.minX &&
    point.x <= rect.maxX &&
    point.y >= rect.minY &&
    point.y <= rect.maxY
  );
}

function intersectPixelBoundsWithRect(
  bounds: HistogramPixelBounds,
  rect: HistogramPlotRect,
): HistogramPixelBounds | null {
  const rectBounds = {
    maxX: rect.xCssPx + rect.widthCssPx,
    maxY: rect.yCssPx + rect.heightCssPx,
    minX: rect.xCssPx,
    minY: rect.yCssPx,
  };
  if (!pixelBoundsIntersect(bounds, rectBounds)) {
    return null;
  }

  return {
    maxX: Math.min(bounds.maxX, rectBounds.maxX),
    maxY: Math.min(bounds.maxY, rectBounds.maxY),
    minX: Math.max(bounds.minX, rectBounds.minX),
    minY: Math.max(bounds.minY, rectBounds.minY),
  };
}

function pixelBoundsIntersect(
  left: HistogramPixelBounds,
  right: HistogramPixelBounds,
): boolean {
  return (
    left.minX <= right.maxX &&
    left.maxX >= right.minX &&
    left.minY <= right.maxY &&
    left.maxY >= right.minY
  );
}

function normalizePixelBounds(
  bounds: HistogramPixelBounds,
): HistogramPixelBounds | null {
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxY)
  ) {
    return null;
  }

  return {
    maxX: Math.max(bounds.minX, bounds.maxX),
    maxY: Math.max(bounds.minY, bounds.maxY),
    minX: Math.min(bounds.minX, bounds.maxX),
    minY: Math.min(bounds.minY, bounds.maxY),
  };
}

function findBinIndexAtAxisValue(
  subplot: HistogramSubplotBins,
  axisValue: number,
): number {
  if (!Number.isFinite(axisValue)) {
    return -1;
  }
  let low = 0;
  let high = subplot.bins.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const bin = subplot.bins[mid];
    if (bin === undefined) {
      return -1;
    }
    const isLastBin = mid === subplot.bins.length - 1;
    if (axisValue < bin.descriptor.min) {
      high = mid - 1;
      continue;
    }
    if (axisValue > bin.descriptor.max || (!isLastBin && axisValue === bin.descriptor.max)) {
      low = mid + 1;
      continue;
    }
    return mid;
  }

  return -1;
}

function findSubplot(
  subplots: readonly HistogramSubplotBins[],
  subplotId: HistogramSubplotId,
): HistogramSubplotBins | null {
  return subplots.find((subplot) => subplot.subplotId === subplotId) ?? null;
}

function findPlotRect(
  plotRects: readonly HistogramPlotRect[],
  subplotId: HistogramSubplotId,
): HistogramPlotRect | null {
  return plotRects.find((rect) => rect.id === subplotId) ?? null;
}

function normalizeSourceIndices(
  sourceIndices: readonly number[],
): HistogramSourceIndexArray {
  if (sourceIndices.length === 0) {
    return new Uint32Array(0);
  }

  const normalized = Array.from(sourceIndices, (value) =>
    Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0,
  );
  normalized.sort((left, right) => left - right);

  let writeIndex = 0;
  for (let readIndex = 0; readIndex < normalized.length; readIndex += 1) {
    if (readIndex === 0 || normalized[readIndex] !== normalized[readIndex - 1]) {
      normalized[writeIndex] = normalized[readIndex] ?? 0;
      writeIndex += 1;
    }
  }

  return Uint32Array.from(normalized.slice(0, writeIndex));
}

function updateViewportForSubplot(
  viewport: HistogramViewport,
  subplotId: HistogramSubplotId,
  subplotViewport: HistogramSubplotViewport,
): HistogramViewport {
  return {
    subplotById: {
      ...viewport.subplotById,
      [subplotId]: subplotViewport,
    },
  };
}

function pixelSpanToAxisRange(
  firstCssPx: number,
  secondCssPx: number,
  range: HistogramRange,
  pixelMin: number,
  pixelMax: number,
): HistogramRange {
  const first = histogramPixelToAxis(firstCssPx, range, pixelMin, pixelMax);
  const second = histogramPixelToAxis(secondCssPx, range, pixelMin, pixelMax);

  return {
    max: Math.max(first, second),
    min: Math.min(first, second),
  };
}

function zoomRangeAtPixel(
  range: HistogramRange,
  pointerCssPx: number,
  pixelMin: number,
  pixelMax: number,
  scale: number,
): HistogramRange {
  const anchor = histogramPixelToAxis(pointerCssPx, range, pixelMin, pixelMax);
  const nextMin = anchor - (anchor - range.min) * scale;
  const nextMax = anchor + (range.max - anchor) * scale;

  return normalizeRange({ max: nextMax, min: nextMin }, range);
}

function calculatePanDelta(
  range: HistogramRange,
  startPointerCssPx: number,
  currentPointerCssPx: number,
  pixelMin: number,
  pixelMax: number,
): number {
  return (
    histogramPixelToAxis(startPointerCssPx, range, pixelMin, pixelMax) -
    histogramPixelToAxis(currentPointerCssPx, range, pixelMin, pixelMax)
  );
}

function shiftRange(range: HistogramRange, delta: number): HistogramRange {
  const min = range.min + delta;
  const max = range.max + delta;

  return Number.isFinite(min) && Number.isFinite(max) && min < max
    ? { max, min }
    : range;
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

function rangesIntersect(left: HistogramRange, right: HistogramRange): boolean {
  return left.min <= right.max && left.max >= right.min;
}

function normalizeRange(
  range: HistogramRange | undefined,
  fallback: HistogramRange,
): HistogramRange {
  if (
    range === undefined ||
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max)
  ) {
    return normalizeRange(fallback, { max: 1, min: 0 });
  }

  const min = Math.min(range.min, range.max);
  const max = Math.max(range.min, range.max);
  if (min === max) {
    const padding = Math.max(1, Math.abs(min) * 0.05);
    return { max: max + padding, min: min - padding };
  }

  if (max - min < MIN_SPAN) {
    const center = (min + max) / 2;
    return { max: center + MIN_SPAN / 2, min: center - MIN_SPAN / 2 };
  }

  return { max, min };
}

function safeSpan(range: HistogramRange): number {
  return Math.max(MIN_SPAN, range.max - range.min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeFocusedSubplotId(
  subplots: readonly HistogramSubplotSpec[],
  focusedSubplotId: HistogramSubplotId | null | undefined,
): HistogramSubplotId | null {
  if (focusedSubplotId === null || focusedSubplotId === undefined) {
    return null;
  }

  return subplots.some((subplot) => subplot.id === focusedSubplotId)
    ? focusedSubplotId
    : null;
}

function createFocusedRowHeights(input: {
  readonly availableHeight: number;
  readonly contextMinHeight: number;
  readonly contextWeight: number;
  readonly focusedSubplotId: HistogramSubplotId;
  readonly focusedWeight: number;
  readonly subplots: readonly HistogramSubplotSpec[];
}): number[] {
  if (input.subplots.length <= 1) {
    return [input.availableHeight];
  }

  const contextCount = input.subplots.filter(
    (subplot) => subplot.id !== input.focusedSubplotId,
  ).length;
  const minimumTotal = input.contextMinHeight * (contextCount + 1);
  if (input.availableHeight <= minimumTotal) {
    const contextHeight = Math.max(
      1,
      (input.availableHeight - input.contextMinHeight) / contextCount,
    );
    const focusedHeight = Math.max(
      1,
      input.availableHeight - contextHeight * contextCount,
    );

    return input.subplots.map((subplot) =>
      subplot.id === input.focusedSubplotId ? focusedHeight : contextHeight,
    );
  }

  const weightedContextHeight = Math.max(
    input.contextMinHeight,
    input.availableHeight /
      (input.focusedWeight / input.contextWeight + contextCount),
  );
  const contextHeight = Math.min(
    weightedContextHeight,
    Math.max(
      input.contextMinHeight,
      (input.availableHeight - input.contextMinHeight) / contextCount,
    ),
  );
  const focusedHeight = Math.max(
    input.contextMinHeight,
    input.availableHeight - contextHeight * contextCount,
  );

  return input.subplots.map((subplot) =>
    subplot.id === input.focusedSubplotId ? focusedHeight : contextHeight,
  );
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
