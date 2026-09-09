import {
  createClientDataView, type ClientDataField, type ClientDataSet,
  type ClientDataView, type ClientDataViewEvaluation, type CreateClientDataViewOptions,
} from '../../client-data-view/index.js';
import { clientRowIsActive, composeClientRowColors } from '../../client-data-view/core/chartProjection.js';
import type { HistogramColumns, HistogramValueColumn } from './types.js';

export interface HistogramClientViewBinding {
  readonly view: ClientDataView;
  readonly fieldByParameter?: Readonly<Record<string, string>>;
}
export interface CreateHistogramClientDataViewOptions {
  readonly columns: HistogramColumns;
  readonly datasetKey?: string;
  readonly datasetVersion?: string;
  readonly fields?: Readonly<Record<string, ClientDataField>>;
  readonly state?: CreateClientDataViewOptions['state'];
  readonly onListenerError?: CreateClientDataViewOptions['onListenerError'];
}
export interface HistogramClientViewEvaluation extends ClientDataViewEvaluation {
  readonly columns: HistogramColumns;
  readonly sourceStyleMode: 'preserve' | 'ignore';
}
export function createHistogramClientDataSet(options: CreateHistogramClientDataViewOptions): ClientDataSet {
  const fields: Record<string, ClientDataField> = { ...options.fields };
  for (const [key, values] of Object.entries(options.columns.valuesByParameter)) {
    fields[key] ??= { kind: options.columns.parameters?.find((p) => p.key === key)?.kind ?? 'numeric', values };
  }
  return { fields, rowCount: options.columns.ids.length, datasetKey: options.datasetKey, datasetVersion: options.datasetVersion };
}
export function createHistogramClientDataView(options: CreateHistogramClientDataViewOptions): ClientDataView {
  return createClientDataView({ dataset: createHistogramClientDataSet(options), state: options.state, onListenerError: options.onListenerError });
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
  const reuseValues = previous?.source === source && previous.fields === evaluation.fields && previous.result.activeMask === evaluation.activeMask && previous.mapping === mapping;
  const valuesByParameter: Record<string, HistogramValueColumn> = reuseValues ? previous.result.columns.valuesByParameter : {};
  if (!reuseValues) for (const key of Object.keys(source.valuesByParameter)) {
    const field = evaluation.fields[binding.fieldByParameter?.[key] ?? key];
    if (field === undefined) throw new TypeError(`Histogram client-view field for "${key}" is missing.`);
    if (field.values === source.valuesByParameter[key] && evaluation.metrics.activeRowCount === source.ids.length) {
      valuesByParameter[key] = source.valuesByParameter[key]!;
    } else if ((field.kind === 'categorical' || field.kind === 'boolean') && ArrayBuffer.isView(field.values)) {
      // The unsigned sentinel cannot match a category, and keeps the WASM
      // categorical path available without compacting source identities.
      valuesByParameter[key] = Uint32Array.from({ length: source.ids.length }, (_, row) =>
        clientRowIsActive(evaluation.activeMask, row) && Number.isFinite(Number(field.values[row]))
          ? Number(field.values[row]) : 0xffff_ffff);
    } else if (field.kind === 'numeric' || ArrayBuffer.isView(field.values)) {
      valuesByParameter[key] = Float64Array.from({ length: source.ids.length }, (_, row) => {
        const value = field.values[row];
        return clientRowIsActive(evaluation.activeMask, row) && value != null ? Number(value) : NaN;
      });
    } else {
      valuesByParameter[key] = Array.from({ length: source.ids.length }, (_, row) => clientRowIsActive(evaluation.activeMask, row) ? field.values[row] : null);
    }
  }
  const sourceStyleMode = binding.view.getState().sourceStyleMode ?? 'preserve';
  const fallback = JSON.stringify(defaultColor);
  const reuseStyles = previous?.source === source && previous.result.styles === evaluation.styles && previous.result.sourceStyleMode === sourceStyleMode && previous.fallback === fallback;
  const hasStyles = evaluation.styles.color !== undefined || evaluation.styles.opacity !== undefined;
  const rgba = reuseStyles ? previous.result.columns.color : hasStyles
    ? composeClientRowColors(evaluation, sourceStyleMode === 'preserve', source.color, source.color instanceof Uint32Array || source.colorFormat === 'rgba32', defaultColor)
    : sourceStyleMode === 'preserve' ? source.color : new Uint32Array(source.ids.length).fill(
      ((defaultColor[0]! << 24) | (defaultColor[1]! << 16) | (defaultColor[2]! << 8) | defaultColor[3]!) >>> 0,
    );
  const color = hasStyles && rgba instanceof Uint8Array ? Uint32Array.from({ length: source.ids.length }, (_, row) => {
    const i = row * 4;
    return ((rgba[i]! << 24) | (rgba[i + 1]! << 16) | (rgba[i + 2]! << 8) | rgba[i + 3]!) >>> 0;
  }) : rgba;
  const columns: HistogramColumns = { ...source, valuesByParameter, color,
    colorFormat: hasStyles || sourceStyleMode === 'ignore' ? 'rgba32' : source.colorFormat };
  const result = { ...evaluation, columns, sourceStyleMode };
  caches.set(binding, { source, fields: evaluation.fields, mapping, result, fallback });
  return result;
}
