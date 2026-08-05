import {
  createParallelEngine,
} from '../../m-parallel/engine/createParallelEngine.js';
import {
  ParallelCanvasHoverRenderer,
  ParallelWebgpuRenderer,
} from '../core/index.js';
import type {
  ParallelWebgpuPlotInstance,
  ParallelWebgpuPlotOptions,
} from './types.js';

export function createParallelWebgpuPlot(
  hostElement: HTMLElement,
  options: ParallelWebgpuPlotOptions,
): ParallelWebgpuPlotInstance {
  let renderer: ParallelWebgpuRenderer | null = null;
  const {
    aggregationBackend,
    binResolution,
    directSegmentLimit,
    renderMode,
    rendererFactory: _rendererFactory,
    representativeRecordLimit,
    requestTimestampQuery,
    ...parallelOptions
  } = options;
  void _rendererFactory;

  const plot = createParallelEngine(hostElement, {
    ...parallelOptions,
    baseCanvasClassName:
      options.baseCanvasClassName ??
      'parallel-fast-webgpu-canvas parallel-fast-webgpu-canvas-base',
    baseCanvasLabel:
      options.baseCanvasLabel ??
      'WebGPU high-performance parallel coordinate density canvas',
    baseCanvasRenderer: 'webgpu-parallel-density',
    deferSelectionUntilRenderer: true,
    hoverCanvasClassName:
      options.hoverCanvasClassName ??
      'parallel-fast-webgpu-canvas parallel-fast-hover-canvas',
    hoverVisualMode: 'canvas2d-hover-overlay',
    rendererKind: 'webgpu-parallel-density',
    skipWebglContextLifecycle: true,
    rendererFactory(canvas, buffers, rendererOptions, engineLifecycle) {
      const nextRenderer = new ParallelWebgpuRenderer(canvas, buffers, {
        aggregationBackend,
        binResolution,
        directSegmentLimit,
        lifecycle: {
          onContextLost: (info) => {
            engineLifecycle.onContextLost(JSON.stringify({
              backend: 'webgpu',
              message: info.message,
              reason: info.reason,
            }));
          },
          onError: engineLifecycle.onError,
          onContextRestored: () => {
            engineLifecycle.onContextRestored(JSON.stringify({
              backend: 'webgpu',
            }));
          },
        },
        lineOpacityScale: rendererOptions.lineOpacityScale,
        onMetrics: engineLifecycle.onMetrics,
        renderMode,
        representativeRecordLimit,
        requestTimestampQuery,
        theme: rendererOptions.theme,
      });
      renderer = nextRenderer;
      return nextRenderer;
    },
    hoverRendererFactory(canvas, buffers, rendererOptions) {
      return new ParallelCanvasHoverRenderer(canvas, buffers, rendererOptions);
    },
  });
  if (renderer === null) {
    plot.dispose();
    throw new Error('The WebGPU parallel renderer was not created.');
  }
  const initialRenderer: ParallelWebgpuRenderer = renderer;
  return Object.assign(plot, {
    getWebgpuDiagnostics: () =>
      (renderer ?? initialRenderer).getDiagnostics(),
    interactive: initialRenderer.interactive,
    ready: initialRenderer.ready,
  });
}

export const createParallelFastWebgpuPlot = createParallelWebgpuPlot;
export const createParallelFastPlot = createParallelWebgpuPlot;
export const createParallelPlot = createParallelWebgpuPlot;
