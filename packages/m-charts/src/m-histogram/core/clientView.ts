import { createClientDataFingerprint } from '../../client-data-view/core/fingerprint.js';
import { decodeClientField, projectClientField } from '../../client-data-view/core/encoding.js';
import {
  createClientDataView, type ClientDataField, type ClientDataSet,
  type ClientDataView, type ClientDataViewEvaluation, type CreateClientDataViewOptions,
} from '../../client-data-view/index.js';
import { composeClientRowColors, uniformClientColor } from '../../client-data-view/core/chartProjection.js';
import type { HistogramColumns, HistogramValueColumn } from './types.js';

export interface HistogramClientViewBinding {
  readonly view: ClientDataView;
  readonly fieldByParameter?: Readonly<Record<string, string>>;
}
export interface CreateHistogramClientDataViewOptions {
  readonly columns: HistogramColumns;
  /** Compute a content/identity fingerprint once when no server version is supplied. */
  readonly fingerprint?: boolean;
  readonly datasetKey?: string;
  readonly datasetVersion?: string;
  readonly fields?: Readonly<Record<string, ClientDataField>>;
  readonly state?: CreateClientDataViewOptions['state'];
  readonly asyncEvaluator?: CreateClientDataViewOptions['asyncEvaluator'];
  readonly onListenerError?: CreateClientDataViewOptions['onListenerError'];
}
export interface HistogramClientViewEvaluation extends ClientDataViewEvaluation {
  readonly columns: HistogramColumns;
  readonly sourceStyleMode: 'preserve' | 'ignore';
}
export function createHistogramClientDataSet(options: CreateHistogramClientDataViewOptions): ClientDataSet {
  const fields: Record<string, ClientDataField> = { ...options.fields };
  for (const [key, values] of Object.entries(options.columns.valuesByParameter)) {
    fields[key] ??= decodeClientField(values, options.columns.parameters?.find((p) => p.key === key));
  }
  return { fields, rowCount: options.columns.ids.length, datasetKey: options.datasetKey, datasetVersion: options.datasetVersion ?? (options.fingerprint ? createClientDataFingerprint({ fields, rowCount: options.columns.ids.length }, options.columns.ids) : undefined) };
}
export function createHistogramClientDataView(options: CreateHistogramClientDataViewOptions): ClientDataView {
  return createClientDataView({ dataset: createHistogramClientDataSet(options), state: options.state, asyncEvaluator: options.asyncEvaluator, onListenerError: options.onListenerError });
}
const caches = new WeakMap<HistogramClientViewBinding, {
  source: HistogramColumns; fields: ClientDataViewEvaluation['fields']; mapping: string;
  result: HistogramClientViewEvaluation; fallback: string;
}>();
export function evaluateHistogramClientView(
  binding: HistogramClientViewBinding, source: HistogramColumns,
  defaultColor: readonly number[] = [31, 107, 173, 235],
): HistogramClientViewEvaluation {
  const evaluation = binding.view.evaluate();
  if (evaluation.metrics.rowCount !== source.ids.length) throw new TypeError('Histogram client view row count does not match source columns.');
  const previous = caches.get(binding);
  const mapping = JSON.stringify(binding.fieldByParameter);
  const reuseValues = previous?.source === source && previous.fields === evaluation.fields && previous.mapping === mapping;
  let parameters = reuseValues ? previous.result.columns.parameters : source.parameters;
  const valuesByParameter: Record<string, HistogramValueColumn> = reuseValues ? previous.result.columns.valuesByParameter : {};
  if (!reuseValues) for (const key of Object.keys(source.valuesByParameter)) {
    const field = evaluation.fields[binding.fieldByParameter?.[key] ?? key];
    if (field === undefined) throw new TypeError(`Histogram client-view field for "${key}" is missing.`);
    const parameter = source.parameters?.find((p) => p.key === key);
    const projection = projectClientField(field, source.valuesByParameter[key]!, parameter);
    const raw = projection.values;
    if (projection.changed) {
      parameters = [...(parameters ?? [])];
      const index = parameters.findIndex((p) => p.key === key);
      const projectedParameter: import('./types.js').HistogramParameterSpec = {
        key, label: parameter?.label ?? key, source: parameter?.source,
        ...projection.encoding,
        epochNsValues: projection.encoding.epochNsValues?.map((v) => v ?? ''),
      };
      if (index >= 0) (parameters as import('./types.js').HistogramParameterSpec[])[index] = projectedParameter;
      else (parameters as import('./types.js').HistogramParameterSpec[]).push(projectedParameter);
    }
    if (!projection.changed) {
      valuesByParameter[key] = source.valuesByParameter[key]!;
    } else if (field.kind === 'categorical' || field.kind === 'boolean') {
      valuesByParameter[key] = Uint32Array.from({ length: source.ids.length }, (_, row) =>
        Number.isFinite(raw[row]) ? raw[row]! : 0xffff_ffff);
    } else if (ArrayBuffer.isView(raw)) {
      valuesByParameter[key] = raw as import('./types.js').HistogramNumericArray;
    } else {
      valuesByParameter[key] = Float64Array.from({ length: source.ids.length }, (_, row) =>
        raw[row] != null ? Number(raw[row]) : NaN);
    }
  }

  const sourceStyleMode = binding.view.getState().sourceStyleMode ?? 'preserve';
  const fallback = JSON.stringify(defaultColor);
  const reuseStyles = previous?.source === source && previous.result.styles === evaluation.styles && previous.result.sourceStyleMode === sourceStyleMode && previous.fallback === fallback;
  const hasStyles = evaluation.styles.color !== undefined || evaluation.styles.opacity !== undefined;
  const fallbackColor = sourceStyleMode === 'preserve' && source.color === undefined ? [255, 255, 255, 255] : defaultColor;
  const uniform = hasStyles ? uniformClientColor(evaluation, sourceStyleMode === 'preserve', source.color, fallbackColor) : undefined;
  const rgba = reuseStyles ? previous.result.columns.color : uniform !== undefined ? new Uint32Array(source.ids.length).fill(uniform) : hasStyles
    ? composeClientRowColors(evaluation, sourceStyleMode === 'preserve', source.color, source.color instanceof Uint32Array || source.colorFormat === 'rgba32', sourceStyleMode === 'preserve' && source.color === undefined ? [255, 255, 255, 255] : defaultColor)
    : sourceStyleMode === 'preserve' ? source.color : new Uint32Array(source.ids.length).fill(
      ((defaultColor[0]! << 24) | (defaultColor[1]! << 16) | (defaultColor[2]! << 8) | defaultColor[3]!) >>> 0,
    );
  const color = hasStyles && rgba instanceof Uint8Array ? Uint32Array.from({ length: source.ids.length }, (_, row) => {
    const i = row * 4;
    return ((rgba[i]! << 24) | (rgba[i + 1]! << 16) | (rgba[i + 2]! << 8) | rgba[i + 3]!) >>> 0;
  }) : rgba;
  const columns: HistogramColumns = { ...source, activeMask: evaluation.activeMask, parameters, valuesByParameter, color,
    colorFormat: hasStyles || sourceStyleMode === 'ignore' ? 'rgba32' : source.colorFormat };
  const result = { ...evaluation, columns, sourceStyleMode };
  caches.set(binding, { source, fields: evaluation.fields, mapping, result, fallback });
  return result;
}
