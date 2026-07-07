import { MIXED_TABLE_NAMES, type MixedTableFixture } from './mixedTableFixtures.ts';
import {
  createLazySingleTableRecordIdentityArray,
  createLazySingleValueArray,
} from './identity.ts';
import {
  createAxisTitle,
  encodeFastScatterSchemaRows,
  type FastScatterDatasetSchema,
  type FastScatterEncodedAxis,
  type FastScatterEncodedSchemaColumns,
  type FastScatterEncodeSchemaResult,
  type FastScatterPlotSpec,
} from 'm-charts/m-scatter';

export const SCATTER_FAST_DATASET_URL = '/data/scatter-fast-sample.json';
export const SCATTER_FAST_SCHEMA_URL = '/data/scatter-fast-schema.json';
export const SCATTER_FAST_COLUMNAR_URL = '/data/scatter-fast-sample.columnar.json';
export const FAST_PLOT_E2E_TABLE_FIXTURE_PARAM = '__e2eFastTableFixture';
export const FAST_PLOT_E2E_SCHEMA_DATA_URL_PARAM = '__e2eScatterFastSchemaDataUrl';
export const FAST_PLOT_E2E_SCHEMA_URL_PARAM = '__e2eScatterFastSchemaUrl';

type FastScatterSingleTableColumns = FastScatterEncodedSchemaColumns & {
  recordIdentityBySourceIndex: readonly {
    id: string;
    sourceIndex: number;
    table: string;
  }[];
  tableBySourceIndex: readonly string[];
};

interface ScatterFastColumnarManifest {
  binary: string;
  columns: Record<string, ScatterFastColumnarColumn>;
  count: number;
  domains: Record<string, { max: number; min: number }>;
  idPrefix: string;
  idWidth: number;
  timestampOriginNs: string;
  version: 1;
}

interface ScatterFastColumnarColumn {
  byteLength: number;
  byteOffset: number;
  length: number;
  type: string;
}

export interface LoadedScatterFastBenchmarkSource {
  columnarBytes?: number;
  columns: FastScatterSingleTableColumns;
  decodeMs: number;
  fetchMs: number;
  parseMs: number;
  sourceFormat: 'columnar-binary' | 'json-records';
  sourceUrl: string;
  spec: FastScatterPlotSpec;
  tableName: string;
}

export function resolveFastPlotFixtureUrl(
  searchParams: URLSearchParams,
  defaultUrl: string,
): string {
  if (!import.meta.env.DEV) {
    return defaultUrl;
  }

  return searchParams.get(FAST_PLOT_E2E_TABLE_FIXTURE_PARAM) ?? defaultUrl;
}

export function resolveScatterFastSchemaDataUrl(
  searchParams: URLSearchParams,
): string {
  if (!import.meta.env.DEV) {
    return SCATTER_FAST_DATASET_URL;
  }

  return searchParams.get(FAST_PLOT_E2E_SCHEMA_DATA_URL_PARAM) ?? SCATTER_FAST_DATASET_URL;
}

export function resolveScatterFastSchemaUrl(
  searchParams: URLSearchParams,
): string {
  if (!import.meta.env.DEV) {
    return SCATTER_FAST_SCHEMA_URL;
  }

  return searchParams.get(FAST_PLOT_E2E_SCHEMA_URL_PARAM) ?? SCATTER_FAST_SCHEMA_URL;
}

export async function loadFastPlotMixedTableFixture(
  fixtureUrl: string,
): Promise<{
  fetchMs: number;
  fixture: MixedTableFixture;
  parseMs: number;
}> {
  const fetchStartedAt = performance.now();
  const response = await fetch(fixtureUrl, {
    headers: { Accept: 'application/json' },
  });
  const fetchMs = performance.now() - fetchStartedAt;

  if (!response.ok) {
    throw new Error(`Mixed-table fixture not found at ${fixtureUrl}.`);
  }

  const parseStartedAt = performance.now();
  const payload: unknown = await response.json();
  const parseMs = performance.now() - parseStartedAt;

  if (!isMixedTableFixturePayload(payload)) {
    throw new Error(`Mixed-table fixture at ${fixtureUrl} is invalid.`);
  }

  return {
    fetchMs,
    fixture: payload,
    parseMs,
  };
}

export async function loadScatterFastBenchmarkSource(
  searchParams: URLSearchParams,
): Promise<LoadedScatterFastBenchmarkSource> {
  const datasetUrl = resolveScatterFastSchemaDataUrl(searchParams);
  const schemaUrl = resolveScatterFastSchemaUrl(searchParams);
  const shouldUseColumnar =
    datasetUrl === SCATTER_FAST_DATASET_URL && schemaUrl === SCATTER_FAST_SCHEMA_URL;

  if (shouldUseColumnar) {
    const columnar = await loadScatterFastColumnarBenchmarkSource(schemaUrl).catch(() => null);
    if (columnar !== null) {
      return columnar;
    }
  }

  const fetchStartedAt = performance.now();
  const [datasetResponse, schemaResponse] = await Promise.all([
    fetch(datasetUrl, { headers: { Accept: 'application/json' } }),
    fetch(schemaUrl, { headers: { Accept: 'application/json' } }),
  ]);
  const fetchMs = performance.now() - fetchStartedAt;

  if (!datasetResponse.ok || !schemaResponse.ok) {
    throw new Error(
      `Scatter-fast schema dataset not found. Generate it with: pnpm generate:data -- --kind scatter-fast --count 1000000 --seed 1`,
    );
  }

  const parseStartedAt = performance.now();
  const [datasetPayload, schema] = (await Promise.all([
    datasetResponse.json(),
    schemaResponse.json(),
  ])) as [{ records?: unknown }, FastScatterDatasetSchema];
  const parseMs = performance.now() - parseStartedAt;

  if (!Array.isArray(datasetPayload.records)) {
    throw new Error('Scatter-fast schema dataset must include records.');
  }

  const decodeStartedAt = performance.now();
  const encoded = encodeFastScatterSchemaRows(
    datasetPayload.records as readonly Readonly<Record<string, unknown>>[],
    schema,
  );
  const decodeMs = performance.now() - decodeStartedAt;

  return {
    columns: attachSingleTableIdentityToFastScatterColumns(encoded.columns),
    decodeMs,
    fetchMs,
    parseMs,
    sourceFormat: 'json-records',
    sourceUrl: datasetUrl,
    spec: encoded.spec,
    tableName: MIXED_TABLE_NAMES[0],
  };
}

export function isMixedTableFixturePayload(payload: unknown): payload is MixedTableFixture {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    Array.isArray((payload as { tables?: unknown }).tables) &&
    typeof (payload as { metadata?: { count?: unknown } }).metadata?.count === 'number'
  );
}

async function loadScatterFastColumnarBenchmarkSource(
  schemaUrl: string,
): Promise<LoadedScatterFastBenchmarkSource> {
  const fetchStartedAt = performance.now();
  const [manifestResponse, schemaResponse] = await Promise.all([
    fetch(SCATTER_FAST_COLUMNAR_URL, { headers: { Accept: 'application/json' } }),
    fetch(schemaUrl, { headers: { Accept: 'application/json' } }),
  ]);
  if (!manifestResponse.ok || !schemaResponse.ok) {
    throw new Error('Scatter-fast columnar dataset is not available.');
  }

  const parseStartedAt = performance.now();
  const [manifest, schema] = (await Promise.all([
    manifestResponse.json(),
    schemaResponse.json(),
  ])) as [ScatterFastColumnarManifest, FastScatterDatasetSchema];
  const parseMs = performance.now() - parseStartedAt;
  const binaryUrl = new URL(manifest.binary, manifestResponse.url).toString();
  const binaryResponse = await fetch(binaryUrl, {
    headers: { Accept: 'application/octet-stream' },
  });
  if (!binaryResponse.ok) {
    throw new Error('Scatter-fast columnar binary payload is not available.');
  }
  const binaryBuffer = await binaryResponse.arrayBuffer();
  const fetchMs = performance.now() - fetchStartedAt;

  const decodeStartedAt = performance.now();
  const encoded = decodeScatterFastColumnarManifest(manifest, schema, binaryBuffer);
  const decodeMs = performance.now() - decodeStartedAt;

  return {
    columnarBytes: binaryBuffer.byteLength,
    columns: attachSingleTableIdentityToFastScatterColumns(encoded.columns),
    decodeMs,
    fetchMs,
    parseMs,
    sourceFormat: 'columnar-binary',
    sourceUrl: SCATTER_FAST_COLUMNAR_URL,
    spec: encoded.spec,
    tableName: MIXED_TABLE_NAMES[0],
  };
}

function attachSingleTableIdentityToFastScatterColumns(
  columns: FastScatterEncodedSchemaColumns,
): FastScatterSingleTableColumns {
  const tableName = MIXED_TABLE_NAMES[0];

  return {
    ...columns,
    recordIdentityBySourceIndex: createLazySingleTableRecordIdentityArray(
      columns.ids,
      tableName,
    ),
    tableBySourceIndex: createLazySingleValueArray(columns.ids.length, tableName),
  };
}

function decodeScatterFastColumnarManifest(
  manifest: ScatterFastColumnarManifest,
  schema: FastScatterDatasetSchema,
  binaryBuffer: ArrayBuffer,
): FastScatterEncodeSchemaResult {
  if (manifest.version !== 1) {
    throw new Error(`Unsupported scatter-fast columnar version ${manifest.version}.`);
  }

  const timestampNs = readColumnarArray<BigInt64Array>(
    manifest,
    binaryBuffer,
    'timestampNs',
    'BigInt64Array',
    BigInt64Array,
  );
  const axisByColumn = createColumnarAxisMap(manifest, schema, timestampNs);

  return {
    columns: {
      axisByColumn,
      color: readColumnarArray(manifest, binaryBuffer, 'color', 'Uint8Array', Uint8Array),
      colorFormat: 'rgba8',
      ids: createLazyIdArray(manifest.idPrefix, manifest.idWidth, manifest.count),
      opacity: readColumnarArray(
        manifest,
        binaryBuffer,
        'opacity',
        'Float32Array',
        Float32Array,
      ),
      rotation: readColumnarArray(
        manifest,
        binaryBuffer,
        'rotationRadians',
        'Float32Array',
        Float32Array,
      ),
      rotationDegrees: readColumnarArray(
        manifest,
        binaryBuffer,
        'rotationDegrees',
        'Float32Array',
        Float32Array,
      ),
      rotationRadians: readColumnarArray(
        manifest,
        binaryBuffer,
        'rotationRadians',
        'Float32Array',
        Float32Array,
      ),
      shape: readColumnarArray(manifest, binaryBuffer, 'shape', 'Uint8Array', Uint8Array),
      size: readColumnarArray(manifest, binaryBuffer, 'size', 'Float32Array', Float32Array),
      sourceIndex: readColumnarArray(
        manifest,
        binaryBuffer,
        'sourceIndex',
        'Uint32Array',
        Uint32Array,
      ),
      x: readColumnarArray(manifest, binaryBuffer, 'x', 'Float64Array', Float64Array),
      xKey: schema.x.column,
      y: {
        accepted: readColumnarArray(
          manifest,
          binaryBuffer,
          'accepted',
          'Float64Array',
          Float64Array,
        ),
        phase: readColumnarArray(
          manifest,
          binaryBuffer,
          'phase',
          'Float64Array',
          Float64Array,
        ),
        signalValue: readColumnarArray(
          manifest,
          binaryBuffer,
          'signalValue',
          'Float64Array',
          Float64Array,
        ),
      },
    },
    spec: {
      xLabel: createAxisTitle(requireColumnarSchemaColumn(schema, schema.x.column), schema.x.title),
      plots: schema.plots.map((plot) => {
        const column = requireColumnarSchemaColumn(schema, plot.y.column);

        return {
          id: plot.id,
          label: plot.label ?? createAxisTitle(column, plot.y.title),
          yKey: plot.y.column,
        };
      }),
    },
  };
}

function readColumnarArray<TArray extends ArrayBufferView>(
  manifest: ScatterFastColumnarManifest,
  buffer: ArrayBuffer,
  name: string,
  expectedType: string,
  constructor: {
    new (buffer: ArrayBuffer, byteOffset: number, length: number): TArray;
  },
): TArray {
  const column = manifest.columns[name];
  if (column === undefined || column.type !== expectedType) {
    throw new Error(`Scatter-fast columnar column "${name}" is missing or invalid.`);
  }

  return new constructor(buffer, column.byteOffset, column.length);
}

function createColumnarAxisMap(
  manifest: ScatterFastColumnarManifest,
  schema: FastScatterDatasetSchema,
  timestampNs: BigInt64Array,
): Readonly<Record<string, FastScatterEncodedAxis>> {
  const axisByColumn: Record<string, FastScatterEncodedAxis> = {};

  for (const column of schema.columns) {
    if (column.role !== 'x' && column.role !== 'y') {
      continue;
    }

    const domain = manifest.domains[column.key] ?? { max: 0, min: 0 };
    if (column.axisType === 'datetime-ns') {
      axisByColumn[column.key] = {
        columnKey: column.key,
        datetimeOriginNs: manifest.timestampOriginNs,
        datetimeOriginNsBigInt: BigInt(manifest.timestampOriginNs),
        domain,
        epochNsValues: createLazyBigIntStringArray(timestampNs),
        kind: 'datetime-ns',
        parameterName: column.parameterName ?? column.key,
        title: createAxisTitle(column),
        unit: column.unit,
      };
      continue;
    }

    if (column.axisType === 'categorical' || column.axisType === 'boolean') {
      axisByColumn[column.key] = {
        categories: (column.categories ?? []).map((category, index) => ({
          encoded: category.order ?? index,
          label: category.label ?? String(category.value),
          value: String(category.value),
        })),
        columnKey: column.key,
        domain,
        kind: column.axisType,
        parameterName: column.parameterName ?? column.key,
        title: createAxisTitle(column),
        unit: column.unit,
      };
      continue;
    }

    axisByColumn[column.key] = {
      columnKey: column.key,
      domain,
      kind: 'numeric',
      parameterName: column.parameterName ?? column.key,
      title: createAxisTitle(column),
      unit: column.unit,
    };
  }

  return axisByColumn;
}

function createLazyIdArray(prefix: string, width: number, count: number): readonly string[] {
  return new Proxy(
    { length: count },
    {
      get(target, property) {
        if (property === 'length') {
          return target.length;
        }
        if (typeof property === 'string' && /^\d+$/u.test(property)) {
          const index = Number(property);
          return index < target.length
            ? `${prefix}${String(index).padStart(width, '0')}`
            : undefined;
        }

        return undefined;
      },
    },
  ) as unknown as readonly string[];
}

function createLazyBigIntStringArray(values: BigInt64Array): readonly string[] {
  return new Proxy(
    { length: values.length },
    {
      get(target, property) {
        if (property === 'length') {
          return target.length;
        }
        if (typeof property === 'string' && /^\d+$/u.test(property)) {
          const index = Number(property);
          return index < values.length ? values[index]?.toString() : undefined;
        }

        return undefined;
      },
    },
  ) as unknown as readonly string[];
}

function requireColumnarSchemaColumn(
  schema: FastScatterDatasetSchema,
  key: string,
): FastScatterDatasetSchema['columns'][number] {
  const column = schema.columns.find((candidate) => candidate.key === key);
  if (column === undefined) {
    throw new Error(`Scatter-fast columnar schema column "${key}" is missing.`);
  }

  return column;
}
