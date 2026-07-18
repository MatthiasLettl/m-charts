import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PARALLEL_PARAMETERS,
  SCATTER_SHAPES,
  SCATTER_STYLE_LIMITS,
  type ParallelDataset,
  type ScatterDataset,
} from '../../apps/demo/src/data/types.ts';
import {
  MIXED_TABLE_AXES,
  MIXED_TABLE_NAMES,
  type MixedTableFixture,
} from '../../apps/demo/src/data/mixedTableFixtures.ts';
import type { FastScatterDatasetSchema } from '../../packages/m-charts/src/m-scatter/core/index.ts';

interface HistogramBarsPayload {
  metadata: {
    barsPerParameter: number;
    seed: number;
    version: number;
  };
  parameters: {
    bins: {
      colorCounts?: Record<string, number>;
      count: number;
      max: number;
      min: number;
    }[];
    key: string;
    label: string;
    source: string;
    table: string;
    unit: string;
  }[];
  source: string;
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const tempDir = mkdtempSync(join(tmpdir(), 'mcharts-generator-test-'));

try {
  const firstPath = join(tempDir, 'seed-42-a.json');
  const secondPath = join(tempDir, 'seed-42-b.json');
  const differentSeedPath = join(tempDir, 'seed-43.json');

  runGenerator(firstPath, 42);
  runGenerator(secondPath, 42);
  runGenerator(differentSeedPath, 43);

  const firstOutput = readFileSync(firstPath, 'utf8');
  const secondOutput = readFileSync(secondPath, 'utf8');
  const differentSeedOutput = readFileSync(differentSeedPath, 'utf8');

  assert.equal(firstOutput, secondOutput);
  assert.notEqual(firstOutput, differentSeedOutput);

  const dataset = JSON.parse(firstOutput) as ScatterDataset;
  assert.equal(dataset.metadata.count, 12);
  assert.equal(dataset.metadata.seed, 42);
  assert.equal(dataset.records.length, 12);
  assert.equal(dataset.records[0]?.id, 'pt-000000');
  assert.equal(dataset.records[11]?.id, 'pt-000011');
  assert.deepEqual(dataset.metadata.attributes.y, ['a', 'b', 'c']);
  assert.equal(dataset.metadata.attributes.color, 'color');
  assert.equal(dataset.metadata.attributes.opacity, 'opacity');
  assert.equal(dataset.metadata.attributes.rotation, 'rotation');
  assert.equal(dataset.metadata.attributes.size, 'size');
  assert.equal(dataset.metadata.attributes.shape, 'shape');
  assert.deepEqual(dataset.metadata.styles.shape.values, SCATTER_SHAPES);
  assert.equal(dataset.metadata.styles.color.format, '#RRGGBB');
  assert.equal(dataset.metadata.styles.opacity.min, SCATTER_STYLE_LIMITS.opacity.min);
  assert.equal(dataset.metadata.styles.opacity.max, SCATTER_STYLE_LIMITS.opacity.max);
  assert.equal(dataset.metadata.styles.rotation.min, SCATTER_STYLE_LIMITS.rotation.min);
  assert.equal(dataset.metadata.styles.rotation.max, SCATTER_STYLE_LIMITS.rotation.max);
  assert.equal(dataset.metadata.styles.rotation.unit, SCATTER_STYLE_LIMITS.rotation.unit);
  assert.equal(dataset.metadata.styles.rotation.nullable, true);
  assert.equal(dataset.metadata.styles.size.min, SCATTER_STYLE_LIMITS.size.min);
  assert.equal(dataset.metadata.styles.size.max, SCATTER_STYLE_LIMITS.size.max);
  assert.match(dataset.metadata.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  for (const record of dataset.records) {
    assert.match(record.color, /^#[0-9A-F]{6}$/u);
    assert.ok(record.opacity >= SCATTER_STYLE_LIMITS.opacity.min);
    assert.ok(record.opacity <= SCATTER_STYLE_LIMITS.opacity.max);
    assert.ok(record.rotation !== null);
    assert.ok(record.rotation >= SCATTER_STYLE_LIMITS.rotation.min);
    assert.ok(record.rotation <= SCATTER_STYLE_LIMITS.rotation.max);
    assert.ok(record.size >= SCATTER_STYLE_LIMITS.size.min);
    assert.ok(record.size <= SCATTER_STYLE_LIMITS.size.max);
    assert.ok(SCATTER_SHAPES.includes(record.shape));
  }
  assert.deepEqual(
    collectStyleRangeSamples(dataset.records),
    {
      opacity: [
        SCATTER_STYLE_LIMITS.opacity.min,
        midpoint(SCATTER_STYLE_LIMITS.opacity),
        SCATTER_STYLE_LIMITS.opacity.max,
      ],
      rotation: [
        SCATTER_STYLE_LIMITS.rotation.min,
        midpoint(SCATTER_STYLE_LIMITS.rotation),
        SCATTER_STYLE_LIMITS.rotation.max,
      ],
      size: [
        SCATTER_STYLE_LIMITS.size.min,
        midpoint(SCATTER_STYLE_LIMITS.size),
        SCATTER_STYLE_LIMITS.size.max,
      ],
    },
  );

  const firstParallelPath = join(tempDir, 'parallel-seed-42-a.json');
  const secondParallelPath = join(tempDir, 'parallel-seed-42-b.json');
  const differentParallelSeedPath = join(tempDir, 'parallel-seed-43.json');

  runParallelGenerator(firstParallelPath, 42);
  runParallelGenerator(secondParallelPath, 42);
  runParallelGenerator(differentParallelSeedPath, 43);

  const firstParallelOutput = readFileSync(firstParallelPath, 'utf8');
  const secondParallelOutput = readFileSync(secondParallelPath, 'utf8');
  const differentParallelSeedOutput = readFileSync(differentParallelSeedPath, 'utf8');

  assert.equal(firstParallelOutput, secondParallelOutput);
  assert.notEqual(firstParallelOutput, differentParallelSeedOutput);

  const parallelDataset = JSON.parse(firstParallelOutput) as ParallelDataset;
  assert.equal(parallelDataset.metadata.count, 12);
  assert.equal(parallelDataset.metadata.seed, 42);
  assert.equal(parallelDataset.records.length, 12);
  assert.equal(parallelDataset.records[0]?.id, 'pc-000000');
  assert.equal(parallelDataset.records[11]?.id, 'pc-000011');
  assert.deepEqual(parallelDataset.metadata.attributes.parameters, PARALLEL_PARAMETERS);
  assert.equal(parallelDataset.metadata.attributes.id, 'id');
  assert.match(parallelDataset.metadata.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  for (const record of parallelDataset.records) {
    assert.deepEqual(Object.keys(record), ['id', ...PARALLEL_PARAMETERS]);
    assert.equal(typeof record.id, 'string');
    for (const parameter of PARALLEL_PARAMETERS) {
      assert.equal(typeof record[parameter], 'number');
      assert.ok(Number.isFinite(record[parameter]));
    }
  }

  const scatterFastPath = join(tempDir, 'scatter-fast.json');
  const scatterFastSchemaPath = join(tempDir, 'scatter-fast-schema.json');
  const scatterFastColumnarPath = join(tempDir, 'scatter-fast.columnar.json');

  runScatterFastGenerator(scatterFastPath, scatterFastSchemaPath, scatterFastColumnarPath, 42);

  const scatterFastDataset = JSON.parse(readFileSync(scatterFastPath, 'utf8')) as {
    records: {
      accepted: boolean;
      color: string;
      id: string;
      opacity: number;
      phase: string;
      rotation: number;
      shape: string;
      signalValue: number;
      size: number;
      timestampNs: string;
    }[];
  };
  const scatterFastSchema = JSON.parse(
    readFileSync(scatterFastSchemaPath, 'utf8'),
  ) as FastScatterDatasetSchema;
  const scatterFastColumnarManifest = JSON.parse(readFileSync(scatterFastColumnarPath, 'utf8')) as {
    binary: string;
    columns: Record<
      string,
      { byteLength: number; byteOffset: number; length: number; type: string }
    >;
    count: number;
    domains: Record<string, { max: number; min: number }>;
    idPrefix: string;
    idWidth: number;
    timestampOriginNs: string;
    version: 1;
  };
  const scatterFastColumnarBinary = readFileSync(
    join(tempDir, scatterFastColumnarManifest.binary),
  );

  assert.equal(scatterFastDataset.records.length, 12);
  assert.equal(scatterFastDataset.records[0]?.id, 'sf-000000');
  assert.match(scatterFastDataset.records[0]?.timestampNs ?? '', /^\d+$/u);
  assert.equal(typeof scatterFastDataset.records[0]?.accepted, 'boolean');
  assert.equal(typeof scatterFastDataset.records[0]?.signalValue, 'number');
  assert.equal(typeof scatterFastDataset.records[0]?.opacity, 'number');
  assert.equal(typeof scatterFastDataset.records[0]?.rotation, 'number');
  assert.equal(typeof scatterFastDataset.records[0]?.size, 'number');
  assert.match(scatterFastDataset.records[0]?.color ?? '', /^#[0-9A-F]{6}$/u);
  assert.ok((SCATTER_SHAPES as readonly string[]).includes(scatterFastDataset.records[0]?.shape ?? ''));
  assert.ok(new Set(scatterFastDataset.records.map((record) => record.color)).size > 1);
  assert.ok(new Set(scatterFastDataset.records.map((record) => record.opacity)).size > 1);
  assert.ok(new Set(scatterFastDataset.records.map((record) => record.rotation)).size > 1);
  assert.ok(new Set(scatterFastDataset.records.map((record) => record.shape)).size > 1);
  assert.ok(new Set(scatterFastDataset.records.map((record) => record.size)).size > 1);
  assert.deepEqual(
    collectStyleRangeSamples(scatterFastDataset.records),
    {
      opacity: [
        SCATTER_STYLE_LIMITS.opacity.min,
        midpoint(SCATTER_STYLE_LIMITS.opacity),
        SCATTER_STYLE_LIMITS.opacity.max,
      ],
      rotation: [
        SCATTER_STYLE_LIMITS.rotation.min,
        midpoint(SCATTER_STYLE_LIMITS.rotation),
        SCATTER_STYLE_LIMITS.rotation.max,
      ],
      size: [
        SCATTER_STYLE_LIMITS.size.min,
        midpoint(SCATTER_STYLE_LIMITS.size),
        SCATTER_STYLE_LIMITS.size.max,
      ],
    },
  );
  assert.equal(scatterFastColumnarManifest.count, scatterFastDataset.records.length);
  assert.equal(scatterFastColumnarManifest.idPrefix, 'sf-');
  assert.equal(scatterFastColumnarManifest.version, 1);
  assert.deepEqual(
    scatterFastSchema.plots.map((plot) => [plot.id, plot.y.column]),
    [
      ['phase', 'phase'],
      ['accepted', 'accepted'],
      ['signal', 'signalValue'],
    ],
  );
  assert.equal(
    scatterFastSchema.columns.find((column) => column.key === 'timestampNs')?.axisType,
    'datetime-ns',
  );
  assert.deepEqual(
    scatterFastSchema.columns
      .filter((column) => column.role === 'style')
      .map((column) => column.key),
    ['color', 'opacity', 'rotation', 'size', 'shape'],
  );

  const expectedColumnarX = createExpectedScatterFastColumnarX(scatterFastDataset.records);
  const actualColumnarX = Array.from(
    readColumnarFloat64(scatterFastColumnarManifest, scatterFastColumnarBinary, 'x'),
  );
  const actualColumnarPhase = Array.from(
    readColumnarFloat64(scatterFastColumnarManifest, scatterFastColumnarBinary, 'phase'),
  );
  const actualColumnarAccepted = Array.from(
    readColumnarFloat64(scatterFastColumnarManifest, scatterFastColumnarBinary, 'accepted'),
  );
  const actualColumnarSignalValue = Array.from(
    readColumnarFloat64(scatterFastColumnarManifest, scatterFastColumnarBinary, 'signalValue'),
  );
  const actualColumnarOpacity = Array.from(
    readColumnarFloat32(scatterFastColumnarManifest, scatterFastColumnarBinary, 'opacity'),
  );
  const actualColumnarSize = Array.from(
    readColumnarFloat32(scatterFastColumnarManifest, scatterFastColumnarBinary, 'size'),
  );

  assert.deepEqual(actualColumnarX, expectedColumnarX);
  assert.deepEqual(
    actualColumnarPhase,
    scatterFastDataset.records.map((record) => encodePhase(record.phase)),
  );
  assert.deepEqual(
    actualColumnarAccepted,
    scatterFastDataset.records.map((record) => (record.accepted ? 1 : 0)),
  );
  assert.deepEqual(
    actualColumnarSignalValue,
    scatterFastDataset.records.map((record) => record.signalValue),
  );
  assert.equal(actualColumnarOpacity.includes(SCATTER_STYLE_LIMITS.opacity.min), true);
  assert.equal(actualColumnarOpacity.includes(SCATTER_STYLE_LIMITS.opacity.max), true);
  assert.equal(actualColumnarSize.includes(SCATTER_STYLE_LIMITS.size.min), true);
  assert.equal(actualColumnarSize.includes(SCATTER_STYLE_LIMITS.size.max), true);

  const exactOverlapGroups = collectScatterFastExactOverlapGroups(scatterFastDataset.records);
  const exactColumnarOverlapGroups = collectScatterFastColumnarExactOverlapGroups(
    actualColumnarX,
    actualColumnarPhase,
    actualColumnarAccepted,
    actualColumnarSignalValue,
  );
  assert.deepEqual(
    exactOverlapGroups.map((group) => group.count),
    [3],
  );
  assert.deepEqual(
    exactColumnarOverlapGroups.map((group) => group.count),
    [3],
  );
  assert.deepEqual(
    exactColumnarOverlapGroups.map((group) => group.indices),
    exactOverlapGroups.map((group) => group.indices),
  );
  assert.equal(
    scatterFastDataset.records.every((record, index, records) =>
      index === 0 || BigInt(records[index - 1]!.timestampNs) <= BigInt(record.timestampNs)
    ),
    true,
  );
  assert.equal(
    actualColumnarX.every((value, index, values) => index === 0 || values[index - 1]! <= value),
    true,
  );

  const scatterWebgpuManifestPath = join(tempDir, 'scatter-webgpu.json');
  const scatterWebgpuSchemaPath = join(tempDir, 'scatter-webgpu-schema.json');
  runScatterWebgpuGenerator(scatterWebgpuManifestPath, scatterWebgpuSchemaPath, 42);
  const scatterWebgpuManifest = JSON.parse(
    readFileSync(scatterWebgpuManifestPath, 'utf8'),
  ) as {
    count: number;
    format: string;
    pages: {
      binary: string;
      columns: Record<string, { byteLength: number; byteOffset: number; length: number; type: string }>;
      count: number;
      startIndex: number;
      styleBinary: string;
    }[];
    styleStrideBytes: number;
    version: number;
    xScaleMs: number;
    xStorage: string;
  };
  assert.equal(scatterWebgpuManifest.format, 'm-scatter-webgpu-paged');
  assert.equal(scatterWebgpuManifest.version, 7);
  assert.equal(scatterWebgpuManifest.xScaleMs, 250);
  assert.equal(scatterWebgpuManifest.xStorage, 'generated-overlap-index');
  assert.equal(scatterWebgpuManifest.styleStrideBytes, 4);
  assert.equal(scatterWebgpuManifest.count, 12);
  assert.equal(scatterWebgpuManifest.pages.length, 3);
  assert.deepEqual(scatterWebgpuManifest.pages.map((page) => page.count), [5, 5, 2]);
  const pagedPhase: number[] = [];
  const pagedAccepted: number[] = [];
  const pagedSignal: number[] = [];
  const pagedStyles: number[] = [];
  for (const page of scatterWebgpuManifest.pages) {
    const binary = readFileSync(join(tempDir, page.binary));
    pagedPhase.push(...readColumnarUint8(page, binary, 'phase'));
    pagedAccepted.push(...readColumnarUint8(page, binary, 'accepted'));
    pagedSignal.push(...readColumnarUint16(page, binary, 'signalValue'));
    const styleBinary = readFileSync(join(tempDir, page.styleBinary));
    pagedStyles.push(...new Uint32Array(
      styleBinary.buffer.slice(
        styleBinary.byteOffset,
        styleBinary.byteOffset + styleBinary.byteLength,
      ),
    ));
  }
  assert.deepEqual(pagedPhase, scatterFastDataset.records.map((record) => encodePhase(record.phase)));
  assert.deepEqual(pagedAccepted, scatterFastDataset.records.map((record) => record.accepted ? 1 : 0));
  assert.deepEqual(
    pagedSignal,
    scatterFastDataset.records.map((record) => Math.round(record.signalValue / 0.0025)),
  );
  assert.equal(pagedStyles.length, scatterFastDataset.records.length);
  for (const [index, record] of scatterFastDataset.records.entries()) {
    const expected = expectedPackedStyle(record);
    assert.equal(pagedStyles[index], expected);
  }

  const firstMixedPath = join(tempDir, 'mixed-seed-42-a.json');
  const firstMixedSecondaryPath = join(tempDir, 'mixed-seed-42-a.secondary.json');
  const secondMixedPath = join(tempDir, 'mixed-seed-42-b.json');
  const differentMixedSeedPath = join(tempDir, 'mixed-seed-43.json');

  runMixedTablesGenerator(firstMixedPath, 42, firstMixedSecondaryPath);
  runMixedTablesGenerator(secondMixedPath, 42);
  runMixedTablesGenerator(differentMixedSeedPath, 43);

  const firstMixedOutput = readFileSync(firstMixedPath, 'utf8');
  const secondMixedOutput = readFileSync(secondMixedPath, 'utf8');
  const differentMixedSeedOutput = readFileSync(differentMixedSeedPath, 'utf8');

  assert.equal(firstMixedOutput, secondMixedOutput);
  assert.notEqual(firstMixedOutput, differentMixedSeedOutput);

  const mixedFixture = JSON.parse(firstMixedOutput) as MixedTableFixture;
  const secondaryFixture = JSON.parse(
    readFileSync(firstMixedSecondaryPath, 'utf8'),
  ) as MixedTableFixture;
  assert.equal(mixedFixture.metadata.version, 1);
  assert.equal(mixedFixture.metadata.count, 15);
  assert.equal(mixedFixture.metadata.seed, 42);
  assert.deepEqual(mixedFixture.metadata.tableNames, MIXED_TABLE_NAMES);
  assert.deepEqual(
    mixedFixture.metadata.tables.map((table) => [table.name, table.count]),
    [
      ['benchmark-primary', 12],
      ['benchmark-secondary', 3],
    ],
  );
  assert.deepEqual(
    mixedFixture.metadata.axes.map((axis) => [axis.key, axis.kind]),
    MIXED_TABLE_AXES.map((axis) => [axis.key, axis.kind]),
  );
  assert.deepEqual(
    mixedFixture.metadata.axes.map((axis) => axis.kind),
    ['datetime-ns', 'numeric', 'categorical', 'boolean', 'numeric', 'numeric'],
  );
  assert.equal(mixedFixture.metadata.styles.color.attribute, 'color');
  assert.equal(mixedFixture.metadata.styles.color.format, '#RRGGBB');
  assert.equal(mixedFixture.metadata.styles.opacity.min, SCATTER_STYLE_LIMITS.opacity.min);
  assert.equal(mixedFixture.metadata.styles.opacity.max, SCATTER_STYLE_LIMITS.opacity.max);
  assert.equal(mixedFixture.metadata.styles.size.attribute, 'size');
  assert.equal(mixedFixture.metadata.styles.rotation.attribute, 'rotation');
  assert.deepEqual(mixedFixture.metadata.styles.shape.values, SCATTER_SHAPES);
  assert.deepEqual(
    mixedFixture.metadata.columns
      .filter((column) => column.role === 'style')
      .map((column) => column.key),
    ['color', 'opacity', 'size', 'rotation', 'shape'],
  );
  assert.equal(mixedFixture.tables.length, 2);
  assert.deepEqual(
    mixedFixture.tables.map((table) => table.name),
    ['benchmark-primary', 'benchmark-secondary'],
  );
  assert.deepEqual(
    mixedFixture.tables.map((table) => table.records.length),
    [12, 3],
  );
  assert.equal(mixedFixture.tables[0]?.records[0]?.id, 'sf-000000');
  assert.equal(mixedFixture.tables[1]?.records[0]?.id, 'sf-b-000000');
  assert.equal(mixedFixture.tables[0]?.records[0]?.secondarySignal, undefined);
  assert.equal(mixedFixture.tables[0]?.records[0]?.secondaryDrift, undefined);
  assert.equal(typeof mixedFixture.tables[1]?.records[0]?.secondarySignal, 'number');
  assert.equal(typeof mixedFixture.tables[1]?.records[0]?.secondaryDrift, 'number');
  assert.deepEqual(
    secondaryFixture.tables.map((table) => table.name),
    ['benchmark-secondary'],
  );
  assert.deepEqual(
    secondaryFixture.tables[0]?.records,
    mixedFixture.tables[1]?.records,
  );

  for (const table of mixedFixture.tables) {
    for (const record of table.records) {
      assert.equal(record.table, table.name);
      assert.match(record.timestampNs, /^\d+$/u);
      assert.equal(typeof record.signalValue, 'number');
      assert.equal(typeof record.accepted, 'boolean');
      assert.match(record.color, /^#[0-9A-F]{6}$/u);
      assert.ok(record.opacity >= SCATTER_STYLE_LIMITS.opacity.min);
      assert.ok(record.opacity <= SCATTER_STYLE_LIMITS.opacity.max);
      assert.ok(record.size >= SCATTER_STYLE_LIMITS.size.min);
      assert.ok(record.size <= SCATTER_STYLE_LIMITS.size.max);
      assert.ok(record.rotation >= SCATTER_STYLE_LIMITS.rotation.min);
      assert.ok(record.rotation <= SCATTER_STYLE_LIMITS.rotation.max);
      assert.ok((SCATTER_SHAPES as readonly string[]).includes(record.shape));
    }
  }
  assert.deepEqual(
    collectStyleRangeSamples(mixedFixture.tables.flatMap((table) => table.records)),
    {
      opacity: [
        SCATTER_STYLE_LIMITS.opacity.min,
        midpoint(SCATTER_STYLE_LIMITS.opacity),
        SCATTER_STYLE_LIMITS.opacity.max,
      ],
      rotation: [
        SCATTER_STYLE_LIMITS.rotation.min,
        midpoint(SCATTER_STYLE_LIMITS.rotation),
        SCATTER_STYLE_LIMITS.rotation.max,
      ],
      size: [
        SCATTER_STYLE_LIMITS.size.min,
        midpoint(SCATTER_STYLE_LIMITS.size),
        SCATTER_STYLE_LIMITS.size.max,
      ],
    },
  );

  const firstHistogramBarsPath = join(tempDir, 'histogram-bars-seed-42-a.json');
  const secondHistogramBarsPath = join(tempDir, 'histogram-bars-seed-42-b.json');
  const differentHistogramBarsSeedPath = join(tempDir, 'histogram-bars-seed-43.json');

  runHistogramBarsGenerator(firstHistogramBarsPath, 42);
  runHistogramBarsGenerator(secondHistogramBarsPath, 42);
  runHistogramBarsGenerator(differentHistogramBarsSeedPath, 43);

  const firstHistogramBarsOutput = readFileSync(firstHistogramBarsPath, 'utf8');
  const secondHistogramBarsOutput = readFileSync(secondHistogramBarsPath, 'utf8');
  const differentHistogramBarsSeedOutput = readFileSync(differentHistogramBarsSeedPath, 'utf8');

  assert.equal(firstHistogramBarsOutput, secondHistogramBarsOutput);
  assert.notEqual(firstHistogramBarsOutput, differentHistogramBarsSeedOutput);

  const histogramBarsPayload = JSON.parse(firstHistogramBarsOutput) as HistogramBarsPayload;
  assert.equal(histogramBarsPayload.source, 'generated-histogram-bars');
  assert.equal(histogramBarsPayload.metadata.version, 1);
  assert.equal(histogramBarsPayload.metadata.seed, 42);
  assert.equal(histogramBarsPayload.metadata.barsPerParameter, 8);
  assert.deepEqual(
    histogramBarsPayload.parameters.map((parameter) => parameter.key),
    ['latencyMs', 'signalValue', 'secondarySignal'],
  );
  assert.equal(histogramBarsPayload.parameters.length, 3);

  const stackedParameterCount = histogramBarsPayload.parameters.filter((parameter) =>
    parameter.bins.some((bin) => bin.colorCounts !== undefined)
  ).length;
  assert.ok(stackedParameterCount >= 1);

  for (const parameter of histogramBarsPayload.parameters) {
    assert.equal(parameter.bins.length, 8);
    assert.equal(typeof parameter.label, 'string');
    assert.equal(typeof parameter.source, 'string');
    assert.equal(typeof parameter.table, 'string');
    assert.equal(typeof parameter.unit, 'string');

    for (const [binIndex, bin] of parameter.bins.entries()) {
      assert.equal(typeof bin.count, 'number');
      assert.ok(Number.isSafeInteger(bin.count));
      assert.ok(bin.count >= 0);
      assert.ok(bin.max > bin.min);
      if (binIndex > 0) {
        assert.equal(bin.min, parameter.bins[binIndex - 1]?.max);
      }

      if (bin.colorCounts !== undefined) {
        assert.ok(Object.keys(bin.colorCounts).length >= 2);
        assert.equal(
          Object.values(bin.colorCounts).reduce((sum, count) => sum + count, 0),
          bin.count,
        );
        for (const [color, count] of Object.entries(bin.colorCounts)) {
          assert.match(color, /^#[0-9A-F]{6}$/u);
          assert.ok(Number.isSafeInteger(count));
          assert.ok(count >= 0);
        }
      }
    }
  }
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

console.log('generateData tests passed');

function runGenerator(outPath: string, seed: number): void {
  execFileSync(
    'pnpm',
    [
      'generate:data',
      '--',
      '--count',
      '12',
      '--seed',
      String(seed),
      '--out',
      outPath,
    ],
    {
      cwd: repoRoot,
      stdio: 'pipe',
    },
  );
}

function runParallelGenerator(outPath: string, seed: number): void {
  execFileSync(
    'pnpm',
    [
      'generate:data',
      '--',
      '--kind',
      'parallel',
      '--count',
      '12',
      '--seed',
      String(seed),
      '--out',
      outPath,
    ],
    {
      cwd: repoRoot,
      stdio: 'pipe',
    },
  );
}

function runScatterFastGenerator(
  outPath: string,
  schemaOutPath: string,
  columnarOutPath: string,
  seed: number,
): void {
  execFileSync(
    'pnpm',
    [
      'generate:data',
      '--',
      '--kind',
      'scatter-fast',
      '--count',
      '12',
      '--seed',
      String(seed),
      '--out',
      outPath,
      '--schema-out',
      schemaOutPath,
      '--columnar-out',
      columnarOutPath,
    ],
    {
      cwd: repoRoot,
      stdio: 'pipe',
    },
  );
}

function runScatterWebgpuGenerator(
  outPath: string,
  schemaOutPath: string,
  seed: number,
): void {
  execFileSync(
    'pnpm',
    [
      'generate:data', '--', '--kind', 'scatter-webgpu', '--count', '12',
      '--page-size', '5', '--seed', String(seed), '--out', outPath,
      '--schema-out', schemaOutPath,
    ],
    { cwd: repoRoot, stdio: 'pipe' },
  );
}

function createExpectedScatterFastColumnarX(
  records: readonly { timestampNs: string }[],
): number[] {
  const originNs = BigInt(records[0]?.timestampNs ?? '0');
  return records.map((record) => Number(BigInt(record.timestampNs) - originNs) / 1_000_000);
}

function encodePhase(phase: string): number {
  switch (phase) {
    case 'idle':
      return 0;
    case 'ramp':
      return 1;
    case 'steady':
      return 2;
    case 'cooldown':
      return 3;
    default:
      throw new Error(`Unsupported scatter-fast phase ${phase}.`);
  }
}

function expectedPackedStyle(record: {
  color: string;
  opacity: number;
  rotation: number;
  shape: string;
  size: number;
}): number {
  const color = Number.parseInt(record.color.slice(1), 16);
  const fullTurn = Math.PI * 2;
  const sourceRotation = Math.fround(((record.rotation * Math.PI) / 180) % fullTurn);
  const rotation = ((sourceRotation + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
  const encodedRotation = Math.max(0, Math.min(63, Math.round(
    ((rotation + Math.PI) / (Math.PI * 2)) * 63,
  )));
  const encodedSize = Math.max(0, Math.min(7, Math.round(record.size - 1)));
  const red = (color >>> 16) & 0xff;
  const green = (color >>> 8) & 0xff;
  const blue = color & 0xff;
  return (
    Math.round((red / 255) * 31) |
    (Math.round((green / 255) * 63) << 5) |
    (Math.round((blue / 255) * 31) << 11) |
    (Math.round(Math.fround(record.opacity) * 15) << 16) |
    (encodeShape(record.shape) << 20) |
    (encodedRotation << 23) |
    (encodedSize << 29)
  ) >>> 0;
}

function encodeShape(shape: string): number {
  const index = (SCATTER_SHAPES as readonly string[]).indexOf(shape);
  if (index < 0) throw new Error(`Unsupported scatter-fast shape ${shape}.`);
  return index;
}

function collectScatterFastExactOverlapGroups(
  records: readonly {
    accepted: boolean;
    phase: string;
    signalValue: number;
    timestampNs: string;
  }[],
): { count: number; indices: number[] }[] {
  const groups = new Map<string, number[]>();
  for (const [index, record] of records.entries()) {
    const key = [
      record.timestampNs,
      record.phase,
      String(record.accepted),
      record.signalValue.toFixed(3),
    ].join('|');
    const indices = groups.get(key);
    if (indices === undefined) {
      groups.set(key, [index]);
    } else {
      indices.push(index);
    }
  }

  return Array.from(groups.values())
    .filter((indices) => indices.length > 1)
    .map((indices) => ({ count: indices.length, indices }));
}

function collectScatterFastColumnarExactOverlapGroups(
  x: readonly number[],
  phase: readonly number[],
  accepted: readonly number[],
  signalValue: readonly number[],
): { count: number; indices: number[] }[] {
  const groups = new Map<string, number[]>();
  for (let index = 0; index < x.length; index += 1) {
    const key = [x[index], phase[index], accepted[index], signalValue[index]].join('|');
    const indices = groups.get(key);
    if (indices === undefined) {
      groups.set(key, [index]);
    } else {
      indices.push(index);
    }
  }

  return Array.from(groups.values())
    .filter((indices) => indices.length > 1)
    .map((indices) => ({ count: indices.length, indices }));
}

function readColumnarFloat64(
  manifest: {
    columns: Record<
      string,
      { byteLength: number; byteOffset: number; length: number; type: string }
    >;
  },
  binary: Uint8Array,
  name: string,
): Float64Array {
  const column = manifest.columns[name];
  assert.ok(column, `Missing scatter-fast columnar column ${name}.`);
  assert.equal(column.type, 'Float64Array');
  const buffer = binary.buffer.slice(
    binary.byteOffset + column.byteOffset,
    binary.byteOffset + column.byteOffset + column.byteLength,
  );
  return new Float64Array(buffer, 0, column.length);
}

function readColumnarFloat32(
  manifest: {
    columns: Record<
      string,
      { byteLength: number; byteOffset: number; length: number; type: string }
    >;
  },
  binary: Uint8Array,
  name: string,
): Float32Array {
  const column = manifest.columns[name];
  assert.ok(column, `Missing scatter-fast columnar column ${name}.`);
  assert.equal(column.type, 'Float32Array');
  const buffer = binary.buffer.slice(
    binary.byteOffset + column.byteOffset,
    binary.byteOffset + column.byteOffset + column.byteLength,
  );
  return new Float32Array(buffer, 0, column.length);
}

function readColumnarUint16(
  manifest: {
    columns: Record<
      string,
      { byteLength: number; byteOffset: number; length: number; type: string }
    >;
  },
  binary: Uint8Array,
  name: string,
): Uint16Array {
  const column = manifest.columns[name];
  assert.ok(column, `Missing scatter-fast columnar column ${name}.`);
  assert.equal(column.type, 'Uint16Array');
  const buffer = binary.buffer.slice(
    binary.byteOffset + column.byteOffset,
    binary.byteOffset + column.byteOffset + column.byteLength,
  );
  return new Uint16Array(buffer, 0, column.length);
}

function readColumnarUint8(
  manifest: {
    columns: Record<string, { byteLength: number; byteOffset: number; length: number; type: string }>;
  },
  binary: Uint8Array,
  name: string,
): Uint8Array {
  const column = manifest.columns[name];
  assert.ok(column, `Missing scatter-fast columnar column ${name}.`);
  assert.equal(column.type, 'Uint8Array');
  return binary.slice(column.byteOffset, column.byteOffset + column.byteLength);
}

function collectStyleRangeSamples(
  records: readonly { opacity: number; rotation: number; size: number }[],
): {
  opacity: number[];
  rotation: number[];
  size: number[];
} {
  return {
    opacity: collectPresentNumbers(records.map((record) => record.opacity), [
      SCATTER_STYLE_LIMITS.opacity.min,
      midpoint(SCATTER_STYLE_LIMITS.opacity),
      SCATTER_STYLE_LIMITS.opacity.max,
    ]),
    rotation: collectPresentNumbers(records.map((record) => record.rotation), [
      SCATTER_STYLE_LIMITS.rotation.min,
      midpoint(SCATTER_STYLE_LIMITS.rotation),
      SCATTER_STYLE_LIMITS.rotation.max,
    ]),
    size: collectPresentNumbers(records.map((record) => record.size), [
      SCATTER_STYLE_LIMITS.size.min,
      midpoint(SCATTER_STYLE_LIMITS.size),
      SCATTER_STYLE_LIMITS.size.max,
    ]),
  };
}

function midpoint(range: { max: number; min: number }): number {
  return (range.min + range.max) / 2;
}

function collectPresentNumbers(values: readonly number[], expected: readonly number[]): number[] {
  const valueSet = new Set(values);

  return expected.filter((value) => valueSet.has(value));
}

function runMixedTablesGenerator(
  outPath: string,
  seed: number,
  secondaryOutPath?: string,
): void {
  execFileSync(
    'pnpm',
    [
      'generate:data',
      '--',
      '--kind',
      'mixed-tables',
      '--count',
      '12',
      '--secondary-count',
      '3',
      '--seed',
      String(seed),
      '--out',
      outPath,
      ...(secondaryOutPath === undefined
        ? []
        : ['--secondary-out', secondaryOutPath]),
    ],
    {
      cwd: repoRoot,
      stdio: 'pipe',
    },
  );
}

function runHistogramBarsGenerator(outPath: string, seed: number): void {
  execFileSync(
    'pnpm',
    [
      'generate:data',
      '--',
      '--kind',
      'histogram-bars',
      '--count',
      '8',
      '--seed',
      String(seed),
      '--out',
      outPath,
    ],
    {
      cwd: repoRoot,
      stdio: 'pipe',
    },
  );
}
