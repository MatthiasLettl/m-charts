import {
  createWebGlContextLifecycle,
} from '../../plot-engine/core/index.js';
import {
  ParallelWebgl2HoverOverlayRenderer,
  ParallelWebgl2SegmentRenderer,
} from '../core/index.js';
import { createParallelEngine } from './createParallelEngine.js';
import type {
  ParallelFastPlotInstance,
  ParallelFastPlotOptions,
} from './types.js';

const WEBGL_UNAVAILABLE_MESSAGE =
  'WebGL2 is unavailable in this browser. Use a browser or device with WebGL2 enabled.';

export function createParallelFastPlot(
  hostElement: HTMLElement,
  options: ParallelFastPlotOptions,
): ParallelFastPlotInstance {
  return createParallelEngine(
    hostElement,
    {
      ...options,
      baseCanvasClassName:
        options.baseCanvasClassName ??
        'parallel-fast-webgl-canvas parallel-fast-webgl-canvas-base',
      baseCanvasLabel:
        options.baseCanvasLabel ??
        'WebGL2 parallel coordinate segment canvas',
      baseCanvasRenderer: options.baseCanvasRenderer ?? 'webgl2-segments',
      hoverCanvasClassName:
        options.hoverCanvasClassName ??
        'parallel-fast-webgl-canvas parallel-fast-webgl-hover-canvas',
      hoverVisualMode:
        options.hoverVisualMode ?? 'webgl2-hover-overlay-canvas',
      rendererKind: options.rendererKind ?? 'webgl2-segments',
    },
    {
      attachContextLifecycle(canvas, callbacks) {
        return createWebGlContextLifecycle(canvas, {
          onLost: callbacks.onLost,
          onRestored: callbacks.onRestored,
          preventDefaultOnLost: true,
        });
      },
      hoverRendererFactory(canvas, buffers, rendererOptions) {
        return new ParallelWebgl2HoverOverlayRenderer(
          canvas,
          buffers,
          rendererOptions,
        );
      },
      rendererFactory(canvas, buffers, rendererOptions) {
        if (options.forceWebglUnavailable) {
          throw new Error(WEBGL_UNAVAILABLE_MESSAGE);
        }
        return new ParallelWebgl2SegmentRenderer(
          canvas,
          buffers,
          rendererOptions,
        );
      },
    },
  );
}

export const createParallelPlot = createParallelFastPlot;
