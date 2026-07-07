import {
  SCATTER_CATEGORIES,
  SCATTER_SHAPES,
  SCATTER_STYLE_GROUPS,
  SCATTER_STYLE_LIMITS,
  type ParallelDataset,
  type ScatterCategory,
  type ScatterDataset,
  type ScatterShape,
  type ScatterStyleGroup,
} from './types.ts';

const viteEnv = import.meta.env as Record<string, string | undefined> | undefined;

export const SAMPLE_DATASET_URL =
  viteEnv?.VITE_SCATTER_DATASET_URL ?? '/data/scatter-sample.json';
export const PARALLEL_SAMPLE_DATASET_URL =
  viteEnv?.VITE_PARALLEL_DATASET_URL ?? '/data/parallel-sample.json';

export interface ScatterDatasetLoadResult {
  dataset: ScatterDataset;
  metrics: {
    fetchMs: number;
    parseMs: number;
  };
}

export interface ParallelDatasetLoadResult {
  dataset: ParallelDataset;
  metrics: {
    fetchMs: number;
    parseMs: number;
  };
}

const SCATTER_CATEGORY_VALUES = new Set<string>(SCATTER_CATEGORIES);
const SCATTER_STYLE_GROUP_VALUES = new Set<string>(SCATTER_STYLE_GROUPS);
const SCATTER_SHAPE_VALUES = new Set<string>(SCATTER_SHAPES);
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/u;

export async function loadScatterDataset(
  url = SAMPLE_DATASET_URL,
): Promise<ScatterDataset> {
  const result = await loadScatterDatasetWithMetrics(url);

  return result.dataset;
}

export async function loadScatterDatasetWithMetrics(
  url = SAMPLE_DATASET_URL,
): Promise<ScatterDatasetLoadResult> {
  const fetchStartedAt = performance.now();
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });
  const fetchMs = performance.now() - fetchStartedAt;

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        `Sample dataset not found at ${url}. Generate it with: pnpm generate:data -- --count 1000000 --seed 1`,
      );
    }

    throw new Error(`Failed to load dataset from ${url}: HTTP ${response.status}`);
  }

  const parseStartedAt = performance.now();
  const payload: unknown = await response.json();
  const parseMs = performance.now() - parseStartedAt;

  return {
    dataset: assertScatterDataset(payload, url),
    metrics: {
      fetchMs,
      parseMs,
    },
  };
}

export async function loadParallelDataset(
  url = PARALLEL_SAMPLE_DATASET_URL,
): Promise<ParallelDataset> {
  const result = await loadParallelDatasetWithMetrics(url);

  return result.dataset;
}

export async function loadParallelDatasetWithMetrics(
  url = PARALLEL_SAMPLE_DATASET_URL,
): Promise<ParallelDatasetLoadResult> {
  const fetchStartedAt = performance.now();
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });
  const fetchMs = performance.now() - fetchStartedAt;

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        `Parallel dataset not found at ${url}. Generate it with: pnpm generate:data -- --kind parallel --count 100000 --seed 1`,
      );
    }

    throw new Error(`Failed to load parallel dataset from ${url}: HTTP ${response.status}`);
  }

  const parseStartedAt = performance.now();
  const payload: unknown = await response.json();
  const parseMs = performance.now() - parseStartedAt;

  return {
    dataset: assertParallelDataset(payload, url),
    metrics: {
      fetchMs,
      parseMs,
    },
  };
}

function assertScatterDataset(payload: unknown, url: string): ScatterDataset {
  if (!isObject(payload)) {
    throw new Error(`Dataset at ${url} is not a JSON object.`);
  }

  const metadata = payload.metadata;
  const records = payload.records;

  if (!isObject(metadata) || !Array.isArray(records)) {
    throw new Error(`Dataset at ${url} must include metadata and records.`);
  }

  const metadataCount = metadata.count;

  if (
    typeof metadataCount !== 'number' ||
    !Number.isSafeInteger(metadataCount) ||
    metadataCount < 0
  ) {
    throw new Error(`Dataset at ${url} has invalid metadata.count.`);
  }

  if (metadataCount !== records.length) {
    throw new Error(
      `Dataset at ${url} reports ${metadataCount} records but contains ${records.length}.`,
    );
  }

  let previousX = Number.NEGATIVE_INFINITY;

  for (const [index, record] of records.entries()) {
    assertScatterRecord(record, index, url);

    const x = (record as { x: number }).x;

    if (x < previousX) {
      throw new Error(
        `Dataset at ${url} must be sorted by nondecreasing x; record index ${index} has x ${x} after ${previousX}.`,
      );
    }

    previousX = x;
  }

  return payload as unknown as ScatterDataset;
}

function assertParallelDataset(payload: unknown, url: string): ParallelDataset {
  if (!isObject(payload)) {
    throw new Error(`Parallel dataset at ${url} is not a JSON object.`);
  }

  const metadata = payload.metadata;
  const records = payload.records;

  if (!isObject(metadata) || !Array.isArray(records)) {
    throw new Error(`Parallel dataset at ${url} must include metadata and records.`);
  }

  const metadataCount = metadata.count;

  if (
    typeof metadataCount !== 'number' ||
    !Number.isSafeInteger(metadataCount) ||
    metadataCount < 0
  ) {
    throw new Error(`Parallel dataset at ${url} has invalid metadata.count.`);
  }

  if (metadataCount !== records.length) {
    throw new Error(
      `Parallel dataset at ${url} reports ${metadataCount} records but contains ${records.length}.`,
    );
  }

  if (!isObject(metadata.attributes)) {
    throw new Error(`Parallel dataset at ${url} has invalid metadata.attributes.`);
  }

  if (metadata.attributes.id !== 'id') {
    throw new Error(`Parallel dataset at ${url} has invalid metadata.attributes.id.`);
  }

  if (!isValidParallelParameterList(metadata.attributes.parameters)) {
    throw new Error(
      `Parallel dataset at ${url} has invalid metadata.attributes.parameters.`,
    );
  }

  const parameters = metadata.attributes.parameters;
  const seenIds = new Set<string>();

  for (const [index, record] of records.entries()) {
    assertParallelRecord(record, index, url, parameters);

    const id = (record as { id: string }).id;

    if (seenIds.has(id)) {
      throw new Error(
        `Parallel dataset at ${url} has duplicate id "${id}" at record index ${index}.`,
      );
    }

    seenIds.add(id);
  }

  return payload as unknown as ParallelDataset;
}

function assertScatterRecord(record: unknown, index: number, url: string): void {
  if (!isObject(record)) {
    throw new Error(`Dataset at ${url} has an invalid record at index ${index}.`);
  }

  for (const field of ['id', 'category', 'styleGroup', 'color', 'shape'] as const) {
    if (typeof record[field] !== 'string') {
      throw new Error(
        `Dataset at ${url} has invalid ${field} at record index ${index}; expected string.`,
      );
    }
  }

  for (const field of ['x', 'a', 'b', 'c', 'opacity', 'size'] as const) {
    if (!isFiniteNumber(record[field])) {
      throw new Error(
        `Dataset at ${url} has invalid ${field} at record index ${index}; expected finite number.`,
      );
    }
  }

  const category = record.category as string;
  const color = record.color as string;
  const opacity = record.opacity as number;
  const rotation = record.rotation;
  const shape = record.shape as string;
  const size = record.size as number;
  const styleGroup = record.styleGroup as string;

  if (!isScatterCategory(category)) {
    throw new Error(
      `Dataset at ${url} has unknown category "${category}" at record index ${index}.`,
    );
  }

  if (!isScatterStyleGroup(styleGroup)) {
    throw new Error(
      `Dataset at ${url} has unknown styleGroup "${styleGroup}" at record index ${index}.`,
    );
  }

  if (!HEX_COLOR_PATTERN.test(color)) {
    throw new Error(
      `Dataset at ${url} has invalid color "${color}" at record index ${index}; expected #RRGGBB.`,
    );
  }

  if (
    opacity < SCATTER_STYLE_LIMITS.opacity.min ||
    opacity > SCATTER_STYLE_LIMITS.opacity.max
  ) {
    throw new Error(
      `Dataset at ${url} has invalid opacity ${opacity} at record index ${index}; expected ${SCATTER_STYLE_LIMITS.opacity.min} to ${SCATTER_STYLE_LIMITS.opacity.max}.`,
    );
  }

  if (
    size < SCATTER_STYLE_LIMITS.size.min ||
    size > SCATTER_STYLE_LIMITS.size.max
  ) {
    throw new Error(
      `Dataset at ${url} has invalid size ${size} at record index ${index}; expected ${SCATTER_STYLE_LIMITS.size.min} to ${SCATTER_STYLE_LIMITS.size.max}.`,
    );
  }

  if (
    rotation !== null &&
    (!isFiniteNumber(rotation) ||
      rotation < SCATTER_STYLE_LIMITS.rotation.min ||
      rotation > SCATTER_STYLE_LIMITS.rotation.max)
  ) {
    throw new Error(
      `Dataset at ${url} has invalid rotation ${String(rotation)} at record index ${index}; expected null or ${SCATTER_STYLE_LIMITS.rotation.min} to ${SCATTER_STYLE_LIMITS.rotation.max} degrees.`,
    );
  }

  if (!isScatterShape(shape)) {
    throw new Error(
      `Dataset at ${url} has unknown shape "${shape}" at record index ${index}.`,
    );
  }
}

function assertParallelRecord(
  record: unknown,
  index: number,
  url: string,
  parameters: readonly string[],
): void {
  if (!isObject(record)) {
    throw new Error(`Parallel dataset at ${url} has an invalid record at index ${index}.`);
  }

  if (typeof record.id !== 'string' || record.id.length === 0) {
    throw new Error(
      `Parallel dataset at ${url} has invalid id at record index ${index}; expected non-empty string.`,
    );
  }

  for (const field of parameters) {
    if (!isFiniteNumber(record[field])) {
      throw new Error(
        `Parallel dataset at ${url} has invalid ${field} at record index ${index}; expected finite number.`,
      );
    }
  }

  if ('selected' in record && typeof record.selected !== 'boolean') {
    throw new Error(
      `Parallel dataset at ${url} has invalid selected at record index ${index}; expected boolean when present.`,
    );
  }
}

function isScatterCategory(value: string): value is ScatterCategory {
  return SCATTER_CATEGORY_VALUES.has(value);
}

function isScatterStyleGroup(value: string): value is ScatterStyleGroup {
  return SCATTER_STYLE_GROUP_VALUES.has(value);
}

function isScatterShape(value: string): value is ScatterShape {
  return SCATTER_SHAPE_VALUES.has(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidParallelParameterList(value: unknown): value is readonly string[] {
  const seenParameters = new Set<string>();

  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => {
      if (typeof item !== 'string' || item.length === 0) {
        return false;
      }
      if (item === 'id' || seenParameters.has(item)) {
        return false;
      }
      seenParameters.add(item);
      return true;
    })
  );
}
