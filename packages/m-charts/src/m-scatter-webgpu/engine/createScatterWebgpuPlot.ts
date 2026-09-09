import { createFastScatterEngine } from '../../m-scatter/engine/createScatterEngine.js';
import { evaluateFastScatterClientView } from '../../m-scatter/core/index.js';
import {
  FastScatterWebgpuRenderer,
  unpackFastScatterWebgpuStyleColumns,
} from '../core/index.js';
import type {
  FastScatterWebgpuPlotInstance,
  FastScatterWebgpuPlotOptions,
  FastScatterWebgpuPlotUpdateOptions,
} from './types.js';

export function createFastScatterWebgpuPlot(
  hostElement: HTMLElement,
  options: FastScatterWebgpuPlotOptions,
): FastScatterWebgpuPlotInstance {
  let renderer: FastScatterWebgpuRenderer | null = null;
  const {
    aggregationBackend,
    clientView,
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
  const sourceColumns = scatterOptions.columns;
  let currentTheme = scatterOptions.theme;
  let sourceHoverIndex = scatterOptions.hoverIndex;
  const expandedPackedStyles = clientView !== undefined && packedStyles !== undefined &&
    'data' in packedStyles
    ? unpackFastScatterWebgpuStyleColumns(packedStyles, sourceColumns.x.length)
    : undefined;
  const indexedBase = clientView !== undefined && indexedStyle === true && packedStyles === undefined &&
    sourceColumns.color === undefined && sourceColumns.opacity === undefined && sourceColumns.rotation === undefined && sourceColumns.rotationRadians === undefined && sourceColumns.shape === undefined && sourceColumns.size === undefined
    ? createIndexedClientBase(sourceColumns.x.length) : undefined;
  const clientViewSourceColumns = indexedBase !== undefined ? { ...sourceColumns, ...indexedBase } : expandedPackedStyles !== undefined
    ? {
        ...sourceColumns,
        ...expandedPackedStyles,
      }
    : sourceColumns;
  let clientViewEvaluation = clientView === undefined
    ? null
    : evaluateFastScatterClientView(clientView, clientViewSourceColumns, currentTheme?.defaultPointColor);
  const effectiveHoverIndex = () => clientViewEvaluation !== null &&
    (clientViewEvaluation.transformedX || clientViewEvaluation.transformedYKeys.size > 0)
    ? undefined : sourceHoverIndex;
  const plot = createFastScatterEngine(hostElement, {
    ...scatterOptions,
    columns: clientViewEvaluation?.interactionColumns ?? sourceColumns,
    hoverIndex: effectiveHoverIndex(),
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
        dataDomain: _plotOptions.dataDomain,
        indexedStyle,
        initialClientView: clientViewEvaluation ?? undefined,
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
        sourceColumns,
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
  if (clientView !== undefined) plot.use(() => clientView.view.validateWith((next) => {
    if (next.metrics.rowCount !== sourceColumns.x.length) throw new TypeError('Client view must retain source row identities.');
    for (const key of Object.keys(sourceColumns.y).map((key) => clientView.yFieldByKey?.[key] ?? key).concat(clientView.xField ?? sourceColumns.xKey ?? 'x')) {
      if (!Object.hasOwn(next.fields, key)) throw new TypeError(`Cannot remove plotted client field "${key}" while a chart is attached.`);
    }
  }));
  const updatePlot = plot.update.bind(plot);
  const instance = Object.assign(plot, {
    getWebgpuDiagnostics: () => activeRenderer.getDiagnostics(),
    interactive: activeRenderer.interactive,
    ready: activeRenderer.ready,
    update(nextOptions: FastScatterWebgpuPlotUpdateOptions) {
      if (clientView === undefined) {
        updatePlot(nextOptions);
        return;
      }
      if (nextOptions.columns !== undefined && nextOptions.columns !== sourceColumns) {
        throw new TypeError(
          'WebGPU scatter source columns are immutable while clientView is attached; recreate the view and plot for a new dataset.',
        );
      }
      const { columns: _unchangedSourceColumns, ...mutableOptions } = nextOptions;
      void _unchangedSourceColumns;
      if (nextOptions.hoverIndex !== undefined) sourceHoverIndex = nextOptions.hoverIndex;
      if (nextOptions.theme !== undefined && nextOptions.theme !== currentTheme) {
        currentTheme = nextOptions.theme;
        const evaluation = evaluateFastScatterClientView(
          clientView, clientViewSourceColumns, currentTheme.defaultPointColor,
        );
        clientViewEvaluation = evaluation;
        updatePlot({ ...mutableOptions, columns: evaluation.interactionColumns, hoverIndex: effectiveHoverIndex() });
        void activeRenderer.applyClientView(evaluation);
      } else {
        updatePlot({ ...mutableOptions, hoverIndex: effectiveHoverIndex() });
      }
    },
  });
  if (clientView !== undefined) {
    const unsubscribe = clientView.view.on('change', () => {
      const nextEvaluation = evaluateFastScatterClientView(clientView, clientViewSourceColumns, currentTheme?.defaultPointColor);
      clientViewEvaluation = nextEvaluation;
      updatePlot({ columns: nextEvaluation.interactionColumns, hoverIndex: effectiveHoverIndex() });
      void activeRenderer.applyClientView(nextEvaluation);
    });
    instance.use(() => unsubscribe);
  }
  return instance;
}

export const createScatterWebgpuPlot = createFastScatterWebgpuPlot;
export const createFastScatterPlot = createFastScatterWebgpuPlot;
export const createScatterPlot = createFastScatterWebgpuPlot;

function createIndexedClientBase(count: number) {
  return {
    color: Uint32Array.from({ length: count }, (_, i) => (((35 + (i * 17) % 190) << 24) | ((55 + (i * 29) % 170) << 16) | ((75 + (i * 43) % 160) << 8) | 235) >>> 0),
    colorFormat: 'rgba32' as const,
    opacity: Float32Array.from({ length: count }, (_, i) => 0.36 + (i % 5) * 0.13),
    shape: Uint8Array.from({ length: count }, (_, i) => i % 5),
    rotation: Float32Array.from({ length: count }, (_, i) => (i % 360) / 180 * Math.PI),
    size: Float32Array.from({ length: count }, (_, i) => 2 + (i % 7) * 0.5),
  };
}
