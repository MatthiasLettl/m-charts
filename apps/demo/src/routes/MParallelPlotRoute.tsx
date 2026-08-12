import { useLocation, useSearchParams } from 'react-router-dom';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  createParallelBuffers,
  materializeParallelSelectedIds,
  normalizeParallelBrushIntervals,
  sampleParallelSelectedIdsFromSourceIndices,
  serializeParallelSelectedRecordsForExport,
  type ParallelActiveBrushInterval,
  type ParallelBrushIntervals,
  type ParallelBuffers,
} from '../data/parallelBuffers.ts';
import {
  FAST_ROUTE_TABLES_PARAM,
  MIXED_TABLE_FIXTURE_URL,
  formatFastRouteTableMode,
  parseFastRouteTableMode,
  type FastRouteTableMode,
} from '../data/fastRouteDataMode.ts';
import {
  loadFastPlotMixedTableFixture,
  loadScatterFastBenchmarkSource,
  resolveFastPlotFixtureUrl,
} from '../data/fastPlotTableSources.ts';
import {
  loadParallelDatasetWithMetrics,
} from '../data/loadDataset.ts';
import type { MixedTableFixture } from '../data/mixedTableFixtures.ts';
import { type NumericRange } from '../data/selection.ts';
import {
  type ParallelDataset,
  type ParallelParameter,
} from '../data/types.ts';
import {
  type ParallelFastInspectionState,
  type ParallelFastRendererKind,
  type ParallelFastRendererMetricsEvent,
  type ParallelFastRendererState,
} from 'm-charts/m-parallel';
import {
  createDefaultParallelBindings,
  createParallelDomBrushHitTest,
  createParallelPlot,
  type ParallelFastOverlayDescriptor,
  type ParallelFastOverlayKind,
  type ParallelLineOpacityAdjustment,
  type ParallelPlotCommands,
  type ParallelPlotInstance,
  type ParallelFastSelectionChangeEvent,
  type ParallelFastSelectionFilter,
} from 'm-charts/m-parallel';
import {
  PARALLEL_FAST_DEFAULT_LINE_OPACITY_SCALE,
  PARALLEL_ABOVE_VIEWPORT_DISPLAY_VALUE,
  PARALLEL_ABOVE_VIEWPORT_ROUTE_NORMALIZED_Y,
  PARALLEL_AXIS_MAX_DISPLAY_VALUE,
  PARALLEL_AXIS_MIN_DISPLAY_VALUE,
  PARALLEL_BELOW_VIEWPORT_DISPLAY_VALUE,
  PARALLEL_BELOW_VIEWPORT_ROUTE_NORMALIZED_Y,
  PARALLEL_MISSING_AXIS_DISPLAY_VALUE,
  PARALLEL_FAST_LINE_OPACITY_SCALE_PARAM,
  PARALLEL_FAST_SMALL_DISCRETE_TICK_LIMIT,
  createParallelFastAxisTicks,
  formatLineOpacityScaleParam,
  formatParallelFastAxisValue,
  formatParallelFastRecordAxisValue,
  createParallelHoverIndex,
  readParallelNormalizedValue,
  getNextLineOpacityScale,
  getPreviousLineOpacityScale,
  parallelRenderedNormalizedValueToDisplayValue,
  projectParallelViewportNormalizedValue,
  parseLineOpacityScaleSearchParam,
} from 'm-charts/m-parallel';
import type {
  ParallelFastAxisKind,
  ParallelFastAxisMetadata,
  ParallelFastAxisTick,
  ParallelHoverIndex,
} from 'm-charts/m-parallel';
import {
  isPlotInteractionGateActive,
  type PlotInteractionGateState,
} from '../state/viewSearchParams.ts';
import {
  parseParallelAxisViewportsSearchParams,
  serializeParallelAxisViewportsSearchParams,
} from '../state/parallelViewSearchParams.ts';
import { createThemeAwareTo } from '../state/themeMode.ts';
import { useThemeMode } from '../theme/ThemeModeProvider.tsx';
import { getParallelFastTheme } from '../theme/plotTheme.ts';
import {
  DemoSidebarHeader,
  InteractionCheatSheet,
} from './DemoRouteChrome.tsx';
import { adaptMixedTablesForParallelFast } from 'm-charts/m-parallel';
import { adaptScatterBenchmarkForParallelFast } from 'm-charts/m-parallel';
import type { LoadedScatterFastBenchmarkSource } from '../data/fastPlotTableSources.ts';
import {
  createParallelWebgpuPlot,
  createParallelWebgpuStreamingPlot,
  type ParallelAxisViewports,
  type ParallelWebgpuDiagnostics,
  type ParallelWebgpuPlotInstance,
  type ParallelWebgpuStreamProgress,
  type ParallelWebgpuStreamSource,
} from 'm-charts/m-parallel-webgpu';
import {
  LocalParallelWebgpuDatasetUnavailableError,
  loadParallelWebgpuDataset,
  type LoadedParallelWebgpuDataset,
} from '../data/parallelWebgpuDatasetAdapter.ts';
import { prepareParallelWebgpuDemoStream } from '../data/webgpuStreamingAdapters.ts';
import {
  SCATTER_WEBGPU_DEMO_POINT_COUNTS,
  deleteStoredScatterWebgpuDataset,
  generateAndStoreScatterWebgpuDataset,
} from '../data/scatterWebgpuDatasetStore.ts';

type ParallelFastDatasetLoadState =
  | { status: 'loading' }
  | { status: 'missing'; message?: string; pointCount: number }
  | {
      status: 'generating';
      completedPages: number;
      pageCount: number;
      pointCount: number;
    }
  | { status: 'error'; message: string }
  | {
      status: 'loaded';
      dataset:
        | LoadedParallelWebgpuDataset
        | LoadedScatterFastBenchmarkSource
        | MixedTableFixture
        | ParallelDataset;
      datasetKind:
        | 'legacy-parallel'
        | 'mixed-tables'
        | 'scatter-fast-benchmark'
        | 'webgpu-buffers';
      loadTimeMs: number;
    };

interface ParallelFastTableMetadata {
  tableCount: number;
  tableNames: readonly string[];
  tableRecordCounts: Readonly<Record<string, number>>;
}

type ParallelFastBufferState =
  | { status: 'idle' }
  | { status: 'building' }
  | { status: 'error'; message: string }
  | { status: 'ready'; buffers: ParallelBuffers };

interface ParallelFastDiagnostics {
  brushComputeMs: number | null;
  bufferBuildMs: number | null;
  datasetFetchMs: number | null;
  datasetParseMs: number | null;
  densityBlendMode: string;
  densityMode: string;
  drawCallCount: number;
  lineAlpha: number | null;
  firstReadySignalMs: number | null;
  gapCount: number;
  lineSetSamplesMs: number | null;
  recordCount: number;
  rendererKind: ParallelFastRendererKind;
  rendererRedrawMs: number | null;
  rendererState: ParallelFastRendererState;
  rendererSetupMs: number | null;
  rendererUploadMs: number | null;
  sampleCount: number;
  selectionFreshness: ParallelFastSelectionFreshness;
  preselectedCount: number;
  preselectedOverlayEnabled: boolean;
  selectedCount: number;
  selectedLineSampleCount: number;
  selectedLineAlpha: number | null;
  selectionVisualUpdateMs: number | null;
  sharedArrayBuffersUsed: boolean;
  hoverResolveMs: number | null;
  hoverVisualBaseRedrawMs: number | null;
  hoverVisualGpuUploadMs: number | null;
  hoverVisualMode:
    | 'canvas2d-hover-overlay'
    | 'webgl2-hover-overlay-canvas'
    | 'n/a';
  hoverVisualRedrawMs: number | null;
  hoverVisualSkipped: boolean;
  hoverVisualUpdateMs: number | null;
  hoverVisualUploadBytes: number;
  reactSelectionCommitMs: number | null;
  webglSegmentCount: number;
  webglVertexCount: number;
  selectedIdMaterializationMs: number | null;
  selectedSourceIndexCreationMs: number | null;
  selectedVisualBufferCreationMs: number | null;
  selectedVisualGpuUploadMs: number | null;
  selectedVisualMaskBuildMs: number | null;
  selectedVisualMaskGpuUploadMs: number | null;
  selectedVisualRedrawMs: number | null;
  exportSerializationMs: number | null;
  userLineOpacityScale: number;
  tableMode: FastRouteTableMode;
  tableCount: number;
  tableRecordCounts: string;
  hoverIndexState: 'idle' | 'building' | 'ready' | 'error';
  hoverIndexBuildMs: number | null;
  hoverIndexBytes: number;
  hoverLookupSource: 'index' | 'fallback' | 'none';
}

type ParallelFastSelectionFreshness = 'exact' | 'stale';

interface ParallelFastSelectionState {
  activeBrushes: readonly ParallelActiveBrushInterval[];
  brushIntervals: ParallelBrushIntervals;
  callbackLog: readonly string[];
  filters: readonly ParallelFastSelectionFilter[];
  reason: string | null;
  selectedCount: number;
  selectedSampleIds: readonly string[];
  selectionFreshness: ParallelFastSelectionFreshness;
  source: string | null;
  sourceIndexCreationMs: number | null;
  sourceIndexSample: readonly number[];
}

interface ParallelFastBrushHookSelector {
  axis: ParallelParameter;
  end: number;
  mode?: 'append' | 'replace';
  start: number;
}

interface ParallelFastBrushHooks {
  clearBrushes: () => void;
  getTableMode: () => FastRouteTableMode;
  getWebgpuDiagnostics: () => ParallelWebgpuDiagnostics | null;
  getHoverIndexState: () => string;
  getInspection: () => ParallelFastInspectionState | null;
  getLineOpacityScale: () => number;
  getPlotInteractionState: () => PlotInteractionGateState & { active: boolean };
  getSelectedIds: () => readonly string[];
  inspectRecord: (recordId: string, axis: ParallelParameter) => void;
  serializeSelectedIdsForBenchmark: () => { byteLength: number; ms: number };
  setBrushes: (selectors: readonly ParallelFastBrushHookSelector[]) => void;
  setAxisViewports: (axisViewports: ParallelAxisViewports) => void;
  setLineOpacityScale: (scale: number) => void;
  setPreselectedOverlayEnabled: (enabled: boolean) => void;
}

interface ParallelFastBrushHooksWindow extends Window {
  __parallelFastPrototypeTestHooks?: ParallelFastBrushHooks;
}

interface ParallelFastRoutePlotHandle {
  clearBrushes: (source?: string) => void;
  clearOverlays: (kind?: ParallelFastOverlayKind) => void;
  commitBrushIntervals: (
    brushIntervals: ParallelBrushIntervals,
    source?: string,
  ) => void;
  getWebgpuDiagnostics: () => ParallelWebgpuDiagnostics | null;
  requestLineOpacityAdjustment: (
    adjustment: ParallelLineOpacityAdjustment,
  ) => void;
  resetAxisViewports: () => void;
  setAxisViewports: (axisViewports: ParallelAxisViewports) => void;
  setInspection: (
    inspection: ParallelFastInspectionState | null,
    resolveMs?: number | null,
  ) => void;
}

const MAX_PARALLEL_FAST_CALLBACK_LOG_ENTRIES = 8;
const PARALLEL_FAST_INSPECT_MAX_DISTANCE_PX = 28;
const PARALLEL_FAST_INSPECTION_LABEL_MAX_COUNT = 12;
const INITIAL_PLOT_INTERACTION_GATE_STATE: PlotInteractionGateState = {
  hasFocusWithin: false,
  isHovered: false,
};
const PARALLEL_SHORTCUT_GROUPS = [
  {
    items: [{ keys: ['Shift'], action: 'Inspect hovered line path' }],
    label: 'Inspect',
  },
  {
    items: [
      { keys: [',', '-'], action: 'Lower line opacity' },
      { keys: ['.', '+'], action: 'Raise line opacity' },
      { keys: ['0'], action: 'Reset line opacity' },
    ],
    label: 'Line opacity',
  },
  {
    items: [
      { keys: ['Right drag axis'], action: 'Brush an axis range' },
      { keys: ['Ctrl', 'Right drag axis'], action: 'Append an axis brush' },
      { keys: ['Double right click'], action: 'Remove one brush' },
      { keys: ['Escape'], action: 'Clear all brushes' },
    ],
    label: 'Brushes',
  },
] as const;

const PARALLEL_TRY_THIS_ITEMS = [
  {
    label: 'Zoom an axis',
    detail:
      'Left-drag a vertical box on one axis; release to apply it. Middle-drag pans one axis and middle-click undoes.',
  },
  {
    label: 'Brush an axis',
    detail:
      'Right-drag vertically on an axis to select a value range; hold Ctrl to append another range.',
  },
  {
    label: 'Remove one brush',
    detail: 'Double right-click an active brush to remove just that brush.',
  },
  {
    label: 'Inspect',
    detail: 'Hold Shift over the plot to show the nearest line and axis values.',
  },
  {
    label: 'Opacity',
    detail: 'Press comma and period while the plot is active to adjust line opacity.',
  },
  {
    label: 'Clear brushes',
    detail: 'Press Escape or use Clear selection to remove all active brushes.',
  },
] as const;

const PARALLEL_WEBGPU_POINT_COUNTS = SCATTER_WEBGPU_DEMO_POINT_COUNTS;
type ParallelRendererBackend = 'webgl2' | 'webgpu';

export function MParallelPlotRoute({
  rendererBackend = 'webgl2',
}: {
  rendererBackend?: ParallelRendererBackend;
}) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { themeMode } = useThemeMode();
  const plotTheme = useMemo(() => getParallelFastTheme(themeMode), [themeMode]);
  const [datasetState, setDatasetState] = useState<ParallelFastDatasetLoadState>({
    status: 'loading',
  });
  const [datasetRefreshVersion, setDatasetRefreshVersion] = useState(0);
  const [bufferState, setBufferState] = useState<ParallelFastBufferState>({
    status: 'idle',
  });
  const [diagnostics, setDiagnostics] = useState<ParallelFastDiagnostics>(() =>
    createEmptyParallelFastDiagnostics(),
  );
  const [selectionState, setSelectionState] = useState<ParallelFastSelectionState>(
    () => createEmptyParallelFastSelectionState(),
  );
  const [preselectedOverlayEnabled, setPreselectedOverlayEnabled] = useState(false);
  const [inspectionState, setInspectionState] =
    useState<ParallelFastInspectionState | null>(null);
  const [parallelOverlays, setParallelOverlays] = useState<
    readonly ParallelFastOverlayDescriptor[]
  >([]);
  const [axisViewportState, setAxisViewportState] = useState<{
    buffers: ParallelBuffers | null;
    viewports: ParallelAxisViewports;
  }>({ buffers: null, viewports: {} });
  const [tableMetadata, setTableMetadata] = useState<ParallelFastTableMetadata>(() =>
    createEmptyParallelFastTableMetadata(),
  );
  const [hoverIndex, setHoverIndex] = useState<ParallelHoverIndex | null>(null);
  const [streamProgress, setStreamProgress] =
    useState<ParallelWebgpuStreamProgress | null>(null);
  const [streamedBuffers, setStreamedBuffers] = useState<ParallelBuffers | null>(null);
  const [plotInteractionGate, setPlotInteractionGate] = useState<PlotInteractionGateState>(
    INITIAL_PLOT_INTERACTION_GATE_STATE,
  );
  const selectionStateRef = useRef(selectionState);
  const inspectionStateRef = useRef(inspectionState);
  const chartHandleRef = useRef<ParallelFastRoutePlotHandle | null>(null);
  const selectedSourceIndicesRef = useRef<Uint32Array<ArrayBufferLike>>(
    new Uint32Array(0),
  );
  const selectedIdsCacheRef = useRef<{
    ids: readonly string[];
    sourceIndices: Uint32Array;
  } | null>(null);
  const componentActiveRef = useRef(true);
  const datasetGenerationAbortRef = useRef<AbortController | null>(null);

  const baseReadyBuffers = bufferState.status === 'ready' ? bufferState.buffers : null;
  const readyBuffers = streamedBuffers ?? baseReadyBuffers;
  const persistedAxisViewports = useMemo(
    () =>
      readyBuffers === null
        ? {}
        : parseParallelAxisViewportsSearchParams(
            new URLSearchParams(location.search),
            readyBuffers.axisOrder,
            readyBuffers.domainsByAxis,
          ),
    [location.search, readyBuffers],
  );
  const axisViewports =
    axisViewportState.buffers === readyBuffers
      ? axisViewportState.viewports
      : persistedAxisViewports;
  const adjustedAxisCount = Object.keys(axisViewports).length;

  const handleAxisViewportsChange = useCallback(
    (
      nextAxisViewports: ParallelAxisViewports,
      phase: 'preview' | 'commit',
    ) => {
      setAxisViewportState({
        buffers: readyBuffers,
        viewports: nextAxisViewports,
      });
      if (phase !== 'commit' || readyBuffers === null) return;

      const currentParams = new URLSearchParams(window.location.search);
      const nextParams = serializeParallelAxisViewportsSearchParams(
        nextAxisViewports,
        readyBuffers.axisOrder,
        currentParams,
      );
      if (nextParams.toString() !== currentParams.toString()) {
        setSearchParams(nextParams, { replace: true });
      }
    },
    [readyBuffers, setSearchParams],
  );

  const updatePreselectedOverlayEnabled = useCallback((enabled: boolean) => {
    setPreselectedOverlayEnabled(enabled);
    setDiagnostics((currentDiagnostics) => ({
      ...currentDiagnostics,
      preselectedOverlayEnabled: enabled,
    }));
  }, []);
  const lineOpacityScale = useMemo(
    () => parseLineOpacityScaleSearchParam(searchParams),
    [searchParams],
  );
  const lineOpacityScaleRef = useRef(lineOpacityScale);
  const plotInteractionActive = isPlotInteractionGateActive(plotInteractionGate);
  const plotInteractionActiveRef = useRef(plotInteractionActive);
  const tableMode = useMemo(() => parseFastRouteTableMode(searchParams), [searchParams]);
  const webgpuPointCount = useMemo(
    () => parseParallelWebgpuPointCount(searchParams),
    [searchParams],
  );
  const webgpuStreamingKind = rendererBackend === 'webgpu'
    ? parseParallelWebgpuStreamKind(searchParams)
    : null;
  const webgpuStreaming = webgpuStreamingKind !== null;
  const webgpuStreamingSource =
    datasetState.status === 'loaded' && datasetState.datasetKind === 'webgpu-buffers'
      ? (datasetState.dataset as LoadedParallelWebgpuDataset).streamingSource
      : undefined;
  const webgpuManifestUrl = useMemo(() => {
    if (searchParams.get('webgpuData') !== 'http') return undefined;
    return searchParams.get('__e2eParallelWebgpuManifest') ??
      (webgpuPointCount > 10_000_000
        ? '/data/scatter-webgpu-25m.json'
        : '/data/scatter-webgpu-10m.json');
  }, [searchParams, webgpuPointCount]);
  const datasetOverrideUrl = useMemo(
    () => getParallelFastDatasetOverrideUrl(location.search),
    [location.search],
  );
  const mixedTableFixtureUrl = useMemo(
    () => resolveFastPlotFixtureUrl(searchParams, MIXED_TABLE_FIXTURE_URL),
    [searchParams],
  );
  const nonWebgpuDatasetSearch = rendererBackend === 'webgpu'
    ? ''
    : searchParams.toString();

  const selectWebgpuPointCount = useCallback((pointCount: number) => {
    if (pointCount === webgpuPointCount) return;
    const next = new URL(window.location.href);
    next.searchParams.set('points', String(pointCount));
    window.location.assign(next.href);
  }, [webgpuPointCount]);

  const selectWebgpuStreaming = useCallback(() => {
    const next = new URL(window.location.href);
    next.searchParams.set('webgpuData', 'stream-local');
    window.location.assign(next.href);
  }, []);

  const selectWebgpuStreamKind = useCallback((kind: 'function' | 'local') => {
    const next = new URL(window.location.href);
    next.searchParams.set('webgpuData', `stream-${kind}`);
    window.location.assign(next.href);
  }, []);

  const selectWebgpuTableMode = useCallback((mode: FastRouteTableMode) => {
    if (mode === tableMode && !webgpuStreaming) return;
    const next = new URL(window.location.href);
    next.searchParams.delete('webgpuData');
    const value = formatFastRouteTableMode(mode);
    if (value === null) next.searchParams.delete(FAST_ROUTE_TABLES_PARAM);
    else next.searchParams.set(FAST_ROUTE_TABLES_PARAM, value);
    window.location.assign(next.href);
  }, [tableMode, webgpuStreaming]);

  const generateWebgpuDataset = useCallback(async () => {
    datasetGenerationAbortRef.current?.abort();
    const controller = new AbortController();
    datasetGenerationAbortRef.current = controller;
    setDatasetState({
      completedPages: 0,
      pageCount: Math.ceil(webgpuPointCount / 250_000),
      pointCount: webgpuPointCount,
      status: 'generating',
    });
    try {
      await generateAndStoreScatterWebgpuDataset({
        onProgress: ({ completedPages, pageCount }) => {
          if (componentActiveRef.current && !controller.signal.aborted) {
            setDatasetState({
              completedPages,
              pageCount,
              pointCount: webgpuPointCount,
              status: 'generating',
            });
          }
        },
        pointCount: webgpuPointCount,
        signal: controller.signal,
      });
      if (componentActiveRef.current && !controller.signal.aborted) {
        setDatasetState({ status: 'loading' });
        setDatasetRefreshVersion((version) => version + 1);
      }
    } catch (error) {
      if (!componentActiveRef.current) return;
      setDatasetState({
        ...(controller.signal.aborted
          ? {}
          : {
              message: error instanceof Error
                ? error.message
                : 'Unknown WebGPU dataset generation error.',
            }),
        pointCount: webgpuPointCount,
        status: 'missing',
      });
    } finally {
      if (datasetGenerationAbortRef.current === controller) {
        datasetGenerationAbortRef.current = null;
      }
    }
  }, [webgpuPointCount]);

  const deleteWebgpuDataset = useCallback(async () => {
    datasetGenerationAbortRef.current?.abort();
    try {
      await deleteStoredScatterWebgpuDataset(webgpuPointCount);
      setBufferState({ status: 'idle' });
      setDatasetState({ pointCount: webgpuPointCount, status: 'missing' });
    } catch (error) {
      setDatasetState({
        message: error instanceof Error
          ? error.message
          : 'Could not delete the local dataset.',
        status: 'error',
      });
    }
  }, [webgpuPointCount]);

  const updateLineOpacityScale = useCallback(
    (scale: number) => {
      lineOpacityScaleRef.current = scale;
      const baseParams = new URLSearchParams(window.location.search);
      const nextParams = new URLSearchParams(baseParams);
      nextParams.set(
        PARALLEL_FAST_LINE_OPACITY_SCALE_PARAM,
        formatLineOpacityScaleParam(scale),
      );

      if (nextParams.toString() !== baseParams.toString()) {
        setSearchParams(nextParams, { replace: true });
      }
    },
    [setSearchParams],
  );
  const getPlotInteractionActive = useCallback(
    () => plotInteractionActiveRef.current,
    [],
  );
  const selectionCallbackPreview = useMemo(
    () =>
      serializeParallelSelectionCallbackPreview({
        buffers: readyBuffers,
        selectionState,
      }),
    [readyBuffers, selectionState],
  );

  const handlePlotInteractionHoverChange = useCallback((isHovered: boolean) => {
    setPlotInteractionGate((current) =>
      current.isHovered === isHovered ? current : { ...current, isHovered },
    );
  }, []);

  const handlePlotInteractionFocusChange = useCallback((hasFocusWithin: boolean) => {
    setPlotInteractionGate((current) =>
      current.hasFocusWithin === hasFocusWithin
        ? current
        : { ...current, hasFocusWithin },
    );
  }, []);

  const focusPlotInteractionSurface = useCallback((element: HTMLDivElement | null) => {
    if (element !== null && document.activeElement !== element) {
      element.focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => {
    selectionStateRef.current = selectionState;
  }, [selectionState]);

  useEffect(() => {
    inspectionStateRef.current = inspectionState;
  }, [inspectionState]);

  useEffect(() => {
    lineOpacityScaleRef.current = lineOpacityScale;
  }, [lineOpacityScale]);

  useEffect(() => {
    plotInteractionActiveRef.current = plotInteractionActive;
  }, [plotInteractionActive]);

  useEffect(() => {
    componentActiveRef.current = true;
    return () => {
      componentActiveRef.current = false;
      datasetGenerationAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let isActive = true;
    const startedAt = performance.now();
    const controller = new AbortController();

    async function loadDataset() {
      try {
        setStreamProgress(null);
        setStreamedBuffers(null);
        const loaded =
          rendererBackend === 'webgpu'
            ? await (webgpuStreaming
              ? prepareParallelWebgpuDemoStream({
                  kind: webgpuStreamingKind ?? 'local',
                  pointCount: webgpuPointCount,
                  ...(tableMode === 'multi'
                    ? {
                        secondaryFixtureUrl: mixedTableFixtureUrl.replace(
                          /\.json(?=($|[?#]))/u,
                          '.secondary.json',
                        ),
                      }
                    : {}),
                  signal: controller.signal,
                  startedAt,
                })
              : loadParallelWebgpuDataset({
                fixtureUrl: mixedTableFixtureUrl,
                ...(webgpuManifestUrl === undefined
                  ? {}
                  : { manifestUrl: webgpuManifestUrl }),
                pointCount: webgpuPointCount,
                signal: controller.signal,
                startedAt,
                tableMode,
              })).then((dataset) => ({
                dataset,
                datasetKind: 'webgpu-buffers' as const,
                metrics: {
                  fetchMs: dataset.loadMs,
                  parseMs: 0,
                },
              }))
            : datasetOverrideUrl !== null
            ? await loadParallelFastRouteDataset(datasetOverrideUrl)
            : tableMode === 'multi'
              ? await loadMixedTableParallelFastRouteDataset(mixedTableFixtureUrl)
              : await loadScatterFastBenchmarkSource(
                  new URLSearchParams(nonWebgpuDatasetSearch),
                ).then((dataset) => ({
                  dataset,
                  datasetKind: 'scatter-fast-benchmark' as const,
                  metrics: {
                    fetchMs: dataset.fetchMs,
                    parseMs: dataset.parseMs + dataset.decodeMs,
                  },
                }));

        if (!isActive) {
          return;
        }

        setDatasetState({
          dataset: loaded.dataset,
          datasetKind: loaded.datasetKind,
          loadTimeMs: performance.now() - startedAt,
          status: 'loaded',
        });
        setDiagnostics((currentDiagnostics) => ({
          ...currentDiagnostics,
          datasetFetchMs: loaded.metrics.fetchMs,
          datasetParseMs: loaded.metrics.parseMs,
          recordCount: getParallelFastRouteRecordCount(loaded.dataset, tableMode),
          tableMode,
        }));
      } catch (error) {
        if (!isActive) {
          return;
        }

        if (
          error instanceof LocalParallelWebgpuDatasetUnavailableError &&
          rendererBackend === 'webgpu'
        ) {
          setDatasetState({
            pointCount: webgpuPointCount,
            status: 'missing',
          });
          return;
        }

        setDatasetState({
          message:
            error instanceof Error
              ? error.message
              : 'Unknown parallel dataset load error.',
          status: 'error',
        });
      }
    }

    void loadDataset();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [
    datasetOverrideUrl,
    datasetRefreshVersion,
    mixedTableFixtureUrl,
    nonWebgpuDatasetSearch,
    rendererBackend,
    tableMode,
    webgpuManifestUrl,
    webgpuPointCount,
    webgpuStreaming,
    webgpuStreamingKind,
  ]);

  useEffect(() => {
    if (datasetState.status !== 'loaded') {
      return;
    }

    let isActive = true;

    window.setTimeout(() => {
      if (!isActive) {
        return;
      }

      setBufferState({ status: 'building' });

      try {
        const bufferStartedAt = performance.now();
        const routeBuffers =
          datasetState.datasetKind === 'webgpu-buffers'
            ? {
                buffers: (datasetState.dataset as LoadedParallelWebgpuDataset)
                  .buffers,
                tableMetadata: {
                  tableCount: (
                    datasetState.dataset as LoadedParallelWebgpuDataset
                  ).tableNames.length,
                  tableNames: (
                    datasetState.dataset as LoadedParallelWebgpuDataset
                  ).tableNames,
                  tableRecordCounts: (
                    datasetState.dataset as LoadedParallelWebgpuDataset
                  ).tableRecordCounts,
                },
              }
            : createParallelFastRouteBuffers(
                datasetState,
                {
                  includeWebglSegmentBuffers: true,
                },
                tableMode,
              );
        const buffers = routeBuffers.buffers;
        const bufferBuildMs = performance.now() - bufferStartedAt;

        if (!isActive) {
          return;
        }

        setBufferState({ buffers, status: 'ready' });
        setHoverIndex(null);
        setTableMetadata(routeBuffers.tableMetadata);
        setDiagnostics((currentDiagnostics) => ({
          ...currentDiagnostics,
          bufferBuildMs,
          tableMode,
          gapCount: buffers.lineSeriesBuffers.gapCount,
          hoverIndexState:
            rendererBackend === 'webgpu' ? 'ready' : 'building',
          hoverIndexBuildMs: rendererBackend === 'webgpu' ? 0 : null,
          hoverIndexBytes: 0,
          hoverLookupSource:
            rendererBackend === 'webgpu' ? 'index' : 'none',
          preselectedCount: buffers.preselectedCount,
          recordCount: buffers.recordCount,
          sampleCount: buffers.lineSeriesBuffers.sampleCount,
          tableCount: routeBuffers.tableMetadata.tableCount,
          tableRecordCounts: formatTableRecordCounts(
            routeBuffers.tableMetadata.tableRecordCounts,
          ),
          webglSegmentCount: buffers.webglSegmentBuffers?.segmentCount ?? 0,
          webglVertexCount: buffers.webglSegmentBuffers
            ? buffers.webglSegmentBuffers.segmentCount *
              buffers.webglSegmentBuffers.verticesPerSegment
            : 0,
        }));
      } catch (error) {
        if (!isActive) {
          return;
        }

        setBufferState({
          message:
            error instanceof Error
              ? error.message
              : 'Unknown parallel buffer build error.',
          status: 'error',
        });
      }
    }, 0);

    return () => {
      isActive = false;
    };
  }, [datasetState, rendererBackend, tableMode]);

  useEffect(() => {
    if (!baseReadyBuffers) {
      return;
    }
    if (rendererBackend === 'webgpu') {
      return;
    }

    let isActive = true;
    const timeout = window.setTimeout(() => {
      try {
        setDiagnostics((currentDiagnostics) => ({
          ...currentDiagnostics,
          hoverIndexState: 'building',
          hoverIndexBuildMs: null,
          hoverIndexBytes: 0,
        }));
        const nextIndex = createParallelHoverIndex(baseReadyBuffers);
        if (!isActive) {
          return;
        }
        setHoverIndex(nextIndex);
        setDiagnostics((currentDiagnostics) => ({
          ...currentDiagnostics,
          hoverIndexBuildMs: nextIndex.metrics.buildMs,
          hoverIndexBytes: nextIndex.metrics.byteLength,
          hoverIndexState: 'ready',
        }));
      } catch {
        if (!isActive) {
          return;
        }
        setHoverIndex(null);
        setDiagnostics((currentDiagnostics) => ({
          ...currentDiagnostics,
          hoverIndexState: 'error',
        }));
      }
    }, 0);

    return () => {
      isActive = false;
      window.clearTimeout(timeout);
    };
  }, [baseReadyBuffers, rendererBackend]);

  const handleRendererMetricsChange = (event: ParallelFastRendererMetricsEvent) => {
    setDiagnostics((currentDiagnostics) => ({
      ...currentDiagnostics,
      densityBlendMode:
        event.densityBlendMode ?? currentDiagnostics.densityBlendMode,
      densityMode: event.densityMode ?? currentDiagnostics.densityMode,
      drawCallCount: event.drawCallCount ?? currentDiagnostics.drawCallCount,
      lineAlpha:
        event.lineAlpha === undefined ? currentDiagnostics.lineAlpha : event.lineAlpha,
      userLineOpacityScale:
        event.lineOpacityScale === undefined
          ? currentDiagnostics.userLineOpacityScale
          : event.lineOpacityScale,
      firstReadySignalMs:
        event.firstReadySignalMs === undefined
          ? currentDiagnostics.firstReadySignalMs
          : event.firstReadySignalMs,
      lineSetSamplesMs:
        event.lineSetSamplesMs === undefined
          ? currentDiagnostics.lineSetSamplesMs
          : event.lineSetSamplesMs,
      rendererKind: event.rendererKind ?? currentDiagnostics.rendererKind,
      rendererRedrawMs:
        event.rendererRedrawMs === undefined
          ? currentDiagnostics.rendererRedrawMs
          : event.rendererRedrawMs,
      rendererSetupMs:
        event.rendererSetupMs === undefined
          ? currentDiagnostics.rendererSetupMs
          : event.rendererSetupMs,
      rendererState: event.rendererState ?? currentDiagnostics.rendererState,
      rendererUploadMs:
        event.rendererUploadMs === undefined
          ? currentDiagnostics.rendererUploadMs
          : event.rendererUploadMs,
      selectedLineSampleCount:
        event.selectedLineSampleCount ?? currentDiagnostics.selectedLineSampleCount,
      selectedLineAlpha:
        event.selectedLineAlpha === undefined
          ? currentDiagnostics.selectedLineAlpha
          : event.selectedLineAlpha,
      selectedVisualBufferCreationMs:
        event.selectedVisualBufferCreationMs === undefined
          ? currentDiagnostics.selectedVisualBufferCreationMs
          : event.selectedVisualBufferCreationMs,
      selectedVisualGpuUploadMs:
        event.selectedVisualGpuUploadMs === undefined
          ? currentDiagnostics.selectedVisualGpuUploadMs
          : event.selectedVisualGpuUploadMs,
      selectedVisualMaskBuildMs:
        event.selectedVisualMaskBuildMs === undefined
          ? currentDiagnostics.selectedVisualMaskBuildMs
          : event.selectedVisualMaskBuildMs,
      selectedVisualMaskGpuUploadMs:
        event.selectedVisualMaskGpuUploadMs === undefined
          ? currentDiagnostics.selectedVisualMaskGpuUploadMs
          : event.selectedVisualMaskGpuUploadMs,
      selectedVisualRedrawMs:
        event.selectedVisualRedrawMs === undefined
          ? currentDiagnostics.selectedVisualRedrawMs
          : event.selectedVisualRedrawMs,
      selectionVisualUpdateMs:
        event.selectionVisualUpdateMs === undefined
          ? currentDiagnostics.selectionVisualUpdateMs
          : event.selectionVisualUpdateMs,
      sharedArrayBuffersUsed:
        event.sharedArrayBuffersUsed ?? currentDiagnostics.sharedArrayBuffersUsed,
      hoverResolveMs:
        event.hoverResolveMs === undefined
          ? currentDiagnostics.hoverResolveMs
          : event.hoverResolveMs,
      hoverVisualBaseRedrawMs:
        event.hoverVisualBaseRedrawMs === undefined
          ? currentDiagnostics.hoverVisualBaseRedrawMs
          : event.hoverVisualBaseRedrawMs,
      hoverVisualGpuUploadMs:
        event.hoverVisualGpuUploadMs === undefined
          ? currentDiagnostics.hoverVisualGpuUploadMs
          : event.hoverVisualGpuUploadMs,
      hoverVisualMode:
        event.hoverVisualMode === undefined
          ? currentDiagnostics.hoverVisualMode
          : event.hoverVisualMode,
      hoverVisualRedrawMs:
        event.hoverVisualRedrawMs === undefined
          ? currentDiagnostics.hoverVisualRedrawMs
          : event.hoverVisualRedrawMs,
      hoverVisualSkipped:
        event.hoverVisualSkipped === undefined
          ? currentDiagnostics.hoverVisualSkipped
          : event.hoverVisualSkipped,
      hoverVisualUpdateMs:
        event.hoverVisualUpdateMs === undefined
          ? currentDiagnostics.hoverVisualUpdateMs
          : event.hoverVisualUpdateMs,
      hoverVisualUploadBytes:
        event.hoverVisualUploadBytes === undefined
          ? currentDiagnostics.hoverVisualUploadBytes
          : event.hoverVisualUploadBytes,
      webglSegmentCount:
        event.webglSegmentCount ?? currentDiagnostics.webglSegmentCount,
      webglVertexCount: event.webglVertexCount ?? currentDiagnostics.webglVertexCount,
    }));
  };

  const handleParallelFastHandleChange = useCallback(
    (handle: ParallelFastRoutePlotHandle | null) => {
      chartHandleRef.current = handle;
    },
    [],
  );

  const handleParallelSelectionChange = useCallback(
    (event: ParallelFastSelectionChangeEvent, source: string) => {
      if (!readyBuffers) {
        return;
      }

      const commitStartedAt = performance.now();
      const selectedSampleIds = sampleParallelSelectedIdsFromSourceIndices(
        readyBuffers,
        event.sourceIndices,
        6,
      );

      selectedSourceIndicesRef.current = event.sourceIndices;
      selectedIdsCacheRef.current = null;

      setSelectionState((currentSelectionState) => ({
        activeBrushes: event.activeBrushes,
        brushIntervals: event.brushIntervals,
        callbackLog: [
          formatParallelFastBrushLogEntry({
            activeBrushes: event.activeBrushes,
            buffers: readyBuffers,
            brushComputeMs: event.computeMs,
            selectedCount: event.selectedCount,
            source,
          }),
          ...currentSelectionState.callbackLog,
        ].slice(0, MAX_PARALLEL_FAST_CALLBACK_LOG_ENTRIES),
        reason: event.reason,
        selectedCount: event.selectedCount,
        selectedSampleIds,
        filters: event.filters,
        selectionFreshness: 'exact',
        source: event.source,
        sourceIndexCreationMs: event.sourceIndexCreationMs,
        sourceIndexSample: Array.from(event.sourceIndices.slice(0, 8)),
      }));
      setDiagnostics((currentDiagnostics) => ({
        ...currentDiagnostics,
        brushComputeMs: event.computeMs,
        reactSelectionCommitMs: performance.now() - commitStartedAt,
        selectedCount: event.selectedCount,
        selectedIdMaterializationMs: null,
        selectedSourceIndexCreationMs: event.sourceIndexCreationMs,
        selectionFreshness: 'exact',
      }));
    },
    [readyBuffers],
  );

  const previewBrushIntervals = useCallback(
    (nextBrushIntervals: ParallelBrushIntervals) => {
      if (!readyBuffers) {
        return;
      }

      const activeBrushes = normalizeParallelBrushIntervals(
        nextBrushIntervals,
        readyBuffers.axisOrder,
      );

      setSelectionState((currentSelectionState) => ({
        ...currentSelectionState,
        activeBrushes,
        brushIntervals: nextBrushIntervals,
        selectionFreshness: 'stale',
      }));
      setDiagnostics((currentDiagnostics) => ({
        ...currentDiagnostics,
        selectionFreshness: 'stale',
      }));
    },
    [readyBuffers],
  );

  const handleClearSelection = useCallback(() => {
    const handle = chartHandleRef.current;
    if (handle) {
      handle.clearBrushes('clear');
      return;
    }
  }, []);

  useEffect(() => {
    const handleWindowBlur = () => {
      handlePlotInteractionFocusChange(false);
    };

    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [
    handlePlotInteractionFocusChange,
  ]);

  const handleExportSelectedIds = useCallback(() => {
    if (!readyBuffers || selectionState.selectedCount === 0) {
      return;
    }

    const exportStartedAt = performance.now();
    const exportText = serializeParallelSelectedRecordsForExport(
      readyBuffers,
      selectedSourceIndicesRef.current,
    );
    const exportSerializationMs = performance.now() - exportStartedAt;
    const exportBlob = new Blob([exportText], { type: 'text/plain;charset=utf-8' });
    const exportUrl = URL.createObjectURL(exportBlob);

    window.open(exportUrl, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => {
      URL.revokeObjectURL(exportUrl);
    }, 0);
    setDiagnostics((currentDiagnostics) => ({
      ...currentDiagnostics,
      exportSerializationMs,
    }));
  }, [readyBuffers, selectionState.selectedCount]);

  const handleBrushIntervalsPreview = useCallback(
    (nextBrushIntervals: ParallelBrushIntervals) => {
      previewBrushIntervals(nextBrushIntervals);
    },
    [previewBrushIntervals],
  );

  useEffect(() => {
    if (!readyBuffers || !shouldEnableParallelFastBrushHooksForE2e()) {
      return;
    }

    const hookWindow = window as ParallelFastBrushHooksWindow;
    hookWindow.__parallelFastPrototypeTestHooks = {
      clearBrushes: () => {
        chartHandleRef.current?.clearBrushes('e2e-clear');
      },
      getTableMode: () => parseFastRouteTableMode(new URLSearchParams(window.location.search)),
      getWebgpuDiagnostics: () =>
        chartHandleRef.current?.getWebgpuDiagnostics() ?? null,
      getHoverIndexState: () => diagnostics.hoverIndexState,
      getInspection: () => inspectionStateRef.current,
      getLineOpacityScale: () =>
        parseLineOpacityScaleSearchParam(new URLSearchParams(window.location.search)),
      getPlotInteractionState: () => ({
        ...plotInteractionGate,
        active: isPlotInteractionGateActive(plotInteractionGate),
      }),
      getSelectedIds: () => {
        const selectedSourceIndices = selectedSourceIndicesRef.current;
        const cachedSelection = selectedIdsCacheRef.current;

        if (cachedSelection?.sourceIndices === selectedSourceIndices) {
          return cachedSelection.ids;
        }

        const startedAt = performance.now();
        const ids = materializeParallelSelectedIds(
          readyBuffers,
          selectedSourceIndices,
        );
        selectedIdsCacheRef.current = {
          ids,
          sourceIndices: selectedSourceIndices,
        };
        setDiagnostics((currentDiagnostics) => ({
          ...currentDiagnostics,
          selectedIdMaterializationMs: performance.now() - startedAt,
        }));

        return ids;
      },
      inspectRecord: (recordId, axis) => {
        const recordIndex = readyBuffers.ids.indexOf(recordId);

        if (recordIndex < 0) {
          throw new Error(`Unknown parallel-fast inspect record ID: ${recordId}`);
        }
        if (!readyBuffers.axisOrder.includes(axis)) {
          throw new Error(`Unknown parallel-fast inspect axis: ${axis}`);
        }

        const axisIndex = readyBuffers.axisOrder.indexOf(axis);
        const nextInspection = {
          activeAxis: axis,
          activeAxisValue: readyBuffers.rawValuesByAxis[axis][recordIndex],
          distancePx: 0,
          id: recordId,
          normalizedAxisValue:
            readParallelNormalizedValue(readyBuffers, axis, recordIndex),
          projectedAxisPosition: axisIndex,
          projectedNormalizedValue:
            readParallelNormalizedValue(readyBuffers, axis, recordIndex),
          ...(readyBuffers.recordIdentityBySourceIndex?.[recordIndex] === undefined
            ? {}
            : { record: readyBuffers.recordIdentityBySourceIndex[recordIndex] }),
          recordIndex,
          segmentEndAxis:
            readyBuffers.axisOrder[
              Math.min(axisIndex + 1, readyBuffers.axisOrder.length - 1)
            ],
          segmentStartAxis:
            readyBuffers.axisOrder[Math.max(0, axisIndex - 1)],
          source: 'e2e-inspect-record',
        } satisfies ParallelFastInspectionState;
        const handle = chartHandleRef.current;
        if (handle) {
          handle.setInspection(nextInspection, 0);
        } else {
          setInspectionState(nextInspection);
        }
        setDiagnostics((currentDiagnostics) => ({
          ...currentDiagnostics,
          hoverResolveMs: 0,
        }));
      },
      serializeSelectedIdsForBenchmark: () => {
        const startedAt = performance.now();
        const exportText = serializeParallelSelectedRecordsForExport(
          readyBuffers,
          selectedSourceIndicesRef.current,
        );
        const ms = performance.now() - startedAt;
        setDiagnostics((currentDiagnostics) => ({
          ...currentDiagnostics,
          exportSerializationMs: ms,
        }));

        return {
          byteLength: new Blob([exportText]).size,
          ms,
        };
      },
      setBrushes: (selectors) => {
        const nextBrushIntervals: ParallelBrushIntervals = {};

        for (const selector of selectors) {
          if (!readyBuffers.axisOrder.includes(selector.axis)) {
            throw new Error(`Unknown parallel-fast brush axis: ${selector.axis}`);
          }

          const nextRange = {
            max: selector.end,
            min: selector.start,
          };
          const current = getBrushRangesForAxis(nextBrushIntervals, selector.axis);

          nextBrushIntervals[selector.axis] =
            selector.mode === 'replace' || current.length === 0
              ? [nextRange]
              : [...current, nextRange];
        }

        chartHandleRef.current?.commitBrushIntervals(nextBrushIntervals, 'e2e-brush');
      },
      setAxisViewports: (nextAxisViewports) => {
        chartHandleRef.current?.setAxisViewports(nextAxisViewports);
      },
      setLineOpacityScale: updateLineOpacityScale,
      setPreselectedOverlayEnabled: (enabled) => {
        updatePreselectedOverlayEnabled(enabled);
      },
    };

    return () => {
      delete hookWindow.__parallelFastPrototypeTestHooks;
    };
  }, [
    diagnostics.hoverIndexState,
    plotInteractionGate,
    readyBuffers,
    updatePreselectedOverlayEnabled,
    updateLineOpacityScale,
  ]);

  return (
    <main
      aria-label="High-performance parallel coordinate workspace"
      className="prototype-shell parallel-prototype-shell parallel-fast-prototype-shell"
    >
      <section className="workspace">
        <div className="workspace-grid parallel-workspace-grid">
          <section className="parallel-main-panel" aria-label="Parallel fast chart panel">
            {datasetState.status === 'missing' ||
            datasetState.status === 'generating' ? (
              <ParallelWebgpuDatasetSetup
                datasetState={datasetState}
                onCancel={() => datasetGenerationAbortRef.current?.abort()}
                onGenerate={() => void generateWebgpuDataset()}
                onSelectPointCount={selectWebgpuPointCount}
                pointCount={webgpuPointCount}
              />
            ) : null}
            {datasetState.status === 'loading' ? (
              <div className="workspace-placeholder" role="status">
                Loading parallel dataset...
              </div>
            ) : null}
            {datasetState.status === 'error' ? (
              <div className="workspace-placeholder lc-status-error" role="alert">
                {datasetState.message}
              </div>
            ) : null}
            {datasetState.status === 'loaded' ? (
              <>
                {bufferState.status === 'building' || bufferState.status === 'idle' ? (
                  <div className="workspace-placeholder" role="status">
                    Building parallel render buffers...
                  </div>
                ) : null}
                {bufferState.status === 'error' ? (
                  <div className="workspace-placeholder lc-status-error" role="alert">
                    {bufferState.message}
                  </div>
                ) : null}
                {readyBuffers !== null ? (
                  <div
                    aria-label="m-parallel plot interaction surface"
                    className="fast-plot-interaction-surface"
                    data-interaction-active={plotInteractionActive ? 'true' : 'false'}
                    data-interaction-focused={
                      plotInteractionGate.hasFocusWithin ? 'true' : 'false'
                    }
                    data-interaction-hovered={
                      plotInteractionGate.isHovered ? 'true' : 'false'
                    }
                    data-testid="parallel-fast-interaction-surface"
                    onBlurCapture={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        handlePlotInteractionFocusChange(false);
                      }
                    }}
                    onFocusCapture={() => {
                      handlePlotInteractionFocusChange(true);
                    }}
                    onPointerDownCapture={(event) => {
                      focusPlotInteractionSurface(event.currentTarget);
                    }}
                    onPointerEnter={() => {
                      handlePlotInteractionHoverChange(true);
                    }}
                    onPointerLeave={() => {
                      handlePlotInteractionHoverChange(false);
                    }}
                    tabIndex={0}
                  >
                    <MParallelEngineChart
                      rendererBackend={rendererBackend}
                      axisViewports={axisViewports}
                      onAxisViewportsChange={handleAxisViewportsChange}
                      onHandleChange={handleParallelFastHandleChange}
                      axisOverlay={
                        <MParallelAxisBrushOverlay
                          axisViewports={axisViewports}
                          buffers={readyBuffers}
                          overlays={parallelOverlays}
                        />
                      }
                      brushIntervals={selectionState.brushIntervals}
                      buffers={readyBuffers}
                      hoverIndex={hoverIndex}
                      inspection={inspectionState}
                      lineOpacityScale={lineOpacityScale}
                      onSelectionChange={(event, source) => {
                        handleParallelSelectionChange(event, source);
                      }}
                      onBrushIntervalsPreview={handleBrushIntervalsPreview}
                      onInspectionChange={(inspection, resolveMs, lookupSource) => {
                        setInspectionState(inspection);
                        setDiagnostics((currentDiagnostics) => ({
                          ...currentDiagnostics,
                          hoverLookupSource: lookupSource,
                          hoverResolveMs: resolveMs,
                        }));
                      }}
                      onLineOpacityAdjustRequest={(adjustment) => {
                        if (adjustment === 'reset') {
                          updateLineOpacityScale(PARALLEL_FAST_DEFAULT_LINE_OPACITY_SCALE);
                          return;
                        }
                        updateLineOpacityScale(
                          adjustment === 'increase'
                            ? getNextLineOpacityScale(lineOpacityScaleRef.current)
                            : getPreviousLineOpacityScale(lineOpacityScaleRef.current),
                        );
                      }}
                      onMetricsChange={handleRendererMetricsChange}
                      onOverlaysChange={setParallelOverlays}
                      preserveDrawingBuffer={shouldPreserveWebglDrawingBufferForE2e()}
                      preselectedOverlayEnabled={preselectedOverlayEnabled}
                      preselectedSourceIndices={readyBuffers.preselectedSourceIndices}
                      selectedHighlightCount={selectionState.selectedCount}
                      selectedVisualUpdateDelayMs={100}
                      shortcutGate={getPlotInteractionActive}
                      theme={plotTheme}
                      streamingSource={webgpuStreamingSource}
                      onStreamProgress={(progress, buffers) => {
                        setStreamProgress(progress);
                        setStreamedBuffers(buffers);
                      }}
                    />
                  </div>
                ) : null}
              </>
            ) : null}
          </section>
          <aside
            aria-label="Parallel fast diagnostics"
            className="control-panel parallel-control-panel"
          >
            <DemoSidebarHeader
              links={[
                { icon: 'overview', label: 'Overview', to: createThemeAwareTo('/', location.search, themeMode) },
              ]}
              title={
                rendererBackend === 'webgpu'
                  ? 'm-parallel WebGPU'
                  : 'm-parallel'
              }
            />
            <section className="control-section">
              <h2>Dataset</h2>
              {rendererBackend === 'webgpu' ? (
                <div className="scatter-webgpu-dataset-controls">
                  {webgpuStreamingKind !== 'function' ? (
                  <div
                    aria-label="WebGPU parallel dataset size"
                    className="segmented-control"
                    data-testid="parallel-webgpu-point-count"
                  >
                    {PARALLEL_WEBGPU_POINT_COUNTS.map((count) => (
                      <button
                        className={webgpuPointCount === count ? 'is-active' : undefined}
                        disabled={datasetState.status === 'generating'}
                        key={count}
                        onClick={() => selectWebgpuPointCount(count)}
                        type="button"
                      >
                        {formatCompactParallelPointCount(count)}
                      </button>
                    ))}
                  </div>
                  ) : (
                    <p className="compact-note">
                      The server-function sample is hard-capped at 5,000 records.
                    </p>
                  )}
                  <div
                    aria-label="WebGPU parallel dataset mode"
                    className="segmented-control scatter-webgpu-table-mode-control"
                    data-testid="parallel-webgpu-table-mode"
                  >
                    {(['single', 'multi', 'stream'] as const).map((mode) => (
                      <button
                        aria-pressed={mode === 'stream' ? webgpuStreaming : !webgpuStreaming && tableMode === mode}
                        className={
                          (mode === 'stream' ? webgpuStreaming : !webgpuStreaming && tableMode === mode)
                            ? 'is-active'
                            : undefined
                        }
                        disabled={datasetState.status === 'generating'}
                        key={mode}
                        onClick={() => mode === 'stream'
                          ? selectWebgpuStreaming()
                          : selectWebgpuTableMode(mode)}
                        type="button"
                      >
                        {mode === 'single'
                          ? 'Single table'
                          : mode === 'multi' ? 'Multiple tables' : 'Streaming'}
                      </button>
                    ))}
                  </div>
                  {webgpuStreaming ? (
                    <div
                      aria-label="WebGPU parallel streaming source"
                      className="segmented-control scatter-webgpu-stream-source-control"
                      data-testid="parallel-webgpu-stream-source"
                    >
                      {(['local', 'function'] as const).map((kind) => (
                        <button
                          aria-pressed={webgpuStreamingKind === kind}
                          className={webgpuStreamingKind === kind ? 'is-active' : undefined}
                          key={kind}
                          onClick={() => selectWebgpuStreamKind(kind)}
                          type="button"
                        >
                          {kind === 'local' ? 'Browser local' : 'Server function'}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {webgpuStreaming ? (
                    <p className="compact-note">
                      {webgpuStreamingKind === 'function'
                        ? 'Streams one capped, genuinely chunked JSON response from the Vercel Function.'
                        : <>Streams the selected {tableMode === 'multi' ? 'multiple-table' : 'single-table'} dataset from browser-local pages (IndexedDB when stored).</>}
                    </p>
                  ) : null}
                  <details
                    className="control-disclosure scatter-webgpu-dataset-details"
                    data-testid="parallel-webgpu-dataset-details"
                  >
                    <summary>Dataset details</summary>
                    <div className="control-disclosure-body">
                      <p className="compact-note">
                        {webgpuStreamingKind === 'function'
                          ? 'The browser passes response.body to the incremental JSON-record decoder, maps each batch to parallel-coordinate columns and packed GPU pages, and never materializes the complete HTTP payload first.'
                          : webgpuStreaming
                          ? 'Streaming uses the same renderer, axes, density aggregation, and interactions. Batches come from the shared browser-local dataset; the seeded worker is used only when no stored copy exists.'
                          : 'Uses the same locally generated, paged dataset as m-scatter and m-histogram WebGPU, including each record\'s color.'}
                      </p>
                      <p className="compact-note">
                        Density rendering evaluates every record. Exact hover and axis
                        brush selection also resolve against the complete source data.
                        Multiple tables adds the fixed 1,000-record secondary table.
                      </p>
                    </div>
                  </details>
                  {streamProgress !== null ? (
                    <dl
                      className="metrics-grid"
                      data-loaded-count={streamProgress.loadedCount}
                      data-testid="parallel-webgpu-stream-progress"
                    >
                      <div>
                        <dt>Streamed</dt>
                        <dd>{streamProgress.loadedCount.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Capacity</dt>
                        <dd>{streamProgress.capacity.toLocaleString()}</dd>
                      </div>
                    </dl>
                  ) : null}
                  {datasetState.status === 'loaded' && webgpuManifestUrl === undefined && !webgpuStreaming ? (
                    <button
                      className="secondary-link"
                      data-testid="parallel-webgpu-delete-dataset"
                      onClick={() => void deleteWebgpuDataset()}
                      type="button"
                    >
                      Delete local dataset
                    </button>
                  ) : null}
                </div>
              ) : null}
              <dl className="metrics-grid">
                <MetricTerm
                  label="Records"
                  value={streamProgress?.loadedCount ?? diagnostics.recordCount}
                />
                <MetricTerm label="Tables" value={`${tableMetadata.tableCount} (${tableMode})`} />
                <MetricTerm
                  label="Parameters"
                  value={readyBuffers?.axisCount ?? 'n/a'}
                />
                {diagnostics.preselectedCount > 0 ? (
                  <MetricTerm label="Preselected" value={diagnostics.preselectedCount} />
                ) : null}
              </dl>
            </section>
            <section className="control-section">
              <h2>Viewport</h2>
              <div className="route-viewport-controls">
                <div className="route-viewport-group">
                  <span
                    className="route-viewport-group-label"
                    data-testid="parallel-viewport-status"
                  >
                    {adjustedAxisCount === 0
                      ? 'All axes at full range'
                      : `${adjustedAxisCount} ${
                          adjustedAxisCount === 1 ? 'axis' : 'axes'
                        } adjusted`}
                  </span>
                  <button
                    aria-label="Reset viewport"
                    className="secondary-link route-reset-button"
                    data-testid="parallel-reset-viewport"
                    disabled={adjustedAxisCount === 0}
                    onClick={() => chartHandleRef.current?.resetAxisViewports()}
                    type="button"
                  >
                    Reset viewport
                  </button>
                </div>
              </div>
            </section>
            <InteractionCheatSheet
              groups={PARALLEL_SHORTCUT_GROUPS}
              tryItems={PARALLEL_TRY_THIS_ITEMS}
            />
            <section className="control-section">
              <h2>Current selection</h2>
              <MParallelBrushBoundsPanel
                activeBrushes={selectionState.activeBrushes}
                buffers={readyBuffers}
              />
              <dl
                aria-label="Parallel fast selected records"
                className="selection-grid"
                data-active-brush-count={selectionState.activeBrushes.length}
                data-selected-count={selectionState.selectedCount}
                data-selected-sample-ids={
                  selectionState.selectedSampleIds.length > 0
                    ? selectionState.selectedSampleIds.join(',')
                    : 'none'
                }
                data-selection-freshness={selectionState.selectionFreshness}
                data-testid="parallel-fast-selection-state"
              >
                <MetricTerm
                  label="Selected"
                  value={selectionState.selectedCount.toLocaleString('en-US')}
                />
                <MetricTerm
                  label="Brushes"
                  value={selectionState.activeBrushes.length.toLocaleString('en-US')}
                />
                {selectionState.selectionFreshness === 'stale' ? (
                  <MetricTerm label="State" value="pending exact result" />
                ) : null}
                {selectionState.selectedSampleIds.length > 0 ? (
                  <MetricTerm
                    label="Sample IDs"
                    value={selectionState.selectedSampleIds.join(', ')}
                  />
                ) : null}
              </dl>
              <div className="button-row">
                <button
                  disabled={selectionState.activeBrushes.length === 0}
                  onClick={handleClearSelection}
                  type="button"
                >
                  Clear selection
                </button>
                <button
                  disabled={selectionState.selectedCount === 0}
                  onClick={handleExportSelectedIds}
                  type="button"
                >
                  Export selected records
                </button>
              </div>
            </section>
            <section className="control-section">
              <details className="control-disclosure route-advanced-diagnostics">
                <summary>
                  <h2>Advanced diagnostics</h2>
                </summary>
                <div className="control-disclosure-body">
                  <details className="control-disclosure">
                    <summary>Selection callback payload</summary>
                    <div className="control-disclosure-body">
                      <pre
                        className="compact-code-block"
                        data-testid="parallel-fast-selection-filter-preview"
                      >
                        <code>{selectionCallbackPreview}</code>
                      </pre>
                      {selectionState.callbackLog.length === 0 ? (
                        <p
                          className="compact-note"
                          data-testid="parallel-fast-selection-log"
                        >
                          No brush callbacks yet.
                        </p>
                      ) : (
                        <ol
                          className="callback-log"
                          data-testid="parallel-fast-selection-log"
                        >
                          {selectionState.callbackLog.map((entry, index) => (
                            <li key={`${entry}-${index}`}>{entry}</li>
                          ))}
                        </ol>
                      )}
                    </div>
                  </details>
                  <details className="control-disclosure">
                    <summary>Renderer and route metrics</summary>
                    <div className="control-disclosure-body">
                      <dl
                        aria-label="Parallel fast route diagnostics"
                        className="metrics-grid"
                        data-brush-compute-ms={diagnostics.brushComputeMs ?? 'n/a'}
                        data-buffer-build-ms={diagnostics.bufferBuildMs ?? 'n/a'}
                        data-table-mode={diagnostics.tableMode}
                        data-dataset-fetch-ms={diagnostics.datasetFetchMs ?? 'n/a'}
                        data-dataset-parse-ms={diagnostics.datasetParseMs ?? 'n/a'}
                        data-density-blend-mode={diagnostics.densityBlendMode}
                        data-density-mode={diagnostics.densityMode}
                        data-draw-call-count={diagnostics.drawCallCount}
                        data-first-ready-signal-ms={
                          diagnostics.firstReadySignalMs ?? 'n/a'
                        }
                        data-gap-count={diagnostics.gapCount}
                        data-line-set-samples-ms={diagnostics.lineSetSamplesMs ?? 'n/a'}
                        data-line-alpha={diagnostics.lineAlpha ?? 'n/a'}
                        data-user-line-opacity-scale={formatDiagnosticNumber(
                          diagnostics.userLineOpacityScale,
                        )}
                        data-export-serialization-ms={
                          diagnostics.exportSerializationMs ?? 'n/a'
                        }
                        data-react-selection-commit-ms={
                          diagnostics.reactSelectionCommitMs ?? 'n/a'
                        }
                        data-record-count={diagnostics.recordCount}
                        data-preselected-count={diagnostics.preselectedCount}
                        data-preselected-overlay-enabled={
                          diagnostics.preselectedOverlayEnabled ? 'true' : 'false'
                        }
                        data-renderer-kind={diagnostics.rendererKind}
                    data-renderer-redraw-ms={diagnostics.rendererRedrawMs ?? 'n/a'}
                    data-render-state={diagnostics.rendererState}
                    data-renderer-setup-ms={diagnostics.rendererSetupMs ?? 'n/a'}
                    data-renderer-upload-ms={diagnostics.rendererUploadMs ?? 'n/a'}
                    data-sample-count={diagnostics.sampleCount}
                    data-selection-freshness={diagnostics.selectionFreshness}
                    data-selection-visual-update-ms={
                      diagnostics.selectionVisualUpdateMs ?? 'n/a'
                    }
                    data-selected-id-materialization-ms={
                      diagnostics.selectedIdMaterializationMs ?? 'n/a'
                    }
                    data-selected-source-index-creation-ms={
                      diagnostics.selectedSourceIndexCreationMs ?? 'n/a'
                    }
                    data-selected-line-sample-count={diagnostics.selectedLineSampleCount}
                    data-selected-line-alpha={diagnostics.selectedLineAlpha ?? 'n/a'}
                    data-selected-visual-buffer-creation-ms={
                      diagnostics.selectedVisualBufferCreationMs ?? 'n/a'
                    }
                    data-selected-visual-gpu-upload-ms={
                      diagnostics.selectedVisualGpuUploadMs ?? 'n/a'
                    }
                    data-selected-visual-mask-build-ms={
                      diagnostics.selectedVisualMaskBuildMs ?? 'n/a'
                    }
                    data-selected-visual-mask-gpu-upload-ms={
                      diagnostics.selectedVisualMaskGpuUploadMs ?? 'n/a'
                    }
                    data-selected-visual-redraw-ms={
                      diagnostics.selectedVisualRedrawMs ?? 'n/a'
                    }
                    data-shared-array-buffers-used={
                      diagnostics.sharedArrayBuffersUsed ? 'true' : 'false'
                    }
                    data-hover-resolve-ms={diagnostics.hoverResolveMs ?? 'n/a'}
                    data-hover-visual-base-redraw-ms={
                      diagnostics.hoverVisualBaseRedrawMs ?? 'n/a'
                    }
                    data-hover-visual-gpu-upload-ms={
                      diagnostics.hoverVisualGpuUploadMs ?? 'n/a'
                    }
                    data-hover-visual-mode={diagnostics.hoverVisualMode}
                    data-hover-visual-redraw-ms={
                      diagnostics.hoverVisualRedrawMs ?? 'n/a'
                    }
                    data-hover-visual-skipped={
                      diagnostics.hoverVisualSkipped ? 'true' : 'false'
                    }
                    data-hover-visual-update-ms={
                      diagnostics.hoverVisualUpdateMs ?? 'n/a'
                    }
                    data-hover-visual-upload-bytes={diagnostics.hoverVisualUploadBytes}
                    data-hover-index-state={diagnostics.hoverIndexState}
                    data-hover-index-build-ms={diagnostics.hoverIndexBuildMs ?? 'n/a'}
                    data-hover-index-bytes={diagnostics.hoverIndexBytes}
                    data-hover-lookup-source={diagnostics.hoverLookupSource}
                    data-plot-interaction-active={plotInteractionActive ? 'true' : 'false'}
                    data-plot-interaction-focused={
                      plotInteractionGate.hasFocusWithin ? 'true' : 'false'
                    }
                    data-plot-interaction-hovered={
                      plotInteractionGate.isHovered ? 'true' : 'false'
                    }
                    data-table-count={diagnostics.tableCount}
                    data-table-record-counts={diagnostics.tableRecordCounts}
                    data-style-record-count={getParallelFastStyledRecordCount(readyBuffers)}
                    data-webgl-segment-count={diagnostics.webglSegmentCount}
                    data-webgl-vertex-count={diagnostics.webglVertexCount}
                    data-testid="parallel-fast-route-diagnostics"
                  >
                    <MetricTerm
                      label="Fetch"
                      value={formatNullableDuration(diagnostics.datasetFetchMs)}
                    />
                    <MetricTerm
                      label="Parse"
                      value={formatNullableDuration(diagnostics.datasetParseMs)}
                    />
                    <MetricTerm
                      label="Buffer build"
                      value={formatNullableDuration(diagnostics.bufferBuildMs)}
                    />
                    <MetricTerm
                      label="Renderer setup"
                      value={formatNullableDuration(diagnostics.rendererSetupMs)}
                    />
                    <MetricTerm label="Renderer" value={formatRendererKind()} />
                    <MetricTerm label="Density mode" value={diagnostics.densityMode} />
                    <MetricTerm label="Blend mode" value={diagnostics.densityBlendMode} />
                    <MetricTerm
                      label="Line alpha"
                      value={formatNullableAlpha(diagnostics.lineAlpha)}
                    />
                    <MetricTerm
                      label="Line opacity"
                      value={formatScaleLabel(diagnostics.userLineOpacityScale)}
                    />
                    <MetricTerm
                      label="Selected alpha"
                      value={formatNullableAlpha(diagnostics.selectedLineAlpha)}
                    />
                    <MetricTerm
                      label="Renderer upload"
                      value={formatNullableDuration(diagnostics.rendererUploadMs)}
                    />
                    <MetricTerm
                      label="Renderer redraw"
                      value={formatNullableDuration(diagnostics.rendererRedrawMs)}
                    />
                    <MetricTerm
                      label="Line samples"
                      value={formatNullableDuration(diagnostics.lineSetSamplesMs)}
                    />
                    <MetricTerm
                      label="First ready"
                      value={formatNullableDuration(diagnostics.firstReadySignalMs)}
                    />
                    <MetricTerm
                      label="Brush compute"
                      value={formatNullableDuration(diagnostics.brushComputeMs)}
                    />
                    <MetricTerm
                      label="Preselected"
                      value={diagnostics.preselectedCount.toLocaleString('en-US')}
                    />
                    <MetricTerm
                      label="Index create"
                      value={formatNullableDuration(
                        diagnostics.selectedSourceIndexCreationMs,
                      )}
                    />
                    <MetricTerm
                      label="ID materialize"
                      value={formatNullableDuration(
                        diagnostics.selectedIdMaterializationMs,
                      )}
                    />
                    <MetricTerm
                      label="Selection visual"
                      value={formatNullableDuration(diagnostics.selectionVisualUpdateMs)}
                    />
                    <MetricTerm
                      label="Mask build"
                      value={formatNullableDuration(diagnostics.selectedVisualMaskBuildMs)}
                    />
                    <MetricTerm
                      label="Mask upload"
                      value={formatNullableDuration(
                        diagnostics.selectedVisualMaskGpuUploadMs,
                      )}
                    />
                    <MetricTerm
                      label="Selection state"
                      value={
                        selectionState.selectionFreshness === 'stale'
                          ? 'pending exact result'
                          : 'exact'
                      }
                    />
                    <MetricTerm
                      label="Hover inspect"
                      value={formatNullableDuration(diagnostics.hoverResolveMs)}
                    />
                    <MetricTerm
                      label="Hover visual"
                      value={formatNullableDuration(diagnostics.hoverVisualUpdateMs)}
                    />
                    <MetricTerm label="Hover index" value={diagnostics.hoverIndexState} />
                    <MetricTerm
                      label="Hover index build"
                      value={formatNullableDuration(diagnostics.hoverIndexBuildMs)}
                    />
                    <MetricTerm
                      label="Styled records"
                      value={getParallelFastStyledRecordCount(readyBuffers).toLocaleString(
                        'en-US',
                      )}
                    />
                    <MetricTerm
                      label="Table records"
                      value={diagnostics.tableRecordCounts}
                    />
                    <MetricTerm
                      label="Selected line samples"
                      value={diagnostics.selectedLineSampleCount.toLocaleString('en-US')}
                    />
                    <MetricTerm
                      label="WebGL segments"
                      value={diagnostics.webglSegmentCount.toLocaleString('en-US')}
                    />
                    <MetricTerm
                      label="Draw calls"
                      value={diagnostics.drawCallCount.toLocaleString('en-US')}
                    />
                  </dl>
                </div>
              </details>
                </div>
              </details>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}

function MParallelEngineChart({
  rendererBackend,
  axisViewports,
  onAxisViewportsChange,
  axisOverlay,
  brushIntervals,
  buffers,
  hoverIndex,
  inspection,
  lineOpacityScale = 1,
  onBrushIntervalsPreview,
  onHandleChange,
  onInspectionChange,
  onLineOpacityAdjustRequest,
  onMetricsChange,
  onOverlaysChange,
  onSelectionChange,
  preserveDrawingBuffer = false,
  preselectedOverlayEnabled,
  preselectedSourceIndices,
  selectedHighlightCount,
  selectedVisualUpdateDelayMs,
  shortcutGate,
  theme,
  streamingSource,
  onStreamProgress,
}: {
  rendererBackend: ParallelRendererBackend;
  axisViewports: ParallelAxisViewports;
  onAxisViewportsChange: (
    axisViewports: ParallelAxisViewports,
    phase: 'preview' | 'commit',
  ) => void;
  axisOverlay: ReactNode;
  brushIntervals: ParallelBrushIntervals;
  buffers: ParallelBuffers;
  hoverIndex: ParallelHoverIndex | null;
  inspection: ParallelFastInspectionState | null;
  lineOpacityScale?: number;
  onSelectionChange: (
    event: ParallelFastSelectionChangeEvent,
    source: string,
  ) => void;
  onBrushIntervalsPreview: (brushIntervals: ParallelBrushIntervals) => void;
  onHandleChange: (handle: ParallelFastRoutePlotHandle | null) => void;
  onInspectionChange: (
    inspection: ParallelFastInspectionState | null,
    resolveMs: number | null,
    lookupSource: ParallelFastDiagnostics['hoverLookupSource'],
  ) => void;
  onLineOpacityAdjustRequest: (
    adjustment: ParallelLineOpacityAdjustment,
  ) => void;
  onMetricsChange: (event: ParallelFastRendererMetricsEvent) => void;
  onOverlaysChange: (overlays: readonly ParallelFastOverlayDescriptor[]) => void;
  preserveDrawingBuffer?: boolean;
  preselectedOverlayEnabled: boolean;
  preselectedSourceIndices: Uint32Array;
  selectedHighlightCount: number;
  selectedVisualUpdateDelayMs: number;
  shortcutGate: () => boolean;
  theme?: Parameters<ParallelPlotCommands['updateTheme']>[0];
  streamingSource?: ParallelWebgpuStreamSource;
  onStreamProgress: (
    progress: ParallelWebgpuStreamProgress,
    buffers: ParallelBuffers,
  ) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const pendingBrushCommitSourceRef = useRef<string | null>(null);
  const plotRef = useRef<ParallelPlotInstance | null>(null);
  const latestHoverIndexRef = useRef<ParallelHoverIndex | null>(hoverIndex);
  const latestEngineOptionsRef = useRef({
    axisViewports,
    brushIntervals,
    buffers,
    inspection,
    lineOpacityScale,
    preserveDrawingBuffer,
    preselectedOverlayEnabled,
    preselectedSourceIndices,
    selectedVisualUpdateDelayMs,
    theme,
  });
  const callbacksRef = useRef({
    onAxisViewportsChange,
    onBrushIntervalsPreview,
    onInspectionChange,
    onLineOpacityAdjustRequest,
    onMetricsChange,
    onOverlaysChange,
    onSelectionChange,
    onStreamProgress,
  });
  const styleBuffers = (
    buffers as ParallelBuffers & {
      styleBuffers?: {
        colorFormat: string;
        opacity: { length: number };
        styledRecordCount: number;
      };
    }
  ).styleBuffers;
  const [renderState, setRenderState] = useState<{
    message?: string;
    status: ParallelFastRendererState;
  }>({ status: 'idle' });
  const [readyStreamingSource, setReadyStreamingSource] =
    useState<ParallelWebgpuStreamSource | null>(null);

  useEffect(() => {
    callbacksRef.current = {
      onAxisViewportsChange,
      onBrushIntervalsPreview,
      onInspectionChange,
      onLineOpacityAdjustRequest,
      onMetricsChange,
      onOverlaysChange,
      onSelectionChange,
      onStreamProgress,
    };
  }, [
    onAxisViewportsChange,
    onBrushIntervalsPreview,
    onInspectionChange,
    onLineOpacityAdjustRequest,
    onMetricsChange,
    onOverlaysChange,
    onSelectionChange,
    onStreamProgress,
  ]);

  const plotDataKey = streamingSource ?? buffers;

  useEffect(() => {
    latestHoverIndexRef.current = hoverIndex;
  }, [hoverIndex]);

  useEffect(() => {
    latestEngineOptionsRef.current = {
      axisViewports,
      brushIntervals,
      buffers,
      inspection,
      lineOpacityScale,
      preserveDrawingBuffer,
      preselectedOverlayEnabled,
      preselectedSourceIndices,
      selectedVisualUpdateDelayMs,
      theme,
    };
  }, [
    axisViewports,
    brushIntervals,
    buffers,
    inspection,
    lineOpacityScale,
    preserveDrawingBuffer,
    preselectedOverlayEnabled,
    preselectedSourceIndices,
    selectedVisualUpdateDelayMs,
    theme,
  ]);

  useEffect(() => {
    const host = hostRef.current;
    const shell = shellRef.current;
    if (host === null || shell === null) {
      return;
    }
    const initialOptions = latestEngineOptionsRef.current;
    let disposed = false;
    let cleanupAttachedPlot = () => undefined;
    const createAndAttachPlot = async () => {
      const commonOptions = {
        axisViewports: initialOptions.axisViewports,
        baseCanvasClassName:
          rendererBackend === 'webgpu'
            ? 'parallel-fast-webgpu-canvas parallel-fast-webgpu-canvas-base'
            : 'parallel-fast-webgl-canvas parallel-fast-webgl-canvas-base',
        brushIntervals: initialOptions.brushIntervals,
        hoverCanvasClassName:
          'parallel-fast-webgl-canvas parallel-fast-webgl-hover-canvas',
        inspection: initialOptions.inspection,
        lineOpacityScale: initialOptions.lineOpacityScale,
        onMetrics: (event: ParallelFastRendererMetricsEvent) => {
          callbacksRef.current.onMetricsChange(event);
        },
        preserveDrawingBuffer: initialOptions.preserveDrawingBuffer,
        preselectedOverlayEnabled: initialOptions.preselectedOverlayEnabled,
        preselectedSourceIndices: initialOptions.preselectedSourceIndices,
        selectedVisualUpdateDelayMs: initialOptions.selectedVisualUpdateDelayMs,
        theme: initialOptions.theme,
      };
      let streamingPlot: Awaited<
        ReturnType<typeof createParallelWebgpuStreamingPlot>
      > | null = null;
      const plot: ParallelPlotInstance =
        rendererBackend === 'webgpu' && streamingSource !== undefined
          ? await createParallelWebgpuStreamingPlot(host, {
              ...commonOptions,
              dataSource: streamingSource,
              onStreamProgress: (progress) => {
                callbacksRef.current.onStreamProgress(
                  progress,
                  streamingPlot?.streaming.getBuffers() ?? initialOptions.buffers,
                );
              },
            }).then((createdPlot) => {
              streamingPlot = createdPlot;
              callbacksRef.current.onStreamProgress(
                createdPlot.streaming.getProgress(),
                createdPlot.streaming.getBuffers(),
              );
              return createdPlot;
            })
          : rendererBackend === 'webgpu'
            ? createParallelWebgpuPlot(host, {
                ...commonOptions,
                buffers: initialOptions.buffers,
              })
            : createParallelPlot(host, {
                ...commonOptions,
                buffers: initialOptions.buffers,
              });
      if (disposed) {
        plot.dispose();
        return;
      }
    plotRef.current = plot;
    setRenderState({
      message: plot.commands.getRenderSnapshot().renderStateMessage,
      status: plot.commands.getRenderSnapshot().renderState,
    });
    const handle: ParallelFastRoutePlotHandle = {
      clearBrushes: (source = 'brush') => {
        pendingBrushCommitSourceRef.current = source;
        plot.commands.clearBrushes({ source: 'route' });
      },
      clearOverlays: (kind) => {
        plot.commands.clearOverlays(kind);
      },
      commitBrushIntervals: (nextBrushIntervals, source = 'brush') => {
        pendingBrushCommitSourceRef.current = source;
        plot.commands.commitBrushIntervals(nextBrushIntervals, {
          source: 'route',
        });
      },
      getWebgpuDiagnostics: () =>
        rendererBackend === 'webgpu'
          ? (plot as ParallelWebgpuPlotInstance).getWebgpuDiagnostics()
          : null,
      requestLineOpacityAdjustment: (adjustment) => {
        plot.commands.requestLineOpacityAdjustment(adjustment, {
          source: 'route',
        });
      },
      resetAxisViewports: () => {
        plot.commands.resetAxisViewports({ source: 'route' });
      },
      setAxisViewports: (nextAxisViewports) => {
        plot.commands.setAxisViewports(nextAxisViewports, { source: 'route' });
      },
      setInspection: (nextInspection, resolveMs = null) => {
        plot.commands.setInspection(nextInspection, {
          lookupSource: nextInspection === null ? 'none' : 'index',
          resolveMs,
          source: 'route',
        });
      },
    };
    onHandleChange(handle);
    onOverlaysChange(plot.commands.getOverlays());
    const inputElement =
      shell.parentElement instanceof HTMLElement ? shell.parentElement : shell;
    plot.use(
      createDefaultParallelBindings({
        brushHitTest: createParallelDomBrushHitTest(),
        coordinateTarget: host,
        ignoreKeyboardTarget: shouldIgnoreParallelFastShortcutTarget,
        inputElement,
        inspection: {
          explicitHoverModeActive: isParallelFastExplicitHoverModeActive,
          getHoverIndex: () => latestHoverIndexRef.current,
          maxDistancePx: PARALLEL_FAST_INSPECT_MAX_DISTANCE_PX,
          smallDatasetFallbackRecordLimit: 20_000,
        },
        keyboardTarget: window,
        shortcutGate,
      }),
    );
    const unsubscribeRenderState = plot.on('renderstatechange', (event) => {
      setRenderState({ message: event.message, status: event.state });
      if (streamingSource !== undefined && event.state === 'ready') {
        setReadyStreamingSource(streamingSource);
      }
    });
    const unsubscribeBrushPreview = plot.on('brushpreview', (event) => {
      if (event.defaultAction !== 'select') {
        return;
      }
      callbacksRef.current.onBrushIntervalsPreview(event.brushIntervals);
    });
    const unsubscribeOverlay = plot.on('overlaychange', (event) => {
      callbacksRef.current.onOverlaysChange(event.overlays);
    });
    const unsubscribeSelection = plot.on('selectionchange', (event) => {
      const source =
        pendingBrushCommitSourceRef.current ??
        (event.source === 'keyboard' && event.reason === 'clear'
          ? 'escape'
          : event.source === 'pointer' && event.reason === 'remove'
            ? 'double-click-remove'
          : 'brush');
      pendingBrushCommitSourceRef.current = null;
      callbacksRef.current.onSelectionChange(event, source);
    });
    const unsubscribeInspection = plot.on('inspectionchange', (event) => {
      callbacksRef.current.onInspectionChange(
        event.inspection,
        event.resolveMs,
        event.lookupSource,
      );
    });
    const unsubscribeLineOpacity = plot.on('lineopacityadjustrequest', (event) => {
      callbacksRef.current.onLineOpacityAdjustRequest(event.adjustment);
    });
    const unsubscribeAxisViewport = plot.on('axisviewportchange', (event) => {
      callbacksRef.current.onAxisViewportsChange(event.axisViewports, 'commit');
    });
    const unsubscribeAxisViewportPreview = plot.on(
      'axisviewportpreview',
      (event) => {
        callbacksRef.current.onAxisViewportsChange(event.axisViewports, 'preview');
      },
    );

      const activeStreamingPlot = streamingSource === undefined
        ? null
        : plot as Awaited<ReturnType<typeof createParallelWebgpuStreamingPlot>>;
      if (activeStreamingPlot !== null) {
        void activeStreamingPlot.streaming.done.catch((error: unknown) => {
          if (disposed) return;
          setRenderState({
            message: error instanceof Error ? error.message : 'Unknown streaming error.',
            status: 'error',
          });
        });
      }
      cleanupAttachedPlot = () => {
      unsubscribeAxisViewportPreview();
      unsubscribeAxisViewport();
      unsubscribeLineOpacity();
      unsubscribeInspection();
      unsubscribeSelection();
      unsubscribeOverlay();
      unsubscribeBrushPreview();
      unsubscribeRenderState();
      onHandleChange(null);
      onOverlaysChange([]);
      plotRef.current = null;
      plot.dispose();
      };
    };
    void createAndAttachPlot().catch((error: unknown) => {
      if (disposed) return;
      setRenderState({
        message: error instanceof Error ? error.message : 'Unknown plot startup error.',
        status: 'error',
      });
    });

    return () => {
      disposed = true;
      cleanupAttachedPlot();
    };
  }, [
    onHandleChange,
    onOverlaysChange,
    plotDataKey,
    preserveDrawingBuffer,
    rendererBackend,
    shortcutGate,
    streamingSource,
  ]);

  useEffect(() => {
    plotRef.current?.update({ theme });
  }, [theme]);

  useEffect(() => {
    plotRef.current?.update({ lineOpacityScale });
  }, [lineOpacityScale]);

  useEffect(() => {
    plotRef.current?.update({
      preselectedOverlayEnabled,
      preselectedSourceIndices,
    });
  }, [preselectedOverlayEnabled, preselectedSourceIndices]);

  useEffect(() => {
    plotRef.current?.update({ selectedVisualUpdateDelayMs });
  }, [selectedVisualUpdateDelayMs]);

  useEffect(() => {
    const plot = plotRef.current;
    if (plot === null) {
      return;
    }
    if (areParallelFastInspectionsEqual(plot.commands.getStateSnapshot().inspection, inspection)) {
      return;
    }
    plot.update({ inspection });
  }, [inspection]);

  const plotReadyForInteraction =
    renderState.status === 'ready' ||
    (streamingSource !== undefined && readyStreamingSource === streamingSource);
  const plotPreparing = !plotReadyForInteraction && renderState.status !== 'error';

  return (
    <div
      ref={shellRef}
      aria-label={`Parallel fast ${rendererBackend === 'webgpu' ? 'WebGPU' : 'WebGL2'} chart`}
      aria-busy={plotPreparing ? true : undefined}
      className="parallel-fast-chart-shell"
      data-plot-ready={plotReadyForInteraction ? 'true' : 'false'}
      role="region"
    >
      <div
        ref={hostRef}
        aria-label={
          rendererBackend === 'webgpu'
            ? 'WebGPU density parallel renderer'
            : 'WebGL2 segment parallel renderer'
        }
        className="parallel-fast-chart-host"
        data-axis-count={buffers.axisCount}
        data-axis-viewport-count={Object.keys(axisViewports).length}
        data-axis-labels={buffers.axisOrder.join('|')}
        data-density-blend-mode="src-alpha-one-minus-src-alpha"
        data-density-mode="adaptive-alpha-source-over"
        data-gap-count={buffers.lineSeriesBuffers.gapCount}
        data-hover-highlight-count={inspection === null ? 0 : 1}
        data-hover-visual-mode={
          rendererBackend === 'webgpu'
            ? 'canvas2d-hover-overlay'
            : 'webgl2-hover-overlay-canvas'
        }
        data-line-opacity-scale={lineOpacityScale.toFixed(4)}
        data-preselected-highlight-count={
          preselectedOverlayEnabled ? preselectedSourceIndices.length : 0
        }
        data-preselected-overlay-enabled={
          preselectedOverlayEnabled ? 'true' : 'false'
        }
        data-record-count={buffers.recordCount}
        data-render-state={renderState.status}
        data-renderer={
          rendererBackend === 'webgpu'
            ? 'webgpu-parallel-density'
            : 'webgl2-segments'
        }
        data-sample-count={buffers.lineSeriesBuffers.sampleCount}
        data-selected-highlight-count={selectedHighlightCount}
        data-selected-visual-mode={
          rendererBackend === 'webgpu'
            ? 'webgpu-selected-density'
            : 'webgl2-selected-mask'
        }
        data-selected-visual-precedence="brush-over-dataset"
        data-style-color-format={styleBuffers?.colorFormat ?? 'none'}
        data-style-opacity-count={styleBuffers?.opacity.length ?? 0}
        data-style-record-count={styleBuffers?.styledRecordCount ?? 0}
        data-testid="parallel-fast-chart-layout"
        data-webgl-segment-count={buffers.webglSegmentBuffers?.segmentCount ?? 0}
        data-webgl-vertex-count={
          buffers.webglSegmentBuffers
            ? buffers.webglSegmentBuffers.segmentCount *
              buffers.webglSegmentBuffers.verticesPerSegment
            : 0
        }
      />
      {plotPreparing ? (
        <PlotLoadingOverlay
          detail={renderState.message ?? 'Loading renderer and plot data'}
          label="Preparing parallel plot"
          testId="parallel-fast-plot-loading"
        />
      ) : null}
      {renderState.status === 'error' ? (
        <div className="lc-status lc-status-error" role="alert">
          {renderState.message}
        </div>
      ) : null}
      {axisOverlay}
    </div>
  );
}

function PlotLoadingOverlay({
  detail,
  label,
  testId,
}: {
  detail?: string;
  label: string;
  testId: string;
}) {
  return (
    <div
      aria-live="polite"
      className="plot-loading-overlay"
      data-testid={testId}
      role="status"
    >
      <span aria-hidden="true" className="plot-loading-spinner" />
      <span className="plot-loading-label">{label}</span>
      {detail ? <span className="plot-loading-detail">{detail}</span> : null}
    </div>
  );
}

function MParallelAxisBrushOverlay({
  axisViewports,
  buffers,
  overlays,
}: {
  axisViewports: ParallelAxisViewports;
  buffers: ParallelBuffers;
  overlays: readonly ParallelFastOverlayDescriptor[];
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [overlayHeightPx, setOverlayHeightPx] = useState<number | null>(null);
  const inspection =
    overlays.find((overlay) => overlay.kind === 'inspection')?.inspection ?? null;
  const brushIntervals = getParallelBrushOverlayIntervals(overlays);

  useEffect(() => {
    const node = overlayRef.current;

    if (!node) {
      return undefined;
    }

    const updateOverlayHeight = () => {
      setOverlayHeightPx(node.getBoundingClientRect().height);
    };

    updateOverlayHeight();

    const ResizeObserverCtor = globalThis.ResizeObserver;
    if (ResizeObserverCtor) {
      const observer = new ResizeObserverCtor(updateOverlayHeight);
      observer.observe(node);

      return () => {
        observer.disconnect();
      };
    }

    globalThis.window?.addEventListener('resize', updateOverlayHeight);

    return () => {
      globalThis.window?.removeEventListener('resize', updateOverlayHeight);
    };
  }, []);

  return (
    <div
      aria-label="Parallel fast axis brush overlay"
      className="parallel-fast-axis-overlay"
      data-axis-count={buffers.axisCount}
      data-testid="parallel-fast-axis-overlay"
      ref={overlayRef}
      role="group"
      style={
        {
          '--parallel-fast-axis-label-max-width': getAxisLabelMaxWidth(
            buffers.axisCount,
          ),
          '--parallel-fast-axis-tick-max-width': getAxisTickLabelMaxWidth(
            buffers.axisCount,
          ),
        } as CSSProperties
      }
    >
      {inspection ? (
        <MParallelInspectionMarkers
          axisViewports={axisViewports}
          buffers={buffers}
          inspection={inspection}
        />
      ) : null}
      {buffers.axisOrder.map((parameter, axisIndex) => {
        const brushRanges = getBrushRangesForAxis(
          brushIntervals,
          parameter,
        );
        const completeDomain = buffers.domainsByAxis[parameter];
        const viewport = axisViewports[parameter];
        const domain =
          viewport === null || viewport === undefined
            ? completeDomain
            : {
                max: viewport.max,
                min: viewport.min,
                span: viewport.max - viewport.min,
              };
        const axisMetadata = (
          buffers as ParallelBuffers & {
            axisMetadataByAxis?: Readonly<Record<string, ParallelFastAxisMetadata>>;
          }
        ).axisMetadataByAxis?.[parameter];
        const axisLabel = axisMetadata?.label ?? parameter;
        const axisKind = axisMetadata?.kind ?? 'numeric';
        const ticks = createParallelFastAxisTicks(axisMetadata, {
          count: getParallelFastOverlayTickCount(
            buffers.axisCount,
            axisKind,
            axisMetadata,
            domain,
            overlayHeightPx,
          ),
          range: domain,
        });
        const axisBoundaries = getParallelFastAxisBoundaryLabels(axisMetadata, domain, ticks);
        const renderedTicks = isParallelFastDiscreteAxisKind(axisKind)
          ? ticks
          : ticks.slice(1, -1);
        const axisLeftPercent =
          buffers.axisCount <= 1
            ? 50
            : (axisIndex / (buffers.axisCount - 1)) * 100;
        const axisBottomPercent = PARALLEL_AXIS_MIN_DISPLAY_VALUE * 100;
        const axisTopPercent = (1 - PARALLEL_AXIS_MAX_DISPLAY_VALUE) * 100;
        const missingAnchorPercent = PARALLEL_MISSING_AXIS_DISPLAY_VALUE * 100;
        const belowViewportAnchorPercent =
          PARALLEL_BELOW_VIEWPORT_DISPLAY_VALUE * 100;
        const aboveViewportAnchorPercent =
          (1 - PARALLEL_ABOVE_VIEWPORT_DISPLAY_VALUE) * 100;
        const viewportActive =
          viewport !== null &&
          viewport !== undefined &&
          (viewport.min !== completeDomain.min || viewport.max !== completeDomain.max);
        const hasBelowViewportValues =
          viewportActive && completeDomain.min < viewport.min;
        const hasAboveViewportValues =
          viewportActive && completeDomain.max > viewport.max;
        const hasMissingValues =
          (buffers.missingValueCountByAxis?.[parameter] ?? 0) > 0;

        return (
          <div
            aria-label={`Brush ${parameter}`}
            className={[
              'parallel-fast-axis-guide',
              axisIndex === 0 ? 'parallel-fast-axis-guide-first' : '',
              axisIndex === buffers.axisCount - 1
                ? 'parallel-fast-axis-guide-last'
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-axis={parameter}
            data-axis-kind={axisKind}
            data-axis-label={axisLabel}
            data-above-viewport={hasAboveViewportValues ? 'true' : 'false'}
            data-below-viewport={hasBelowViewportValues ? 'true' : 'false'}
            data-missing-values={hasMissingValues ? 'true' : 'false'}
            data-max-label={axisBoundaries.max.label}
            data-min-label={axisBoundaries.min.label}
            data-rendered-tick-labels={renderedTicks.map((tick) => tick.label).join('|')}
            data-tick-labels={ticks.map((tick) => tick.label).join('|')}
            key={parameter}
            style={
              {
                '--parallel-fast-normal-axis-bottom': `${axisBottomPercent}%`,
                '--parallel-fast-normal-axis-top': `${axisTopPercent}%`,
                '--parallel-fast-missing-axis-anchor': `${missingAnchorPercent}%`,
                '--parallel-fast-below-viewport-anchor': `${belowViewportAnchorPercent}%`,
                '--parallel-fast-above-viewport-anchor': `${aboveViewportAnchorPercent}%`,
                left: `${axisLeftPercent}%`,
              } as CSSProperties
            }
          >
            <div
              aria-hidden={!hasMissingValues}
              aria-label="Missing value"
              className="parallel-fast-axis-special-rail parallel-fast-axis-missing-rail"
              data-visible={hasMissingValues ? 'true' : 'false'}
              title="Missing value"
            >
              <span aria-hidden="true">∅</span>
            </div>
            <div
              aria-hidden={!hasBelowViewportValues}
              aria-label="Below visible range"
              className="parallel-fast-axis-special-rail parallel-fast-axis-overflow-rail parallel-fast-axis-overflow-rail-below"
              data-visible={hasBelowViewportValues ? 'true' : 'false'}
              title={`Below visible range (< ${axisBoundaries.min.title})`}
            >
              <span aria-hidden="true">↓</span>
            </div>
            <div
              aria-hidden={!hasAboveViewportValues}
              aria-label="Above visible range"
              className="parallel-fast-axis-special-rail parallel-fast-axis-overflow-rail parallel-fast-axis-overflow-rail-above"
              data-visible={hasAboveViewportValues ? 'true' : 'false'}
              title={`Above visible range (> ${axisBoundaries.max.title})`}
            >
              <span aria-hidden="true">↑</span>
            </div>
            <div className="parallel-fast-axis-line" />
            <div className="parallel-fast-axis-ticks" aria-hidden="true">
              {renderedTicks.map((tick) => {
                const normalizedValue = rawValueToNormalized(tick.value, domain);

                return (
                  <div
                    className="parallel-fast-axis-tick"
                    data-axis={parameter}
                    data-axis-kind={axisKind}
                    data-full-label={tick.fullLabel ?? tick.label}
                    data-value={tick.value}
                    data-testid="parallel-fast-axis-tick"
                    key={`${parameter}-${tick.value}`}
                    style={{
                      top: `${parallelNormalizedValueToTopPercent(normalizedValue)}%`,
                    }}
                    title={tick.fullLabel ?? tick.label}
                  >
                    <span className="parallel-fast-axis-tick-label">{tick.label}</span>
                  </div>
                );
              })}
            </div>
            <div
              className="parallel-fast-axis-value parallel-fast-axis-value-max"
              data-testid="parallel-fast-axis-value-max"
              title={axisBoundaries.max.title}
            >
              {axisBoundaries.max.label}
            </div>
            <div
              className="parallel-fast-axis-value parallel-fast-axis-value-min"
              data-testid="parallel-fast-axis-value-min"
              title={axisBoundaries.min.title}
            >
              {axisBoundaries.min.label}
            </div>
            <div
              className="parallel-fast-axis-label"
              data-testid="parallel-fast-axis-label"
              title={axisLabel}
            >
              {axisLabel}
            </div>
            {brushRanges.map((brushRange, axisRangeIndex) => (
              <MParallelAxisBrush
                axisMetadata={getAxisMetadata(buffers, parameter)}
                axisRangeIndex={axisRangeIndex}
                domain={domain}
                parameter={parameter}
                range={brushRange}
                key={`${parameter}-${axisRangeIndex}`}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function getParallelBrushOverlayIntervals(
  overlays: readonly ParallelFastOverlayDescriptor[],
): ParallelBrushIntervals {
  return overlays.reduce(
    (result, overlay) => {
      if (overlay.kind === 'axis-brush') {
        return overlay.brushIntervals;
      }
      return result;
    },
    {} as ParallelBrushIntervals,
  );
}

function getAxisLabelMaxWidth(axisCount: number): string {
  if (axisCount <= 3) {
    return '9.5rem';
  }

  if (axisCount <= 5) {
    return '7rem';
  }

  return '5.25rem';
}

function getAxisTickLabelMaxWidth(axisCount: number): string {
  if (axisCount <= 3) {
    return '6.75rem';
  }

  if (axisCount <= 5) {
    return '5.5rem';
  }

  if (axisCount <= 7) {
    return '4.5rem';
  }

  return '3.5rem';
}

function getParallelFastOverlayTickCount(
  axisCount: number,
  axisKind: ParallelFastAxisKind,
  axis: ParallelFastAxisMetadata | undefined,
  domain: { max: number; min: number },
  overlayHeightPx: number | null,
): number {
  if (isParallelFastDiscreteAxisKind(axisKind)) {
    const categoryCount = getVisibleParallelFastDiscreteCategoryCount(axis, domain);
    const heightLimitedCount =
      overlayHeightPx === null
        ? PARALLEL_FAST_SMALL_DISCRETE_TICK_LIMIT
        : Math.max(2, Math.floor(overlayHeightPx / 24));

    if (
      categoryCount > 0 &&
      categoryCount <= PARALLEL_FAST_SMALL_DISCRETE_TICK_LIMIT &&
      categoryCount <= heightLimitedCount
    ) {
      return categoryCount;
    }

    if (categoryCount > 0) {
      return Math.min(categoryCount, heightLimitedCount);
    }

    return axisKind === 'boolean' ? 2 : Math.min(5, heightLimitedCount);
  }

  if (axisCount >= 8) {
    return 4;
  }

  if (axisCount >= 6) {
    return 5;
  }

  return 6;
}

function isParallelFastDiscreteAxisKind(axisKind: ParallelFastAxisKind): boolean {
  return axisKind === 'categorical' || axisKind === 'boolean';
}

function getVisibleParallelFastDiscreteCategoryCount(
  axis: ParallelFastAxisMetadata | undefined,
  domain: { max: number; min: number },
): number {
  if (axis?.kind !== 'categorical' && axis?.kind !== 'boolean') {
    return 0;
  }

  return axis.categories.filter(
    (category) => category.encoded >= domain.min && category.encoded <= domain.max,
  ).length;
}

function getParallelFastAxisBoundaryLabels(
  axis: ParallelFastAxisMetadata | undefined,
  domain: { max: number; min: number },
  ticks: readonly ParallelFastAxisTick[],
): {
  max: { label: string; title: string };
  min: { label: string; title: string };
} {
  const minTick = ticks[0];
  const maxTick = ticks[ticks.length - 1];

  return {
    max: {
      label:
        maxTick?.label ??
        formatParallelFastAxisValue(axis, domain.max),
      title:
        maxTick?.fullLabel ??
        maxTick?.label ??
        formatParallelFastAxisValue(axis, domain.max),
    },
    min: {
      label:
        minTick?.label ??
        formatParallelFastAxisValue(axis, domain.min),
      title:
        minTick?.fullLabel ??
        minTick?.label ??
        formatParallelFastAxisValue(axis, domain.min),
    },
  };
}

function parallelNormalizedValueToTopPercent(normalizedValue: number): number {
  const displayValue = parallelRenderedNormalizedValueToDisplayValue(normalizedValue);
  if (!Number.isFinite(displayValue)) {
    return 100;
  }

  return (1 - displayValue) * 100;
}

function MParallelAxisBrush({
  axisMetadata,
  axisRangeIndex,
  domain,
  parameter,
  range,
}: {
  axisMetadata: ParallelFastAxisMetadata | undefined;
  axisRangeIndex: number;
  domain: { max: number; min: number; span: number };
  parameter: ParallelParameter;
  range: NumericRange;
}) {
  const normalizedRange = normalizeRange(range);
  const maxNormalized = rawValueToNormalized(normalizedRange.max, domain);
  const minNormalized = rawValueToNormalized(normalizedRange.min, domain);
  const topPercent = parallelNormalizedValueToTopPercent(maxNormalized);
  const bottomPercent = parallelNormalizedValueToTopPercent(minNormalized);
  const brushRangeLabels = formatAxisBrushRangeLabels(
    axisMetadata,
    normalizedRange.min,
    normalizedRange.max,
  );

  return (
    <div
      aria-label={`${parameter} brush range`}
      className="parallel-fast-axis-brush"
      data-axis={parameter}
      data-axis-kind={axisMetadata?.kind ?? 'numeric'}
      data-axis-range-index={axisRangeIndex}
      data-brush-max={normalizedRange.max}
      data-brush-min={normalizedRange.min}
      data-brush-purpose="selection"
      data-formatted-max={brushRangeLabels.max}
      data-formatted-min={brushRangeLabels.min}
      data-testid="parallel-fast-axis-brush"
      style={{
        height: `${Math.max(0, bottomPercent - topPercent)}%`,
        top: `${topPercent}%`,
      }}
    >
      <>
        <button
          aria-label={`Resize ${parameter} brush maximum`}
          className="parallel-fast-axis-brush-handle parallel-fast-axis-brush-handle-max"
          type="button"
        />
        <button
          aria-label={`Move ${parameter} brush range`}
          className="parallel-fast-axis-brush-band"
          title={`${brushRangeLabels.min} – ${brushRangeLabels.max}`}
          type="button"
        >
          <span>{brushRangeLabels.min}</span>
          <span>{brushRangeLabels.max}</span>
        </button>
        <button
          aria-label={`Resize ${parameter} brush minimum`}
          className="parallel-fast-axis-brush-handle parallel-fast-axis-brush-handle-min"
          type="button"
        />
      </>
    </div>
  );
}

function MParallelInspectionMarkers({
  axisViewports,
  buffers,
  inspection,
}: {
  axisViewports: ParallelAxisViewports;
  buffers: ParallelBuffers;
  inspection: ParallelFastInspectionState;
}) {
  const axisLabels = getParallelFastInspectionAxisLabels(
    axisViewports,
    buffers,
    inspection,
  );
  const leftPercent =
    buffers.axisCount <= 1
      ? 50
      : (inspection.projectedAxisPosition / (buffers.axisCount - 1)) * 100;
  const topPercent = parallelNormalizedValueToTopPercent(
    inspection.projectedNormalizedValue,
  );

  return (
    <>
      <div
        aria-hidden="true"
        className="parallel-fast-inspection-marker"
        data-record-id={inspection.id}
        data-testid="parallel-fast-inspection-projection-marker"
        style={{
          left: `${leftPercent}%`,
          top: `${topPercent}%`,
        }}
      />
      {axisLabels.map((label) => (
        <div
          aria-hidden="true"
          className="parallel-fast-inspection-crossing"
          data-active={label.isActive ? 'true' : 'false'}
          data-axis={label.axis}
          data-axis-kind={label.axisKind}
          data-label-side={label.side}
          data-record-id={inspection.id}
          key={label.axis}
        >
          <div
            className="parallel-fast-inspection-marker parallel-fast-inspection-axis-marker"
            data-axis={label.axis}
            data-record-id={inspection.id}
            data-testid="parallel-fast-inspection-axis-marker"
            style={{
              left: `${label.markerLeftPercent}%`,
              top: `${label.markerTopPercent}%`,
            }}
          />
          <div
            className="parallel-fast-inspection-axis-label"
            data-active={label.isActive ? 'true' : 'false'}
            data-axis={label.axis}
            data-axis-kind={label.axisKind}
            data-label-side={label.side}
            data-record-id={inspection.id}
            data-testid="parallel-fast-inspection-axis-label"
            data-value-text={label.valueText}
            title={`${label.axisLabel}: ${label.valueText}`}
            style={{
              left: `${label.markerLeftPercent}%`,
              top: `${label.labelTopPercent}%`,
            }}
          >
            {label.valueText}
          </div>
        </div>
      ))}
    </>
  );
}

type ParallelFastInspectionLabelSide = 'left' | 'right';

interface ParallelFastInspectionAxisLabel {
  axis: ParallelParameter;
  axisIndex: number;
  axisKind: ParallelFastAxisKind;
  axisLabel: string;
  isActive: boolean;
  labelTopPercent: number;
  markerLeftPercent: number;
  markerTopPercent: number;
  side: ParallelFastInspectionLabelSide;
  valueText: string;
}

type ParallelFastInspectionFormatterBuffers = ParallelBuffers & {
  axisMetadataByAxis?: Readonly<Record<ParallelParameter, ParallelFastAxisMetadata>>;
};

function getParallelFastInspectionAxisLabels(
  axisViewports: ParallelAxisViewports,
  buffers: ParallelBuffers,
  inspection: ParallelFastInspectionState,
): ParallelFastInspectionAxisLabel[] {
  const formatterBuffers = buffers as ParallelFastInspectionFormatterBuffers;
  const labels = buffers.axisOrder
    .map((axis, axisIndex) => {
      const normalizedValue = readParallelInspectionAxisNormalizedValue(
        axisViewports,
        buffers,
        axis,
        inspection.recordIndex,
      );

      if (!Number.isFinite(normalizedValue)) {
        return null;
      }

      const axisMetadata = formatterBuffers.axisMetadataByAxis?.[axis];
      const formattedValue = formatParallelFastRecordAxisValue(
        formatterBuffers,
        axis,
        inspection.recordIndex,
      );
      const valueText =
        normalizedValue === PARALLEL_BELOW_VIEWPORT_ROUTE_NORMALIZED_Y
          ? `Below range: ${formattedValue}`
          : normalizedValue === PARALLEL_ABOVE_VIEWPORT_ROUTE_NORMALIZED_Y
            ? `Above range: ${formattedValue}`
            : formattedValue;

      return {
        axis,
        axisIndex,
        axisKind: axisMetadata?.kind ?? 'numeric',
        axisLabel: axisMetadata?.label ?? axis,
        isActive: axis === inspection.activeAxis,
        labelTopPercent: parallelNormalizedValueToTopPercent(normalizedValue),
        markerLeftPercent:
          buffers.axisCount <= 1
            ? 50
            : (axisIndex / (buffers.axisCount - 1)) * 100,
        markerTopPercent: parallelNormalizedValueToTopPercent(normalizedValue),
        side: getParallelFastInspectionLabelSide(axisIndex, buffers.axisCount),
        valueText,
      } satisfies ParallelFastInspectionAxisLabel;
    })
    .filter(
      (label): label is ParallelFastInspectionAxisLabel => label !== null,
    );

  const limitedLabels = limitParallelFastInspectionAxisLabels(labels);

  for (const side of ['left', 'right'] as const) {
    applyParallelFastInspectionLabelLayout(
      limitedLabels.filter((label) => label.side === side),
      getParallelFastInspectionLabelMinGapPercent(buffers.axisCount),
    );
  }

  return limitedLabels;
}

function readParallelInspectionAxisNormalizedValue(
  axisViewports: ParallelAxisViewports,
  buffers: ParallelBuffers,
  axis: ParallelParameter,
  recordIndex: number,
): number {
  const viewport = axisViewports[axis];
  const domain = buffers.domainsByAxis[axis];

  if (viewport === null || viewport === undefined || domain === undefined) {
    return readParallelNormalizedValue(buffers, axis, recordIndex);
  }

  const rawValue = buffers.rawValuesByAxis[axis]?.[recordIndex] ?? Number.NaN;
  return projectParallelViewportNormalizedValue(
    (rawValue - viewport.min) /
      Math.max(Number.EPSILON, viewport.max - viewport.min),
  );
}

function limitParallelFastInspectionAxisLabels(
  labels: readonly ParallelFastInspectionAxisLabel[],
): ParallelFastInspectionAxisLabel[] {
  if (labels.length <= PARALLEL_FAST_INSPECTION_LABEL_MAX_COUNT) {
    return labels.map((label) => ({ ...label }));
  }

  const activeLabel = labels.find((label) => label.isActive) ?? null;
  const retained = new Set<number>();
  const targetCount = PARALLEL_FAST_INSPECTION_LABEL_MAX_COUNT - (activeLabel ? 1 : 0);
  const stride = Math.max(1, Math.ceil(labels.length / Math.max(targetCount, 1)));

  for (let index = 0; index < labels.length && retained.size < targetCount; index += stride) {
    retained.add(index);
  }

  for (let index = 0; index < labels.length && retained.size < targetCount; index += 1) {
    retained.add(index);
  }

  const selected = labels.filter((_entry, index) => retained.has(index)).slice(0, targetCount);

  if (
    activeLabel !== null &&
    !selected.some((label) => label.axis === activeLabel.axis)
  ) {
    selected.push(activeLabel);
  }

  return selected
    .sort((left, right) => left.axisIndex - right.axisIndex)
    .slice(0, PARALLEL_FAST_INSPECTION_LABEL_MAX_COUNT)
    .map((label) => ({ ...label }));
}

function getParallelFastInspectionLabelSide(
  axisIndex: number,
  axisCount: number,
): ParallelFastInspectionLabelSide {
  if (axisCount <= 1 || axisIndex === 0) {
    return 'right';
  }

  if (axisIndex === axisCount - 1) {
    return 'left';
  }

  return axisIndex % 2 === 0 ? 'right' : 'left';
}

function getParallelFastInspectionLabelMinGapPercent(axisCount: number): number {
  if (axisCount <= 6) {
    return 6.5;
  }

  if (axisCount <= 10) {
    return 5;
  }

  return 4;
}

function applyParallelFastInspectionLabelLayout(
  labels: ParallelFastInspectionAxisLabel[],
  minGapPercent: number,
): void {
  if (labels.length <= 1) {
    return;
  }

  labels.sort((left, right) => left.markerTopPercent - right.markerTopPercent);

  const minTop = 2;
  const maxTop = 98;
  labels[0]!.labelTopPercent = clampNumber(labels[0]!.markerTopPercent, minTop, maxTop);

  for (let index = 1; index < labels.length; index += 1) {
    const previous = labels[index - 1]!;
    const current = labels[index]!;
    current.labelTopPercent = Math.max(
      clampNumber(current.markerTopPercent, minTop, maxTop),
      previous.labelTopPercent + minGapPercent,
    );
  }

  const overflow = labels[labels.length - 1]!.labelTopPercent - maxTop;
  if (overflow > 0) {
    for (const label of labels) {
      label.labelTopPercent -= overflow;
    }
  }

  const underflow = minTop - labels[0]!.labelTopPercent;
  if (underflow > 0) {
    for (const label of labels) {
      label.labelTopPercent += underflow;
    }
  }

  for (let index = labels.length - 2; index >= 0; index -= 1) {
    const current = labels[index]!;
    const next = labels[index + 1]!;
    current.labelTopPercent = Math.min(
      current.labelTopPercent,
      next.labelTopPercent - minGapPercent,
    );
  }

  for (const label of labels) {
    label.labelTopPercent = clampNumber(label.labelTopPercent, minTop, maxTop);
  }
}

function MParallelBrushBoundsPanel({
  activeBrushes,
  buffers,
}: {
  activeBrushes: readonly ParallelActiveBrushInterval[];
  buffers: ParallelBuffers | null;
}) {
  const brushSummary =
    activeBrushes.length === 0
      ? 'none'
      : activeBrushes
          .map(
            (brush) =>
              `${brush.parameter}:${formatAxisBrushSummaryValue(
                buffers,
                brush.parameter,
                brush,
              )}`,
          )
          .join('|');

  if (activeBrushes.length === 0) {
    return (
      <p
        className="compact-note"
        data-active-brush-count="0"
        data-brush-summary="none"
        data-testid="parallel-fast-brush-bounds"
      >
        No active brushes.
      </p>
    );
  }

  return (
    <dl
      aria-label="Parallel fast active brush bounds"
      className="parallel-fast-brush-bounds"
      data-active-brush-count={activeBrushes.length}
      data-brush-summary={brushSummary}
      data-testid="parallel-fast-brush-bounds"
    >
      {activeBrushes.map((brush) => {
        const { max: formattedMax, min: formattedMin } = formatAxisBrushRangeLabels(
          getAxisMetadata(buffers, brush.parameter),
          brush.min,
          brush.max,
        );

        return (
          <div
            className="parallel-fast-brush-bound"
            data-axis={brush.parameter}
            data-formatted-max={formattedMax}
            data-formatted-min={formattedMin}
            data-raw-max={brush.max}
            data-raw-min={brush.min}
            data-testid="parallel-fast-brush-bound"
            key={`${brush.parameter}-${brush.axisRangeIndex}`}
          >
            <dt>{brush.parameter}</dt>
            <dd>
              <span data-testid="parallel-fast-brush-bound-min">
                {formattedMin}
              </span>
              <span aria-hidden="true"> to </span>
              <span data-testid="parallel-fast-brush-bound-max">
                {formattedMax}
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function shouldEnableParallelFastBrushHooksForE2e(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }

  return (
    new URL(window.location.href).searchParams.get('__e2eParallelFastBrushHook') ===
    '1'
  );
}

function areParallelFastInspectionsEqual(
  left: ParallelFastInspectionState | null,
  right: ParallelFastInspectionState | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null) {
    return false;
  }
  return (
    left.activeAxis === right.activeAxis &&
    left.activeAxisValue === right.activeAxisValue &&
    left.distancePx === right.distancePx &&
    left.id === right.id &&
    left.normalizedAxisValue === right.normalizedAxisValue &&
    left.projectedAxisPosition === right.projectedAxisPosition &&
    left.projectedNormalizedValue === right.projectedNormalizedValue &&
    left.record?.id === right.record?.id &&
    left.record?.sourceIndex === right.record?.sourceIndex &&
    left.record?.table === right.record?.table &&
    left.recordIndex === right.recordIndex &&
    left.segmentEndAxis === right.segmentEndAxis &&
    left.segmentStartAxis === right.segmentStartAxis &&
    left.source === right.source
  );
}

function shouldPreserveWebglDrawingBufferForE2e(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }

  return (
    new URL(window.location.href).searchParams.get('__e2ePreserveDrawingBuffer') ===
    '1'
  );
}

function isParallelFastExplicitHoverModeActive(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }

  return new URL(window.location.href).searchParams.get('__parallelFastHoverMode') === '1';
}

function getParallelFastDatasetOverrideUrl(search: string): string | null {
  if (!import.meta.env.DEV) {
    return null;
  }

  return new URLSearchParams(search).get('__e2eParallelFastDataset');
}

function MetricTerm({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatRendererKind(): string {
  return 'WebGL2 segments';
}

function formatNullableAlpha(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(4);
}

function formatScaleLabel(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(0) : String(value)}x`;
}

function formatDiagnosticNumber(value: number): string {
  return value.toFixed(4);
}

function shouldIgnoreParallelFastShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable || target.closest('[contenteditable="true"]') !== null) {
    return true;
  }

  return target.matches('button, input, select, textarea');
}

function createEmptyParallelFastDiagnostics(): ParallelFastDiagnostics {
  return {
    brushComputeMs: null,
    bufferBuildMs: null,
    datasetFetchMs: null,
    datasetParseMs: null,
    densityBlendMode: 'n/a',
    densityMode: 'n/a',
    drawCallCount: 0,
    firstReadySignalMs: null,
    gapCount: 0,
    hoverResolveMs: null,
    hoverVisualBaseRedrawMs: null,
    hoverVisualGpuUploadMs: null,
    hoverVisualMode: 'n/a',
    hoverVisualRedrawMs: null,
    hoverVisualSkipped: false,
    hoverVisualUpdateMs: null,
    hoverVisualUploadBytes: 0,
    hoverIndexState: 'idle',
    hoverIndexBuildMs: null,
    hoverIndexBytes: 0,
    hoverLookupSource: 'none',
    userLineOpacityScale: PARALLEL_FAST_DEFAULT_LINE_OPACITY_SCALE,
    exportSerializationMs: null,
    lineAlpha: null,
    lineSetSamplesMs: null,
    preselectedCount: 0,
    preselectedOverlayEnabled: false,
    recordCount: 0,
    rendererKind: 'webgl2-segments',
    rendererRedrawMs: null,
    rendererState: 'idle',
    rendererSetupMs: null,
    rendererUploadMs: null,
    sampleCount: 0,
    selectionFreshness: 'exact',
    selectedCount: 0,
    reactSelectionCommitMs: null,
    selectedIdMaterializationMs: null,
    selectedLineAlpha: null,
    selectedLineSampleCount: 0,
    selectedSourceIndexCreationMs: null,
    selectedVisualBufferCreationMs: null,
    selectedVisualGpuUploadMs: null,
    selectedVisualMaskBuildMs: null,
    selectedVisualMaskGpuUploadMs: null,
    selectedVisualRedrawMs: null,
    selectionVisualUpdateMs: null,
    sharedArrayBuffersUsed: false,
    webglSegmentCount: 0,
    webglVertexCount: 0,
    tableMode: 'single',
    tableCount: 0,
    tableRecordCounts: 'none',
  };
}

function createEmptyParallelFastSelectionState(): ParallelFastSelectionState {
  return {
    activeBrushes: [],
    brushIntervals: {},
    callbackLog: [],
    filters: [],
    reason: null,
    selectedCount: 0,
    selectedSampleIds: [],
    selectionFreshness: 'exact',
    source: null,
    sourceIndexCreationMs: null,
    sourceIndexSample: [],
  };
}

function formatNullableDuration(value: number | null): string {
  return value === null ? 'n/a' : formatDuration(value);
}

function formatDuration(value: number): string {
  return `${value.toFixed(1)} ms`;
}

function formatParallelFastBrushLogEntry({
  activeBrushes,
  buffers,
  brushComputeMs,
  selectedCount,
  source,
}: {
  activeBrushes: readonly ParallelActiveBrushInterval[];
  buffers: ParallelBuffers | null;
  brushComputeMs: number;
  selectedCount: number;
  source: string;
}): string {
  if (activeBrushes.length === 0) {
    return `${source}: cleared brushes -> 0 IDs (${formatDuration(brushComputeMs)})`;
  }

  const brushSummary = activeBrushes
    .map(
      (brush) =>
        `${brush.parameter} ${formatAxisBrushSummaryValue(
          buffers,
          brush.parameter,
          brush,
        )}`,
    )
    .join(', ');

  return `${source}: ${brushSummary} -> ${selectedCount.toLocaleString(
    'en-US',
  )} IDs (${formatDuration(brushComputeMs)})`;
}

function getBrushRangesForAxis(
  brushIntervals: ParallelBrushIntervals,
  parameter: ParallelParameter,
): NumericRange[] {
  const interval = brushIntervals[parameter];

  if (interval === null || interval === undefined) {
    return [];
  }

  return Array.isArray(interval)
    ? [...(interval as readonly NumericRange[])]
    : [interval as NumericRange];
}

function serializeParallelSelectionCallbackPreview({
  buffers,
  selectionState,
}: {
  buffers: ParallelBuffers | null;
  selectionState: ParallelFastSelectionState;
}): string {
  return JSON.stringify(
    {
      callback: 'selectionchange',
      plotType: 'm-parallel',
      activeBrushes: selectionState.activeBrushes.map((brush) => ({
        axisRangeIndex: brush.axisRangeIndex,
        formattedRange:
          buffers === null
            ? undefined
            : formatAxisBrushSummaryValue(buffers, brush.parameter, brush),
        parameterKey: brush.parameter,
        range: toPreviewRange(brush),
      })),
      booleanModel: 'OR intervals within one axis; AND between brushed axes',
      brushIntervals: serializeParallelBrushIntervalsForPreview(
        selectionState.brushIntervals,
      ),
      filters: selectionState.filters.map((filter) => ({
        axisRangeIndex: filter.axisRangeIndex,
        parameterKey: filter.parameterKey,
        range: toPreviewRange(filter.range),
        source: filter.source,
        valueType: filter.valueType,
        values: filter.values,
      })),
      note:
        selectionState.source === null
          ? 'No committed selection callback yet.'
          : undefined,
      reason: selectionState.reason ?? 'none',
      selectedCount: selectionState.selectedCount,
      selectionFreshness: selectionState.selectionFreshness,
      source: selectionState.source ?? 'none',
      sourceIndexCreationMs: selectionState.sourceIndexCreationMs,
      sourceIndices: {
        count: selectionState.selectedCount,
        sample: selectionState.sourceIndexSample,
        type: 'Uint32Array',
      },
    },
    null,
    2,
  );
}

function serializeParallelBrushIntervalsForPreview(
  brushIntervals: ParallelBrushIntervals,
): Record<string, readonly { max: number; min: number }[]> {
  return Object.fromEntries(
    Object.entries(brushIntervals).map(([parameter, interval]) => {
      const ranges =
        interval === null || interval === undefined
          ? []
          : Array.isArray(interval)
            ? interval
            : [interval];
      return [parameter, ranges.map(toPreviewRange)];
    }),
  );
}

function toPreviewRange(range: NumericRange): { max: number; min: number } {
  return {
    max: toPreviewNumber(range.max),
    min: toPreviewNumber(range.min),
  };
}

function toPreviewNumber(value: number): number {
  return Number.isFinite(value) ? Number(value.toPrecision(12)) : value;
}

function getAxisMetadata(
  buffers: ParallelBuffers | null,
  parameter: ParallelParameter,
): ParallelFastAxisMetadata | undefined {
  return (
    buffers as (ParallelBuffers & {
      axisMetadataByAxis?: Readonly<Record<string, ParallelFastAxisMetadata>>;
    }) | null
  )?.axisMetadataByAxis?.[parameter];
}

function formatAxisBrushRangeLabels(
  axisMetadata: ParallelFastAxisMetadata | undefined,
  min: number,
  max: number,
): {
  max: string;
  min: string;
} {
  const normalizedMin = Math.min(min, max);
  const normalizedMax = Math.max(min, max);

  if (axisMetadata?.kind === 'categorical' || axisMetadata?.kind === 'boolean') {
    const matchingCategories = axisMetadata.categories.filter(
      (category) =>
        category.encoded >= normalizedMin && category.encoded <= normalizedMax,
    );

    if (matchingCategories.length > 0) {
      return {
        max: formatParallelFastAxisValue(
          axisMetadata,
          matchingCategories[matchingCategories.length - 1]!.encoded,
        ),
        min: formatParallelFastAxisValue(axisMetadata, matchingCategories[0]!.encoded),
      };
    }
  }

  return {
    max: formatParallelFastAxisValue(axisMetadata, normalizedMax),
    min: formatParallelFastAxisValue(axisMetadata, normalizedMin),
  };
}

function formatAxisBrushSummaryValue(
  buffers: ParallelBuffers | null,
  parameter: ParallelParameter,
  range: NumericRange,
): string {
  const { max, min } = formatAxisBrushRangeLabels(
    getAxisMetadata(buffers, parameter),
    range.min,
    range.max,
  );

  return min === max ? min : `${min}-${max}`;
}

function rawValueToNormalized(
  value: number,
  domain: { max: number; min: number; span: number },
): number {
  if (domain.span === 0) {
    return 0.5;
  }

  return clampNumber((value - domain.min) / domain.span, 0, 1);
}

function normalizeRange(range: NumericRange): NumericRange {
  return range.min <= range.max
    ? { max: range.max, min: range.min }
    : { max: range.min, min: range.max };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function ParallelWebgpuDatasetSetup({
  datasetState,
  onCancel,
  onGenerate,
  onSelectPointCount,
  pointCount,
}: {
  datasetState: Extract<
    ParallelFastDatasetLoadState,
    { status: 'generating' | 'missing' }
  >;
  onCancel: () => void;
  onGenerate: () => void;
  onSelectPointCount: (pointCount: number) => void;
  pointCount: number;
}) {
  const progress = datasetState.status === 'generating' && datasetState.pageCount > 0
    ? datasetState.completedPages / datasetState.pageCount
    : 0;
  return (
    <div
      className="workspace-placeholder scatter-webgpu-dataset-setup"
      data-testid="parallel-webgpu-dataset-setup"
    >
      <h2>Generate the WebGPU demo dataset</h2>
      <p>
        The shared scatter, histogram, and parallel dataset is generated in this
        browser and retained in IndexedDB. Nothing is uploaded. It uses about{' '}
        {formatParallelBytes(pointCount * 8)} of browser storage.
      </p>
      {datasetState.status === 'missing' && datasetState.message !== undefined ? (
        <p role="alert">{datasetState.message}</p>
      ) : null}
      <div aria-label="WebGPU parallel dataset size" className="segmented-control">
        {PARALLEL_WEBGPU_POINT_COUNTS.map((candidate) => (
          <button
            className={pointCount === candidate ? 'is-active' : undefined}
            disabled={datasetState.status === 'generating'}
            key={candidate}
            onClick={() => onSelectPointCount(candidate)}
            type="button"
          >
            {formatCompactParallelPointCount(candidate)} points
          </button>
        ))}
      </div>
      {datasetState.status === 'generating' ? (
        <div
          aria-live="polite"
          className="scatter-webgpu-generation-progress"
          role="status"
        >
          <progress max={1} value={progress} />
          <span>
            Generated {datasetState.completedPages} of {datasetState.pageCount} pages
          </span>
          <button className="secondary-link" onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
      ) : (
        <button
          data-testid="parallel-webgpu-generate-dataset"
          onClick={onGenerate}
          type="button"
        >
          Generate {formatCompactParallelPointCount(pointCount)} points locally
        </button>
      )}
    </div>
  );
}

function formatCompactParallelPointCount(pointCount: number): string {
  return pointCount >= 1_000_000
    ? `${pointCount / 1_000_000}M`
    : pointCount.toLocaleString('en-US');
}

function formatParallelBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MiB`;
}

function parseParallelWebgpuPointCount(
  searchParams: URLSearchParams,
): (typeof PARALLEL_WEBGPU_POINT_COUNTS)[number] {
  const parsed = Number(searchParams.get('points'));
  return PARALLEL_WEBGPU_POINT_COUNTS.find((count) => count === parsed) ??
    PARALLEL_WEBGPU_POINT_COUNTS[0];
}

function parseParallelWebgpuStreamKind(
  searchParams: URLSearchParams,
): 'function' | 'local' | null {
  const value = searchParams.get('webgpuData');
  if (value === 'stream-local') return 'local';
  if (value === 'stream-function') return 'function';
  return null;
}

async function loadParallelFastRouteDataset(
  url: string,
): Promise<{
  dataset: MixedTableFixture | ParallelDataset;
  datasetKind: 'legacy-parallel' | 'mixed-tables';
  metrics: { fetchMs: number; parseMs: number };
}> {
  try {
    const { dataset, metrics } = await loadParallelDatasetWithMetrics(url);
    return { dataset, datasetKind: 'legacy-parallel', metrics };
  } catch (legacyError) {
    const fetchStartedAt = performance.now();
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const fetchMs = performance.now() - fetchStartedAt;

    if (!response.ok) {
      throw legacyError;
    }

    const parseStartedAt = performance.now();
    const payload: unknown = await response.json();
    const parseMs = performance.now() - parseStartedAt;

    if (!isMixedTableFixturePayload(payload)) {
      throw legacyError;
    }

    return {
      dataset: payload,
      datasetKind: 'mixed-tables',
      metrics: { fetchMs, parseMs },
    };
  }
}

async function loadMixedTableParallelFastRouteDataset(
  url: string,
): Promise<{
  dataset: MixedTableFixture;
  datasetKind: 'mixed-tables';
  metrics: { fetchMs: number; parseMs: number };
}> {
  const loaded = await loadFastPlotMixedTableFixture(url).catch((error) => {
    if (error instanceof Error && error.message.includes('not found')) {
      throw new Error(
        `Mixed-table fixture not found at ${url}. Generate it with: pnpm generate:data -- --kind mixed-tables --count 1000000 --secondary-count 1000 --seed 1`,
      );
    }

    throw error;
  });

  return {
    dataset: loaded.fixture,
    datasetKind: 'mixed-tables',
    metrics: { fetchMs: loaded.fetchMs, parseMs: loaded.parseMs },
  };
}

function getParallelFastRouteRecordCount(
  dataset:
    | LoadedParallelWebgpuDataset
    | LoadedScatterFastBenchmarkSource
    | MixedTableFixture
    | ParallelDataset,
  tableMode: FastRouteTableMode,
): number {
  if ('buffers' in dataset && 'storedBytes' in dataset) {
    return dataset.buffers.recordCount;
  }
  if ('columns' in dataset && 'spec' in dataset) {
    return dataset.columns.ids.length;
  }

  if (!isMixedTableFixturePayload(dataset)) {
    return dataset.records.length;
  }

  return tableMode === 'multi'
    ? dataset.metadata.count
    : (dataset.tables[0]?.records.length ?? 0);
}

function createParallelFastRouteBuffers(
  datasetState: Extract<ParallelFastDatasetLoadState, { status: 'loaded' }>,
  options: { includeWebglSegmentBuffers: true },
  tableMode: FastRouteTableMode,
): { buffers: ParallelBuffers; tableMetadata: ParallelFastTableMetadata } {
  if (datasetState.datasetKind === 'scatter-fast-benchmark') {
    const adapted = adaptScatterBenchmarkForParallelFast(
      datasetState.dataset as LoadedScatterFastBenchmarkSource,
      options,
    );

    return {
      buffers: adapted.buffers,
      tableMetadata: {
        tableCount: adapted.metadata.tableNames.length,
        tableNames: adapted.metadata.tableNames,
        tableRecordCounts: adapted.metadata.tableRecordCounts,
      },
    };
  }

  if (datasetState.datasetKind === 'mixed-tables') {
    const fixture = datasetState.dataset as MixedTableFixture;
    const tables =
      tableMode === 'multi'
        ? fixture.tables.map((table) => ({
            axes: fixture.metadata.axes,
            name: table.name,
            records: table.records,
          }))
        : [
            {
              axes: fixture.metadata.axes,
              name: fixture.tables[0]?.name ?? 'benchmark-primary',
              records: fixture.tables[0]?.records ?? [],
            },
          ];
    const adapted = adaptMixedTablesForParallelFast(tables, {
      ...options,
      tableAxis: 'auto',
    });

    return {
      buffers: adapted.buffers,
      tableMetadata: {
        tableCount: adapted.metadata.tableNames.length,
        tableNames: adapted.metadata.tableNames,
        tableRecordCounts: adapted.metadata.tableRecordCounts,
      },
    };
  }

  const buffers = createParallelBuffers(datasetState.dataset as ParallelDataset, options);

  return { buffers, tableMetadata: createEmptyParallelFastTableMetadata() };
}

function isMixedTableFixturePayload(payload: unknown): payload is MixedTableFixture {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    Array.isArray((payload as { tables?: unknown }).tables) &&
    typeof (payload as { metadata?: { count?: unknown } }).metadata?.count === 'number'
  );
}

function createEmptyParallelFastTableMetadata(): ParallelFastTableMetadata {
  return {
    tableCount: 0,
    tableNames: [],
    tableRecordCounts: {},
  };
}

function formatTableRecordCounts(
  tableRecordCounts: Readonly<Record<string, number>>,
): string {
  const entries = Object.entries(tableRecordCounts);
  return entries.length === 0
    ? 'none'
    : entries.map(([name, count]) => `${name}:${count}`).join(',');
}

function getParallelFastStyledRecordCount(buffers: ParallelBuffers | null): number {
  return (
    buffers as
      | (ParallelBuffers & {
          styleBuffers?: { styledRecordCount: number };
        })
      | null
  )?.styleBuffers?.styledRecordCount ?? 0;
}
