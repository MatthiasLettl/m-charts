import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  FastScatterDatasetSchema,
  FastScatterDisplayColumns,
  FastScatterControllerOptions,
  FastScatterHoverEvent,
  FastScatterMeasurementEvent,
  FastScatterMetricsEvent,
  FastScatterPlotSpec,
  FastScatterPointColumns,
  FastScatterSelectionEvent,
  FastScatterViewport,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';
import { createDefaultScatterBindings, createFastScatterPlot } from '../../packages/m-charts/src/m-scatter/engine/index.ts';
import type {
  FastScatterPlotOptions,
  FastScatterRenderState,
} from '../../packages/m-charts/src/m-scatter/engine/index.ts';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const scatterFastRoot = resolve(repoRoot, 'packages/m-charts/src/m-scatter');
const coreRoot = resolve(repoRoot, 'packages/m-charts/src/m-scatter/core');
const engineRoot = resolve(repoRoot, 'packages/m-charts/src/m-scatter/engine');
const sourceFiles = [...listSourceFiles(coreRoot), ...listSourceFiles(engineRoot)];
const portableScatterFastSourceFiles = listSourceFiles(scatterFastRoot);

const forbiddenImportPatterns = [
  /from\s+['"]react(?:\/[^'"]*)?['"]/,
  /import\s+['"]react(?:\/[^'"]*)?['"]/,
  /from\s+['"]react-router(?:-dom)?(?:\/[^'"]*)?['"]/,
  /import\s+['"]react-router(?:-dom)?(?:\/[^'"]*)?['"]/,
  /from\s+['"][^.'"][^'"]*['"]/,
  /import\s+['"][^.'"][^'"]*['"]/,
  /from\s+['"].*\/(?:data|routes|state|theme)\//,
  /import\s+['"].*\/(?:data|routes|state|theme)\//,
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
      `${relative(repoRoot, filePath)} must not import React, React Router, package dependencies, or app-owned modules`,
    );
  }
}

for (const filePath of portableScatterFastSourceFiles) {
  const source = readFileSync(filePath, 'utf8');

  for (const pattern of forbiddenImportPatterns.filter(
    (candidate) => !String(candidate).includes('react(?:'),
  )) {
    assert.equal(
      pattern.test(source),
      false,
      `${relative(repoRoot, filePath)} must not import React Router or app-owned modules`,
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

const columns: FastScatterPointColumns = {
  ids: ['alpha', 'bravo'],
  x: new Float64Array([1, 2]),
  y: {
    metricA: new Float32Array([10, 20]),
  },
  color: new Uint32Array([0xff0033ff, 0x3355aaff]),
  opacity: new Float32Array([0.6, 1]),
  size: new Float32Array([4, 7]),
  rotation: new Float32Array([0, 90]),
  shape: new Uint8Array([0, 2]),
};
const displayColumns: FastScatterDisplayColumns = columns;
const schema: FastScatterDatasetSchema = {
  columns: [
    { axisType: 'numeric', key: 'x' },
    { axisType: 'numeric', key: 'metricA', unit: 'ms' },
  ],
  plots: [{ id: 'a', yKey: 'metricA' }],
  xKey: 'x',
};

const spec: FastScatterPlotSpec = {
  xLabel: 'Time',
  plots: [{ id: 'a', label: 'Metric A', yKey: 'metricA' }],
};

const viewport: FastScatterViewport = {
  x: { min: 1, max: 2 },
  yByPlot: {
    a: { min: 10, max: 20 },
  },
};

const events: {
  selection?: FastScatterSelectionEvent;
  hover?: FastScatterHoverEvent | null;
  measurement?: FastScatterMeasurementEvent;
  metrics?: FastScatterMetricsEvent;
} = {};

const options: FastScatterControllerOptions = {
  axisMode: 'xy',
  columns,
  mode: 'hover',
  onHoverChange: (hover) => {
    events.hover = hover;
  },
  onMeasurementChange: (measurement) => {
    events.measurement = measurement;
  },
  onMetrics: (metrics) => {
    events.metrics = metrics;
  },
  onSelectionChange: (selection) => {
    events.selection = selection;
  },
  onViewportChange: (nextViewport, reason) => {
    assert.equal(reason, 'programmatic');
    assert.deepEqual(nextViewport, viewport);
  },
  spec,
  viewport,
};

assert.equal(options.columns.ids.length, 2);
assert.equal(options.spec.plots[0]?.yKey, 'metricA');
assert.equal(options.viewport.yByPlot.a?.max, 20);
assert.equal(displayColumns.x.length, 2);
assert.equal(schema.columns[1]?.unit, 'ms');
assert.deepEqual(events, {});

const engineOptions = {
  axisMode: 'xy',
  columns: displayColumns,
  mode: 'hover',
  spec,
  viewport,
} satisfies FastScatterPlotOptions;
const renderState: FastScatterRenderState = 'ready';
assert.equal(engineOptions.columns.x.length, 2);
assert.equal(renderState, 'ready');
assert.equal(typeof createFastScatterPlot, 'function');
assert.equal(typeof createDefaultScatterBindings, 'function');

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
