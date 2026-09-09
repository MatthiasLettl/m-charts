import { calculateHistogramDomain, evaluateHistogramClientView } from '../../m-histogram/core/index.js';
import type { HistogramWebgpuPlotUpdateOptions } from './types.js';
import { createHistogramEngine } from '../../m-histogram/engine/createHistogramEngine.js';
import {
  HistogramWebgpuAggregationProvider,
  HistogramWebgpuRenderer,
} from '../core/index.js';
import type {
  HistogramWebgpuPlotInstance,
  HistogramWebgpuPlotOptions,
} from './types.js';

export function createHistogramWebgpuPlot(
  hostElement: HTMLElement,
  options: HistogramWebgpuPlotOptions,
): HistogramWebgpuPlotInstance {
  let renderer: HistogramWebgpuRenderer | null = null;
  const {
    aggregationBackend,
    clientView,
    forceWebglUnavailable: _forceWebglUnavailable,
    preserveDrawingBuffer: _preserveDrawingBuffer,
    rendererFactory: _rendererFactory,
    requestTimestampQuery,
    ...histogramOptions
  } = options;
  void _forceWebglUnavailable;
  void _preserveDrawingBuffer;
  void _rendererFactory;
  const sourceColumns = histogramOptions.columns;
  if (clientView !== undefined && (sourceColumns === undefined || histogramOptions.spec.mode !== 'histogram')) {
    throw new TypeError('Histogram clientView requires raw columns in histogram mode; pre-aggregated bars have no row pipeline.');
  }
  let theme = histogramOptions.theme;
  const evaluate = () => clientView === undefined ? null : evaluateHistogramClientView(
    clientView, sourceColumns!, theme?.defaultBarColor?.map((v) => Math.round(v * 255)),
  );
  let evaluation = evaluate();
  let specFields: import('../../client-data-view/index.js').ClientDataViewEvaluation['fields'] | undefined;
  let cachedSpec = histogramOptions.spec;
  const projectedSpec = () => {
    if (evaluation === null) return histogramOptions.spec;
    if (specFields === evaluation.fields) return cachedSpec;
    specFields = evaluation.fields;
    cachedSpec = {
    ...histogramOptions.spec,
    parameters: histogramOptions.spec.parameters.map((parameter) => {
      const field = evaluation!.fields[clientView!.fieldByParameter?.[parameter.key] ?? parameter.key];
      if (field?.kind !== 'numeric' || field.values === sourceColumns!.valuesByParameter[parameter.key]) return parameter;
      const numericParameter = { ...parameter, kind: 'numeric' as const, domain: undefined };
      return { ...numericParameter, domain: calculateHistogramDomain(evaluation!.columns, numericParameter).range };
    }),
    };
    return cachedSpec;
  };
  const aggregationProvider = new HistogramWebgpuAggregationProvider(
    aggregationBackend ?? 'auto',
  );
  const plot = createHistogramEngine(hostElement, { ...histogramOptions, ...(evaluation === null ? {} : { columns: evaluation.columns, spec: projectedSpec(), aggregation: undefined }) }, {
    aggregationProvider,
    asynchronousReady: true,
    canvasClassName: 'histogram-fast-engine-canvas histogram-fast-webgpu-canvas',
    canvasLabel: 'WebGPU high-performance histogram canvas',
    canvasRenderer: 'webgpu-histogram',
    createRenderer(rendererOptions, _plotOptions, lifecycle) {
      const nextRenderer = new HistogramWebgpuRenderer({
        ...rendererOptions,
        lifecycle: {
          onContextLost: (info) => lifecycle.onContextLost(JSON.stringify({
            backend: 'webgpu',
            message: info.message,
            reason: info.reason,
          })),
          onContextRestored: () => lifecycle.onContextRestored(JSON.stringify({
            backend: 'webgpu',
          })),
          onError: lifecycle.onError,
        },
        requestTimestampQuery,
      });
      renderer = nextRenderer;
      // The renderer reports initialization failures through its lifecycle;
      // this promise hook only advances the shared engine readiness state.
      void nextRenderer.interactive.then(lifecycle.onReady, () => {});
      return nextRenderer;
    },
    deferMembership: true,
    hostClassName: 'histogram-fast-engine-host histogram-fast-webgpu-host',
    setupErrorMessage: 'Unknown histogram WebGPU renderer setup error.',
  });
  if (renderer === null) {
    plot.dispose();
    throw new Error('The WebGPU histogram renderer was not created.');
  }
  const activeRenderer: HistogramWebgpuRenderer = renderer;
  const updatePlot = plot.update.bind(plot);
  const instance = Object.assign(plot, {
    getWebgpuDiagnostics: () => {
      const aggregation = aggregationProvider.getDiagnostics();
      return {
        ...activeRenderer.getDiagnostics(),
        clientView: evaluation === null ? undefined : { ...evaluation.metrics, revision: evaluation.revision, sourceStyleMode: evaluation.sourceStyleMode },
        aggregation,
        aggregationBackend: aggregation.backend,
        aggregationBackendPreference: aggregationBackend ?? 'auto',
        aggregationBuildCount: aggregation.buildCount,
        aggregationFallbackReason: aggregation.fallbackReason,
        lastAggregationMs: aggregation.lastBuildMs,
      };
    },
    interactive: activeRenderer.interactive,
    ready: activeRenderer.ready,
    update(next: HistogramWebgpuPlotUpdateOptions) {
      if (clientView === undefined) { updatePlot(next); return; }
      if (next.columns !== undefined && next.columns !== sourceColumns) throw new TypeError(
        'WebGPU histogram source columns are immutable while clientView is attached; recreate the view and plot for a new dataset.',
      );
      if (next.spec !== undefined && next.spec !== histogramOptions.spec) throw new TypeError('Histogram spec is creation-bound while clientView is attached.');
      if (next.aggregation !== undefined) throw new TypeError('An aggregation override is unavailable while clientView is attached.');
      const { columns: _source, spec: _spec, ...mutable } = next;
      void _source;
      void _spec;
      if (next.theme !== undefined && next.theme !== theme) {
        theme = next.theme; evaluation = evaluate();
        updatePlot({ ...mutable, columns: evaluation!.columns, spec: projectedSpec() });
      } else updatePlot(mutable);
    },
  });
  if (clientView !== undefined) plot.use(() => clientView.view.on('change', () => {
    evaluation = evaluate();
    updatePlot({ columns: evaluation!.columns, spec: projectedSpec(), selectedSourceIndices: [], hoverSourceIndex: null });
    plot.commands.render();
  }));
  return instance;
}

export const createHistogramPlot = createHistogramWebgpuPlot;
