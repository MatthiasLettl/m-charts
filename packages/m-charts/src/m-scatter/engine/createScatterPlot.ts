import { createWebGlContextLifecycle } from '../../plot-engine/core/index.js';
import { FastScatterWebglRenderer } from '../core/index.js';
import { createFastScatterEngine } from './createScatterEngine.js';
import type {
  FastScatterEngineOptions,
  FastScatterPlotInstance,
  FastScatterPlotOptions,
} from './types.js';

const WEBGL_UNAVAILABLE_MESSAGE =
  'WebGL2 is unavailable in this browser. Use a browser or device with WebGL2 enabled.';

export function createFastScatterPlot(
  hostElement: HTMLElement,
  options: FastScatterPlotOptions,
): FastScatterPlotInstance {
  return createFastScatterEngine(hostElement, options, {
    assertAvailable(currentOptions) {
      if ((currentOptions as FastScatterPlotOptions).forceWebglUnavailable) {
        throw new Error(WEBGL_UNAVAILABLE_MESSAGE);
      }
    },
    attachContextLifecycle(canvas, handlers) {
      return createWebGlContextLifecycle(canvas, {
        onLost: handlers.onLost,
        onRestored: handlers.onRestored,
        preventDefaultOnLost: true,
      });
    },
    canvasClassName: 'scatter-fast-engine-canvas',
    canvasLabel: 'WebGL2 scatter-fast point canvas',
    canvasRenderer: 'webgl2-points',
    contextLostMessage: 'WebGL2 context lost; waiting for restore.',
    contextRestoreErrorMessage: 'Unknown scatter-fast WebGL2 renderer restore error.',
    createRenderer(rendererOptions, currentOptions: FastScatterEngineOptions) {
      const webglOptions = currentOptions as FastScatterPlotOptions;
      const rendererFactory =
        webglOptions.rendererFactory ??
        ((factoryOptions) => new FastScatterWebglRenderer(factoryOptions));
      return rendererFactory({
        ...rendererOptions,
        preserveDrawingBuffer: webglOptions.preserveDrawingBuffer,
      });
    },
    hostClassName: 'scatter-fast-engine-host',
    setupErrorMessage: 'Unknown scatter-fast WebGL2 renderer setup error.',
  });
}
