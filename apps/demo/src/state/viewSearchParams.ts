import {
  SCATTER_Y_ATTRIBUTES,
  type ScatterRecord,
  type ScatterYAttribute,
} from '../data/types.ts';
import {
  FAST_SCATTER_VISUALIZATION_MODES,
  type FastScatterVisualizationMode,
} from 'm-charts/m-scatter';

export const INTERACTION_MODES = [
  'zoom',
  'pan',
  'select',
  'lasso',
  'hover',
  'measure',
] as const;
export const INTERACTION_AXES = ['x', 'y', 'xy'] as const;

export type InteractionMode = (typeof INTERACTION_MODES)[number];
export type InteractionAxis = (typeof INTERACTION_AXES)[number];

export interface AxisRange {
  min: number;
  max: number;
}

export type ViewportState = {
  x: AxisRange;
} & Record<ScatterYAttribute, AxisRange>;

export interface PrototypeSearchState {
  axis: InteractionAxis;
  mode: InteractionMode;
  viewport: ViewportState;
}

export type ViewportAxisKey = keyof ViewportState;

export type ViewportChangeKind = 'x-only' | 'y-only' | 'combined';

export type ViewportMovementKind = 'pan/move' | 'zoom/resize' | 'mixed';

export interface ViewportChangeSummary {
  axes: ViewportAxisKey[];
  kind: ViewportChangeKind;
  movement: ViewportMovementKind;
}

export interface ViewportLogEntry {
  axes: string;
  id: number;
  kind: ViewportChangeKind;
  movement: ViewportMovementKind;
  timestamp: string;
}

export interface PlotInteractionGateState {
  hasFocusWithin: boolean;
  isHovered: boolean;
}

const DEFAULT_MODE: InteractionMode = 'pan';
const DEFAULT_AXIS: InteractionAxis = 'xy';
export const FAST_SCATTER_VISUALIZATION_PARAM = 'viz';
export const FAST_SCATTER_HEATMAP_BIN_SIZE_PARAM = 'heatBinPx';
export const DEFAULT_FAST_SCATTER_VISUALIZATION_MODE: FastScatterVisualizationMode =
  'points';
export const DEFAULT_FAST_SCATTER_HEATMAP_BIN_SIZE_PX = 12;
export const MIN_FAST_SCATTER_HEATMAP_BIN_SIZE_PX = 4;
export const MAX_FAST_SCATTER_HEATMAP_BIN_SIZE_PX = 64;

const VIEWPORT_PARAM_NAMES = {
  x: ['xMin', 'xMax'],
  a: ['aMin', 'aMax'],
  b: ['bMin', 'bMax'],
  c: ['cMin', 'cMax'],
} as const satisfies Record<keyof ViewportState, readonly [string, string]>;

const RANGE_EPSILON = 1e-9;

export function createDefaultViewport(records: readonly ScatterRecord[]): ViewportState {
  const viewport: ViewportState = {
    x: rangeFor(records, 'x'),
    a: rangeFor(records, 'a'),
    b: rangeFor(records, 'b'),
    c: rangeFor(records, 'c'),
  };

  return viewport;
}

export function parsePrototypeSearchParams(
  params: URLSearchParams,
  defaultViewport: ViewportState,
): PrototypeSearchState {
  return {
    axis: parseInteractionAxis(params),
    mode: parseInteractionMode(params),
    viewport: parseViewportSearchParams(params, defaultViewport),
  };
}

export function parseInteractionMode(params: URLSearchParams): InteractionMode {
  const value = params.get('mode');

  return isInteractionMode(value) ? value : DEFAULT_MODE;
}

export function parseInteractionAxis(params: URLSearchParams): InteractionAxis {
  const value = params.get('axis');

  return isInteractionAxis(value) ? value : DEFAULT_AXIS;
}

export function parseViewportSearchParams(
  params: URLSearchParams,
  defaultViewport: ViewportState,
): ViewportState {
  const parsed = {
    x: parseAxisRange(params, VIEWPORT_PARAM_NAMES.x),
    a: parseAxisRange(params, VIEWPORT_PARAM_NAMES.a),
    b: parseAxisRange(params, VIEWPORT_PARAM_NAMES.b),
    c: parseAxisRange(params, VIEWPORT_PARAM_NAMES.c),
  };

  const { x, a, b, c } = parsed;

  if (x === null || a === null || b === null || c === null) {
    return defaultViewport;
  }

  return {
    x,
    a,
    b,
    c,
  };
}

export function serializePrototypeSearchParams(
  state: PrototypeSearchState,
  baseParams = new URLSearchParams(),
): URLSearchParams {
  const params = new URLSearchParams(baseParams);

  params.set('mode', state.mode);
  params.set('axis', state.axis);
  writeAxisRange(params, VIEWPORT_PARAM_NAMES.x, state.viewport.x);

  for (const attribute of SCATTER_Y_ATTRIBUTES) {
    writeAxisRange(params, VIEWPORT_PARAM_NAMES[attribute], state.viewport[attribute]);
  }

  return params;
}

export function summarizeViewportChange(
  previous: ViewportState,
  next: ViewportState,
): ViewportChangeSummary | null {
  const axes = getChangedViewportAxes(previous, next);

  if (axes.length === 0) {
    return null;
  }

  const hasX = axes.includes('x');
  const hasY = axes.some((axis) => axis !== 'x');
  const unchangedSpanCount = axes.filter((axis) =>
    hasSameSpan(previous[axis], next[axis]),
  ).length;

  return {
    axes,
    kind: hasX && hasY ? 'combined' : hasX ? 'x-only' : 'y-only',
    movement:
      unchangedSpanCount === axes.length
        ? 'pan/move'
        : unchangedSpanCount === 0
          ? 'zoom/resize'
          : 'mixed',
  };
}

export function areViewportsEqual(
  first: ViewportState,
  second: ViewportState,
): boolean {
  return getChangedViewportAxes(first, second).length === 0;
}

export function createViewportStateKey(viewport: ViewportState): string {
  const axes: ViewportAxisKey[] = ['x', ...SCATTER_Y_ATTRIBUTES];

  return axes
    .map((axis) => `${axis}:${viewport[axis].min}:${viewport[axis].max}`)
    .join('|');
}

export function isPlotInteractionGateActive(
  state: PlotInteractionGateState,
): boolean {
  return state.hasFocusWithin || state.isHovered;
}

export function normalizeInteractionShortcutKey(key: string): string {
  return key.toLowerCase();
}

export function parseFastScatterVisualizationMode(
  params: URLSearchParams,
): FastScatterVisualizationMode {
  return normalizeFastScatterVisualizationMode(
    params.get(FAST_SCATTER_VISUALIZATION_PARAM),
  );
}

export function formatFastScatterVisualizationMode(
  mode: FastScatterVisualizationMode,
): string {
  return normalizeFastScatterVisualizationMode(mode);
}

export function normalizeFastScatterVisualizationMode(
  value: FastScatterVisualizationMode | string | null | undefined,
): FastScatterVisualizationMode {
  return FAST_SCATTER_VISUALIZATION_MODES.includes(
    value as FastScatterVisualizationMode,
  )
    ? (value as FastScatterVisualizationMode)
    : DEFAULT_FAST_SCATTER_VISUALIZATION_MODE;
}

export function parseHeatmapBinSizeSearchParam(params: URLSearchParams): number {
  return normalizeHeatmapBinSizePx(params.get(FAST_SCATTER_HEATMAP_BIN_SIZE_PARAM));
}

export function formatHeatmapBinSizeSearchParam(value: number): string {
  return String(normalizeHeatmapBinSizePx(value));
}

export function normalizeHeatmapBinSizePx(
  value: number | string | null | undefined,
): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value !== 'string' || value.trim() === ''
        ? Number.NaN
        : Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_FAST_SCATTER_HEATMAP_BIN_SIZE_PX;
  }

  return clampInteger(
    Math.round(parsed),
    MIN_FAST_SCATTER_HEATMAP_BIN_SIZE_PX,
    MAX_FAST_SCATTER_HEATMAP_BIN_SIZE_PX,
  );
}

export function isInteractionMode(value: string | null): value is InteractionMode {
  return INTERACTION_MODES.includes(value as InteractionMode);
}

export function isInteractionAxis(value: string | null): value is InteractionAxis {
  return INTERACTION_AXES.includes(value as InteractionAxis);
}

function parseAxisRange(
  params: URLSearchParams,
  names: readonly [string, string],
): AxisRange | null {
  const min = parseFiniteParam(params.get(names[0]));
  const max = parseFiniteParam(params.get(names[1]));

  if (min === null || max === null || min >= max) {
    return null;
  }

  return { min, max };
}

function writeAxisRange(
  params: URLSearchParams,
  names: readonly [string, string],
  range: AxisRange,
): void {
  params.set(names[0], formatNumber(range.min));
  params.set(names[1], formatNumber(range.max));
}

function parseFiniteParam(value: string | null): number | null {
  if (value === null || value.trim() === '') {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rangeFor(
  records: readonly ScatterRecord[],
  key: 'x' | ScatterYAttribute,
): AxisRange {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const record of records) {
    const value = record[key];
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }

  if (min === max) {
    const padding = Math.max(1, Math.abs(min) * 0.05);
    return { min: min - padding, max: max + padding };
  }

  return { min, max };
}

function formatNumber(value: number): string {
  return String(value);
}

function getChangedViewportAxes(
  previous: ViewportState,
  next: ViewportState,
): ViewportAxisKey[] {
  const axes: ViewportAxisKey[] = ['x', ...SCATTER_Y_ATTRIBUTES];

  return axes.filter((axis) => !areAxisRangesEqual(previous[axis], next[axis]));
}

function areAxisRangesEqual(first: AxisRange, second: AxisRange): boolean {
  return areNearlyEqual(first.min, second.min) && areNearlyEqual(first.max, second.max);
}

function hasSameSpan(first: AxisRange, second: AxisRange): boolean {
  return areNearlyEqual(first.max - first.min, second.max - second.min);
}

function areNearlyEqual(first: number, second: number): boolean {
  return Math.abs(first - second) <= RANGE_EPSILON;
}
