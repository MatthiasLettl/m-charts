import { createFastScatterEngine } from '../../m-scatter/engine/createScatterEngine.js';
import { FastScatterWebgpuRenderer } from '../core/index.js';
import type {
  FastScatterWebgpuPlotInstance,
  FastScatterWebgpuPlotOptions,
} from './types.js';

export function createFastScatterWebgpuPlot(
  hostElement: HTMLElement,
  options: FastScatterWebgpuPlotOptions,
): FastScatterWebgpuPlotInstance {
  let renderer: FastScatterWebgpuRenderer | null = null;
  const {
    aggregationBackend,
    forceWebglUnavailable: _forceWebglUnavailable,
    indexedStyle,
    packedStyles,
    pointCapacity,
    preserveDrawingBuffer: _preserveDrawingBuffer,
    requestTimestampQuery,
    rendererFactory: _rendererFactory,
    ...scatterOptions
  } = options;
  void _forceWebglUnavailable;
  void _preserveDrawingBuffer;
  void _rendererFactory;
  const plot = createFastScatterEngine(hostElement, {
    ...scatterOptions,
    visualizationMode: scatterOptions.visualizationMode ?? 'points',
  }, {
    asynchronousReady: true,
    canvasClassName: 'scatter-fast-engine-canvas scatter-fast-webgpu-canvas',
    canvasLabel: 'WebGPU high-performance scatter canvas',
    canvasRenderer: `webgpu-${scatterOptions.visualizationMode ?? 'points'}`,
    createRenderer(rendererOptions, _plotOptions, lifecycle) {
      const nextRenderer = new FastScatterWebgpuRenderer({
        ...rendererOptions,
        aggregationBackend,
        indexedStyle,
        lifecycle: {
          onContextLost: (info) => lifecycle.onContextLost(JSON.stringify({
            backend: 'webgpu',
            message: info.message,
            reason: info.reason,
          })),
          onContextRestored: () => lifecycle.onContextRestored(JSON.stringify({
            backend: 'webgpu',
          })),
          onError: (error) => lifecycle.onError(error),
        },
        packedStyles,
        pointCapacity,
        requestTimestampQuery,
      });
      renderer = nextRenderer;
      void nextRenderer.interactive.then(
        () => lifecycle.onReady(),
        (error: unknown) => lifecycle.onError(error),
      );
      return nextRenderer;
    },
    hostClassName: 'scatter-fast-engine-host scatter-fast-webgpu-host',
    setupErrorMessage: 'Unknown scatter WebGPU renderer setup error.',
  });

  if (renderer === null) {
    plot.dispose();
    throw new Error('The WebGPU scatter renderer was not created.');
  }
  const activeRenderer: FastScatterWebgpuRenderer = renderer;
  return Object.assign(plot, {
    getWebgpuDiagnostics: () => activeRenderer.getDiagnostics(),
    interactive: activeRenderer.interactive,
    ready: activeRenderer.ready,
  });
}

export const createScatterWebgpuPlot = createFastScatterWebgpuPlot;
export const createFastScatterPlot = createFastScatterWebgpuPlot;
export const createScatterPlot = createFastScatterWebgpuPlot;
