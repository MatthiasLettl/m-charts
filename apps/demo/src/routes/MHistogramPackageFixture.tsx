import { useEffect, useMemo, useRef, useState } from 'react';

import {
  getCommittedSelectionOverlayColor,
  getPlotTheme,
  rgbaToUnitTuple,
} from '../theme/plotTheme.ts';
import { useThemeMode } from '../theme/ThemeModeProvider.tsx';
import {
  type HistogramBinSizeState,
  type HistogramColumns,
  type HistogramPlotSpec,
  type HistogramPlotOptions,
  type HistogramRendererTheme,
  type HistogramSelectionEvent,
  type HistogramViewport,
} from 'm-charts/m-histogram';
import {
  createDefaultHistogramBindings,
  createHistogramPlot,
  type HistogramOverlayDescriptor,
  type HistogramPlotInstance,
  type HistogramRenderState,
} from 'm-charts/m-histogram';
import { createHistogramWebgpuPlot } from 'm-charts/m-histogram-webgpu';

export function MHistogramPackageFixture({
  rendererBackend = 'webgl2',
}: {
  rendererBackend?: 'webgl2' | 'webgpu';
} = {}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<HistogramPlotInstance | null>(null);
  const { themeMode } = useThemeMode();
  const { binSizes, columns, spec } = useMemo(() => createFixtureModel(), []);
  const initialSelectedSourceIndices = useMemo(() => new Uint32Array([2, 5, 8]), []);
  const histogramTheme = useMemo(
    () => createHistogramFixtureTheme(themeMode),
    [themeMode],
  );
  const [overlays, setOverlays] = useState<readonly HistogramOverlayDescriptor[]>([]);
  const [renderState, setRenderState] = useState<HistogramRenderState>('idle');
  const [selectedSourceIndices, setSelectedSourceIndices] = useState<
    Uint32Array<ArrayBufferLike>
  >(initialSelectedSourceIndices);
  const [viewport, setViewport] = useState<HistogramViewport | null>(null);
  const preserveDrawingBuffer = useMemo(
    () =>
      import.meta.env.DEV &&
      new URLSearchParams(window.location.search).has('__e2ePreserveDrawingBuffer'),
    [],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }

    const plotOptions: HistogramPlotOptions = {
      binSizes,
      canvasClassName: rendererBackend === 'webgpu'
        ? undefined
        : 'histogram-fast-webgl-canvas',
      columns,
      onSelectionChange(event: HistogramSelectionEvent) {
        setSelectedSourceIndices(event.sourceIndices);
      },
      onViewportChange(nextViewport) {
        setViewport(nextViewport);
      },
      overlayClassName: 'histogram-fast-engine-overlay',
      preserveDrawingBuffer,
      selectedSourceIndices: initialSelectedSourceIndices,
      spec,
      theme: histogramTheme,
    };
    const plot = rendererBackend === 'webgpu'
      ? createHistogramWebgpuPlot(host, plotOptions)
      : createHistogramPlot(host, plotOptions);
    plotRef.current = plot;
    plot.canvas.dataset.testid = rendererBackend === 'webgpu'
      ? 'histogram-fast-webgpu-fixture-canvas'
      : 'histogram-fast-fixture-canvas';
    plot.overlayElement.dataset.testid = 'histogram-fast-fixture-engine-overlay';
    plot.use(createDefaultHistogramBindings({ suppressContextMenu: true }));

    const subscriptions = [
      plot.on('renderstatechange', (event) => {
        setRenderState(event.state);
      }),
      plot.on('overlaychange', (event) => {
        setOverlays(event.overlays);
      }),
      plot.on('selectionchange', (event) => {
        setSelectedSourceIndices(event.sourceIndices);
      }),
      plot.on('viewportchange', (event) => {
        setViewport(event.viewport);
      }),
    ];
    const snapshot = plot.commands.getStateSnapshot();
    setRenderState(snapshot.render.renderState);
    setViewport(snapshot.viewport);
    plot.commands.render();

    return () => {
      for (const unsubscribe of subscriptions) {
        unsubscribe();
      }
      plotRef.current = null;
      plot.dispose();
    };
  }, [
    binSizes,
    columns,
    histogramTheme,
    initialSelectedSourceIndices,
    preserveDrawingBuffer,
    rendererBackend,
    spec,
  ]);

  useEffect(() => {
    plotRef.current?.update({
      selectedSourceIndices,
      theme: histogramTheme,
      viewport: viewport ?? undefined,
    });
    plotRef.current?.commands.render();
  }, [histogramTheme, selectedSourceIndices, viewport]);

  return (
    <main className="prototype-shell">
      <section className="workspace" aria-label="m-histogram package fixture">
        <div className="histogram-fast-chart-shell" data-testid="histogram-fast-fixture">
          <h1>m-histogram package fixture</h1>
          <div
            ref={hostRef}
            aria-label="m-histogram package fixture engine host"
            className="histogram-fast-webgl-host"
            data-overlay-count={overlays.length}
            data-record-count={columns.ids.length}
            data-render-state={renderState}
            data-renderer={`${rendererBackend}-histogram`}
            data-selected-count={selectedSourceIndices.length}
            data-testid="histogram-fast-fixture-host"
            style={{ height: '24rem' }}
          />
          <div
            aria-live="polite"
            className="histogram-fast-inspection-summary"
            data-overlay-count={overlays.length}
            data-render-state={renderState}
            data-selected-count={selectedSourceIndices.length}
            data-testid="histogram-fast-fixture-overlay-sink"
          >
            Overlay descriptors: {overlays.length}
          </div>
        </div>
      </section>
    </main>
  );
}

function createFixtureModel(): {
  binSizes: readonly HistogramBinSizeState[];
  columns: HistogramColumns;
  spec: HistogramPlotSpec;
} {
  const recordCount = 48;
  const ids = Array.from(
    { length: recordCount },
    (_, index) => `hist-fixture-${index + 1}`,
  );
  const latency = new Float32Array(recordCount);
  const throughput = new Float32Array(recordCount);
  const color = new Uint32Array(recordCount);
  const sourceIndex = new Uint32Array(recordCount);

  for (let index = 0; index < recordCount; index += 1) {
    const t = index / Math.max(1, recordCount - 1);
    latency[index] = 22 + Math.sin(t * Math.PI * 4) * 9 + (index % 6) * 2.5;
    throughput[index] = 80 + Math.cos(t * Math.PI * 3) * 18 + index * 0.7;
    color[index] = index % 3 === 0 ? 0x2563ebff : index % 3 === 1 ? 0x16a34aff : 0xd97706ff;
    sourceIndex[index] = index;
  }

  const spec: HistogramPlotSpec = {
    mode: 'histogram',
    parameters: [
      {
        domain: { max: 52, min: 10 },
        key: 'latency',
        kind: 'numeric',
        label: 'Latency',
        unit: 'ms',
      },
      {
        domain: { max: 122, min: 56 },
        key: 'throughput',
        kind: 'numeric',
        label: 'Throughput',
        unit: 'req/s',
      },
    ],
    subplots: [
      { id: 'latency', label: 'Latency', parameterKey: 'latency' },
      { id: 'throughput', label: 'Throughput', parameterKey: 'throughput' },
    ],
  };

  return {
    binSizes: [
      {
        binSize: 6,
        mode: 'continuous',
        parameterKey: 'latency',
        subplotId: 'latency',
      },
      {
        binSize: 8,
        mode: 'continuous',
        parameterKey: 'throughput',
        subplotId: 'throughput',
      },
    ],
    columns: {
      color,
      colorFormat: 'rgba32',
      ids,
      sourceIndex,
      valuesByParameter: {
        latency,
        throughput,
      },
    },
    spec,
  };
}

function createHistogramFixtureTheme(themeMode: 'light' | 'dark'): HistogramRendererTheme {
  const theme = getPlotTheme(themeMode);
  return {
    backgroundColor: rgbaToUnitTuple(theme.backgroundRgba),
    defaultBarColor: rgbaToUnitTuple(theme.lineRgba),
    gridLineColor: rgbaToUnitTuple(theme.gridMajorRgba),
    hoverOverlayColor: rgbaToUnitTuple(theme.preselectedRgba),
    selectedOverlayColor: getCommittedSelectionOverlayColor(themeMode),
    subplotBackgroundColor: rgbaToUnitTuple(theme.subplotBackgroundRgba),
  };
}
