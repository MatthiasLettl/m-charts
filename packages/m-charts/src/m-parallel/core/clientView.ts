import { createClientDataFingerprint } from '../../client-data-view/core/fingerprint.js';
import { decodeClientField, projectClientField } from '../../client-data-view/core/encoding.js';
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
  /** Compute a content/identity fingerprint once when no server version is supplied. */
  readonly fingerprint?: boolean;
  readonly datasetKey?: string;
  readonly datasetVersion?: string;
  readonly fields?: Readonly<Record<string, ClientDataField>>;
  readonly state?: CreateClientDataViewOptions['state'];
  readonly asyncEvaluator?: CreateClientDataViewOptions['asyncEvaluator'];
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
    const { values } = decodeClientField(raw, metadata);
    if (values !== raw) decodedSources.set(values, raw);
    fields[key] = { kind, values };
  }
  return { fields, rowCount: buffers.recordCount, datasetKey: options.datasetKey, datasetVersion: options.datasetVersion ?? (options.fingerprint ? createClientDataFingerprint({ fields, rowCount: buffers.recordCount }, buffers.ids) : undefined) };
}
export function createParallelClientDataView(options: CreateParallelClientDataViewOptions): ClientDataView {
  return createClientDataView({ dataset: createParallelClientDataSet(options), state: options.state, asyncEvaluator: options.asyncEvaluator, onListenerError: options.onListenerError });
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
      const projection = projectClientField(field, source.rawValuesByAxis[key]!, metadata);
      const output = Float64Array.from(projection.values);
      rawValuesByAxis[key] = output;
      const range = projection.encoding.domain ?? { min: 0, max: 1 };
      const domain = { ...range, span: range.max - range.min };
      domainsByAxis[key] = domain;
      axisMetadataByAxis[key] = { ...metadata, ...projection.encoding, domain,
        ...(projection.encoding.datetimeOriginNs === undefined ? {} : { datetimeOriginNsBigInt: BigInt(projection.encoding.datetimeOriginNs) }),
      } as NonNullable<ParallelBuffers['axisMetadataByAxis']>[string];

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
