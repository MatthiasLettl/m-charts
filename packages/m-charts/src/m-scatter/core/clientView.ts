import {
  createClientDataView,
  type ClientComputedStyleChannel,
  type ClientDataField,
  type ClientDataSet,
  type ClientDataView,
  type ClientDataViewEvaluation,
  type ClientDataViewState,
  type CreateClientDataViewOptions,
} from '../../client-data-view/index.js';
import type { FastScatterPointColumns } from './types.js';

export interface FastScatterClientViewBinding {
  readonly view: ClientDataView;
  readonly xField?: string;
  readonly yFieldByKey?: Readonly<Record<string, string>>;
}

export interface FastScatterClientViewEvaluation {
  readonly activeMask: Uint32Array;
  readonly activeSourceIndices: Uint32Array;
  readonly interactionColumns: FastScatterPointColumns;
  readonly metrics: ClientDataViewEvaluation['metrics'];
  readonly renderColumns: FastScatterPointColumns;
  readonly revision: number;
  readonly sourceStyleMode: 'ignore' | 'preserve';
  readonly styles: ClientDataViewEvaluation['styles'];
  readonly transformedX: boolean;
  readonly transformedYKeys: ReadonlySet<string>;
}

export interface CreateFastScatterClientDataViewOptions {
  readonly onListenerError?: CreateClientDataViewOptions['onListenerError'];
  readonly columns: FastScatterPointColumns;
  readonly datasetKey?: string;
  readonly datasetVersion?: string;
  readonly fields?: Readonly<Record<string, ClientDataField>>;
  readonly state?: Partial<Omit<ClientDataViewState, 'revision' | 'version'>>;
}

export function createFastScatterClientDataView(
  options: CreateFastScatterClientDataViewOptions,
): ClientDataView {
  return createClientDataView({
    dataset: createFastScatterClientDataSet(options),
    state: options.state,
    onListenerError: options.onListenerError,
  });
}

export function createFastScatterClientDataSet(
  options: Omit<CreateFastScatterClientDataViewOptions, 'state'>,
): ClientDataSet {
  const xKey = options.columns.xKey ?? 'x';
  const fields: Record<string, ClientDataField> = {
    ...options.fields,
    [xKey]: options.fields?.[xKey] ?? { kind: 'numeric', values: options.columns.x },
  };
  for (const [key, values] of Object.entries(options.columns.y)) {
    fields[key] ??= { kind: 'numeric', values };
  }
  return {
    datasetKey: options.datasetKey,
    datasetVersion: options.datasetVersion,
    fields,
    rowCount: options.columns.x.length,
  };
}

interface ScatterViewCache {
  source: FastScatterPointColumns;
  fields: ClientDataViewEvaluation['fields'];
  mapping: string;
  coordinates: FastScatterPointColumns;
  result: FastScatterClientViewEvaluation;
  fallbackColor: number;
}
const scatterViewCaches = new WeakMap<FastScatterClientViewBinding, ScatterViewCache>();

export function evaluateFastScatterClientView(
  binding: FastScatterClientViewBinding,
  sourceColumns: FastScatterPointColumns,
  defaultPointColor: readonly [number, number, number, number] = [0, 0, 0, 255],
): FastScatterClientViewEvaluation {
  const evaluation = binding.view.evaluate();
  if (evaluation.metrics.rowCount !== sourceColumns.x.length) {
    throw new TypeError(
      `Scatter client view has ${evaluation.metrics.rowCount} rows for ${sourceColumns.x.length} points.`,
    );
  }
  const mapping = JSON.stringify([binding.xField, binding.yFieldByKey]);
  const previous = scatterViewCaches.get(binding);
  const reuseCoordinates = previous?.source === sourceColumns &&
    previous.fields === evaluation.fields && previous.mapping === mapping;
  const xFieldKey = binding.xField ?? sourceColumns.xKey ?? 'x';
  const xField = requireScatterCoordinateField(evaluation, xFieldKey);
  const transformedX = xField.values !== sourceColumns.x;
  const transformedYKeys = reuseCoordinates ? previous.result.transformedYKeys : new Set<string>();
  let coordinates: FastScatterPointColumns;
  if (reuseCoordinates) {
    coordinates = previous.coordinates;
  } else {
    const y: Record<string, FastScatterPointColumns['x']> = {};
    for (const [yKey, sourceValues] of Object.entries(sourceColumns.y)) {
      const fieldKey = binding.yFieldByKey?.[yKey] ?? yKey;
      const field = requireScatterCoordinateField(evaluation, fieldKey);
      y[yKey] = toScatterNumericArray(field.values, sourceValues);
      if (field.values !== sourceValues) (transformedYKeys as Set<string>).add(yKey);
    }
    // Always establish sorted display order, including an unchanged unsorted
    // source. Source indices/IDs and source buffers keep their original order.
    coordinates = withProjectedXOrder({
      ...sourceColumns, x: toScatterNumericArray(xField.values, sourceColumns.x), y,
    });
  }
  const sourceStyleMode = binding.view.getState().sourceStyleMode ?? 'preserve';
  const fallbackColor = ((defaultPointColor[0] << 24) | (defaultPointColor[1] << 16) |
    (defaultPointColor[2] << 8) | defaultPointColor[3]) >>> 0;
  const reuseStyles = previous?.source === sourceColumns &&
    previous.result.styles === evaluation.styles &&
    previous.result.sourceStyleMode === sourceStyleMode && previous.fallbackColor === fallbackColor;
  const renderColumns = reuseStyles
    ? { ...previous.result.renderColumns, x: coordinates.x, xOrder: coordinates.xOrder, y: coordinates.y }
    : applyComputedStyles(coordinates, evaluation, sourceStyleMode, fallbackColor);
  const reuseMask = reuseCoordinates && previous.result.activeMask === evaluation.activeMask;
  const interactionColumns = evaluation.metrics.activeRowCount === evaluation.metrics.rowCount
    ? renderColumns
    : reuseMask
      ? { ...renderColumns, y: previous.result.interactionColumns.y }
      : maskInteractionColumns(renderColumns, evaluation.activeMask);
  const result: FastScatterClientViewEvaluation = {
    activeMask: evaluation.activeMask,
    activeSourceIndices: evaluation.activeSourceIndices,
    interactionColumns,
    metrics: evaluation.metrics,
    renderColumns,
    revision: evaluation.revision,
    sourceStyleMode,
    styles: evaluation.styles,
    transformedX,
    transformedYKeys,
  };
  scatterViewCaches.set(binding, {
    source: sourceColumns, fields: evaluation.fields, mapping, coordinates, result, fallbackColor,
  });
  return result;
}

function applyComputedStyles(
  columns: FastScatterPointColumns,
  evaluation: ClientDataViewEvaluation,
  sourceStyleMode: 'ignore' | 'preserve',
  fallbackColor: number,
): FastScatterPointColumns {
  const pointCount = columns.x.length;
  const computed = evaluation.styles;
  const color = computed.color === undefined
    ? sourceStyleMode === 'preserve' ? columns.color : undefined
    : mergeColor(columns, computed.color.assigned, computed.color.values, sourceStyleMode, fallbackColor);
  const colorFormat = color === undefined
    ? undefined
    : computed.color === undefined ? columns.colorFormat : 'rgba32';
  const opacity = mergeFloatChannel(
    sourceStyleMode === 'preserve' ? columns.opacity : undefined,
    computed.opacity,
    pointCount,
    1,
  );
  const size = mergeFloatChannel(
    sourceStyleMode === 'preserve' ? columns.size : undefined,
    computed.size,
    pointCount,
    4,
  );
  const rotation = mergeFloatChannel(
    sourceStyleMode === 'preserve' ? columns.rotation ?? columns.rotationRadians : undefined,
    computed.rotation,
    pointCount,
    0,
  );
  const shape = mergeShapeChannel(
    sourceStyleMode === 'preserve' ? columns.shape : undefined,
    computed.shape,
    pointCount,
  );
  return {
    ...columns,
    color,
    colorFormat,
    opacity,
    rotation,
    rotationRadians: rotation,
    shape,
    size,
  };
}

function mergeColor(
  columns: FastScatterPointColumns,
  assigned: Uint8Array,
  computed: Uint32Array,
  sourceStyleMode: 'ignore' | 'preserve',
  fallbackColor: number,
): Uint32Array {
  const output = new Uint32Array(columns.x.length);
  output.fill(fallbackColor);
  if (sourceStyleMode === 'preserve') {
    if (columns.color instanceof Uint32Array) output.set(columns.color);
    else if (columns.color instanceof Uint8Array) {
      for (let index = 0; index < output.length; index += 1) {
        const offset = index * 4;
        output[index] = (
          ((columns.color[offset] ?? 0) << 24) |
          ((columns.color[offset + 1] ?? 0) << 16) |
          ((columns.color[offset + 2] ?? 0) << 8) |
          (columns.color[offset + 3] ?? 255)
        ) >>> 0;
      }
    }
  }
  for (let index = 0; index < output.length; index += 1) {
    if (assigned[index] !== 0) output[index] = computed[index] ?? output[index]!;
  }
  return output;
}

function mergeFloatChannel(
  source: Float32Array | undefined,
  computed: ClientComputedStyleChannel<Float32Array> | undefined,
  pointCount: number,
  fallback: number,
): Float32Array | undefined {
  if (computed === undefined) return source;
  const output = source === undefined ? new Float32Array(pointCount) : new Float32Array(source);
  if (source === undefined) output.fill(fallback);
  for (let index = 0; index < pointCount; index += 1) {
    if (computed.assigned[index] !== 0) output[index] = computed.values[index] ?? fallback;
  }
  return output;
}

function mergeShapeChannel(
  source: Uint8Array | undefined,
  computed: ClientComputedStyleChannel<Uint8Array> | undefined,
  pointCount: number,
): Uint8Array | undefined {
  if (computed === undefined) return source;
  const output = source === undefined ? new Uint8Array(pointCount) : new Uint8Array(source);
  for (let index = 0; index < pointCount; index += 1) {
    if (computed.assigned[index] !== 0) output[index] = computed.values[index] ?? 0;
  }
  return output;
}

function maskInteractionColumns(
  columns: FastScatterPointColumns,
  activeMask: Uint32Array,
): FastScatterPointColumns {
  const y: Record<string, Float64Array> = Object.fromEntries(
    Object.keys(columns.y).map((key) => [key, new Float64Array(columns.x.length)]),
  );
  for (const [key, values] of Object.entries(columns.y)) {
    const output = y[key]!;
    for (let index = 0; index < columns.x.length; index += 1) {
      const active = ((activeMask[index >>> 5] ?? 0) & (1 << (index & 31))) !== 0;
      output[index] = active ? values[index] ?? Number.NaN : Number.NaN;
    }
  }
  // Keep X intact so the scatter engine's sorted-X range lookup remains valid.
  // Masking every Y coordinate is sufficient to exclude a row from hover,
  // rectangle/lasso selection, and aggregation in every subplot.
  return { ...columns, y };
}

function withProjectedXOrder(columns: FastScatterPointColumns): FastScatterPointColumns {
  const values = columns.x;
  let previous = Number.NEGATIVE_INFINITY;
  let naturallySorted = true;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? Number.NaN;
    if (!Number.isFinite(value) || value < previous) {
      naturallySorted = false;
      break;
    }
    previous = value;
  }
  if (naturallySorted) return { ...columns, xOrder: undefined };

  const indices = Uint32Array.from({ length: values.length }, (_, index) => index);
  indices.sort((left, right) => {
    const leftValue = values[left] ?? Number.NaN;
    const rightValue = values[right] ?? Number.NaN;
    const leftFinite = Number.isFinite(leftValue);
    const rightFinite = Number.isFinite(rightValue);
    if (leftFinite !== rightFinite) return leftFinite ? -1 : 1;
    if (leftFinite && rightFinite && leftValue !== rightValue) return leftValue - rightValue;
    return left - right;
  });
  return { ...columns, xOrder: indices };
}

function requireScatterCoordinateField(
  evaluation: ClientDataViewEvaluation,
  key: string,
): ClientDataField {
  const field = evaluation.fields[key];
  if (field === undefined) throw new TypeError(`Scatter client-view field "${key}" is missing.`);
  return field;
}

function toScatterNumericArray(
  values: ClientDataField['values'],
  fallback: FastScatterPointColumns['x'],
): FastScatterPointColumns['x'] {
  if (values === fallback) return fallback;
  if (
    values instanceof Float32Array || values instanceof Float64Array ||
    values instanceof Uint8Array || values instanceof Uint16Array || values instanceof Uint32Array
  ) return values;
  const output = new Float64Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    output[index] = typeof value === 'number'
      ? value
      : typeof value === 'bigint' ? Number(value) : Number.NaN;
  }
  return output;
}
