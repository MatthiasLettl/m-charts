import type {
  ClientComputedStyles,
  ClientDataField,
  ClientDataPredicate,
  ClientDataSet,
  ClientDataTransformation,
  ClientDataValue,
  ClientDataViewEvaluation,
  ClientDataViewState,
  ClientStyleChannel,
  ClientStyleExpression,
  ClientStyleValue,
} from './types.js';

const CHANNELS: readonly ClientStyleChannel[] = [
  'color',
  'opacity',
  'rotation',
  'shape',
  'size',
];

type CompiledPredicate = (rowIndex: number) => boolean;
type CompiledStyleExpression = (rowIndex: number) => ClientStyleValue | undefined;

interface EvaluationCache {
  filters: string;
  transformations: string;
  styles: string;
  evaluation: ClientDataViewEvaluation;
}

/** Internal controller evaluator: retain only the last successfully evaluated stages. */
export function createCachedClientDataViewEvaluator(dataset: ClientDataSet) {
  let previous: EvaluationCache | undefined;
  return (state: ClientDataViewState): ClientDataViewEvaluation => {
    const next = evaluateStages(dataset, state, previous);
    previous = next;
    return next.evaluation;
  };
}

export function evaluateClientDataView(
  dataset: ClientDataSet,
  state: ClientDataViewState,
): ClientDataViewEvaluation {
  return evaluateStages(dataset, state).evaluation;
}

function evaluateStages(
  dataset: ClientDataSet,
  state: ClientDataViewState,
  previous?: EvaluationCache,
): EvaluationCache {
  const startedAt = performance.now();
  validateClientDataSet(dataset);
  validateClientDataViewState(dataset, state);
  const rowCount = dataset.rowCount;
  const filtersKey = JSON.stringify(state.filters);
  const transformationsKey = JSON.stringify(state.transformations);
  const stylesKey = JSON.stringify(state.styles);
  const reuseFilters = previous !== undefined && previous.filters === filtersKey;
  const reuseTransformations = reuseFilters && previous.transformations === transformationsKey;
  const reuseStyles = reuseTransformations && previous.styles === stylesKey;
  const filterStartedAt = performance.now();
  let activeMask: Uint32Array;
  let activeSourceIndices: Uint32Array;
  let activeRowCount: number;
  if (reuseFilters) {
    ({ activeMask, activeSourceIndices } = previous.evaluation);
    activeRowCount = activeSourceIndices.length;
  } else {
    activeMask = new Uint32Array(Math.ceil(rowCount / 32));
    const enabledFilters = state.filters
      .filter((filter) => filter.enabled !== false)
      .map((filter) => compilePredicate(filter.predicate, dataset.fields));
    activeRowCount = 0;
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      if (!enabledFilters.every((filter) => filter(rowIndex))) continue;
      activeMask[rowIndex >>> 5] |= 1 << (rowIndex & 31);
      activeRowCount += 1;
    }
    activeSourceIndices = new Uint32Array(activeRowCount);
    for (let rowIndex = 0, activeIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      if ((activeMask[rowIndex >>> 5]! & (1 << (rowIndex & 31))) !== 0) {
        activeSourceIndices[activeIndex++] = rowIndex;
      }
    }
  }
  const filterMs = reuseFilters ? 0 : performance.now() - filterStartedAt;

  const transformationStartedAt = performance.now();
  const fields: Record<string, ClientDataField> = reuseTransformations
    ? previous.evaluation.fields
    : { ...dataset.fields };
  if (!reuseTransformations) {
    for (const transformation of state.transformations) {
      if (transformation.enabled === false) continue;
      fields[transformation.output] = evaluateTransformation(
        transformation, fields, activeSourceIndices, rowCount,
      );
    }
  }
  const transformationMs = reuseTransformations ? 0 : performance.now() - transformationStartedAt;
  const styleStartedAt = performance.now();
  const styles = reuseStyles
    ? previous.evaluation.styles
    : evaluateStyles(state, fields, activeSourceIndices, rowCount);
  const styleMs = reuseStyles ? 0 : performance.now() - styleStartedAt;
  return {
    filters: filtersKey,
    transformations: transformationsKey,
    styles: stylesKey,
    evaluation: {
      activeMask,
      activeSourceIndices,
      fields,
      metrics: {
        activeRowCount,
        backend: 'typescript',
        durationMs: performance.now() - startedAt,
        filterMs,
        rowCount,
        styleMs,
        transformationMs,
      },
      revision: state.revision,
      styles,
    },
  };
}

export function evaluateClientDataPredicate(
  predicate: ClientDataPredicate,
  fields: Readonly<Record<string, ClientDataField>>,
  rowIndex: number,
): boolean {
  return evaluatePredicate(predicate, fields, rowIndex);
}

function evaluateTransformation(
  transformation: ClientDataTransformation,
  fields: Readonly<Record<string, ClientDataField>>,
  activeSourceIndices: Uint32Array,
  rowCount: number,
): ClientDataField {
  const input = requireField(fields, transformation.input);
  if (input.kind !== 'numeric' && input.kind !== 'datetime-ns') {
    throw new TypeError(
      `Client transformation "${transformation.id}" requires a numeric or datetime input.`,
    );
  }
  const values = new Float64Array(rowCount);
  values.fill(Number.NaN);
  if (transformation.op === 'affine') {
    for (const rowIndex of activeSourceIndices) {
      const inputValue = toFiniteNumber(input.values[rowIndex]);
      if (inputValue !== null) {
        values[rowIndex] = inputValue * transformation.factor + transformation.offset;
      }
    }
    return { kind: 'numeric', values };
  }

  const partitionFields = (transformation.partitionBy ?? []).map((key) => requireField(fields, key));
  const orderField = transformation.orderBy === undefined
    ? null
    : requireField(fields, transformation.orderBy);
  const compareRows = (left: number, right: number) => {
    for (const field of partitionFields) {
      const comparison = compareValues(field.values[left], field.values[right], field.kind);
      if (comparison !== 0) return comparison;
    }
    if (orderField !== null) {
      const comparison = compareValues(
        orderField.values[left],
        orderField.values[right],
        orderField.kind,
      );
      if (comparison !== 0) return comparison;
    }
    return left - right;
  };
  let ordered = activeSourceIndices;
  if (orderField !== null || partitionFields.length > 0) {
    for (let position = 1; position < ordered.length; position += 1) {
      if (compareRows(ordered[position - 1]!, ordered[position]!) > 0) {
        ordered = activeSourceIndices.slice().sort(compareRows);
        break;
      }
    }
  }
  for (let position = 0; position < ordered.length; position += 1) {
    const currentIndex = ordered[position]!;
    const neighborPosition = transformation.direction === 'forward'
      ? position + 1
      : position - 1;
    const neighborIndex = ordered[neighborPosition];
    if (
      neighborIndex === undefined ||
      !samePartition(currentIndex, neighborIndex, partitionFields)
    ) {
      if (transformation.missingValue === 'zero') values[currentIndex] = 0;
      continue;
    }
    const difference = calculateDifference(
      input,
      currentIndex,
      neighborIndex,
      transformation.direction,
    );
    if (difference === null) {
      if (transformation.missingValue === 'zero') values[currentIndex] = 0;
      continue;
    }
    values[currentIndex] = difference;
  }
  return { kind: 'numeric', values };
}

function evaluateStyles(
  state: ClientDataViewState,
  fields: Readonly<Record<string, ClientDataField>>,
  activeSourceIndices: Uint32Array,
  rowCount: number,
): ClientComputedStyles {
  const enabledRules = state.styles.filter((style) => style.enabled !== false);
  const requestedChannels = new Set<ClientStyleChannel>();
  for (const rule of enabledRules) {
    for (const channel of CHANNELS) {
      if (rule.channels[channel] !== undefined) requestedChannels.add(channel);
    }
  }
  const result: ClientComputedStyles = {};
  for (const channel of requestedChannels) {
    const assigned = new Uint8Array(rowCount);
    const values = channel === 'color'
      ? new Uint32Array(rowCount)
      : channel === 'shape'
        ? new Uint8Array(rowCount)
        : new Float32Array(rowCount);
    for (const rule of enabledRules) {
      const expression = rule.channels[channel];
      if (expression === undefined) continue;
      const when = rule.when === undefined ? null : compilePredicate(rule.when, fields);
      const constant = expression.op === 'constant' ? encodeStyleValue(channel, expression.value) : null;
      if (expression.op === 'constant' && when === null && activeSourceIndices.length === rowCount) {
        if (constant !== null) {
          values.fill(constant);
          assigned.fill(1);
        }
        continue;
      }
      const evaluate = compileStyleExpression(expression, fields);
      // Categorical/case color values repeat frequently. Bound the cache so a
      // high-cardinality host field cannot allocate one entry per resident row.
      const colorCache = new Map<string, number>();
      for (const rowIndex of activeSourceIndices) {
        if (when !== null && !when(rowIndex)) continue;
        let encoded = constant;
        if (expression.op !== 'constant') {
          const value = evaluate(rowIndex);
          if (value === undefined) continue;
          if (channel === 'color' && typeof value === 'string') {
            encoded = colorCache.get(value) ?? parseColor(value);
            if (colorCache.size < 1024) colorCache.set(value, encoded);
          } else {
            encoded = encodeStyleValue(channel, value);
          }
        }
        if (encoded === null) continue;
        values[rowIndex] = encoded;
        assigned[rowIndex] = 1;
      }
    }
    Object.assign(result, { [channel]: { assigned, values } });
  }
  return result;
}

function compileStyleExpression(
  expression: ClientStyleExpression,
  fields: Readonly<Record<string, ClientDataField>>,
): CompiledStyleExpression {
  if (expression.op === 'constant') return () => expression.value;
  if (expression.op === 'hashedColor') {
    const values = requireField(fields, expression.field).values;
    const cache = new Map<Exclude<ClientDataValue, null | undefined>, string>();
    return (rowIndex) => {
      const value = values[rowIndex];
      if (isNullish(value)) return undefined;
      let color = cache.get(value);
      if (color === undefined) {
        color = hashedColor(canonicalValue(value));
        if (cache.size < 4096) cache.set(value, color);
      }
      return color;
    };
  }
  if (expression.op === 'categorical') {
    const values = requireField(fields, expression.field).values;
    const mapping = expression.values;
    const fallback = expression.fallback === undefined
      ? null
      : compileStyleExpression(expression.fallback, fields);
    return (rowIndex) => {
      const value = values[rowIndex];
      if (isNullish(value)) return undefined;
      const canonical = canonicalValue(value);
      const plain = String(value);
      const mapped = mapping !== undefined && Object.hasOwn(mapping, canonical)
        ? mapping[canonical]
        : mapping !== undefined && Object.hasOwn(mapping, plain) ? mapping[plain] : undefined;
      return mapped ?? fallback?.(rowIndex);
    };
  }
  if (expression.op === 'continuous') {
    const values = requireField(fields, expression.field).values;
    const [domainStart, domainEnd] = expression.domain;
    const span = domainEnd - domainStart;
    const [rangeStart, rangeEnd] = expression.range;
    if (typeof rangeStart === 'number' && typeof rangeEnd === 'number') {
      return (rowIndex) => {
        const value = toFiniteNumber(values[rowIndex]);
        if (value === null) return undefined;
        let t = span === 0 ? 0 : (value - domainStart) / span;
        if (expression.clamp !== false) t = Math.max(0, Math.min(1, t));
        return rangeStart + (rangeEnd - rangeStart) * t;
      };
    }
    if (typeof rangeStart === 'string' && typeof rangeEnd === 'string') {
      const start = unpackColor(parseColor(rangeStart));
      const end = unpackColor(parseColor(rangeEnd));
      return (rowIndex) => {
        const value = toFiniteNumber(values[rowIndex]);
        if (value === null) return undefined;
        let t = span === 0 ? 0 : (value - domainStart) / span;
        if (expression.clamp !== false) t = Math.max(0, Math.min(1, t));
        return interpolatePackedColor(start, end, t);
      };
    }
    return () => undefined;
  }
  const branches = expression.branches.map((branch) => ({
    value: compileStyleExpression(branch.value, fields),
    when: compilePredicate(branch.when, fields),
  }));
  const fallback = expression.fallback === undefined
    ? null
    : compileStyleExpression(expression.fallback, fields);
  return (rowIndex) => {
    for (const branch of branches) {
      if (branch.when(rowIndex)) return branch.value(rowIndex);
    }
    return fallback?.(rowIndex);
  };
}

function compilePredicate(
  predicate: ClientDataPredicate,
  fields: Readonly<Record<string, ClientDataField>>,
): CompiledPredicate {
  if (predicate.op === 'and' || predicate.op === 'or') {
    const args = predicate.args.map((argument) => compilePredicate(argument, fields));
    return predicate.op === 'and'
      ? (rowIndex) => args.every((argument) => argument(rowIndex))
      : (rowIndex) => args.some((argument) => argument(rowIndex));
  }
  if (predicate.op === 'not') {
    const arg = compilePredicate(predicate.arg, fields);
    return (rowIndex) => !arg(rowIndex);
  }
  if (predicate.op === 'pointInPolygon') {
    const x = requireField(fields, predicate.xField).values;
    const y = requireField(fields, predicate.yField).values;
    return (rowIndex) => {
      const xValue = toFiniteNumber(x[rowIndex]);
      const yValue = toFiniteNumber(y[rowIndex]);
      return xValue !== null && yValue !== null &&
        pointInPolygon(xValue, yValue, predicate.points);
    };
  }
  const field = requireField(fields, predicate.field);
  const values = field.values;
  if (predicate.op === 'isNull') {
    return (rowIndex) => isNullish(values[rowIndex]) || isInvalidNumber(values[rowIndex]);
  }
  if (predicate.op === 'isValid') {
    return (rowIndex) => !isNullish(values[rowIndex]) && !isInvalidNumber(values[rowIndex]);
  }
  if (predicate.op === 'in' || predicate.op === 'notIn') {
    // Normalize once so large selection membership filters remain linear in
    // rows + selected values, while retaining boolean/datetime coercion.
    const key = (value: ClientDataValue) => {
      if (field.kind === 'boolean') return toBoolean(value) ?? canonicalValue(value);
      if (field.kind === 'datetime-ns') return toBigInt(value) ?? canonicalValue(value);
      if (field.kind === 'numeric') return toFiniteNumber(value) ?? canonicalValue(value);
      return canonicalValue(value);
    };
    const members = new Set(predicate.values.map(key));
    return (rowIndex) => {
      const value = values[rowIndex];
      if (isNullish(value) || isInvalidNumber(value)) return false;
      const matches = members.has(key(value));
      return predicate.op === 'in' ? matches : !matches;
    };
  }
  if (predicate.op === 'between') {
    return (rowIndex) => {
      const value = values[rowIndex];
      if (isNullish(value) || isInvalidNumber(value)) return false;
      const lower = compareValues(value, predicate.min, field.kind);
      const upper = compareValues(value, predicate.max, field.kind);
      return predicate.inclusive === false ? lower > 0 && upper < 0 : lower >= 0 && upper <= 0;
    };
  }
  if (!('value' in predicate)) return () => false;
  const comparisonValue = predicate.value;
  const comparisonOperation = predicate.op;
  return (rowIndex) => {
    const value = values[rowIndex];
    if (isNullish(value) || isInvalidNumber(value)) return false;
    const comparison = compareValues(value, comparisonValue, field.kind);
    if (comparisonOperation === 'eq') return comparison === 0;
    if (comparisonOperation === 'ne') return comparison !== 0;
    if (comparisonOperation === 'gt') return comparison > 0;
    if (comparisonOperation === 'gte') return comparison >= 0;
    if (comparisonOperation === 'lt') return comparison < 0;
    return comparison <= 0;
  };
}

function evaluatePredicate(
  predicate: ClientDataPredicate,
  fields: Readonly<Record<string, ClientDataField>>,
  rowIndex: number,
): boolean {
  if (predicate.op === 'and' || predicate.op === 'or') {
    return predicate.op === 'and'
      ? predicate.args.every((argument) => evaluatePredicate(argument, fields, rowIndex))
      : predicate.args.some((argument) => evaluatePredicate(argument, fields, rowIndex));
  }
  if (predicate.op === 'not') return !evaluatePredicate(predicate.arg, fields, rowIndex);
  if (predicate.op === 'pointInPolygon') {
    const x = toFiniteNumber(requireField(fields, predicate.xField).values[rowIndex]);
    const y = toFiniteNumber(requireField(fields, predicate.yField).values[rowIndex]);
    return x !== null && y !== null && pointInPolygon(x, y, predicate.points);
  }
  const field = requireField(fields, predicate.field);
  const value = field.values[rowIndex];
  if (predicate.op === 'isNull') return isNullish(value) || isInvalidNumber(value);
  if (predicate.op === 'isValid') return !isNullish(value) && !isInvalidNumber(value);
  if (isNullish(value) || isInvalidNumber(value)) return false;
  if (predicate.op === 'in' || predicate.op === 'notIn') {
    const matches = predicate.values.some(
      (candidate) => compareValues(value, candidate, field.kind) === 0,
    );
    return predicate.op === 'in' ? matches : !matches;
  }
  if (predicate.op === 'between') {
    const lower = compareValues(value, predicate.min, field.kind);
    const upper = compareValues(value, predicate.max, field.kind);
    return predicate.inclusive === false ? lower > 0 && upper < 0 : lower >= 0 && upper <= 0;
  }
  if (!('value' in predicate)) return false;
  const comparison = compareValues(value, predicate.value, field.kind);
  if (predicate.op === 'eq') return comparison === 0;
  if (predicate.op === 'ne') return comparison !== 0;
  if (predicate.op === 'gt') return comparison > 0;
  if (predicate.op === 'gte') return comparison >= 0;
  if (predicate.op === 'lt') return comparison < 0;
  return comparison <= 0;
}

function pointInPolygon(
  x: number,
  y: number,
  points: readonly { readonly x: number; readonly y: number }[],
): boolean {
  if (points.length < 3) return false;
  let inside = false;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current++) {
    const left = points[current]!;
    const right = points[previous]!;
    if (isPointOnSegment(x, y, left, right)) return true;
    if (
      (left.y > y) !== (right.y > y) &&
      x < ((right.x - left.x) * (y - left.y)) / (right.y - left.y) + left.x
    ) inside = !inside;
  }
  return inside;
}

function isPointOnSegment(
  x: number,
  y: number,
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): boolean {
  const cross = (y - start.y) * (end.x - start.x) -
    (x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 1e-9) return false;
  return x >= Math.min(start.x, end.x) - 1e-9 &&
    x <= Math.max(start.x, end.x) + 1e-9 &&
    y >= Math.min(start.y, end.y) - 1e-9 &&
    y <= Math.max(start.y, end.y) + 1e-9;
}

function compareValues(
  left: ClientDataValue,
  right: ClientDataValue,
  kind: ClientDataField['kind'],
): number {
  if (kind === 'boolean') {
    const leftBoolean = toBoolean(left);
    const rightBoolean = toBoolean(right);
    if (leftBoolean !== null && rightBoolean !== null) {
      return leftBoolean === rightBoolean ? 0 : leftBoolean ? 1 : -1;
    }
  }
  if (kind === 'datetime-ns') {
    const leftBigInt = toBigInt(left);
    const rightBigInt = toBigInt(right);
    if (leftBigInt !== null && rightBigInt !== null) {
      return leftBigInt < rightBigInt ? -1 : leftBigInt > rightBigInt ? 1 : 0;
    }
  }
  if (kind === 'numeric') {
    const leftNumber = toFiniteNumber(left);
    const rightNumber = toFiniteNumber(right);
    if (leftNumber !== null && rightNumber !== null) {
      return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
    }
  }
  const leftCanonical = canonicalValue(left);
  const rightCanonical = canonicalValue(right);
  return leftCanonical < rightCanonical ? -1 : leftCanonical > rightCanonical ? 1 : 0;
}

function toBoolean(value: ClientDataValue): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return value === 1;
  return null;
}

function samePartition(
  left: number,
  right: number,
  partitionFields: readonly ClientDataField[],
): boolean {
  return partitionFields.every(
    (field) => compareValues(field.values[left], field.values[right], field.kind) === 0,
  );
}

function calculateDifference(
  input: ClientDataField,
  currentIndex: number,
  neighborIndex: number,
  direction: 'backward' | 'forward',
): number | null {
  if (input.kind === 'datetime-ns') {
    const current = toBigInt(input.values[currentIndex]);
    const neighbor = toBigInt(input.values[neighborIndex]);
    if (current === null || neighbor === null) return null;
    const result = Number(direction === 'forward' ? neighbor - current : current - neighbor);
    return Number.isFinite(result) ? result : null;
  }
  const current = toFiniteNumber(input.values[currentIndex]);
  const neighbor = toFiniteNumber(input.values[neighborIndex]);
  if (current === null || neighbor === null) return null;
  return direction === 'forward' ? neighbor - current : current - neighbor;
}

function encodeStyleValue(channel: ClientStyleChannel, value: ClientStyleValue): number | null {
  if (channel === 'color') return typeof value === 'string' ? parseColor(value) : value >>> 0;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (channel === 'opacity') return Math.max(0, Math.min(1, numeric));
  if (channel === 'shape') return Math.max(0, Math.min(4, Math.round(numeric)));
  if (channel === 'size') return Math.max(0, numeric);
  return numeric;
}

function hashedColor(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const hue = hash % 360;
  const saturation = 58 + ((hash >>> 9) % 24);
  const lightness = 43 + ((hash >>> 17) % 18);
  return hslToHex(hue, saturation / 100, lightness / 100);
}

function canonicalValue(value: ClientDataValue): string {
  if (value === null) return 'null:null';
  if (value === undefined) return 'undefined:undefined';
  return `${typeof value}:${String(value)}`;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = hue / 60;
  const second = chroma * (1 - Math.abs((section % 2) - 1));
  const [r1, g1, b1] = section < 1 ? [chroma, second, 0]
    : section < 2 ? [second, chroma, 0]
      : section < 3 ? [0, chroma, second]
        : section < 4 ? [0, second, chroma]
          : section < 5 ? [second, 0, chroma]
            : [chroma, 0, second];
  const match = lightness - chroma / 2;
  return `#${[r1, g1, b1].map((channel) =>
    Math.round((channel + match) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function interpolatePackedColor(
  start: readonly number[],
  end: readonly number[],
  t: number,
): number {
  const channels = start.map((channel, index) =>
    Math.max(0, Math.min(255, Math.round(channel + ((end[index] ?? channel) - channel) * t))));
  return (
    ((channels[0] ?? 0) << 24) |
    ((channels[1] ?? 0) << 16) |
    ((channels[2] ?? 0) << 8) |
    (channels[3] ?? 255)
  ) >>> 0;
}

function parseColor(value: string): number {
  const hex = value.startsWith('#') ? value.slice(1) : value;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) {
    throw new TypeError(`Client style color "${value}" must use #RRGGBB or #RRGGBBAA.`);
  }
  const rgba = hex.length === 6 ? `${hex}ff` : hex;
  return Number.parseInt(rgba, 16) >>> 0;
}

function unpackColor(value: number): [number, number, number, number] {
  return [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function toFiniteNumber(value: ClientDataValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }
  return null;
}

function toBigInt(value: ClientDataValue): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    try { return BigInt(value); } catch { return null; }
  }
  return null;
}

function isNullish(value: ClientDataValue): value is null | undefined {
  return value === null || value === undefined;
}

function isInvalidNumber(value: ClientDataValue): boolean {
  return typeof value === 'number' && !Number.isFinite(value);
}

function requireField(
  fields: Readonly<Record<string, ClientDataField>>,
  key: string,
): ClientDataField {
  const field = fields[key];
  if (field === undefined) throw new TypeError(`Unknown client data field "${key}".`);
  return field;
}

function validateClientDataSet(dataset: ClientDataSet): void {
  if (!Number.isSafeInteger(dataset.rowCount) || dataset.rowCount < 0 || dataset.rowCount > 0xffff_ffff) {
    throw new TypeError('Client dataset rowCount must be an unsigned 32-bit integer.');
  }
  for (const [key, field] of Object.entries(dataset.fields)) {
    if (!['numeric', 'datetime-ns', 'categorical', 'boolean'].includes(field.kind)) {
      throw new TypeError(`Client data field "${key}" has unsupported kind "${String(field.kind)}".`);
    }
    if (field.values.length !== dataset.rowCount) {
      throw new TypeError(
        `Client data field "${key}" has ${field.values.length} values for ${dataset.rowCount} rows.`,
      );
    }
  }
}

function validateClientDataViewState(dataset: ClientDataSet, state: ClientDataViewState): void {
  if (state.version !== 1) {
    throw new TypeError(`Unsupported client data-view state version "${String(state.version)}".`);
  }
  if ((state.datasetKey !== undefined && typeof state.datasetKey !== 'string') ||
      (state.datasetVersion !== undefined && typeof state.datasetVersion !== 'string')) {
    throw new TypeError('Client data-view datasetKey and datasetVersion must be strings.');
  }
  if (state.sourceStyleMode !== undefined &&
      state.sourceStyleMode !== 'preserve' && state.sourceStyleMode !== 'ignore') {
    throw new TypeError(`Unknown client data-view sourceStyleMode "${String(state.sourceStyleMode)}".`);
  }
  if (!Array.isArray(state.filters) || !Array.isArray(state.transformations) || !Array.isArray(state.styles)) {
    throw new TypeError('Client data-view filters, transformations, and styles must be arrays.');
  }
  const ids = new Set<string>();
  for (const item of [...state.filters, ...state.transformations, ...state.styles]) {
    if (typeof item?.id !== 'string' || item.id.trim().length === 0 || ids.has(item.id)) {
      throw new TypeError(`Client data-view IDs must be non-empty and unique; received "${item.id}".`);
    }
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') {
      throw new TypeError(`Client data-view item "${item.id}" has a non-boolean enabled value.`);
    }
    ids.add(item.id);
  }
  for (const filter of state.filters) validatePredicateDefinition(filter.predicate, dataset.fields);
  const availableFields: Record<string, ClientDataField> = { ...dataset.fields };
  for (const transformation of state.transformations) {
    if (transformation.op !== 'affine' && transformation.op !== 'difference') {
      throw new TypeError(
        `Client transformation "${transformation.id}" has unsupported op "${String(transformation.op)}".`,
      );
    }
    if (typeof transformation.input !== 'string' || typeof transformation.output !== 'string' ||
        transformation.input.length === 0 || transformation.output.length === 0) {
      throw new TypeError(`Client transformation "${transformation.id}" requires input and output fields.`);
    }
    if (transformation.op === 'affine' &&
        (!Number.isFinite(transformation.factor) || !Number.isFinite(transformation.offset))) {
      throw new TypeError(`Client transformation "${transformation.id}" has a non-finite factor or offset.`);
    }
    const input = requireField(availableFields, transformation.input);
    if (input.kind !== 'numeric' && input.kind !== 'datetime-ns') {
      throw new TypeError(
        `Client transformation "${transformation.id}" requires a numeric or datetime input.`,
      );
    }
    if (transformation.op === 'difference') {
      if (transformation.direction !== 'backward' && transformation.direction !== 'forward') {
        throw new TypeError(`Client transformation "${transformation.id}" has an invalid direction.`);
      }
      if (transformation.missingValue !== undefined &&
          transformation.missingValue !== 'null' && transformation.missingValue !== 'zero') {
        throw new TypeError(`Client transformation "${transformation.id}" has an invalid missingValue.`);
      }
      if (transformation.partitionBy !== undefined && !Array.isArray(transformation.partitionBy)) {
        throw new TypeError(`Client transformation "${transformation.id}" partitionBy must be an array.`);
      }
      if (transformation.orderBy !== undefined) requireField(availableFields, transformation.orderBy);
      for (const key of transformation.partitionBy ?? []) requireField(availableFields, key);
    }
    if (transformation.enabled !== false) {
      availableFields[transformation.output] = { kind: 'numeric', values: [] };
    }
  }
  for (const style of state.styles) {
    if (style.channels === null || typeof style.channels !== 'object' || Array.isArray(style.channels)) {
      throw new TypeError(`Client style "${style.id}" channels must be an object.`);
    }
    for (const channel of Object.keys(style.channels)) {
      if (!CHANNELS.includes(channel as ClientStyleChannel)) {
        throw new TypeError(`Client style "${style.id}" has unknown channel "${channel}".`);
      }
    }
    if (style.when !== undefined) validatePredicateDefinition(style.when, availableFields);
    for (const channel of CHANNELS) {
      const expression = style.channels[channel];
      if (expression !== undefined) validateStyleExpression(expression, channel, availableFields);
    }
  }
  if (
    state.datasetKey !== undefined && dataset.datasetKey !== undefined &&
    state.datasetKey !== dataset.datasetKey
  ) {
    throw new TypeError('Client data-view datasetKey does not match the resident dataset.');
  }
  if (
    state.datasetVersion !== undefined && dataset.datasetVersion !== undefined &&
    state.datasetVersion !== dataset.datasetVersion
  ) {
    throw new TypeError('Client data-view datasetVersion does not match the resident dataset.');
  }
}

function validatePredicateDefinition(
  predicate: ClientDataPredicate,
  fields: Readonly<Record<string, ClientDataField>>,
): void {
  if (predicate === null || typeof predicate !== 'object') {
    throw new TypeError('Client data predicates must be objects.');
  }
  if (predicate.op === 'and' || predicate.op === 'or') {
    if (!Array.isArray(predicate.args)) {
      throw new TypeError(`Client predicate "${predicate.op}" requires an args array.`);
    }
    for (const argument of predicate.args) validatePredicateDefinition(argument, fields);
    return;
  }
  if (predicate.op === 'not') {
    validatePredicateDefinition(predicate.arg, fields);
    return;
  }
  if (predicate.op === 'pointInPolygon') {
    const x = requireField(fields, predicate.xField);
    const y = requireField(fields, predicate.yField);
    if ((x.kind !== 'numeric' && x.kind !== 'datetime-ns') ||
        (y.kind !== 'numeric' && y.kind !== 'datetime-ns')) {
      throw new TypeError('pointInPolygon requires numeric or datetime coordinate fields.');
    }
    if (predicate.points.length < 3 || predicate.points.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )) {
      throw new TypeError('pointInPolygon requires at least three finite points.');
    }
    return;
  }
  if (predicate.op === 'isNull' || predicate.op === 'isValid') {
    requireField(fields, predicate.field);
    return;
  }
  if (predicate.op === 'in' || predicate.op === 'notIn') {
    const field = requireField(fields, predicate.field);
    if (!Array.isArray(predicate.values)) {
      throw new TypeError(`Client predicate "${predicate.op}" requires a values array.`);
    }
    for (const value of predicate.values) validatePredicateValue(value, field, predicate.op);
    return;
  }
  if (predicate.op === 'between') {
    const field = requireField(fields, predicate.field);
    validatePredicateValue(predicate.min, field, predicate.op);
    validatePredicateValue(predicate.max, field, predicate.op);
    if (predicate.inclusive !== undefined && typeof predicate.inclusive !== 'boolean') {
      throw new TypeError('Client between predicate inclusive must be boolean.');
    }
    return;
  }
  if (predicate.op === 'eq' || predicate.op === 'ne' || predicate.op === 'gt' ||
      predicate.op === 'gte' || predicate.op === 'lt' || predicate.op === 'lte') {
    const field = requireField(fields, predicate.field);
    validatePredicateValue(predicate.value, field, predicate.op);
    return;
  }
  throw new TypeError(`Unsupported client predicate op "${String((predicate as { op?: unknown }).op)}".`);
}

function validatePredicateValue(
  value: ClientDataValue,
  field: ClientDataField,
  operation: string,
): void {
  if (field.kind === 'numeric') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`Client ${operation} predicate on a numeric field requires finite numbers.`);
    }
    return;
  }
  if (field.kind === 'datetime-ns') {
    if ((typeof value !== 'number' && typeof value !== 'string') || toBigInt(value) === null) {
      throw new TypeError(
        `Client ${operation} predicate on a datetime-ns field requires an integer or decimal string.`,
      );
    }
    return;
  }
  if (field.kind === 'boolean') {
    if (toBoolean(value) === null) {
      throw new TypeError(`Client ${operation} predicate on a boolean field requires boolean or 0/1.`);
    }
    return;
  }
  if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') {
    throw new TypeError(`Client ${operation} predicate requires a JSON scalar.`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(`Client ${operation} predicate requires a finite numeric scalar.`);
  }
}

function validateStyleExpression(
  expression: ClientStyleExpression,
  channel: ClientStyleChannel,
  fields: Readonly<Record<string, ClientDataField>>,
): void {
  if (expression === null || typeof expression !== 'object') {
    throw new TypeError(`Client style channel "${channel}" requires an expression object.`);
  }
  if (expression.op === 'constant') {
    validateStyleLiteral(channel, expression.value);
    return;
  }
  if (expression.op === 'hashedColor') {
    if (channel !== 'color') throw new TypeError('hashedColor is valid only for the color channel.');
    requireField(fields, expression.field);
    return;
  }
  if (expression.op === 'categorical') {
    requireField(fields, expression.field);
    if (expression.values !== undefined &&
        (expression.values === null || typeof expression.values !== 'object' ||
          Array.isArray(expression.values))) {
      throw new TypeError('Categorical client style values must be an object map.');
    }
    for (const value of Object.values(expression.values ?? {})) validateStyleLiteral(channel, value);
    if (expression.fallback !== undefined) {
      validateStyleExpression(expression.fallback, channel, fields);
    }
    return;
  }
  if (expression.op === 'continuous') {
    const field = requireField(fields, expression.field);
    if (field.kind !== 'numeric' && field.kind !== 'datetime-ns') {
      throw new TypeError('Continuous client styles require a numeric or datetime field.');
    }
    if (!Array.isArray(expression.domain) || expression.domain.length !== 2 ||
        !expression.domain.every(Number.isFinite)) {
      throw new TypeError('Continuous client style domains require two finite values.');
    }
    if (!Array.isArray(expression.range) || expression.range.length !== 2) {
      throw new TypeError('Continuous client style ranges require two endpoints.');
    }
    if (typeof expression.range[0] !== typeof expression.range[1]) {
      throw new TypeError('Continuous client style range endpoints must have the same type.');
    }
    if (channel === 'color' && typeof expression.range[0] !== 'string') {
      throw new TypeError('Continuous color styles require #RRGGBB range endpoints.');
    }
    if (channel !== 'color' && typeof expression.range[0] !== 'number') {
      throw new TypeError(`Continuous client style channel "${channel}" requires numeric endpoints.`);
    }
    validateStyleLiteral(channel, expression.range[0]);
    validateStyleLiteral(channel, expression.range[1]);
    return;
  }
  if (expression.op === 'case') {
    if (!Array.isArray(expression.branches)) {
      throw new TypeError('Client case style expressions require a branches array.');
    }
    for (const branch of expression.branches) {
      validatePredicateDefinition(branch.when, fields);
      validateStyleExpression(branch.value, channel, fields);
    }
    if (expression.fallback !== undefined) {
      validateStyleExpression(expression.fallback, channel, fields);
    }
    return;
  }
  throw new TypeError(
    `Unsupported client style expression op "${String((expression as { op?: unknown }).op)}".`,
  );
}

function validateStyleLiteral(channel: ClientStyleChannel, value: ClientStyleValue): void {
  if (channel === 'color') {
    if (typeof value === 'string') parseColor(value);
    else if (!Number.isFinite(value)) throw new TypeError('Client style colors must be finite.');
    return;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TypeError(`Client style channel "${channel}" requires a numeric value.`);
  }
}
