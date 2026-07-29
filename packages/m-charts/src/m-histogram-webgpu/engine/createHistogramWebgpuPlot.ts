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
    forceWebglUnavailable: _forceWebglUnavailable,
    preserveDrawingBuffer: _preserveDrawingBuffer,
    rendererFactory: _rendererFactory,
    requestTimestampQuery,
    ...histogramOptions
  } = options;
  void _forceWebglUnavailable;
  void _preserveDrawingBuffer;
  void _rendererFactory;
  const aggregationProvider = new HistogramWebgpuAggregationProvider(
    aggregationBackend ?? 'auto',
  );
  const plot = createHistogramEngine(hostElement, histogramOptions, {
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
  return Object.assign(plot, {
    getWebgpuDiagnostics: () => {
      const aggregation = aggregationProvider.getDiagnostics();
      return {
        ...activeRenderer.getDiagnostics(),
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
  });
}

export const createHistogramPlot = createHistogramWebgpuPlot;
