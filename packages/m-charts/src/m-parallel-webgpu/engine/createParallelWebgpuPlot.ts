import { evaluateParallelClientView } from '../../m-parallel/core/index.js';
import {
  createParallelEngine,
} from '../../m-parallel/engine/createParallelEngine.js';
import type {
  ParallelBuffers,
  ParallelWebgpuPackedPage,
} from '../../m-parallel/core/index.js';
import {
  ParallelCanvasHoverRenderer,
  ParallelWebgpuRenderer,
} from '../core/index.js';
import type {
  ParallelWebgpuPlotInstance,
  ParallelWebgpuPlotOptions,
  ParallelWebgpuPlotUpdateOptions,
} from './types.js';

const streamedUpdateHandlers = new WeakMap<
  ParallelWebgpuPlotInstance,
  (options: ParallelWebgpuPlotUpdateOptions) => Promise<void>
>();
const streamedAppendHandlers = new WeakMap<
  ParallelWebgpuPlotInstance,
  (page: ParallelWebgpuPackedPage, buffers: ParallelBuffers) => Promise<void>
>();

/** @internal Streaming-adapter handoff for resident GPU page appends. */
export async function appendParallelWebgpuStreamPage(
  plot: ParallelWebgpuPlotInstance,
  page: ParallelWebgpuPackedPage,
  buffers: ParallelBuffers,
): Promise<void> {
  const append = streamedAppendHandlers.get(plot);
  if (append === undefined) {
    throw new Error('Parallel WebGPU plot does not accept streamed pages.');
  }
  await append(page, buffers);
}

/** @internal Streaming-adapter handoff; not part of the public plot contract. */
export async function updateParallelWebgpuStreamBuffers(
  plot: ParallelWebgpuPlotInstance,
  options: ParallelWebgpuPlotUpdateOptions,
): Promise<void> {
  const update = streamedUpdateHandlers.get(plot);
  if (update === undefined) {
    throw new Error('Parallel WebGPU plot does not accept streamed data.');
  }
  await update(options);
}

export function createParallelWebgpuPlot(
  hostElement: HTMLElement,
  options: ParallelWebgpuPlotOptions,
): ParallelWebgpuPlotInstance {
  let renderer: ParallelWebgpuRenderer | null = null;
  const {
    aggregationBackend,
    clientView,
    binResolution,
    directSegmentLimit,
    renderMode,
    rendererFactory: _rendererFactory,
    representativeRecordLimit,
    requestTimestampQuery,
    ...parallelOptions
  } = options;
  void _rendererFactory;

  const sourceBuffers = parallelOptions.buffers;
  let theme = parallelOptions.theme;
  const evaluate = () => clientView === undefined ? null : evaluateParallelClientView(
    clientView, sourceBuffers, theme?.lineColor.map((v) => Math.round(v * 255)),
  );
  let evaluation = evaluate();
  const plot = createParallelEngine(hostElement, {
    ...parallelOptions,
    buffers: evaluation?.buffers ?? sourceBuffers,
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
      return new ParallelCanvasHoverRenderer(canvas, buffers, rendererOptions,
        (target, indices, color) => renderer?.drawHoverGroup(target, indices, color) ?? false);
    },
  });
  if (renderer === null) {
    plot.dispose();
    throw new Error('The WebGPU parallel renderer was not created.');
  }
  const initialRenderer: ParallelWebgpuRenderer = renderer;
  const webgpuPlot = Object.assign(plot, {
    waitForGpuIdle: () => (renderer ?? initialRenderer).waitForGpuIdle(),
    getWebgpuDiagnostics: () =>
      ({ ...(renderer ?? initialRenderer).getDiagnostics(),
        clientView: evaluation === null ? undefined : { ...evaluation.metrics, ...(renderer ?? initialRenderer).getClientViewStatus(), revision: evaluation.revision, sourceStyleMode: evaluation.sourceStyleMode } }),
    interactive: initialRenderer.interactive,
    ready: initialRenderer.ready,
  });
  if (clientView !== undefined) plot.use(() => clientView.view.validateWith((next) => {
    if (next.metrics.rowCount !== sourceBuffers.recordCount) throw new TypeError('Client view must retain source row identities.');
    for (const key of sourceBuffers.axisOrder.map((key) => clientView.fieldByAxis?.[key] ?? key)) {
      if (!Object.hasOwn(next.fields, key)) throw new TypeError(`Cannot remove plotted client field "${key}" while a chart is attached.`);
    }
  }));
  const updatePlot = webgpuPlot.update.bind(webgpuPlot);
  if (clientView !== undefined) {
    const apply = (mutable: ParallelWebgpuPlotUpdateOptions = {}) => {
      evaluation = evaluate();
      const snapshot = plot.commands.getStateSnapshot();
      updatePlot({ brushIntervals: snapshot.brush.brushIntervals, axisViewports: snapshot.axisViewports,
        selectedSourceIndices: snapshot.selectedSourceIndices, inspection: null,
        ...mutable, buffers: evaluation!.buffers });
    };
    webgpuPlot.update = (next) => {
      if (next.buffers !== undefined && next.buffers !== sourceBuffers) throw new TypeError(
        'WebGPU parallel source buffers are immutable while clientView is attached; recreate the view and plot for a new dataset.',
      );
      const { buffers: _source, ...mutable } = next;
      void _source;
      if (next.theme !== undefined && next.theme !== theme) { theme = next.theme; apply(mutable); }
      else updatePlot(mutable);
    };
    plot.use(() => clientView.view.on('change', () => apply()));
  }
  streamedUpdateHandlers.set(webgpuPlot, async (updateOptions) => {
    if (clientView !== undefined) throw new TypeError('Streaming updates are unavailable while clientView is attached.');
    let stop: () => void = () => undefined;
    const rendered = new Promise<void>((resolve, reject) => {
      stop = webgpuPlot.on('renderstatechange', (event) => {
        if (event.state === 'ready') {
          stop();
          resolve();
        } else if (event.state === 'error') {
          stop();
          reject(new Error(event.message ?? 'Parallel WebGPU renderer failed.'));
        }
      });
    });
    try {
      updatePlot(updateOptions);
      const updatedRenderer = renderer;
      if (updatedRenderer !== null) await updatedRenderer.interactive;
      await rendered;
    } finally {
      stop();
    }
  });
  streamedAppendHandlers.set(webgpuPlot, async (page, buffers) => {
    if (clientView !== undefined) throw new TypeError('Streaming append is unavailable while clientView is attached.');
    const activeRenderer = renderer ?? initialRenderer;
    await activeRenderer.appendPackedPage(page, buffers);
  });
  return webgpuPlot;
}

export const createParallelFastWebgpuPlot = createParallelWebgpuPlot;
export const createParallelFastPlot = createParallelWebgpuPlot;
export const createParallelPlot = createParallelWebgpuPlot;
