import { useEffect, useRef, useState } from 'react';
import {
  createDefaultScatterBindings,
  type FastScatterViewport,
  type FastScatterOverlayDescriptor,
} from 'm-charts/m-scatter';
import {
  createDefaultHistogramBindings,
  createDefaultHistogramViewport,
  type HistogramOverlayDescriptor,
  type HistogramViewport,
} from 'm-charts/m-histogram';
import {
  createDefaultParallelBindings,
  createParallelDomBrushHitTest,
  type ParallelAxisViewports,
  PARALLEL_AXIS_MIN_DISPLAY_VALUE,
  PARALLEL_AXIS_MAX_DISPLAY_VALUE,
} from 'm-charts/m-parallel';
import { createScatterWebgpuPlot } from 'm-charts/m-scatter-webgpu';
import { createHistogramWebgpuPlot } from 'm-charts/m-histogram-webgpu';
import { createParallelWebgpuPlot } from 'm-charts/m-parallel-webgpu';
import { createSensorParallelBuffers } from './parallelModel.ts';
import { useThemeMode } from '../../theme/ThemeModeProvider.tsx';
import {
  DIMENSIONS,
  createSensorXOrder,
  SENSOR_COLORS,
  type Dimension,
  type Ranges,
  type SensorReading,
  type ViewId,
} from './sensorModel.ts';

interface ChartProps {
  kind: ViewId;
  wheelZoom: boolean;
  tool: 'zoom' | 'select' | 'inspect';
  suspended: boolean;
  zoomReset: number;
  settingsReset: number;
  onEvent: (source: string, name: string, detail: string) => void;
  ownSelection?: ReadonlySet<number>;
  onSelection: (view: ViewId, indices: Uint32Array | null) => void;
  readings: readonly SensorReading[];
  selected: Uint32Array;
  ranges?: Ranges;
  filtered: boolean;
  onBrush: (view: ViewId, ranges: Ranges, event: string) => void;
  onMetrics: (view: ViewId, duration: number) => void;
}
interface Axes {
  x: number;
  y: number;
  width: number;
  height: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}
const XY: Record<'timeline' | 'scatter' | 'density', [Dimension, Dimension]> = {
  timeline: ['time', 'temperature'],
  scatter: ['temperature', 'pressure'],
  density: ['vibration', 'pressure'],
};
function domain(key: Dimension) {
  return key === 'time'
    ? { min: 0, max: 120 }
    : DIMENSIONS.find((dimension) => dimension.key === key)!;
}
const EMPTY_RANGES: Ranges = {};
type ExplorerOverlay =
  | FastScatterOverlayDescriptor
  | HistogramOverlayDescriptor;
/** Thin lifecycle adapter: events go out, application-owned selections come in. */
export function ExplorerChart({
  kind,
  wheelZoom,
  tool,
  suspended,
  zoomReset,
  settingsReset,
  onEvent,
  ownSelection,
  onSelection,
  readings,
  selected,
  ranges = EMPTY_RANGES,
  filtered,
  onBrush,
  onMetrics,
}: ChartProps) {
  const resetSettingsRef = useRef<(() => void) | null>(null);
  const bindRef = useRef<
    ((tool: 'zoom' | 'select' | 'inspect', suspended: boolean) => void) | null
  >(null);
  const dataUpdateRef = useRef<
    ((rows: readonly SensorReading[]) => void) | null
  >(null);
  const resetZoomRef = useRef<(() => void) | null>(null);
  const readingsRef = useRef(readings);
  const empty = readings.length === 0;
  const scatterViewportRef = useRef<FastScatterViewport | null>(null);
  const histogramUserZoomRef = useRef(false);
  const histogramViewportRef = useRef<HistogramViewport | null>(null);
  const parallelViewportRef = useRef<ParallelAxisViewports>({});
  const ownSelectionRef = useRef(ownSelection);
  const [hover, setHover] = useState<string | null>(null);
  const [parallelViewports, setParallelViewports] = useState<Ranges>({});
  const [parallelPreview, setParallelPreview] = useState<Ranges | null>(null);
  const [overlays, setOverlays] = useState<readonly ExplorerOverlay[]>([]);
  const hostRef = useRef<HTMLDivElement>(null);
  const updateRef = useRef<
    ((indices: Uint32Array, ranges: Ranges) => void) | null
  >(null);
  const callbacks = useRef({ onBrush, onMetrics, onSelection, onEvent });
  const { themeMode } = useThemeMode();
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState<string>();
  const [axes, setAxes] = useState<Axes | null>(null);
  useEffect(() => {
    callbacks.current = { onBrush, onMetrics, onSelection, onEvent };
    ownSelectionRef.current = ownSelection;
  }, [onBrush, onMetrics, onSelection, onEvent, ownSelection]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || wheelZoom) return;
    const stopWheel = (event: WheelEvent) => {
      event.stopImmediatePropagation();
    };
    host.addEventListener('wheel', stopWheel, { capture: true });
    return () =>
      host.removeEventListener('wheel', stopWheel, { capture: true });
  }, [wheelZoom]);
  useEffect(() => {
    readingsRef.current = readings;
  }, [readings]);
  useEffect(() => {
    let rows = readingsRef.current;
    const host = hostRef.current;
    if (!host) return;
    setOverlays([]);
    setParallelPreview(null);
    if (rows.length === 0) {
      host.dataset.appliedSelectionCount = '0';
      return;
    }
    let alive = true;
    const dark = themeMode === 'dark';
    const background = (dark ? [0.059, 0.09, 0.14, 1] : [1, 1, 1, 1]) as [
      number,
      number,
      number,
      number,
    ];
    const highlight = [0.96, 0.63, 0.13, 0.85] as const;
    let ids = rows.map((row) => row.id);
    let color = new Uint8Array(rows.length * 4);
    rows.forEach((row, index) => {
      const rgb = Number.parseInt(SENSOR_COLORS[row.sensor].slice(1), 16);
      color.set(
        [
          rgb >> 16,
          (rgb >> 8) & 255,
          rgb & 255,
          rows.length > 120000 ? 70 : 175,
        ],
        index * 4,
      );
    });
    const values = (key: Dimension) =>
      Float32Array.from(rows, (row) => row[key]);
    let localLookup: Int32Array | undefined;
    const replaceRows = (next: readonly SensorReading[]) => {
      if (next === rows) return false;
      rows = next;
      localLookup = undefined;
      ids = rows.map((row) => row.id);
      color = new Uint8Array(rows.length * 4);
      rows.forEach((row, index) => {
        const rgb = Number.parseInt(SENSOR_COLORS[row.sensor].slice(1), 16);
        color.set(
          [
            rgb >> 16,
            (rgb >> 8) & 255,
            rgb & 255,
            rows.length > 120000 ? 70 : 175,
          ],
          index * 4,
        );
      });
      setHover(null);
      return true;
    };
    const localIndices = (global: Iterable<number>) => {
      const input =
        global instanceof Uint32Array ? global : Uint32Array.from(global);
      if (!input.length) return input;
      if (
        rows[0]?.sourceIndex === 0 &&
        rows.at(-1)?.sourceIndex === rows.length - 1
      )
        return input;
      if (!localLookup) {
        localLookup = new Int32Array((rows.at(-1)?.sourceIndex ?? 0) + 1).fill(
          -1,
        );
        rows.forEach((row, index) => {
          localLookup![row.sourceIndex] = index;
        });
      }
      const output = new Uint32Array(input.length);
      let count = 0;
      for (const id of input) {
        const index = localLookup[id];
        if (index !== undefined && index >= 0) output[count++] = index;
      }
      return output.subarray(0, count);
    };
    const report = (name: string, payload: unknown) =>
      callbacks.current.onEvent(kind, name, JSON.stringify(payload));
    const bindInspection = (plot: {
      commands: {
        hoverAtPoint(request: {
          pointerCssX: number;
          pointerCssY: number;
          source: 'shift-hover';
        }): unknown;
      };
    }) => {
      let frame = 0;
      const move = (event: PointerEvent) => {
        cancelAnimationFrame(frame);
        if (event.buttons) {
          setHover(null);
          return;
        }
        const rect = host.getBoundingClientRect();
        frame = requestAnimationFrame(() =>
          plot.commands.hoverAtPoint({
            pointerCssX: event.clientX - rect.left,
            pointerCssY: event.clientY - rect.top,
            source: 'shift-hover',
          }),
        );
      };
      const leave = () => {
        cancelAnimationFrame(frame);
        setHover(null);
      };
      host.addEventListener('pointermove', move);
      host.addEventListener('pointerup', move);
      host.addEventListener('pointerleave', leave);
      return {
        dispose() {
          leave();
          host.removeEventListener('pointermove', move);
          host.removeEventListener('pointerup', move);
          host.removeEventListener('pointerleave', leave);
        },
      };
    };
    const renderState = ({
      state,
      message: detail,
    }: {
      state: string;
      message?: string;
    }) => {
      if (alive) {
        setStatus(state);
        setMessage(detail);
      }
    };
    const unsubscribers: (() => void)[] = [];
    let dispose: () => void;
    let binding: { dispose(): void } | undefined;
    let publishing = false;
    const describeRow = (row?: SensorReading) =>
      row
        ? `${row.id} · ${row.temperature.toFixed(1)} °C · ${row.pressure.toFixed(1)} kPa · ${row.vibration.toFixed(2)} mm/s`
        : null;
    const observeReady = (plot: {
      ready: Promise<void>;
      getWebgpuDiagnostics(): unknown;
    }) => {
      void plot.ready
        .then(() => {
          if (alive)
            host.dataset.webgpuDiagnostics = JSON.stringify(
              plot.getWebgpuDiagnostics(),
            );
        })
        .catch((error: unknown) =>
          renderState({ state: 'error', message: String(error) }),
        );
    };
    let refreshAxes = () => {};

    if (kind === 'parallel') {
      const buffers = createSensorParallelBuffers(rows, color);
      host.dataset.axisDomains = JSON.stringify(buffers.domainsByAxis);
      const plot = createParallelWebgpuPlot(host, {
        aggregationBackend: 'rust-wasm',
        axisViewports: parallelViewportRef.current,
        buffers,
        selectedVisualUpdateDelayMs: 0,
        lineOpacityScale: Math.max(0.006, (0.6 * 12000) / rows.length),
        theme: {
          backgroundColor: background,
          lineColor: [0.09, 0.54, 0.52, 0.035],
          selectedColor: highlight,
          preselectedColor: highlight,
        },
        onMetrics: (event) => {
          if (event.rendererRedrawMs != null)
            callbacks.current.onMetrics(kind, event.rendererRedrawMs);
        },
      });
      dataUpdateRef.current = (next) => {
        if (!replaceRows(next)) return;
        publishing = true;
        plot.update({
          buffers: createSensorParallelBuffers(rows, color),
          lineOpacityScale: Math.max(0.006, (0.6 * 12000) / rows.length),
        });
        publishing = false;
        report('plot.update', {
          buffers: rows.length,
          axisViewports: parallelViewportRef.current,
        });
      };
      resetZoomRef.current = () => plot.commands.resetAxisViewports();
      bindRef.current = (activeTool, suspended) => {
        binding?.dispose();
        if (suspended) return;
        binding = plot.use(
          createDefaultParallelBindings({
            inputElement: host,
            coordinateTarget: host,
            keyboardTarget: host,
            brushHitTest: createParallelDomBrushHitTest({
              axisGuideSelector: '.sci-axis-guide',
            }),
            inspection: {
              smallDatasetFallbackRecordLimit: 20_000,
              explicitHoverModeActive: () => true,
            },
            axisBrushGestures:
              activeTool === 'select'
                ? [{ button: 0, defaultAction: 'none', modifiers: {} }]
                : [],
          }),
        );
      };
      unsubscribers.push(
        plot.on('brushpreview', (event) => {
          setParallelPreview(
            event.defaultAction === 'none' &&
              event.target.axis &&
              event.range?.value
              ? {
                  ...plot.commands.getStateSnapshot().brush.brushIntervals,
                  [event.target.axis]: [event.range.value],
                }
              : (event.brushIntervals as Ranges),
          );
        }),
        plot.on('brushcommit', (event) => {
          setParallelPreview(null);
          if (
            publishing ||
            (event.source !== 'pointer' && event.source !== 'keyboard')
          )
            return;
          const next =
            event.defaultAction === 'none' &&
            event.target.axis &&
            event.range?.value
              ? {
                  ...plot.commands.getStateSnapshot().brush.brushIntervals,
                  [event.target.axis]: [event.range.value],
                }
              : event.brushIntervals;
          callbacks.current.onBrush(kind, next as Ranges, 'brushcommit');
        }),
        plot.on('axisviewportchange', (event) => {
          if (event.phase === 'commit')
            report('axisviewportchange', event.axisViewports);
          parallelViewportRef.current = event.axisViewports;
          setParallelViewports(
            Object.fromEntries(
              Object.entries(event.axisViewports).map(([key, value]) => [
                key,
                value ? [value] : undefined,
              ]),
            ),
          );
        }),
        plot.on('inspectionchange', (event) =>
          setHover(
            describeRow(
              event.inspection ? rows[event.inspection.recordIndex] : undefined,
            ),
          ),
        ),
        plot.on('renderstatechange', (event) => {
          renderState(event);
          if (event.state === 'ready')
            setParallelViewports(
              Object.fromEntries(
                Object.entries(parallelViewportRef.current).map(
                  ([key, value]) => [key, value ? [value] : undefined],
                ),
              ),
            );
        }),
      );
      updateRef.current = (indices, nextRanges) => {
        publishing = true;
        // Parallel buffers use local row indices; translate the shared experiment IDs.
        plot.update({ brushIntervals: nextRanges });
        plot.update({ selectedSourceIndices: localIndices(indices) });
        host.dataset.appliedSelectionCount = String(
          plot.commands.getStateSnapshot().selectedSourceIndices.length,
        );
        publishing = false;
        report('plot.update', {
          selectedSourceIndices: indices.length,
          sample: Array.from(indices.slice(0, 5)),
        });
      };
      renderState({
        state: plot.commands.getRenderSnapshot().renderState,
        message: plot.commands.getRenderSnapshot().renderStateMessage,
      });
      observeReady(plot);
      dispose = () => plot.dispose();
    } else if (kind === 'histogram') {
      // WASM membership uses dense row indices. Keep experiment IDs at the
      // application boundary so isolated subsets retain their original identity.
      const toLocalIndices = localIndices;
      const histogramColumns = () => ({
        ids,
        sourceIndex: Uint32Array.from(rows, (_, index) => index),
        // Histogram WASM color stacks take packed RRGGBBAA values per row.
        color: Uint32Array.from(
          rows,
          (row) =>
            ((Number.parseInt(SENSOR_COLORS[row.sensor].slice(1), 16) << 8) |
              190) >>>
            0,
        ),
        colorFormat: 'rgba32' as const,
        valuesByParameter: { temperature: values('temperature') },
      });
      const plot = createHistogramWebgpuPlot(host, {
        aggregationBackend: 'rust-wasm',
        columns: histogramColumns(),
        spec: {
          mode: 'histogram',
          parameters: [
            {
              key: 'temperature',
              label: 'Temperature',
              kind: 'numeric',
              unit: '°C',
              domain: domain('temperature'),
            },
          ],
          subplots: [
            {
              id: 'temperature',
              label: 'Temperature',
              parameterKey: 'temperature',
            },
          ],
        },
        binSizes: [
          {
            mode: 'continuous',
            binSize: 0.75,
            parameterKey: 'temperature',
            subplotId: 'temperature',
          },
        ],
        mode: 'select',
        axisMode: 'x',
        theme: {
          backgroundColor: background,
          subplotBackgroundColor: background,
          defaultBarColor: [0.09, 0.54, 0.52, 0.8],
          selectedOverlayColor: highlight,
          gridLineColor: [0.5, 0.55, 0.6, 0.12],
        },
        onMetrics: (event) => {
          if (event.phase === 'render' && event.durationMs != null)
            callbacks.current.onMetrics(kind, event.durationMs);
        },
      });
      if (histogramViewportRef.current)
        plot.commands.setViewport(histogramViewportRef.current, 'programmatic');

      resetSettingsRef.current = () => {
        const current = plot.commands.getStateSnapshot().binSizes[0];
        if (current?.mode === 'continuous' && current.binSize !== 0.75)
          plot.update({ binSizes: [{ ...current, binSize: 0.75 }] });
        setHover(null);
      };
      dataUpdateRef.current = (next) => {
        if (!replaceRows(next)) return;
        publishing = true;
        plot.update({ columns: histogramColumns() });
        if (!histogramUserZoomRef.current) fitHistogram();
        publishing = false;
        report('plot.update', { columns: rows.length });
      };
      const fitHistogram = () => {
        const current = plot.commands.getStateSnapshot();
        const fitted = createDefaultHistogramViewport(current.aggregation);
        const next = fitted.subplotById.temperature;
        const previous = current.viewport.subplotById.temperature;
        if (next && previous && next.y.max !== previous.y.max)
          plot.commands.setViewport(
            {
              ...current.viewport,
              subplotById: {
                ...current.viewport.subplotById,
                temperature: { ...previous, y: next.y },
              },
            },
            'programmatic',
          );
      };
      resetZoomRef.current = () => {
        histogramUserZoomRef.current = false;
        plot.commands.setViewport(
          createDefaultHistogramViewport(
            plot.commands.getStateSnapshot().aggregation,
          ),
          'programmatic',
        );
        history.clear();
      };
      bindRef.current = (activeTool, suspended) => {
        binding?.dispose();
        if (suspended) return;
        if (activeTool === 'inspect') {
          binding = bindInspection(plot);
          return;
        }
        const gestures = plot.use(
          createDefaultHistogramBindings({
            inputElement: host,
            suppressContextMenu: true,
            rectangleBrushGestures:
              activeTool === 'select'
                ? [
                    {
                      button: 0,
                      defaultAction: 'none',
                      axisMode: 'x',
                      modifiers: {},
                    },
                  ]
                : [],
          }),
        );
        const inspection = bindInspection(plot);
        binding = {
          dispose() {
            gestures.dispose();
            inspection.dispose();
          },
        };
      };
      const prepareSelection = (event: PointerEvent) => {
        host.focus({ preventScroll: true });
        if (event.button === 2 && !event.shiftKey) {
          publishing = true;
          plot.update({
            selectedSourceIndices: toLocalIndices(
              ownSelectionRef.current ?? [],
            ),
          });
          publishing = false;
        }
      };
      host.addEventListener('pointerdown', prepareSelection, true);
      unsubscribers.push(() =>
        host.removeEventListener('pointerdown', prepareSelection, true),
      );
      const history = createViewportHistory(
        plot.commands.getStateSnapshot().viewport,
        (viewport) => plot.commands.setViewport(viewport, 'programmatic'),
      );
      refreshAxes = () => {
        if (!alive) return;
        const snapshot = plot.commands.getStateSnapshot();
        const rect = snapshot.render.layout.plotRects[0];
        host.dataset.viewport = JSON.stringify(snapshot.viewport);
        const viewport = snapshot.viewport.subplotById.temperature;
        if (rect && viewport)
          setAxes({
            x: rect.xCssPx,
            y: rect.yCssPx,
            width: rect.widthCssPx,
            height: rect.heightCssPx,
            xMin: viewport.x.min,
            xMax: viewport.x.max,
            yMin: viewport.y.min,
            yMax: viewport.y.max,
          });
      };
      unsubscribers.push(
        plot.on('brushcommit', (event) => {
          if (event.defaultAction !== 'none') return;
          const range = event.range?.value ?? event.range?.x;
          if (range)
            callbacks.current.onBrush(
              kind,
              { temperature: [range] },
              'brushcommit',
            );
        }),
        plot.on('overlaychange', ({ overlays }) => setOverlays(overlays)),
        plot.on('selectionchange', (event) => {
          if (publishing) return;
          // WebGPU bins defer membership until an application needs exact IDs.
          const selection = event.sourceIndicesAvailable
            ? event
            : plot.commands.materializeSelectionSourceIndices();
          if (!selection?.sourceIndicesAvailable) return;
          callbacks.current.onSelection(
            kind,
            selection.tool === 'programmatic' &&
              selection.sourceIndices.length === 0
              ? null
              : Uint32Array.from(
                  selection.sourceIndices,
                  (index) => rows[index].sourceIndex,
                ),
          );
        }),
        plot.on('binsizeadjustrequest', (event) => {
          const current = plot.commands.getStateSnapshot().binSizes[0];
          if (current?.mode !== 'continuous') return;
          const binSize = Math.max(
            0.15,
            Math.min(4, current.binSize * (event.delta > 0 ? 1.2 : 1 / 1.2)),
          );
          plot.update({ binSizes: [{ ...current, binSize }] });
          plot.commands.render();
        }),
        plot.on('hoverchange', (event) =>
          setHover(
            event
              ? `${event.bin.count.toLocaleString()} readings · ${event.bin.bin.min?.toFixed(1)}–${event.bin.bin.max?.toFixed(1)} °C`
              : null,
          ),
        ),
        plot.on('renderstatechange', (event) => {
          if (event.state === 'ready' && !histogramUserZoomRef.current)
            fitHistogram();
          renderState(event);
          refreshAxes();
        }),
        plot.on('viewportchange', (event) => {
          histogramViewportRef.current = event.viewport;
          if (event.reason !== 'programmatic')
            histogramUserZoomRef.current = true;
          if (event.phase === 'commit')
            report('viewportchange', event.viewport);
          history.changed(event.viewport, event.phase);
          refreshAxes();
        }),
        plot.on('viewportundorequest', history.undo),
      );
      updateRef.current = (indices) => {
        publishing = true;
        plot.commands.clearOverlays();
        plot.update({ selectedSourceIndices: toLocalIndices(indices) });
        plot.commands.render();
        host.dataset.appliedSelectionCount = String(
          plot.commands.getStateSnapshot().selectedSourceIndices.length,
        );
        publishing = false;
        report('plot.update', {
          selectedSourceIndices: indices.length,
          sample: Array.from(indices.slice(0, 5)),
        });
      };
      renderState({
        state: plot.commands.getRenderSnapshot().renderState,
        message: plot.commands.getRenderSnapshot().renderStateMessage,
      });
      observeReady(plot);
      dispose = () => plot.dispose();
    } else {
      const [xKey, yKey] = XY[kind];
      const viewport: FastScatterViewport = {
        x: domain(xKey),
        yByPlot: { [kind]: domain(yKey) },
      };
      const scatterColumns = () => ({
        ids,
        x: values(xKey),
        xOrder: createSensorXOrder(values(xKey)),
        xKey,
        y: { [yKey]: values(yKey) },
        sourceIndex: Uint32Array.from(rows, (_, index) => index),
        color,
        colorFormat: 'rgba8' as const,
        size: Float32Array.from(rows, (row) =>
          rows.length > 120000
            ? 1.8
            : kind === 'timeline'
              ? 3
              : Math.min(7, 3.6 + row.vibration * 0.7),
        ),
        shape: Uint8Array.from(rows, (row) =>
          kind === 'timeline' ? 0 : row.sensor,
        ),
      });
      const plot = createScatterWebgpuPlot(host, {
        aggregationBackend: 'rust-wasm',
        columns: scatterColumns(),
        spec: { xLabel: xKey, plots: [{ id: kind, label: yKey, yKey }] },
        viewport: scatterViewportRef.current ?? viewport,
        navigatorCssPx: 0,
        mode: 'select',
        axisMode: kind === 'timeline' ? 'x' : 'xy',
        visualizationMode: kind === 'density' ? 'heatmap' : 'points',
        heatmapBinSizePx: 14,
        heatmapPalette: 'viridis',
        theme: {
          backgroundColor: background,
          subplotBackgroundColor: background,
          defaultPointColor: [22, 139, 134, 190],
          selectedOverlayColor: highlight,
        },
        onMetrics: (event) => {
          if (event.phase === 'render' && event.durationMs != null)
            callbacks.current.onMetrics(kind, event.durationMs);
        },
      });
      dataUpdateRef.current = (next) => {
        if (!replaceRows(next)) return;
        publishing = true;
        plot.update({ columns: scatterColumns() });
        publishing = false;
        report('plot.update', { columns: rows.length });
      };
      resetSettingsRef.current = () => {
        const current = plot.commands.getStateSnapshot();
        if (
          (current.pointSizeScale ?? 1) !== 1 ||
          (current.heatmapBinSizePx ?? 14) !== 14
        )
          plot.update({ pointSizeScale: 1, heatmapBinSizePx: 14 });
        setHover(null);
      };
      resetZoomRef.current = () => {
        plot.commands.setViewport(viewport, 'programmatic');
        history.clear();
      };
      bindRef.current = (activeTool, suspended) => {
        binding?.dispose();
        if (suspended) return;
        if (activeTool === 'inspect') {
          binding = bindInspection(plot);
          return;
        }
        const gestures = plot.use(
          createDefaultScatterBindings({
            inputElement: host,
            easterEgg: false,
            suppressContextMenu: true,
            rectangleBrushGestures:
              activeTool === 'select'
                ? [
                    {
                      button: 0,
                      defaultAction: 'none',
                      axisMode: kind === 'timeline' ? 'x' : 'xy',
                      modifiers: {},
                    },
                  ]
                : [],
          }),
        );
        const inspection = bindInspection(plot);
        binding = {
          dispose() {
            gestures.dispose();
            inspection.dispose();
          },
        };
      };
      const prepareSelection = (event: PointerEvent) => {
        host.focus({ preventScroll: true });
        if (event.button === 2 && !event.shiftKey) {
          publishing = true;
          plot.update({
            selectedSourceIndices: localIndices(ownSelectionRef.current ?? []),
          });
          publishing = false;
        }
      };
      host.addEventListener('pointerdown', prepareSelection, true);
      unsubscribers.push(() =>
        host.removeEventListener('pointerdown', prepareSelection, true),
      );
      const history = createViewportHistory(
        plot.commands.getStateSnapshot().viewport,
        (viewport) => plot.commands.setViewport(viewport, 'programmatic'),
      );
      refreshAxes = () => {
        if (!alive) return;
        const rect = plot.commands.getPlotRectAtPoint(105, 13);
        host.dataset.plotRect = JSON.stringify(rect);
        const current = plot.commands.getStateSnapshot().viewport;
        host.dataset.viewport = JSON.stringify(current);
        if (rect)
          setAxes({
            x: rect.xCssPx,
            y: rect.yCssPx,
            width: rect.widthCssPx,
            height: rect.heightCssPx,
            xMin: current.x.min,
            xMax: current.x.max,
            yMin: current.yByPlot[kind].min,
            yMax: current.yByPlot[kind].max,
          });
      };
      unsubscribers.push(
        plot.on('brushcommit', (event) => {
          if (event.defaultAction !== 'none') return;
          if (event.range?.x)
            callbacks.current.onBrush(
              kind,
              {
                [xKey]: [event.range?.x],
                ...(kind !== 'timeline' && event.range?.y
                  ? { [yKey]: [event.range?.y] }
                  : {}),
              },
              'brushcommit',
            );
        }),
        plot.on('overlaychange', ({ overlays }) => setOverlays(overlays)),
        plot.on('selectionchange', (event) => {
          if (!publishing)
            callbacks.current.onSelection(
              kind,
              event.tool === 'programmatic' && event.sourceIndices.length === 0
                ? null
                : Uint32Array.from(
                    event.sourceIndices,
                    (index) => rows[index].sourceIndex,
                  ),
            );
        }),
        plot.on('pointsizeadjustrequest', ({ delta }) => {
          const size = plot.commands.getStateSnapshot().pointSizeScale ?? 1;
          plot.update({
            pointSizeScale: Math.max(0.25, Math.min(4, size + delta * 0.15)),
          });
        }),
        plot.on('heatmapbinsizeadjustrequest', ({ delta }) => {
          const size = plot.commands.getStateSnapshot().heatmapBinSizePx ?? 14;
          plot.update({
            heatmapBinSizePx: Math.max(4, Math.min(40, size + delta * 2)),
          });
        }),
        plot.on('hoverchange', (event) =>
          setHover(
            event?.aggregate
              ? `${event.aggregate.count.toLocaleString()} readings in this density cell`
              : describeRow(event ? rows[event.point.sourceIndex] : undefined),
          ),
        ),
        plot.on('renderstatechange', (event) => {
          renderState(event);
          refreshAxes();
        }),
        plot.on('viewportchange', (event) => {
          scatterViewportRef.current = event.viewport;
          if (event.phase === 'commit')
            report('viewportchange', event.viewport);
          history.changed(event.viewport, event.phase);
          refreshAxes();
        }),
        plot.on('viewportundorequest', history.undo),
      );
      updateRef.current = (indices) => {
        publishing = true;
        plot.commands.clearOverlays();
        plot.update({ selectedSourceIndices: localIndices(indices) });
        plot.commands.render();
        host.dataset.appliedSelectionCount = String(
          plot.commands.getStateSnapshot().selectedSourceIndices.length,
        );
        publishing = false;
        report('plot.update', {
          selectedSourceIndices: indices.length,
          sample: Array.from(indices.slice(0, 5)),
        });
      };
      renderState({
        state: plot.commands.getRenderSnapshot().renderState,
        message: plot.commands.getRenderSnapshot().renderStateMessage,
      });
      observeReady(plot);
      dispose = () => plot.dispose();
    }
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(refreshAxes);
    });
    observer.observe(host);
    refreshAxes();
    return () => {
      alive = false;
      observer.disconnect();
      binding?.dispose();
      bindRef.current = null;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      updateRef.current = null;
      dataUpdateRef.current = null;
      resetZoomRef.current = null;
      resetSettingsRef.current = null;
      dispose();
    };
  }, [kind, empty, themeMode]);

  useEffect(() => {
    dataUpdateRef.current?.(readings);
  }, [readings, themeMode, empty]);
  useEffect(() => {
    if (settingsReset > 0) resetSettingsRef.current?.();
  }, [settingsReset]);
  useEffect(() => {
    if (zoomReset > 0) {
      scatterViewportRef.current = null;
      histogramViewportRef.current = null;
      histogramUserZoomRef.current = false;
      parallelViewportRef.current = {};
      resetZoomRef.current?.();
      callbacks.current.onEvent(
        kind,
        'viewport.reset',
        'Reset this chart’s zoom; filters retained',
      );
    }
  }, [zoomReset, kind]);
  useEffect(() => {
    bindRef.current?.(tool, suspended);
  }, [tool, suspended, empty, themeMode]);

  useEffect(() => {
    updateRef.current?.(filtered ? selected : new Uint32Array(), ranges);
  }, [filtered, selected, ranges, readings, themeMode]);

  return (
    <div
      className={`sci-plot sci-plot-${kind}`}
      data-testid={`explorer-${kind}`}
      data-renderer="webgpu"
      data-render-state={readings.length ? status : 'empty'}
      data-record-count={readings.length}
      data-selected-count={selected.length}
    >
      <div
        ref={hostRef}
        style={{ position: 'absolute' }}
        className="sci-chart-host"
        aria-label={
          tool === 'inspect'
            ? `${kind} chart. Move over marks to inspect.`
            : `${kind} chart. Left-drag to ${tool}, right-drag to select, Hover for details.`
        }
        onPointerDown={() => hostRef.current?.focus({ preventScroll: true })}
        role="region"
        tabIndex={0}
      >
        {!empty &&
          status !== 'error' &&
          kind === 'parallel' &&
          DIMENSIONS.map((originalDimension, index) => {
            const viewport = parallelViewports[originalDimension.key]?.[0];
            const dimension = { ...originalDimension, ...(viewport ?? {}) };
            return (
              <div
                key={dimension.key}
                data-axis={dimension.key}
                data-domain-min={dimension.min}
                data-domain-max={dimension.max}
                className="sci-axis-guide"
                style={{ left: `${(index / (DIMENSIONS.length - 1)) * 100}%` }}
              >
                <span className="sci-axis-title">
                  {dimension.label}
                  <small>{dimension.unit}</small>
                </span>
                {[0, 0.5, 1].map((t) => (
                  <span
                    className="sci-parallel-tick"
                    key={t}
                    style={{
                      top: `${(1 - (PARALLEL_AXIS_MIN_DISPLAY_VALUE + t * (PARALLEL_AXIS_MAX_DISPLAY_VALUE - PARALLEL_AXIS_MIN_DISPLAY_VALUE))) * 100}%`,
                    }}
                  >
                    {(
                      dimension.min +
                      t * (dimension.max - dimension.min)
                    ).toFixed(0)}
                  </span>
                ))}
                {(parallelPreview ?? ranges)[dimension.key]?.map((range, i) => {
                  const scale = (value: number) =>
                    1 -
                    (PARALLEL_AXIS_MIN_DISPLAY_VALUE +
                      ((value - dimension.min) /
                        (dimension.max - dimension.min)) *
                        (PARALLEL_AXIS_MAX_DISPLAY_VALUE -
                          PARALLEL_AXIS_MIN_DISPLAY_VALUE));
                  return (
                    <span
                      key={i}
                      className="sci-parallel-brush parallel-fast-axis-brush"
                      data-axis-range-index={i}
                      style={{
                        top: `${scale(range.max) * 100}%`,
                        height: `${(scale(range.min) - scale(range.max)) * 100}%`,
                      }}
                    >
                      <span className="parallel-fast-axis-brush-band" />
                      <span className="parallel-fast-axis-brush-handle-max" />
                      <span className="parallel-fast-axis-brush-handle-min" />
                    </span>
                  );
                })}
              </div>
            );
          })}
      </div>
      {!empty && status !== 'error' && axes && kind !== 'parallel' && (
        <ChartAxes axes={axes} kind={kind} ranges={ranges} />
      )}
      {!empty && status !== 'error' && kind !== 'parallel' && (
        <InteractionOverlays overlays={overlays} />
      )}
      {!empty && status !== 'error' && hover && (
        <div className="sci-hover" role="status">
          {hover}
        </div>
      )}
      {readings.length === 0 && (
        <div className="sci-chart-empty">No readings match these filters.</div>
      )}
      {status === 'error' && readings.length > 0 && (
        <div className="sci-chart-empty" role="alert">
          Chart unavailable.{' '}
          {message ??
            'WebGPU is required; use a compatible browser with hardware acceleration.'}
        </div>
      )}
    </div>
  );
}

/** Render engine CSS-pixel descriptors, as the standalone reference routes do. */
function InteractionOverlays({
  overlays,
}: {
  overlays: readonly ExplorerOverlay[];
}) {
  return (
    <svg
      className="sci-interaction-overlays"
      width="100%"
      height="100%"
      aria-hidden="true"
    >
      {overlays.map((overlay) => {
        if (
          overlay.kind === 'rectangle-zoom' ||
          overlay.kind === 'rectangle-selection' ||
          overlay.kind === 'color-rule-brush'
        ) {
          return (
            <rect
              key={overlay.id}
              data-overlay-kind={overlay.kind}
              className={`sci-live-brush sci-live-${overlay.kind}`}
              x={overlay.rect.xCssPx}
              y={overlay.rect.yCssPx}
              width={overlay.rect.widthCssPx}
              height={overlay.rect.heightCssPx}
            />
          );
        }
        if (overlay.kind === 'lasso') {
          return (
            <polyline
              key={overlay.id}
              data-overlay-kind="lasso"
              className="sci-live-brush sci-live-lasso"
              points={overlay.points
                .map((point) => `${point.xCssPx},${point.yCssPx}`)
                .join(' ')}
            />
          );
        }
        if (overlay.kind === 'hover-guide') {
          return (
            <circle
              key={overlay.id}
              className="sci-inspection-anchor"
              cx={overlay.anchor.xCssPx}
              cy={overlay.anchor.yCssPx}
              r={4}
            />
          );
        }
        return null;
      })}
    </svg>
  );
}

function ChartAxes({
  axes: a,
  kind,
  ranges,
}: {
  axes: Axes;
  kind: Exclude<ViewId, 'parallel'>;
  ranges: Ranges;
}) {
  const [xKey, yKey] =
    kind === 'histogram' ? (['temperature', 'count'] as const) : XY[kind];
  const xRange = ranges[xKey]?.[0];
  const yRange = yKey === 'count' ? undefined : ranges[yKey]?.[0];
  const px = (v: number) => a.x + ((v - a.xMin) / (a.xMax - a.xMin)) * a.width;
  const py = (v: number) =>
    a.y + a.height - ((v - a.yMin) / (a.yMax - a.yMin)) * a.height;
  const label = (key: Dimension | 'count') =>
    key === 'time'
      ? 'Elapsed time · min'
      : key === 'count'
        ? 'Readings'
        : `${DIMENSIONS.find((d) => d.key === key)!.label} · ${DIMENSIONS.find((d) => d.key === key)!.unit}`;
  return (
    <svg
      className="sci-chart-axes"
      width="100%"
      height="100%"
      aria-hidden="true"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line
            x1={a.x}
            x2={a.x + a.width}
            y1={a.y + t * a.height}
            y2={a.y + t * a.height}
          />
          {(a.height >= 72 || t === 0 || t === 0.5 || t === 1) && (
            <text x={a.x - 10} y={a.y + t * a.height + 4} textAnchor="end">
              {(a.yMax - t * (a.yMax - a.yMin)).toFixed(
                kind === 'histogram' ? 0 : 1,
              )}
            </text>
          )}
          <text
            x={a.x + t * a.width}
            y={a.y + a.height + 21}
            textAnchor="middle"
          >
            {(a.xMin + t * (a.xMax - a.xMin)).toFixed(0)}
          </text>
        </g>
      ))}
      <text x={a.x + a.width / 2} y={a.y + a.height + 42} textAnchor="middle">
        {label(xKey)}
      </text>
      <text
        transform={`translate(23 ${a.y + a.height / 2}) rotate(-90)`}
        textAnchor="middle"
      >
        {label(yKey)}
      </text>
      {xRange && (
        <rect
          className="sci-committed-brush"
          x={Math.max(a.x, px(xRange.min))}
          y={yRange ? Math.max(a.y, py(yRange.max)) : a.y}
          width={Math.max(
            0,
            Math.min(a.x + a.width, px(xRange.max)) -
              Math.max(a.x, px(xRange.min)),
          )}
          height={
            yRange
              ? Math.max(
                  0,
                  Math.min(a.y + a.height, py(yRange.min)) -
                    Math.max(a.y, py(yRange.max)),
                )
              : a.height
          }
        />
      )}
    </svg>
  );
}

/** Viewport navigation is local; undo never changes the shared cohort. */
function createViewportHistory<T>(initial: T, apply: (viewport: T) => void) {
  const past: T[] = [];
  let committed = initial;
  let undoing = false;
  return {
    changed(viewport: T, phase: string) {
      if (
        phase !== 'commit' ||
        undoing ||
        JSON.stringify(viewport) === JSON.stringify(committed)
      )
        return;
      past.push(committed);
      if (past.length > 40) past.shift();
      committed = viewport;
    },
    clear() {
      past.length = 0;
    },
    undo() {
      const previous = past.pop();
      if (previous === undefined) return;
      undoing = true;
      committed = previous;
      apply(previous);
      undoing = false;
    },
  };
}
