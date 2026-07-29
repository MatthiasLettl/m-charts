import { createWebGlContextLifecycle } from '../../plot-engine/core/index.js';
import {
  HistogramWebglRenderer,
  buildHistogramAggregation,
  prepareHistogramAggregationState,
} from '../core/index.js';
import { createHistogramEngine } from './createHistogramEngine.js';
import type { HistogramPlotInstance, HistogramPlotOptions } from './types.js';

const WEBGL_UNAVAILABLE_MESSAGE =
  'WebGL2 is unavailable in this browser. Use a browser or device with WebGL2 enabled.';

export function createHistogramPlot(
  hostElement: HTMLElement,
  options: HistogramPlotOptions,
): HistogramPlotInstance {
  return createHistogramEngine(hostElement, options, {
    aggregationProvider: {
      build: buildHistogramAggregation,
      dispose: () => {},
      prepare: prepareHistogramAggregationState,
    },
    assertAvailable(currentOptions) {
      if (currentOptions.forceWebglUnavailable) {
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
    canvasClassName: 'histogram-fast-engine-canvas',
    canvasLabel: 'WebGL2 histogram canvas',
    canvasRenderer: 'webgl2-histogram',
    contextLostMessage: 'WebGL2 context lost; waiting for restore.',
    contextRestoreErrorMessage: 'Unknown histogram WebGL2 renderer restore error.',
    createRenderer(rendererOptions, currentOptions) {
      const rendererFactory =
        currentOptions.rendererFactory ??
        ((factoryOptions) => new HistogramWebglRenderer(factoryOptions));
      return rendererFactory({
        ...rendererOptions,
        preserveDrawingBuffer: currentOptions.preserveDrawingBuffer,
      });
    },
    hostClassName: 'histogram-fast-engine-host',
    setupErrorMessage: 'Unknown histogram WebGL2 renderer setup error.',
  });
}
