import { evaluateHistogramClientView } from '../../m-histogram/core/index.js';
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
  let sourceSpec = histogramOptions.spec;
  let theme = histogramOptions.theme;
  const evaluate = () => clientView === undefined ? null : evaluateHistogramClientView(
    clientView, sourceColumns!, theme?.defaultBarColor?.map((v) => Math.round(v * 255)),
  );
  let evaluation = evaluate();
  let specFields: import('../../client-data-view/index.js').ClientDataViewEvaluation['fields'] | undefined;
  let cachedSpec = histogramOptions.spec;
  const projectedSpec = () => {
    if (evaluation === null) return sourceSpec;
    if (specFields === evaluation.fields) return cachedSpec;
    specFields = evaluation.fields;
    cachedSpec = {
    ...sourceSpec,
    parameters: sourceSpec.parameters.map((parameter) => {
      const projected = evaluation!.columns.parameters?.find((p) => p.key === parameter.key);
      const original = sourceColumns!.parameters?.find((p) => p.key === parameter.key);
      return projected !== undefined && projected !== original
        ? { ...projected, label: parameter.label } : parameter;
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
  if (clientView !== undefined) plot.use(() => clientView.view.validateWith((next) => {
    if (next.metrics.rowCount !== sourceColumns!.ids.length) throw new TypeError('Client view must retain source row identities.');
    for (const key of Object.keys(sourceColumns!.valuesByParameter).map((key) => clientView.fieldByParameter?.[key] ?? key)) {
      if (!Object.hasOwn(next.fields, key)) throw new TypeError(`Cannot remove plotted client field "${key}" while a chart is attached.`);
    }
  }));
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
      if (next.aggregation !== undefined) throw new TypeError('An aggregation override is unavailable while clientView is attached.');
      if (next.spec !== undefined) {
        if (next.spec.mode !== 'histogram' || next.spec.parameters.some((p) => !Object.hasOwn(sourceColumns!.valuesByParameter, p.key))) throw new TypeError('Client histogram specs require resident raw parameters.');
        sourceSpec = next.spec; specFields = undefined;
      }
      const { columns: _source, spec: _spec, ...mutable } = next;
      void _source;
      void _spec;
      if (next.theme !== undefined && next.theme !== theme) {
        theme = next.theme; evaluation = evaluate();
        updatePlot({ ...mutable, columns: evaluation!.columns, spec: projectedSpec() });
      } else updatePlot({ ...mutable, ...(next.spec === undefined ? {} : { spec: projectedSpec() }) });
    },
  });
  if (clientView !== undefined) plot.use(() => clientView.view.on('change', () => {
    const previous = evaluation;
    evaluation = evaluate();
    const dataChanged = previous?.columns.valuesByParameter !== evaluation!.columns.valuesByParameter;
    updatePlot({ columns: evaluation!.columns, spec: projectedSpec(), ...(dataChanged ? { selectedSourceIndices: [], hoverSourceIndex: null } : {}) });
    plot.commands.render();
  }));
  return instance;
}

export const createHistogramPlot = createHistogramWebgpuPlot;
