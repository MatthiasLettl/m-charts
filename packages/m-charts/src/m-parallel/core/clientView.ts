import {
  createClientDataView, type ClientDataField, type ClientDataSet,
  type ClientDataView, type ClientDataViewEvaluation, type CreateClientDataViewOptions,
} from '../../client-data-view/index.js';
import { composeClientRowColors } from '../../client-data-view/core/chartProjection.js';
import type { ParallelBuffers, ParallelRawValuesByAxis } from './buffers.js';

export interface ParallelClientViewBinding {
  readonly view: ClientDataView;
  readonly fieldByAxis?: Readonly<Record<string, string>>;
}
export interface CreateParallelClientDataViewOptions {
  readonly buffers: ParallelBuffers;
  readonly datasetKey?: string;
  readonly datasetVersion?: string;
  readonly fields?: Readonly<Record<string, ClientDataField>>;
  readonly state?: CreateClientDataViewOptions['state'];
  readonly onListenerError?: CreateClientDataViewOptions['onListenerError'];
}
export interface ParallelClientViewEvaluation extends ClientDataViewEvaluation {
  readonly buffers: ParallelBuffers;
  readonly sourceStyleMode: 'preserve' | 'ignore';
}

const decodedSources = new WeakMap<object, ParallelRawValuesByAxis[string]>();

export function createParallelClientDataSet(options: CreateParallelClientDataViewOptions): ClientDataSet {
  const { buffers } = options;
  const fields: Record<string, ClientDataField> = { ...options.fields };
  for (const key of buffers.axisOrder) {
    if (fields[key] !== undefined) continue;
    const metadata = buffers.axisMetadataByAxis?.[key];
    const kind = metadata?.kind ?? 'numeric';
    const raw = buffers.rawValuesByAxis[key]!;
    const values = kind === 'numeric' ? raw : Array.from({ length: buffers.recordCount }, (_, row) => {
      if (!Number.isFinite(raw[row])) return null;
      if (metadata?.kind === 'datetime-ns') return metadata.epochNsValues[row] ?? null;
      if (metadata?.kind === 'boolean') return raw[row] === 1;
      if (metadata?.kind === 'categorical') return metadata.categories.find((c) => c.encoded === raw[row])?.value ?? null;
      return raw[row];
    });
    if (values !== raw) decodedSources.set(values, raw);
    fields[key] = { kind, values };
  }
  return { fields, rowCount: buffers.recordCount, datasetKey: options.datasetKey, datasetVersion: options.datasetVersion };
}
export function createParallelClientDataView(options: CreateParallelClientDataViewOptions): ClientDataView {
  return createClientDataView({ dataset: createParallelClientDataSet(options), state: options.state, onListenerError: options.onListenerError });
}
const caches = new WeakMap<ParallelClientViewBinding, {
  source: ParallelBuffers; fields: ClientDataViewEvaluation['fields']; mapping: string;
  coordinates: ParallelBuffers; result: ParallelClientViewEvaluation; fallback: string;
}>();
export function evaluateParallelClientView(
  binding: ParallelClientViewBinding, source: ParallelBuffers,
  defaultColor: readonly number[] = [25, 95, 170, 255],
): ParallelClientViewEvaluation {
  const evaluation = binding.view.evaluate();
  if (evaluation.metrics.rowCount !== source.recordCount) throw new TypeError('Parallel client view row count does not match source buffers.');
  const previous = caches.get(binding);
  const mapping = JSON.stringify(binding.fieldByAxis);
  let coordinates = previous?.source === source && previous.fields === evaluation.fields && previous.mapping === mapping
    ? previous.coordinates : undefined;
  if (coordinates === undefined) {
    const rawValuesByAxis: ParallelRawValuesByAxis = {};
    const domainsByAxis = { ...source.domainsByAxis };
    const axisMetadataByAxis = { ...source.axisMetadataByAxis };
    for (const key of source.axisOrder) {
      const field = evaluation.fields[binding.fieldByAxis?.[key] ?? key];
      if (field === undefined) throw new TypeError(`Parallel client-view field for "${key}" is missing.`);
      const metadata = source.axisMetadataByAxis?.[key];
      const values = field.values;
      if (values === source.rawValuesByAxis[key] || decodedSources.get(values) === source.rawValuesByAxis[key]) { rawValuesByAxis[key] = source.rawValuesByAxis[key]!; continue; }
      const output = new Float64Array(source.recordCount);
      const categories = metadata?.kind === 'categorical' || metadata?.kind === 'boolean'
        ? new Map(metadata.categories.map((c) => [c.value, c.encoded])) : null;
      let min = Infinity; let max = -Infinity;
      for (let row = 0; row < output.length; row += 1) {
        const value = values[row];
        let numeric = value == null ? NaN : Number(value);
        if (field.kind === 'categorical') numeric = value == null ? NaN : categories?.get(String(value)) ?? NaN;
        if (field.kind === 'boolean') numeric = value == null ? NaN : value === true || value === 1 ? 1 : 0;
        if (field.kind === 'datetime-ns' && metadata?.kind === 'datetime-ns') numeric = value == null ? NaN : Number(BigInt(value as string | number | bigint) - metadata.datetimeOriginNsBigInt) / 1_000_000;
        output[row] = numeric;
        if (Number.isFinite(numeric)) { min = Math.min(min, numeric); max = Math.max(max, numeric); }
      }
      rawValuesByAxis[key] = output;
      if (field.kind === 'numeric' && Number.isFinite(min)) {
        const domain = { min, max, span: max - min };
        domainsByAxis[key] = domain;
        if (metadata) axisMetadataByAxis[key] = { ...metadata, kind: 'numeric', domain };
      }
    }
    coordinates = { ...source, rawValuesByAxis, domainsByAxis, axisMetadataByAxis,
      normalizedValuesDerivedFromRaw: true, normalizedValuesByAxis: {}, webgpuPackedData: undefined, webglSegmentBuffers: undefined };
  }
  const sourceStyleMode = binding.view.getState().sourceStyleMode ?? 'preserve';
  const fallback = JSON.stringify(defaultColor);
  const reuseStyles = previous?.source === source && previous.result.styles === evaluation.styles && previous.result.sourceStyleMode === sourceStyleMode && previous.fallback === fallback;
  let styleBuffers = reuseStyles ? previous.result.buffers.styleBuffers : undefined;
  if (!reuseStyles) {
    if (evaluation.styles.color === undefined && evaluation.styles.opacity === undefined) {
      styleBuffers = sourceStyleMode === 'preserve' ? source.styleBuffers : undefined;
    } else {
      const color = composeClientRowColors(evaluation, sourceStyleMode === 'preserve', source.styleBuffers?.color, false, defaultColor, source.styleBuffers?.opacity);
      styleBuffers = color === undefined ? undefined : { color, colorFormat: 'rgba8', opacity: new Float32Array(0), styledRecordCount: source.recordCount };
    }
  }
  const result = { ...evaluation, sourceStyleMode, buffers: { ...coordinates, activeMask: evaluation.activeMask, styleBuffers } };
  caches.set(binding, { source, fields: evaluation.fields, mapping, coordinates, result, fallback });
  return result;
}
