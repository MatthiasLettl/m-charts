import assert from 'node:assert/strict';

import { PlotEngine, MScatter, MParallel, MHistogram } from 'm-charts';
import { createEmitter, type TypedEmitter } from 'm-charts/plot-engine';
import {
  applyScatterColorRules,
  createDefaultScatterBindings,
  createScatterPlot,
  type FastScatterDisplayColumns,
  type FastScatterPlotInstance,
  type FastScatterPlotSpec,
  type ScatterBrushEvent,
} from 'm-charts/m-scatter';
import { createScatterPlot as createScatterPlotAlias } from 'm-charts/scatter';
import {
  applyParallelColorRules,
  createDefaultParallelBindings,
  createParallelPlot,
  type ParallelBuffers,
  type ParallelFastPlotSpec,
  type ParallelPlotInstance,
} from 'm-charts/m-parallel';
import { createParallelPlot as createParallelPlotAlias } from 'm-charts/parallel';
import {
  applyHistogramColorRules,
  createDefaultHistogramBindings,
  createHistogramPlot,
  type HistogramColumns,
  type HistogramPlotInstance,
  type HistogramPlotSpec,
} from 'm-charts/m-histogram';
import { createHistogramPlot as createHistogramPlotAlias } from 'm-charts/histogram';

type CompatibilitySurface = {
  emitter: TypedEmitter<{ brush: ScatterBrushEvent }>;
  histogram: HistogramPlotInstance;
  histogramSpec: HistogramPlotSpec;
  parallel: ParallelPlotInstance;
  parallelSpec: ParallelFastPlotSpec;
  scatter: FastScatterPlotInstance;
  scatterSpec: FastScatterPlotSpec;
};

export function compilePackageCompatibilitySmoke(surface: CompatibilitySurface): void {
  const emitter = createEmitter<{ brush: ScatterBrushEvent }>();
  void emitter;
  void surface;
  void createScatterPlot;
  void createDefaultScatterBindings;
  void applyScatterColorRules({} as FastScatterDisplayColumns, []);
  void createParallelPlot;
  void createDefaultParallelBindings;
  void applyParallelColorRules({ recordCount: 0 } as ParallelBuffers, []);
  void createHistogramPlot;
  void createDefaultHistogramBindings;
  void applyHistogramColorRules({ ids: [] } as unknown as HistogramColumns, []);
}

assert.equal(typeof PlotEngine.createEmitter, 'function');
assert.equal(typeof MScatter.createScatterPlot, 'function');
assert.equal(typeof MParallel.createParallelPlot, 'function');
assert.equal(typeof MHistogram.createHistogramPlot, 'function');
assert.equal(createScatterPlotAlias, createScatterPlot);
assert.equal(createParallelPlotAlias, createParallelPlot);
assert.equal(createHistogramPlotAlias, createHistogramPlot);
compilePackageCompatibilitySmoke({} as CompatibilitySurface);

console.log('m-charts compatibility smoke tests passed');
