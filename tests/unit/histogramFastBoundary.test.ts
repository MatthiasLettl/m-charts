import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  adaptHistogramBarDemoPayload,
  adaptScatterEncodedColumnsForHistogram,
} from '../../packages/m-charts/src/m-histogram/adapters/index.ts';
import {
  buildHistogramAggregation,
  createDefaultHistogramViewport,
  normalizeHistogramBarSeries,
  type HistogramColumns,
  type HistogramPlotSpec,
  type HistogramViewport,
} from '../../packages/m-charts/src/m-histogram/core/index.ts';
import {
  createDefaultHistogramBindings,
  createHistogramPlot,
  type HistogramPlotOptions,
} from '../../packages/m-charts/src/m-histogram/engine/index.ts';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const coreRoot = resolve(repoRoot, 'packages/m-charts/src/m-histogram/core');
const engineRoot = resolve(repoRoot, 'packages/m-charts/src/m-histogram/engine');
const sourceFiles = [...listSourceFiles(coreRoot), ...listSourceFiles(engineRoot)];

const forbiddenImportPatterns = [
  /from\s+['"]react(?:\/[^'"]*)?['"]/,
  /import\s+['"]react(?:\/[^'"]*)?['"]/,
  /from\s+['"]react-router(?:-dom)?(?:\/[^'"]*)?['"]/,
  /import\s+['"]react-router(?:-dom)?(?:\/[^'"]*)?['"]/,
  /from\s+['"][^.'"][^'"]*['"]/,
  /import\s+['"][^.'"][^'"]*['"]/,
  /from\s+['"].*\/(?:data|routes|state|theme)\//,
  /import\s+['"].*\/(?:data|routes|state|theme)\//,
  /from\s+['"].*\/histogram\/(?:react|testing)\//,
  /import\s+['"].*\/histogram\/(?:react|testing)\//,
];
const forbiddenEnvironmentPatterns = [
  /import\.meta\.env/,
  /process\.env/,
];

for (const filePath of sourceFiles) {
  const source = readFileSync(filePath, 'utf8');

  for (const pattern of forbiddenImportPatterns) {
    assert.equal(
      pattern.test(source),
      false,
      `${relative(repoRoot, filePath)} must not import React, React Router, package dependencies, app routes/state/theme/data, or demo fixtures`,
    );
  }

  for (const pattern of forbiddenEnvironmentPatterns) {
    assert.equal(
      pattern.test(source),
      false,
      `${relative(repoRoot, filePath)} must not read environment setup`,
    );
  }
}

const spec = {
  mode: 'histogram',
  parameters: [
    {
      domain: { max: 10, min: 0 },
      key: 'temperature',
      kind: 'numeric',
      label: 'Temperature',
    },
  ],
  subplots: [{ id: 'temperature', label: 'Temperature', parameterKey: 'temperature' }],
} as const satisfies HistogramPlotSpec;
const columns: HistogramColumns = {
  ids: ['row-0', 'row-1'],
  valuesByParameter: {
    temperature: new Float32Array([1, 2]),
  },
};
const aggregation = buildHistogramAggregation(columns, { plotSpec: spec });
const viewport: HistogramViewport = createDefaultHistogramViewport(aggregation);
const options = {
  aggregation,
  spec,
  viewport,
} satisfies HistogramPlotOptions;

assert.equal(options.aggregation.mode, 'histogram');
assert.equal(normalizeHistogramBarSeries({ bins: [], parameterKey: 'empty', subplotId: 'empty' }).mode, 'bar');
assert.equal(typeof createHistogramPlot, 'function');
assert.equal(typeof createDefaultHistogramBindings, 'function');
assert.equal(typeof adaptHistogramBarDemoPayload, 'function');
assert.equal(typeof adaptScatterEncodedColumnsForHistogram, 'function');

function listSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(entryPath));
    } else if (entry.isFile() && /\.[cm]?tsx?$/u.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

console.log('histogram-fast boundary tests passed');
