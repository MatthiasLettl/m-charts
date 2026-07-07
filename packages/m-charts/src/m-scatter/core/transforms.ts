import type {
  FastScatterPlotSpec,
  FastScatterPointColumns,
  FastScatterRange,
  FastScatterViewport,
} from './types.js';
import type { FastScatterEncodedAxis } from './axisSchema.js';

export interface FastScatterDataDomain {
  x: FastScatterRange;
  yByPlot: Readonly<Record<string, FastScatterRange>>;
}

export interface FastScatterPlotRect {
  heightCssPx: number;
  id: string;
  widthCssPx: number;
  xCssPx: number;
  yCssPx: number;
}

export interface FastScatterLayout {
  chartRect: FastScatterPlotRect;
  heightCssPx: number;
  navigatorRect: FastScatterPlotRect | null;
  plotRects: FastScatterPlotRect[];
  widthCssPx: number;
  xAxisReservedCssPx: number;
}

export interface FastScatterLayoutOptions {
  contextMinHeightCssPx?: number;
  contextWeight?: number;
  focusedPlotId?: string | null;
  focusedWeight?: number;
  gapCssPx?: number;
  heightCssPx: number;
  leftAxisCssPx?: number;
  navigatorCssPx?: number;
  rightPaddingCssPx?: number;
  topPaddingCssPx?: number;
  widthCssPx: number;
  xAxisCssPx?: number;
}

const MIN_SPAN = 1e-9;
const DEFAULT_GAP_CSS_PX = 8;
const DEFAULT_LEFT_AXIS_CSS_PX = 104;
const DEFAULT_NAVIGATOR_HEIGHT_CSS_PX = 28;
const DEFAULT_NAVIGATOR_GAP_CSS_PX = 8;
const DEFAULT_NAVIGATOR_HORIZONTAL_PADDING_CSS_PX = 56;
const DEFAULT_RIGHT_PADDING_CSS_PX = 12;
const DEFAULT_TOP_PADDING_CSS_PX = 12;
const DEFAULT_X_AXIS_CSS_PX = 48;
const RANGE_DOMAIN_PADDING_RATIO = 0.05;
const ENCODED_CATEGORY_DOMAIN_PADDING = 0.5;

export function calculateFastScatterDomain(
  columns: FastScatterPointColumns,
  spec: FastScatterPlotSpec,
): FastScatterDataDomain {
  const axisColumns = columns as FastScatterPointColumns & {
    axisByColumn?: Readonly<Record<string, FastScatterEncodedAxis>>;
    xKey?: string;
  };

  return {
    x: createPaddedRangeForColumn(
      columns.x,
      axisColumns.xKey === undefined
        ? undefined
        : axisColumns.axisByColumn?.[axisColumns.xKey],
    ),
    yByPlot: Object.fromEntries(
      spec.plots.map((plot) => [
        plot.id,
        createPaddedRangeForColumn(
          columns.y[plot.yKey],
          axisColumns.axisByColumn?.[plot.yKey],
        ),
      ]),
    ),
  };
}

export function createDefaultFastScatterViewport(
  domain: FastScatterDataDomain,
): FastScatterViewport {
  return normalizeFastScatterViewport(domain, domain);
}

export function normalizeFastScatterViewport(
  viewport: FastScatterViewport,
  fallback: FastScatterDataDomain,
): FastScatterViewport {
  return {
    x: normalizeRange(viewport.x, fallback.x),
    yByPlot: Object.fromEntries(
      Object.entries(fallback.yByPlot).map(([plotId, fallbackRange]) => [
        plotId,
        normalizeRange(viewport.yByPlot[plotId], fallbackRange),
      ]),
    ),
  };
}

export function axisToPixel(
  value: number,
  range: FastScatterRange,
  pixelMin: number,
  pixelMax: number,
): number {
  const span = safeSpan(range);
  const t = (value - range.min) / span;

  return pixelMin + t * (pixelMax - pixelMin);
}

export function pixelToAxis(
  pixel: number,
  range: FastScatterRange,
  pixelMin: number,
  pixelMax: number,
): number {
  const pixelSpan = pixelMax - pixelMin;
  if (pixelSpan === 0) {
    return range.min;
  }

  return range.min + ((pixel - pixelMin) / pixelSpan) * safeSpan(range);
}

export function axisToClip(value: number, range: FastScatterRange): number {
  return ((value - range.min) / safeSpan(range)) * 2 - 1;
}

export function clipToAxis(value: number, range: FastScatterRange): number {
  return range.min + ((value + 1) / 2) * safeSpan(range);
}

export function createFastScatterPlotRects(
  spec: FastScatterPlotSpec,
  options: FastScatterLayoutOptions,
): FastScatterPlotRect[] {
  return createFastScatterLayout(spec, options).plotRects;
}

export function createFastScatterLayout(
  spec: FastScatterPlotSpec,
  options: FastScatterLayoutOptions,
): FastScatterLayout {
  const focusedPlotId = normalizeFocusedPlotId(spec, options.focusedPlotId);
  const gap = options.gapCssPx ?? DEFAULT_GAP_CSS_PX;
  const leftAxis = options.leftAxisCssPx ?? DEFAULT_LEFT_AXIS_CSS_PX;
  const rightPadding = options.rightPaddingCssPx ?? DEFAULT_RIGHT_PADDING_CSS_PX;
  const topPadding = options.topPaddingCssPx ?? DEFAULT_TOP_PADDING_CSS_PX;
  const xAxis = options.xAxisCssPx ?? DEFAULT_X_AXIS_CSS_PX;
  const navigatorReserved =
    options.navigatorCssPx ?? DEFAULT_NAVIGATOR_HEIGHT_CSS_PX + DEFAULT_NAVIGATOR_GAP_CSS_PX;
  const plotCount = Math.max(1, spec.plots.length);
  const contextMinHeight = Math.max(1, options.contextMinHeightCssPx ?? 76);
  const contextWeight = Math.max(0.01, options.contextWeight ?? 1);
  const focusedWeight = Math.max(contextWeight, options.focusedWeight ?? 3.25);
  const width = Math.max(1, options.widthCssPx - leftAxis - rightPadding);
  const availableHeight = Math.max(
    1,
    options.heightCssPx -
      topPadding -
      xAxis -
      navigatorReserved -
      gap * (plotCount - 1),
  );
  const rowHeights =
    focusedPlotId === null
      ? Array.from({ length: spec.plots.length }, () =>
          Math.max(1, availableHeight / plotCount),
        )
      : createFocusedRowHeights({
          availableHeight,
          contextMinHeight,
          contextWeight,
          focusedPlotId,
          focusedWeight,
          spec,
        });
  let yCssPx = topPadding;

  const plotRects = spec.plots.map((plot, index) => {
    const heightCssPx = rowHeights[index] ?? 1;
    const rect = {
      heightCssPx,
      id: plot.id,
      widthCssPx: width,
      xCssPx: leftAxis,
      yCssPx,
    };
    yCssPx += heightCssPx + gap;

    return rect;
  });
  const lastPlotRect = plotRects.at(-1);
  const navigatorHeight = Math.max(
    1,
    Math.min(DEFAULT_NAVIGATOR_HEIGHT_CSS_PX, navigatorReserved - DEFAULT_NAVIGATOR_GAP_CSS_PX),
  );
  const navigatorX = Math.min(DEFAULT_NAVIGATOR_HORIZONTAL_PADDING_CSS_PX, options.widthCssPx - 1);
  const navigatorY =
    lastPlotRect === undefined
      ? topPadding
      : lastPlotRect.yCssPx + lastPlotRect.heightCssPx + xAxis;
  const navigatorRect =
    navigatorReserved <= DEFAULT_NAVIGATOR_GAP_CSS_PX ||
    options.widthCssPx <= 0 ||
    options.heightCssPx <= 0
      ? null
      : {
          heightCssPx: Math.max(
            1,
            Math.min(navigatorHeight, options.heightCssPx - navigatorY),
          ),
          id: 'x-navigator',
          widthCssPx: Math.max(1, options.widthCssPx - navigatorX - rightPadding),
          xCssPx: navigatorX,
          yCssPx: Math.max(0, navigatorY),
        };

  return {
    chartRect: {
      heightCssPx: Math.max(1, options.heightCssPx - topPadding - navigatorReserved),
      id: 'scatter-fast-chart',
      widthCssPx: width,
      xCssPx: leftAxis,
      yCssPx: topPadding,
    },
    heightCssPx: Math.max(0, options.heightCssPx),
    navigatorRect,
    plotRects,
    widthCssPx: Math.max(0, options.widthCssPx),
    xAxisReservedCssPx: xAxis,
  };
}

export function rectToDevicePixels(
  rect: FastScatterPlotRect,
  devicePixelRatio: number,
): FastScatterPlotRect {
  return {
    heightCssPx: Math.round(rect.heightCssPx * devicePixelRatio),
    id: rect.id,
    widthCssPx: Math.round(rect.widthCssPx * devicePixelRatio),
    xCssPx: Math.round(rect.xCssPx * devicePixelRatio),
    yCssPx: Math.round(rect.yCssPx * devicePixelRatio),
  };
}

export function createPaddedFastScatterDomainRange(
  range: FastScatterRange,
  axis: FastScatterEncodedAxis | undefined,
): FastScatterRange {
  if (axis?.kind === 'categorical' || axis?.kind === 'boolean') {
    const categoryRange = rangeForEncodedCategories(axis);

    return {
      max: categoryRange.max + ENCODED_CATEGORY_DOMAIN_PADDING,
      min: categoryRange.min - ENCODED_CATEGORY_DOMAIN_PADDING,
    };
  }

  return padContinuousRange(normalizeRange(range, { min: 0, max: 1 }));
}

function createPaddedRangeForColumn(
  column: ArrayLike<number> | undefined,
  axis: FastScatterEncodedAxis | undefined,
): FastScatterRange {
  return createPaddedFastScatterDomainRange(rangeForColumn(column), axis);
}

function rangeForColumn(column: ArrayLike<number> | undefined): FastScatterRange {
  if (column === undefined || column.length === 0) {
    return { min: 0, max: 1 };
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < column.length; index += 1) {
    const value = column[index];
    if (!Number.isFinite(value)) {
      continue;
    }
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }

  return normalizeRange({ min, max }, { min: 0, max: 1 });
}

function rangeForEncodedCategories(axis: FastScatterEncodedAxis): FastScatterRange {
  if (axis.kind !== 'categorical' && axis.kind !== 'boolean') {
    return axis.domain;
  }

  if (axis.categories.length === 0) {
    return { min: 0, max: 1 };
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const category of axis.categories) {
    min = Math.min(min, category.encoded);
    max = Math.max(max, category.encoded);
  }

  return normalizeRange({ min, max }, { min: 0, max: 1 });
}

function padContinuousRange(range: FastScatterRange): FastScatterRange {
  const span = safeSpan(range);
  const padding = Math.max(MIN_SPAN, span * RANGE_DOMAIN_PADDING_RATIO);

  return {
    max: range.max + padding,
    min: range.min - padding,
  };
}

function normalizeFocusedPlotId(
  spec: FastScatterPlotSpec,
  focusedPlotId: string | null | undefined,
): string | null {
  if (focusedPlotId === null || focusedPlotId === undefined) {
    return null;
  }

  return spec.plots.some((plot) => plot.id === focusedPlotId) ? focusedPlotId : null;
}

function createFocusedRowHeights({
  availableHeight,
  contextMinHeight,
  contextWeight,
  focusedPlotId,
  focusedWeight,
  spec,
}: {
  availableHeight: number;
  contextMinHeight: number;
  contextWeight: number;
  focusedPlotId: string;
  focusedWeight: number;
  spec: FastScatterPlotSpec;
}): number[] {
  if (spec.plots.length <= 1) {
    return [availableHeight];
  }

  const contextCount = spec.plots.filter((plot) => plot.id !== focusedPlotId).length;
  const minimumContextTotal = contextMinHeight * contextCount;
  const minimumFocusedHeight = contextMinHeight;
  if (availableHeight <= minimumContextTotal + minimumFocusedHeight) {
    const contextHeight = Math.max(
      1,
      (availableHeight - minimumFocusedHeight) / contextCount,
    );
    const focusedHeight = Math.max(
      1,
      availableHeight - contextHeight * contextCount,
    );

    return spec.plots.map((plot) =>
      plot.id === focusedPlotId ? focusedHeight : contextHeight,
    );
  }

  const weightedContextHeight = Math.max(
    contextMinHeight,
    availableHeight /
      (focusedWeight / contextWeight + contextCount),
  );
  const contextHeight = Math.min(
    weightedContextHeight,
    Math.max(contextMinHeight, (availableHeight - contextMinHeight) / contextCount),
  );
  const focusedHeight = Math.max(
    contextMinHeight,
    availableHeight - contextHeight * contextCount,
  );

  return spec.plots.map((plot) =>
    plot.id === focusedPlotId ? focusedHeight : contextHeight,
  );
}

function normalizeRange(
  range: FastScatterRange | undefined,
  fallback: FastScatterRange,
): FastScatterRange {
  if (
    range === undefined ||
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max) ||
    range.min > range.max
  ) {
    return normalizeRange(fallback, { min: 0, max: 1 });
  }

  if (range.min === range.max) {
    const padding = Math.max(1, Math.abs(range.min) * 0.05);
    return { min: range.min - padding, max: range.max + padding };
  }

  if (range.max - range.min < MIN_SPAN) {
    const center = (range.min + range.max) / 2;
    return { min: center - MIN_SPAN / 2, max: center + MIN_SPAN / 2 };
  }

  return { min: range.min, max: range.max };
}

function safeSpan(range: FastScatterRange): number {
  return Math.max(MIN_SPAN, range.max - range.min);
}
