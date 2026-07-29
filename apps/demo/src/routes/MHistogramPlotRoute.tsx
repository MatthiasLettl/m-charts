import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FAST_ROUTE_TABLES_PARAM,
  HISTOGRAM_BARS_DATASET_URL,
  MIXED_TABLE_FIXTURE_URL,
  formatFastRouteTableMode,
  parseFastRouteTableMode,
  type FastRouteTableMode,
} from '../data/fastRouteDataMode.ts';
import {
  FAST_PLOT_E2E_SCHEMA_DATA_URL_PARAM,
  FAST_PLOT_E2E_SCHEMA_URL_PARAM,
  FAST_PLOT_E2E_TABLE_FIXTURE_PARAM,
  loadFastPlotMixedTableFixture,
  loadScatterFastBenchmarkSource,
  resolveFastPlotFixtureUrl,
  resolveScatterFastSchemaDataUrl,
  resolveScatterFastSchemaUrl,
} from '../data/fastPlotTableSources.ts';
import { loadHistogramWebgpuDataset } from '../data/histogramWebgpuDatasetAdapter.ts';
import {
  isInteractionAxis,
  type InteractionAxis,
} from '../state/viewSearchParams.ts';
import { createThemeAwareTo } from '../state/themeMode.ts';
import {
  getCommittedSelectionOverlayColor,
  getPlotTheme,
  rgbaToUnitTuple,
} from '../theme/plotTheme.ts';
import { useThemeMode } from '../theme/ThemeModeProvider.tsx';
import {
  DemoSidebarHeader,
  InteractionCheatSheet,
} from './DemoRouteChrome.tsx';
import {
  buildHistogramAggregation,
  compareHistogramMeasurementReferences,
  createDefaultHistogramViewport,
  createHistogramAxisTicks,
  formatHistogramAxisValue,
  formatHistogramBinLabel,
  formatHistogramBinRange,
  histogramAxisToPixel,
  type HistogramAggregationSet,
  type HistogramBinSizeState,
  type HistogramContinuousBinResolution,
  type HistogramColumns,
  type HistogramHoverEvent,
  type HistogramMeasurementEvent,
  type HistogramMetricsEvent,
  type HistogramPlotRect,
  type HistogramPlotSpec,
  type HistogramRange,
  type HistogramRendererTheme,
  type HistogramSelectionEvent,
  type HistogramSubplotId,
  type HistogramViewport,
  type HistogramViewportChangeReason,
} from 'm-charts/m-histogram';
import {
  adaptHistogramBarDemoPayload,
  adaptMixedTablesForHistogram,
  adaptScatterFastBenchmarkSourceForHistogram,
  type HistogramBarDemoPayload,
  type HistogramDatasetAdapterMetadata,
} from 'm-charts/m-histogram';
import {
  createDefaultHistogramBindings,
  createHistogramPlot,
  type HistogramPlotInstance,
} from 'm-charts/m-histogram';
import type { HistogramOverlayDescriptor } from 'm-charts/m-histogram';
import type {
  HistogramRenderState,
  HistogramStateSnapshot,
} from 'm-charts/m-histogram';
import {
  createHistogramWebgpuPlot,
  type HistogramWebgpuAggregationBackend,
  type HistogramWebgpuPlotDiagnostics,
  type HistogramWebgpuPlotInstance,
} from 'm-charts/m-histogram-webgpu';

const HISTOGRAM_MODE_PARAM = 'histMode';
const HISTOGRAM_WEBGPU_POINT_COUNT_PARAM = 'points';
const HISTOGRAM_WEBGPU_AGGREGATION_BACKEND_PARAM = 'aggregationBackend';
const HISTOGRAM_WEBGPU_POINT_COUNTS = [1_000_000, 10_000_000, 25_000_000] as const;
const HISTOGRAM_BIN_SIZE_PARAM = 'binSize';
const HISTOGRAM_BIN_SIZE_PREFIX = 'histBinSize';
const HISTOGRAM_FOCUSED_SUBPLOT_PARAM = 'subplot';
const HISTOGRAM_VIEWPORT_PREFIX = 'histViewport';
const HISTOGRAM_E2E_SELECTED_SOURCE_INDICES_PARAM =
  '__e2eHistogramFastSelectedSourceIndices';
const VIEWPORT_WRITE_DEBOUNCE_MS = 140;
const BIN_SIZE_APPLY_DEBOUNCE_MS = 160;
const BIN_SIZE_FINALIZE_DEBOUNCE_MS = VIEWPORT_WRITE_DEBOUNCE_MS;
const DEFAULT_BIN_COUNT = 64;
const EXPORT_SAMPLE_LIMIT = 5000;
const MIDDLE_CLICK_MAX_MOVE_CSS_PX = 3;
const HISTOGRAM_Y_AXIS_TITLE_X_OFFSET = 72;
const HISTOGRAM_Y_AXIS_TITLE_VERTICAL_PADDING_CSS_PX = 18;
const HISTOGRAM_SHORTCUT_GROUPS = [
  {
    items: [
      { keys: ['Left drag'], action: 'Zoom by rectangle direction' },
      { keys: ['Alt', 'Shift', 'Left drag'], action: 'Force both-axis box zoom' },
      { keys: ['Alt', 'Wheel'], action: 'Zoom x axis' },
      { keys: ['Shift', 'Wheel'], action: 'Zoom y axis' },
      { keys: ['Ctrl', 'Wheel'], action: 'Zoom x and y axes' },
    ],
    label: 'Viewport',
  },
  {
    items: [
      { keys: ['Right drag'], action: 'Select bins' },
      { keys: ['Space', 'Right drag'], action: 'Lasso bins' },
      { keys: ['Ctrl', 'Right drag'], action: 'Append to current selection' },
      { keys: ['Middle click'], action: 'Undo last viewport change' },
    ],
    label: 'Selection',
  },
  {
    items: [
      { keys: ['Middle drag'], action: 'Pan' },
      { keys: ['Shift', 'Right drag'], action: 'Measure between bins' },
      { keys: ['Wheel'], action: 'Adjust bin size over a subplot' },
    ],
    label: 'Explore',
  },
] as const;

const HISTOGRAM_TRY_THIS_ITEMS = [
  {
    label: 'Rectangle zoom',
    detail: 'Left-drag across bins; drag direction picks x or y, Alt+Shift forces both axes.',
  },
  {
    label: 'Select bins',
    detail: 'Right-drag bins, or hold Ctrl while right-dragging to append.',
  },
  {
    label: 'Bin size',
    detail: 'Wheel over a continuous subplot changes bin size; Alt+wheel zooms x, Shift+wheel zooms y, Ctrl+wheel zooms both axes.',
  },
  {
    label: 'Measure',
    detail: 'Hold Shift while right-dragging to compare two bin positions.',
  },
  {
    label: 'Pan',
    detail: 'Middle-drag a subplot to move through the current viewport.',
  },
] as const;

type HistogramRouteMode = 'histogram' | 'bar';
type HistogramSelectionMode = 'select' | 'lasso';
type HistogramViewportApplySource = 'engine' | 'external-url' | 'undo' | 'reset';

type HistogramDatasetState =
  | { status: 'loading' }
  | { message: string; status: 'error' }
  | {
      aggregation?: HistogramAggregationSet;
      columns?: HistogramColumns;
      loadMs: number;
      metadata: HistogramDatasetAdapterMetadata;
      recordExportAvailable: boolean;
      sourceFormat: string;
      spec: HistogramPlotSpec;
      status: 'loaded';
    };

type RendererState = {
  message?: string;
  status: HistogramRenderState;
};

type PendingHistogramBinSizeState = {
  binSize: number;
  requestedAt: number;
  status: 'computing' | 'finalizing-membership' | 'queued';
};

type HistogramBinSizeCycleMetrics = {
  computeMs: number;
  debounceMs: number;
  effectiveBinSize: number | null;
  membershipFinalizeMs: number | null;
  observableMs: number;
  requestedBinSize: number;
  requestedVisibleBinCount: number | null;
  status: HistogramContinuousBinResolution['status'] | 'pending';
  subplotId: HistogramSubplotId;
  visibleBinCount: number | null;
};

type HistogramRouteHookState = {
  activeSubplotId: string | null;
  axisMode: 'x' | 'xy' | 'y';
  binCount: number;
  binSizeComputeMs: number | null;
  binSize: number | null;
  binSizeDebounceMs: number | null;
  binSizeEffective: number | null;
  binSizeMembershipFinalizeMs: number | null;
  binSizeObservableMs: number | null;
  binSizePending: boolean;
  binSizePendingCount: number;
  binSizePendingSubplotId: string | null;
  binSizeRequestedVisibleBinCount: number | null;
  binSizeStatus: HistogramContinuousBinResolution['status'] | 'pending' | null;
  binSizeVisibleBinCount: number | null;
  engineAxisMode: 'x' | 'xy' | 'y' | null;
  engineMode: string | null;
  focusedSubplotId: string | null;
  histMode: HistogramRouteMode;
  hoverActive: boolean;
  measurementActive: boolean;
  mode: HistogramSelectionMode;
  parameterCount: number;
  populatedBinCount: number;
  recordCount: number;
  renderState: RendererState;
  selectedCount: number;
  sourceIndicesAvailable: boolean;
  stackSegmentCount: number;
  tableMode: FastRouteTableMode;
  lastViewportApplySource: HistogramViewportApplySource | null;
  lastViewportWriteSeq: number | null;
  viewport: HistogramViewport | null;
  viewportCommitSeq: number;
};

type HistogramBenchmarkSerializationResult = {
  available: boolean;
  byteLength: number | null;
  count: number;
  message?: string;
  ms: number;
};

type HistogramBenchmarkSelectionResult = {
  available: boolean;
  message?: string;
  ms: number;
  selectedBinCount: number | null;
  selectedSourceCount: number | null;
  selectionComputeMs: number | null;
};

type HistogramSearchParamsUpdate =
  | URLSearchParams
  | ((currentParams: URLSearchParams) => URLSearchParams);

type PendingMiddleUndoGesture = {
  moved: boolean;
  x: number;
  y: number;
};

declare global {
  interface Window {
    __histogramFastBenchmarkTestHook?: {
      getLastMetrics: () => HistogramMetricsEvent | null;
      getMetricHistory: () => readonly HistogramMetricsEvent[];
      getRouteState: () => HistogramRouteHookState | null;
      selectRectangleForBenchmark: () => HistogramBenchmarkSelectionResult;
      serializeSelectedIdsForBenchmark: () => HistogramBenchmarkSerializationResult;
      serializeSelectedRecordsForBenchmark: () => HistogramBenchmarkSerializationResult;
      setRawBinSizeForBenchmark: (binSize: number) => boolean;
    };
    __histogramFastHoverTestHook?: () => HistogramHoverEvent | null;
    __histogramFastMeasurementTestHook?: () => HistogramMeasurementEvent | null;
    __histogramFastRouteStateTestHook?: () => HistogramRouteHookState | null;
    __histogramFastSelectionTestHook?: () => HistogramSelectionEvent | null;
  }
}

export function MHistogramPlotRoute({
  rendererBackend = 'webgl2',
}: {
  rendererBackend?: 'webgl2' | 'webgpu';
}) {
  const [routerSearchParams, setRouterSearchParams] = useSearchParams();
  const [searchParams, setRouteSearchParams] = useState(
    () => new URLSearchParams(routerSearchParams),
  );
  const { themeMode } = useThemeMode();
  const histMode = useMemo(() => parseHistogramRouteMode(searchParams), [searchParams]);
  const tableMode = useMemo(() => parseFastRouteTableMode(searchParams), [searchParams]);
  const webgpuPointCount = useMemo(
    () => parseHistogramWebgpuPointCount(searchParams),
    [searchParams],
  );
  const webgpuAggregationBackend = useMemo(
    () => parseHistogramWebgpuAggregationBackend(searchParams),
    [searchParams],
  );
  const selectionMode = useMemo(
    () => parseHistogramSelectionMode(searchParams),
    [searchParams],
  );
  const interactionAxis = useMemo(
    () => parseHistogramInteractionAxis(searchParams),
    [searchParams],
  );
  const focusedSubplotId = useMemo(
    () => normalizeFocusedSubplotParam(searchParams),
    [searchParams],
  );
  const initialSelectedSourceIndicesParam = import.meta.env.DEV
    ? searchParams.get(HISTOGRAM_E2E_SELECTED_SOURCE_INDICES_PARAM)
    : null;
  const initialSelectedSourceIndices = useMemo(
    () => parseSourceIndexList(initialSelectedSourceIndicesParam),
    [initialSelectedSourceIndicesParam],
  );
  const histogramTheme = useMemo(
    () => createHistogramRendererTheme(themeMode),
    [themeMode],
  );
  const mixedTableFixtureParam = searchParams.get(FAST_PLOT_E2E_TABLE_FIXTURE_PARAM);
  const scatterFastSchemaDataParam = searchParams.get(
    FAST_PLOT_E2E_SCHEMA_DATA_URL_PARAM,
  );
  const scatterFastSchemaParam = searchParams.get(FAST_PLOT_E2E_SCHEMA_URL_PARAM);
  const dataSourceSearchParams = useMemo(() => {
    const params = new URLSearchParams();
    if (mixedTableFixtureParam !== null) {
      params.set(FAST_PLOT_E2E_TABLE_FIXTURE_PARAM, mixedTableFixtureParam);
    }
    if (scatterFastSchemaDataParam !== null) {
      params.set(FAST_PLOT_E2E_SCHEMA_DATA_URL_PARAM, scatterFastSchemaDataParam);
    }
    if (scatterFastSchemaParam !== null) {
      params.set(FAST_PLOT_E2E_SCHEMA_URL_PARAM, scatterFastSchemaParam);
    }
    return params;
  }, [mixedTableFixtureParam, scatterFastSchemaDataParam, scatterFastSchemaParam]);
  const mixedTableFixtureUrl = useMemo(
    () => resolveFastPlotFixtureUrl(dataSourceSearchParams, MIXED_TABLE_FIXTURE_URL),
    [dataSourceSearchParams],
  );
  const scatterFastSchemaDataUrl = useMemo(
    () => resolveScatterFastSchemaDataUrl(dataSourceSearchParams),
    [dataSourceSearchParams],
  );
  const scatterFastSchemaUrl = useMemo(
    () => resolveScatterFastSchemaUrl(dataSourceSearchParams),
    [dataSourceSearchParams],
  );
  const scatterFastLoadParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set('__e2eScatterFastSchemaDataUrl', scatterFastSchemaDataUrl);
    params.set('__e2eScatterFastSchemaUrl', scatterFastSchemaUrl);
    return params;
  }, [scatterFastSchemaDataUrl, scatterFastSchemaUrl]);
  const preserveDrawingBuffer =
    import.meta.env.DEV && searchParams.has('__e2ePreserveDrawingBuffer');
  const binSizeSearchKey = useMemo(
    () => createHistogramBinSizeSearchKey(searchParams),
    [searchParams],
  );
  const binSizeSearchParams = useMemo(
    () => new URLSearchParams(binSizeSearchKey),
    [binSizeSearchKey],
  );

  const [datasetState, setDatasetState] = useState<HistogramDatasetState>({
    status: 'loading',
  });
  const [rendererState, setRendererState] = useState<RendererState>({ status: 'idle' });
  const [metrics, setMetrics] = useState<HistogramMetricsEvent | null>(null);
  const [webgpuDiagnostics, setWebgpuDiagnostics] =
    useState<HistogramWebgpuPlotDiagnostics | null>(null);
  const [selection, setSelection] = useState<HistogramSelectionEvent | null>(null);
  const [hover, setHover] = useState<HistogramHoverEvent | null>(null);
  const [measurement, setMeasurement] = useState<HistogramMeasurementEvent | null>(
    null,
  );
  const [snapshot, setSnapshot] = useState<HistogramStateSnapshot | null>(null);
  const [overlays, setOverlays] = useState<readonly HistogramOverlayDescriptor[]>([]);
  const [exportStatus, setExportStatus] = useState<string>('No export yet.');
  const [pendingBinSizeBySubplot, setPendingBinSizeBySubplot] = useState<
    Readonly<Record<HistogramSubplotId, PendingHistogramBinSizeState>>
  >({});
  const [lastBinSizeCycle, setLastBinSizeCycle] =
    useState<HistogramBinSizeCycleMetrics | null>(null);
  const [viewportSyncDiagnostics, setViewportSyncDiagnostics] = useState<{
    lastViewportApplySource: HistogramViewportApplySource | null;
    lastViewportWriteSeq: number | null;
    viewportCommitSeq: number;
  }>({
    lastViewportApplySource: null,
    lastViewportWriteSeq: null,
    viewportCommitSeq: 0,
  });
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<HistogramPlotInstance | null>(null);
  const metricsHistoryRef = useRef<HistogramMetricsEvent[]>([]);
  const lastCommittedViewportRef = useRef<HistogramViewport | null>(null);
  const resetViewportSeedRef = useRef<HistogramViewport | null>(null);
  const viewportHistoryRef = useRef<HistogramViewport[]>([]);
  const pendingMembershipMaterializeRef = useRef<number>(0);
  const pendingViewportWriteRef = useRef<number>(0);
  const pendingViewportReconcileRef = useRef<number>(0);
  const pendingViewportSyncRef = useRef<HistogramViewport | null>(null);
  const viewportCommitSeqRef = useRef(0);
  const lastRouteWrittenViewportSeqRef = useRef<number | null>(null);
  const lastRouteWrittenViewportSearchKeyRef = useRef('');
  const lastViewportApplySourceRef = useRef<HistogramViewportApplySource | null>(null);
  const pendingMiddleUndoGestureRef = useRef<PendingMiddleUndoGesture | null>(null);
  const pendingBinSizeBySubplotRef = useRef<Record<string, PendingHistogramBinSizeState>>(
    {},
  );
  const pendingBinSizeTimersRef = useRef<Map<string, number>>(new Map());
  const suppressViewportHistoryRef = useRef(false);
  const lastBinSizeCycleRef = useRef<HistogramBinSizeCycleMetrics | null>(null);
  const searchParamsRef = useRef(searchParams);
  const setRouterSearchParamsRef = useRef(setRouterSearchParams);

  const recordLastBinSizeCycle = useCallback(
    (cycle: HistogramBinSizeCycleMetrics | null): void => {
      lastBinSizeCycleRef.current = cycle;
      setLastBinSizeCycle(cycle);
    },
    [],
  );

  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);

  useEffect(() => {
    setRouterSearchParamsRef.current = setRouterSearchParams;
  }, [setRouterSearchParams]);

  const cancelPendingViewportWrite = useCallback(() => {
    if (pendingViewportWriteRef.current !== 0) {
      window.clearTimeout(pendingViewportWriteRef.current);
      pendingViewportWriteRef.current = 0;
    }
  }, []);

  const cancelPendingViewportReconcile = useCallback(() => {
    if (pendingViewportReconcileRef.current !== 0) {
      window.clearTimeout(pendingViewportReconcileRef.current);
      pendingViewportReconcileRef.current = 0;
    }
  }, []);

  const recordCommittedViewportForUndo = useCallback(
    (
      nextViewport: HistogramViewport,
      reason: HistogramViewportChangeReason = 'programmatic',
    ): void => {
      const previousViewport = lastCommittedViewportRef.current;
      if (previousViewport === null) {
        lastCommittedViewportRef.current = nextViewport;
        return;
      }
      if (suppressViewportHistoryRef.current) {
        const latestEntry =
          viewportHistoryRef.current[viewportHistoryRef.current.length - 1] ?? null;
        if (latestEntry !== null && areHistogramViewportsEqual(latestEntry, nextViewport)) {
          viewportHistoryRef.current = viewportHistoryRef.current.slice(0, -1);
        }
        suppressViewportHistoryRef.current = false;
        lastCommittedViewportRef.current = nextViewport;
        return;
      }
      const isWheelBurstContinuation =
        reason === 'wheel' && pendingViewportWriteRef.current !== 0;
      if (
        !isWheelBurstContinuation &&
        !areHistogramViewportsEqual(previousViewport, nextViewport)
      ) {
        const latestEntry =
          viewportHistoryRef.current[viewportHistoryRef.current.length - 1] ?? null;
        if (latestEntry === null || !areHistogramViewportsEqual(latestEntry, previousViewport)) {
          viewportHistoryRef.current = [
            ...viewportHistoryRef.current.slice(-63),
            cloneHistogramViewport(previousViewport),
          ];
        }
      }
      lastCommittedViewportRef.current = nextViewport;
    },
    [],
  );

  const setSearchParams = useCallback(
    (
      nextInit: HistogramSearchParamsUpdate,
      options?: { replace?: boolean },
    ): void => {
      const currentParams = new URLSearchParams(searchParamsRef.current);
      const nextParams =
        typeof nextInit === 'function' ? nextInit(currentParams) : nextInit;
      const normalizedParams = new URLSearchParams(nextParams);
      searchParamsRef.current = normalizedParams;
      setRouteSearchParams(new URLSearchParams(normalizedParams));
      setRouterSearchParamsRef.current(normalizedParams, options);
    },
    [],
  );

  const recordRouteWrittenViewport = useCallback(
    (
      params: URLSearchParams,
      viewport: HistogramViewport,
      seq: number,
      applySource: HistogramViewportApplySource,
    ): void => {
      pendingViewportSyncRef.current = cloneHistogramViewport(viewport);
      lastRouteWrittenViewportSeqRef.current = seq;
      lastRouteWrittenViewportSearchKeyRef.current =
        createHistogramViewportSearchKey(params);
      setViewportSyncDiagnostics({
        lastViewportApplySource: applySource,
        lastViewportWriteSeq: seq,
        viewportCommitSeq: viewportCommitSeqRef.current,
      });
    },
    [],
  );

  useEffect(() => {
    const syncFromLocation = () => {
      const nextParams = new URLSearchParams(window.location.search);
      searchParamsRef.current = nextParams;
      setRouteSearchParams(nextParams);
    };
    window.addEventListener('popstate', syncFromLocation);
    return () => window.removeEventListener('popstate', syncFromLocation);
  }, []);

  useEffect(
    () => () => {
      cancelPendingViewportWrite();
      cancelPendingViewportReconcile();
      if (pendingMembershipMaterializeRef.current !== 0) {
        window.clearTimeout(pendingMembershipMaterializeRef.current);
      }
      for (const timerId of pendingBinSizeTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      pendingBinSizeTimersRef.current.clear();
    },
    [cancelPendingViewportReconcile, cancelPendingViewportWrite],
  );

  const updatePendingBinSizeState = useCallback(
    (
      updater: (
        current: Record<HistogramSubplotId, PendingHistogramBinSizeState>,
      ) => Record<HistogramSubplotId, PendingHistogramBinSizeState>,
    ): void => {
      setPendingBinSizeBySubplot((current) => {
        const next = updater({ ...current });
        pendingBinSizeBySubplotRef.current = next;
        return next;
      });
    },
    [],
  );

  const clearPendingBinSizeState = useCallback(
    (subplotId?: HistogramSubplotId): void => {
      if (subplotId === undefined) {
        for (const timerId of pendingBinSizeTimersRef.current.values()) {
          window.clearTimeout(timerId);
        }
        pendingBinSizeTimersRef.current.clear();
        pendingBinSizeBySubplotRef.current = {};
        setPendingBinSizeBySubplot({});
        return;
      }
      const timerId = pendingBinSizeTimersRef.current.get(subplotId);
      if (timerId !== undefined) {
        window.clearTimeout(timerId);
        pendingBinSizeTimersRef.current.delete(subplotId);
      }
      updatePendingBinSizeState((current) => {
        if (current[subplotId] === undefined) {
          return current;
        }
        delete current[subplotId];
        return current;
      });
    },
    [updatePendingBinSizeState],
  );

  const handleMetrics = useCallback((event: HistogramMetricsEvent) => {
    setMetrics(event);
    metricsHistoryRef.current = [...metricsHistoryRef.current.slice(-63), event];
  }, []);

  useEffect(() => {
    let isActive = true;
    const abortController = new AbortController();
    const startedAt = performance.now();

    async function loadDataset() {
      setDatasetState({ status: 'loading' });
      setSelection(null);
      setHover(null);
      setMeasurement(null);
      clearPendingBinSizeState();
      recordLastBinSizeCycle(null);

      try {
        const loaded =
          histMode === 'bar'
            ? await loadHistogramBarDataset(startedAt)
            : rendererBackend === 'webgpu'
              ? {
                  ...(await loadHistogramWebgpuDataset({
                    fixtureUrl: mixedTableFixtureUrl,
                    pointCount: webgpuPointCount,
                    signal: abortController.signal,
                    startedAt,
                    tableMode,
                  })),
                  recordExportAvailable: true,
                  status: 'loaded' as const,
                }
            : tableMode === 'multi'
              ? await loadHistogramMixedTableDataset(startedAt, mixedTableFixtureUrl)
              : await loadHistogramSingleTableDataset(startedAt, scatterFastLoadParams);

        if (isActive) {
          setDatasetState(loaded);
        }
      } catch (error) {
        if (!isActive) {
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown histogram-fast dataset load error.';
        setDatasetState({
          message,
          status: 'error',
        });
      }
    }

    void loadDataset();

    return () => {
      isActive = false;
      abortController.abort();
    };
  }, [
    clearPendingBinSizeState,
    histMode,
    mixedTableFixtureUrl,
    recordLastBinSizeCycle,
    rendererBackend,
    scatterFastLoadParams,
    tableMode,
    webgpuPointCount,
  ]);

  const binSizes = useMemo(() => {
    if (datasetState.status !== 'loaded' || histMode !== 'histogram') {
      return [];
    }
    return createRouteBinSizes(datasetState.spec, binSizeSearchParams);
  }, [binSizeSearchParams, datasetState, histMode]);
  const viewportSearchKey = useMemo(
    () => createHistogramViewportSearchKey(searchParams),
    [searchParams],
  );
  const activeContinuousSubplotId = useMemo(
    () =>
      resolveContinuousBinTargetSubplotId(
        datasetState.status === 'loaded' ? datasetState.spec : null,
        snapshot?.activeSubplotId ?? null,
        focusedSubplotId,
      ),
    [datasetState, focusedSubplotId, snapshot?.activeSubplotId],
  );
  const activeRequestedBinSize = useMemo(
    () =>
      activeContinuousSubplotId === null
        ? null
        : pendingBinSizeBySubplot[activeContinuousSubplotId]?.binSize ??
          snapshot?.binSizes.find(
            (candidate) => candidate.subplotId === activeContinuousSubplotId,
          )?.binSize ??
          binSizes.find((candidate) => candidate.subplotId === activeContinuousSubplotId)
            ?.binSize ??
          null,
    [activeContinuousSubplotId, binSizes, pendingBinSizeBySubplot, snapshot?.binSizes],
  );
  const activeContinuousBinResolution = useMemo(
    () =>
      activeContinuousSubplotId === null
        ? null
        : resolveHistogramContinuousBinResolutionForSubplot(
            snapshot?.aggregation,
            activeContinuousSubplotId,
          ),
    [activeContinuousSubplotId, snapshot?.aggregation],
  );

  const initialViewport = useMemo(() => {
    if (datasetState.status !== 'loaded') {
      return null;
    }
    // The WebGPU raw route derives its URL-owned viewport from the first
    // Rust/WASM aggregation below, avoiding a duplicate TypeScript build for
    // the large generated dataset.
    if (rendererBackend === 'webgpu' && histMode === 'histogram') {
      return null;
    }
    const aggregation = buildRouteAggregationForViewport(
      datasetState,
      histMode,
      binSizes,
      initialSelectedSourceIndices,
    );
    if (aggregation === null) {
      return null;
    }
    const fallbackViewport = createDefaultHistogramViewport(aggregation);
    if (viewportSearchKey === '') {
      return fallbackViewport;
    }
    return parseHistogramViewportSearchParams(
      new URLSearchParams(viewportSearchKey),
      fallbackViewport,
    );
  }, [
    binSizes,
    datasetState,
    histMode,
    initialSelectedSourceIndices,
    rendererBackend,
    viewportSearchKey,
  ]);

  const scheduleMembershipMaterialization = useCallback(
    (
      targetPlot: HistogramPlotInstance,
      subplotId?: HistogramSubplotId,
      requestedAt?: number,
    ): void => {
      if (rendererBackend === 'webgpu') {
        if (subplotId !== undefined) clearPendingBinSizeState(subplotId);
        return;
      }
      if (pendingMembershipMaterializeRef.current !== 0) {
        window.clearTimeout(pendingMembershipMaterializeRef.current);
      }
      if (subplotId !== undefined) {
        updatePendingBinSizeState((current) => {
          const pendingState = current[subplotId];
          if (pendingState === undefined) {
            return current;
          }
          return {
            ...current,
            [subplotId]: {
              ...pendingState,
              status: 'finalizing-membership',
            },
          };
        });
      }
      pendingMembershipMaterializeRef.current = window.setTimeout(() => {
        pendingMembershipMaterializeRef.current = 0;
        const startedAt = performance.now();
        targetPlot.commands.materializeVisibleMembership();
        const updatedSnapshot = targetPlot.commands.getStateSnapshot();
        setSnapshot(updatedSnapshot);
        if (subplotId !== undefined) {
          clearPendingBinSizeState(subplotId);
          const resolution = resolveHistogramContinuousBinResolutionForSubplot(
            updatedSnapshot.aggregation,
            subplotId,
          );
          const previous = lastBinSizeCycleRef.current;
          if (
            previous !== null &&
            previous.subplotId === subplotId &&
            requestedAt !== undefined
          ) {
            recordLastBinSizeCycle({
              ...previous,
              effectiveBinSize: resolution?.effectiveBinSize ?? previous.effectiveBinSize,
              membershipFinalizeMs: performance.now() - startedAt,
              observableMs: performance.now() - requestedAt,
              requestedVisibleBinCount:
                resolution?.requestedVisibleBinCount ?? previous.requestedVisibleBinCount,
              status: resolution?.status ?? previous.status,
              visibleBinCount:
                resolution?.effectiveVisibleBinCount ?? previous.visibleBinCount,
            });
          }
        }
      }, BIN_SIZE_FINALIZE_DEBOUNCE_MS);
    },
    [
      clearPendingBinSizeState,
      recordLastBinSizeCycle,
      rendererBackend,
      updatePendingBinSizeState,
    ],
  );

  const queueBinSizeUpdate = useCallback(
    (input: {
      debounceMs?: number;
      requestedBinSize: number;
      subplotId: HistogramSubplotId;
    }): boolean => {
      const plot = plotRef.current;
      if (
        plot === null ||
        datasetState.status !== 'loaded' ||
        histMode !== 'histogram' ||
        !Number.isFinite(input.requestedBinSize) ||
        input.requestedBinSize <= 0
      ) {
        return false;
      }
      if (pendingMembershipMaterializeRef.current !== 0) {
        window.clearTimeout(pendingMembershipMaterializeRef.current);
        pendingMembershipMaterializeRef.current = 0;
      }
      const requestedAt = performance.now();
      const nextBinSize = clampPositiveNumber(input.requestedBinSize);
      updatePendingBinSizeState((current) => ({
        ...current,
        [input.subplotId]: {
          binSize: nextBinSize,
          requestedAt,
          status: 'queued',
        },
      }));
      const existingTimerId = pendingBinSizeTimersRef.current.get(input.subplotId);
      if (existingTimerId !== undefined) {
        window.clearTimeout(existingTimerId);
      }
      pendingBinSizeTimersRef.current.set(
        input.subplotId,
        window.setTimeout(() => {
          pendingBinSizeTimersRef.current.delete(input.subplotId);
          updatePendingBinSizeState((current) => {
            const pendingState = current[input.subplotId];
            if (pendingState === undefined) {
              return current;
            }
            return {
              ...current,
              [input.subplotId]: {
                ...pendingState,
                status: 'computing',
              },
            };
          });
          window.setTimeout(() => {
            const computeStartedAt = performance.now();
            const nextParams = updateBinSizeSearchParams(
              searchParamsRef.current,
              input.subplotId,
              nextBinSize,
            );
            const nextBinSizes = createRouteBinSizes(datasetState.spec, nextParams);
            plot.commands.setBinSizes({
              binSizes: nextBinSizes,
              materializeMembership: false,
            });
            const updatedSnapshot = plot.commands.getStateSnapshot();
            const resolution = resolveHistogramContinuousBinResolutionForSubplot(
              updatedSnapshot.aggregation,
              input.subplotId,
            );
            lastCommittedViewportRef.current = updatedSnapshot.viewport;
            recordLastBinSizeCycle({
              computeMs: performance.now() - computeStartedAt,
              debounceMs: Math.max(0, computeStartedAt - requestedAt),
              effectiveBinSize: resolution?.effectiveBinSize ?? null,
              membershipFinalizeMs: null,
              observableMs: Math.max(0, performance.now() - requestedAt),
              requestedBinSize: nextBinSize,
              requestedVisibleBinCount: resolution?.requestedVisibleBinCount ?? null,
              status: resolution?.status ?? 'pending',
              subplotId: input.subplotId,
              visibleBinCount: resolution?.effectiveVisibleBinCount ?? null,
            });
            setSnapshot(updatedSnapshot);
            cancelPendingViewportWrite();
            const nextViewportParams = writeHistogramViewportSearchParams(
              nextParams,
              updatedSnapshot.viewport,
            );
            recordRouteWrittenViewport(
              nextViewportParams,
              updatedSnapshot.viewport,
              viewportCommitSeqRef.current,
              'engine',
            );
            setSearchParams(() => nextViewportParams, { replace: false });
            plot.commands.render();
            scheduleMembershipMaterialization(
              plot,
              input.subplotId,
              requestedAt,
            );
          }, 0);
        }, input.debounceMs ?? BIN_SIZE_APPLY_DEBOUNCE_MS),
      );
      return true;
    },
    [
      datasetState,
      histMode,
      recordLastBinSizeCycle,
      scheduleMembershipMaterialization,
      cancelPendingViewportWrite,
      recordRouteWrittenViewport,
      setSearchParams,
      updatePendingBinSizeState,
    ],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (host === null || datasetState.status !== 'loaded') {
      return;
    }

    const commonOptions = {
      aggregation: datasetState.aggregation,
      axisMode: interactionAxis,
      binSizes,
      canvasClassName:
        rendererBackend === 'webgpu' ? undefined : 'histogram-fast-webgl-canvas',
      columns: datasetState.columns,
      mode: selectionMode,
      overlayClassName: 'histogram-fast-engine-overlay',
      preserveDrawingBuffer,
      selectedSourceIndices: initialSelectedSourceIndices,
      spec: datasetState.spec,
      theme: histogramTheme,
      viewport: initialViewport ?? undefined,
    };
    const plot: HistogramPlotInstance = rendererBackend === 'webgpu'
      ? createHistogramWebgpuPlot(host, {
          ...commonOptions,
          aggregationBackend: webgpuAggregationBackend,
        })
      : createHistogramPlot(host, commonOptions);
    plotRef.current = plot;
    const binding = plot.use(
      createDefaultHistogramBindings({
        suppressContextMenu: true,
      }),
    );
    const subscriptions = [
      plot.on('renderstatechange', (event) => {
        setRendererState({ message: event.message, status: event.state });
        if (isHistogramWebgpuPlot(plot)) {
          setWebgpuDiagnostics(plot.getWebgpuDiagnostics());
        }
      }),
      plot.on('metrics', (event) => {
        handleMetrics(event);
        if (isHistogramWebgpuPlot(plot)) {
          setWebgpuDiagnostics(plot.getWebgpuDiagnostics());
        }
      }),
      plot.on('hoverchange', (event) => {
        setHover(event);
        setSnapshot(plot.commands.getStateSnapshot());
      }),
      plot.on('measurementchange', (event) => {
        setMeasurement(event);
        setSnapshot(plot.commands.getStateSnapshot());
      }),
      plot.on('selectionchange', (event) => {
        setSelection(event);
        setSnapshot(plot.commands.getStateSnapshot());
      }),
      plot.on('viewportchange', ({ phase, reason, viewport }) => {
        if (phase === 'preview') {
          setSnapshot((current) =>
            current === null
              ? plot.commands.getStateSnapshot()
              : {
                  ...current,
                  viewport,
                },
          );
          return;
        }
        const updatedSnapshot = plot.commands.getStateSnapshot();
        setSnapshot(updatedSnapshot);
        if (phase === 'commit') {
          viewportCommitSeqRef.current += 1;
          const applySource = lastViewportApplySourceRef.current ?? 'engine';
          lastViewportApplySourceRef.current = null;
          setViewportSyncDiagnostics({
            lastViewportApplySource: applySource,
            lastViewportWriteSeq: lastRouteWrittenViewportSeqRef.current,
            viewportCommitSeq: viewportCommitSeqRef.current,
          });
          recordCommittedViewportForUndo(viewport, reason);
          writeViewportToUrl(viewport, reason === 'wheel', viewportCommitSeqRef.current);
          if (hasPendingHistogramAggregationMembership(updatedSnapshot.aggregation)) {
            scheduleMembershipMaterialization(plot);
          }
        }
      }),
      plot.on('overlaychange', (event) => {
        setOverlays(event.overlays);
        setSnapshot(plot.commands.getStateSnapshot());
      }),
      plot.on('activeplotchange', () => setSnapshot(plot.commands.getStateSnapshot())),
      plot.on('cursorchange', () => setSnapshot(plot.commands.getStateSnapshot())),
      plot.on('binsizeadjustrequest', (event) => {
        if (
          histMode !== 'histogram' ||
          event.subplotId === undefined ||
          event.binSize?.mode !== 'continuous'
        ) {
          return;
        }
        const currentBinSize =
          pendingBinSizeBySubplotRef.current[event.subplotId]?.binSize ??
          event.binSize?.binSize ??
          plot.commands.getStateSnapshot().binSizes.find(
            (candidate) => candidate.subplotId === event.subplotId,
          )?.binSize ??
          binSizes.find((candidate) => candidate.subplotId === event.subplotId)?.binSize;
        if (currentBinSize === null || currentBinSize === undefined) {
          return;
        }
        queueBinSizeUpdate({
          requestedBinSize: adjustRawBinSize(event.delta, currentBinSize, currentBinSize),
          subplotId: event.subplotId,
        });
      }),
      plot.on('viewportundorequest', () => {
        cancelPendingViewportWrite();
        const previousViewport =
          viewportHistoryRef.current[viewportHistoryRef.current.length - 1] ?? null;
        if (previousViewport !== null) {
          suppressViewportHistoryRef.current = true;
          lastViewportApplySourceRef.current = 'undo';
          plot.commands.setViewport(previousViewport, 'programmatic');
          return;
        }
      }),
    ];
    const mountedSnapshot = plot.commands.getStateSnapshot();
    resetViewportSeedRef.current = cloneHistogramViewport(
      createDefaultHistogramViewport(mountedSnapshot.aggregation),
    );
    lastCommittedViewportRef.current = mountedSnapshot.viewport;
    viewportHistoryRef.current = [];
    suppressViewportHistoryRef.current = false;
    viewportCommitSeqRef.current = 0;
    lastRouteWrittenViewportSeqRef.current = null;
    lastRouteWrittenViewportSearchKeyRef.current = '';
    lastViewportApplySourceRef.current = null;
    setViewportSyncDiagnostics({
      lastViewportApplySource: null,
      lastViewportWriteSeq: null,
      viewportCommitSeq: 0,
    });
    setSnapshot(mountedSnapshot);
    if (isHistogramWebgpuPlot(plot)) {
      setWebgpuDiagnostics(plot.getWebgpuDiagnostics());
    }
    setRendererState({
      message: mountedSnapshot.render.renderStateMessage,
      status: mountedSnapshot.render.renderState,
    });
    if (initialSelectedSourceIndices.length > 0) {
      setSelection({
        binDescriptors: [],
        filters: [],
        kind: 'replace',
        selectedBinCount: 0,
        selectedSourceCount: initialSelectedSourceIndices.length,
        sourceIndices: initialSelectedSourceIndices,
        sourceIndicesAvailable: true,
        tool: 'rectangle',
        viewport: plot.commands.getStateSnapshot().viewport,
      });
    }
    plot.commands.render();

    function writeViewportToUrl(
      viewport: HistogramViewport,
      debounced: boolean,
      seq: number,
    ): void {
      lastCommittedViewportRef.current = viewport;
      cancelPendingViewportWrite();
      cancelPendingViewportReconcile();

      const write = () => {
        if (seq !== viewportCommitSeqRef.current) {
          return;
        }
        setSearchParams((currentParams) => {
          const nextParams = writeHistogramViewportSearchParams(currentParams, viewport);
          recordRouteWrittenViewport(nextParams, viewport, seq, 'engine');
          return nextParams;
        }, { replace: false });
      };

      if (!debounced) {
        write();
        return;
      }
      pendingViewportWriteRef.current = window.setTimeout(() => {
        pendingViewportWriteRef.current = 0;
        write();
      }, VIEWPORT_WRITE_DEBOUNCE_MS);
    }

    return () => {
      cancelPendingViewportWrite();
      cancelPendingViewportReconcile();
      if (pendingMembershipMaterializeRef.current !== 0) {
        window.clearTimeout(pendingMembershipMaterializeRef.current);
        pendingMembershipMaterializeRef.current = 0;
      }
      clearPendingBinSizeState();
      binding.dispose();
      for (const unsubscribe of subscriptions) {
        unsubscribe();
      }
      plot.dispose();
      setWebgpuDiagnostics(null);
      if (plotRef.current === plot) {
        plotRef.current = null;
        resetViewportSeedRef.current = null;
      }
    };
  // The plot instance is recreated only for dataset/host lifecycle changes.
  // Bin sizes, viewport, interaction mode, and theme flow through the focused
  // update effects below to avoid tearing down the WebGL lifecycle on every
  // route-state change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    datasetState,
    handleMetrics,
    initialSelectedSourceIndices,
    preserveDrawingBuffer,
    rendererBackend,
    scheduleMembershipMaterialization,
    setSearchParams,
    clearPendingBinSizeState,
    cancelPendingViewportReconcile,
    cancelPendingViewportWrite,
    queueBinSizeUpdate,
    recordCommittedViewportForUndo,
    recordRouteWrittenViewport,
    webgpuAggregationBackend,
  ]);

  useEffect(() => {
    const plot = plotRef.current;
    if (plot === null || datasetState.status !== 'loaded') {
      return;
    }
    const currentSnapshot = plot.commands.getStateSnapshot();
    const preserveViewport = areHistogramBinSizeStatesEqual(
      currentSnapshot.binSizes,
      binSizes,
    );
    plot.update({
      binSizes,
      ...(histMode === 'bar' ? { aggregation: datasetState.aggregation } : {}),
      columns: datasetState.columns,
      focusedSubplotId,
      spec: datasetState.spec,
      theme: histogramTheme,
      ...(preserveViewport ? { viewport: currentSnapshot.viewport } : {}),
    });
    const updatedSnapshot = plot.commands.getStateSnapshot();
    lastCommittedViewportRef.current = updatedSnapshot.viewport;
    setSnapshot(updatedSnapshot);
    setRendererState({
      message: updatedSnapshot.render.renderStateMessage,
      status: updatedSnapshot.render.renderState,
    });
    plot.commands.render();
  }, [
    binSizes,
    datasetState,
    focusedSubplotId,
    histMode,
    histogramTheme,
  ]);

  useEffect(() => {
    const plot = plotRef.current;
    if (plot === null || datasetState.status !== 'loaded') {
      return;
    }
    plot.update({
      axisMode: interactionAxis,
      mode: selectionMode,
    });
    setSnapshot(plot.commands.getStateSnapshot());
  }, [datasetState.status, interactionAxis, selectionMode]);

  useEffect(() => {
    const plot = plotRef.current;
    if (plot === null || datasetState.status !== 'loaded') {
      return;
    }
    const routeViewport =
      initialViewport ??
      (
        rendererBackend === 'webgpu' && histMode === 'histogram'
          ? parseHistogramViewportSearchParams(
              new URLSearchParams(viewportSearchKey),
              createDefaultHistogramViewport(
                plot.commands.getStateSnapshot().aggregation,
              ),
            )
          : null
      );
    if (routeViewport === null) {
      return;
    }
    const currentViewport = plot.commands.getStateSnapshot().viewport;
    const routeOwnsSearchKey =
      lastRouteWrittenViewportSearchKeyRef.current !== '' &&
      lastRouteWrittenViewportSearchKeyRef.current === viewportSearchKey;
    if (
      routeOwnsSearchKey &&
      ((pendingViewportSyncRef.current !== null &&
        areHistogramViewportsApproximatelyEqual(
          pendingViewportSyncRef.current,
          routeViewport,
        )) ||
        areHistogramViewportsApproximatelyEqual(currentViewport, routeViewport))
    ) {
      pendingViewportSyncRef.current = null;
      return;
    }
    if (areHistogramViewportsApproximatelyEqual(currentViewport, routeViewport)) {
      pendingViewportSyncRef.current = null;
      return;
    }
    pendingViewportSyncRef.current = null;
    cancelPendingViewportWrite();
    cancelPendingViewportReconcile();
    viewportHistoryRef.current = [];
    suppressViewportHistoryRef.current = false;
    lastViewportApplySourceRef.current = 'external-url';
    plot.update({ viewport: routeViewport });
    const updatedSnapshot = plot.commands.getStateSnapshot();
    lastCommittedViewportRef.current = updatedSnapshot.viewport;
    setSnapshot(updatedSnapshot);
    plot.commands.render();
  }, [
    cancelPendingViewportReconcile,
    cancelPendingViewportWrite,
    datasetState.status,
    histMode,
    initialViewport,
    rendererBackend,
    viewportSearchKey,
  ]);

  const diagnostics = useMemo(
    () =>
      createDiagnostics({
        activeContinuousBinResolution,
        activeContinuousSubplotId,
        activeRequestedBinSize,
        lastBinSizeCycle,
        pendingBinSizeBySubplot,
        datasetState,
        histMode,
        hover,
        interactionAxis,
        measurement,
        metrics,
        rendererState,
        selectionMode,
        selection,
        snapshot,
        tableMode,
        viewportSyncDiagnostics,
        webgpuDiagnostics,
      }),
    [
      activeContinuousBinResolution,
      activeContinuousSubplotId,
      activeRequestedBinSize,
      lastBinSizeCycle,
      pendingBinSizeBySubplot,
      datasetState,
      histMode,
      hover,
      interactionAxis,
      measurement,
      metrics,
      rendererState,
      selectionMode,
      selection,
      snapshot,
      tableMode,
      viewportSyncDiagnostics,
      webgpuDiagnostics,
    ],
  );
  const selectionCallbackPreview = useMemo(
    () => serializeHistogramSelectionCallbackPreview(selection),
    [selection],
  );

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    window.__histogramFastBenchmarkTestHook = {
      getLastMetrics: () => metrics,
      getMetricHistory: () => metricsHistoryRef.current.slice(),
      getRouteState: () => diagnostics.routeState,
      selectRectangleForBenchmark: () => selectRectangleForBenchmark(plotRef.current),
      serializeSelectedIdsForBenchmark: () =>
        serializeSelectedIdsForBenchmark(plotRef.current, datasetState, selection),
      serializeSelectedRecordsForBenchmark: () =>
        serializeSelectedRecordsForBenchmark(plotRef.current, datasetState, selection),
      setRawBinSizeForBenchmark: (binSize) => {
        clearPendingBinSizeState();
        if (pendingMembershipMaterializeRef.current !== 0) {
          window.clearTimeout(pendingMembershipMaterializeRef.current);
          pendingMembershipMaterializeRef.current = 0;
        }
        const targetSubplotId = resolveContinuousBinTargetSubplotId(
          datasetState.status === 'loaded' ? datasetState.spec : null,
          plotRef.current?.commands.getStateSnapshot().activeSubplotId ?? null,
          focusedSubplotId,
        );
        if (
          datasetState.status !== 'loaded' ||
          histMode !== 'histogram' ||
          targetSubplotId === null ||
          !Number.isFinite(binSize) ||
          binSize <= 0
        ) {
          return false;
        }
        const plot = plotRef.current;
        if (plot === null) {
          return false;
        }
        const requestedAt = performance.now();
        const nextBinSize = clampPositiveNumber(binSize);
        const nextParams = updateBinSizeSearchParams(
          searchParamsRef.current,
          targetSubplotId,
          nextBinSize,
        );
        const nextBinSizes = createRouteBinSizes(datasetState.spec, nextParams);
        const computeStartedAt = performance.now();
        plot.commands.setBinSizes({
          binSizes: nextBinSizes,
          materializeMembership: false,
        });
        const computedSnapshot = plot.commands.getStateSnapshot();
        const resolution = resolveHistogramContinuousBinResolutionForSubplot(
          computedSnapshot.aggregation,
          targetSubplotId,
        );
        const computeMs = performance.now() - computeStartedAt;
        lastCommittedViewportRef.current = computedSnapshot.viewport;
        setSnapshot(computedSnapshot);
        cancelPendingViewportWrite();
        const nextViewportParams = writeHistogramViewportSearchParams(
          nextParams,
          computedSnapshot.viewport,
        );
        recordRouteWrittenViewport(
          nextViewportParams,
          computedSnapshot.viewport,
          viewportCommitSeqRef.current,
          'engine',
        );
        setSearchParams(() => nextViewportParams, { replace: true });
        plot.commands.render();
        const membershipStartedAt = performance.now();
        plot.commands.materializeVisibleMembership();
        const finalizedSnapshot = plot.commands.getStateSnapshot();
        setSnapshot(finalizedSnapshot);
        recordLastBinSizeCycle({
          computeMs,
          debounceMs: 0,
          effectiveBinSize: resolution?.effectiveBinSize ?? null,
          membershipFinalizeMs: performance.now() - membershipStartedAt,
          observableMs: performance.now() - requestedAt,
          requestedBinSize: nextBinSize,
          requestedVisibleBinCount: resolution?.requestedVisibleBinCount ?? null,
          status: resolution?.status ?? 'pending',
          subplotId: targetSubplotId,
          visibleBinCount: resolution?.effectiveVisibleBinCount ?? null,
        });
        return true;
      },
    };
    window.__histogramFastRouteStateTestHook = () => diagnostics.routeState;
    window.__histogramFastSelectionTestHook = () => selection;
    window.__histogramFastHoverTestHook = () => hover;
    window.__histogramFastMeasurementTestHook = () => measurement;
    return () => {
      delete window.__histogramFastBenchmarkTestHook;
      delete window.__histogramFastRouteStateTestHook;
      delete window.__histogramFastSelectionTestHook;
      delete window.__histogramFastHoverTestHook;
      delete window.__histogramFastMeasurementTestHook;
    };
  }, [
    clearPendingBinSizeState,
    datasetState,
    diagnostics.routeState,
    focusedSubplotId,
    histMode,
    hover,
    measurement,
    metrics,
    queueBinSizeUpdate,
    recordLastBinSizeCycle,
    recordRouteWrittenViewport,
    cancelPendingViewportWrite,
    setSearchParams,
    selection,
  ]);

  const updateSearchParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (currentParams) => {
          const nextParams = new URLSearchParams(currentParams);
          if (value === null || value === '') {
            nextParams.delete(key);
          } else {
            nextParams.set(key, value);
          }
          return nextParams;
        },
      );
      const plot = plotRef.current;
      if (plot === null) {
        return;
      }
      if (key === 'mode' && isHistogramSelectionMode(value)) {
        plot.update({ mode: value });
        setSnapshot(plot.commands.getStateSnapshot());
      } else if (key === 'axis' && isInteractionAxis(value)) {
        plot.update({ axisMode: value });
        setSnapshot(plot.commands.getStateSnapshot());
      }
    },
    [setSearchParams],
  );

  const selectWebgpuPointCount = useCallback((pointCount: number) => {
    if (pointCount === webgpuPointCount) return;
    const next = new URL(window.location.href);
    next.searchParams.set(HISTOGRAM_WEBGPU_POINT_COUNT_PARAM, String(pointCount));
    window.location.assign(next.href);
  }, [webgpuPointCount]);

  const selectWebgpuTableMode = useCallback((mode: FastRouteTableMode) => {
    if (mode === tableMode) return;
    const next = new URL(window.location.href);
    const value = formatFastRouteTableMode(mode);
    if (value === null) next.searchParams.delete(FAST_ROUTE_TABLES_PARAM);
    else next.searchParams.set(FAST_ROUTE_TABLES_PARAM, value);
    window.location.assign(next.href);
  }, [tableMode]);

  const selectHistogramMode = useCallback((mode: HistogramRouteMode) => {
    if (mode === histMode) return;
    const next = new URL(window.location.href);
    if (mode === 'histogram') next.searchParams.delete(HISTOGRAM_MODE_PARAM);
    else next.searchParams.set(HISTOGRAM_MODE_PARAM, mode);
    window.location.assign(next.href);
  }, [histMode]);

  const selectWebgpuAggregationBackend = useCallback(
    (backend: HistogramWebgpuAggregationBackend) => {
      if (backend === webgpuAggregationBackend) return;
      const next = new URL(window.location.href);
      if (backend === 'auto') {
        next.searchParams.delete(HISTOGRAM_WEBGPU_AGGREGATION_BACKEND_PARAM);
      } else {
        next.searchParams.set(HISTOGRAM_WEBGPU_AGGREGATION_BACKEND_PARAM, backend);
      }
      window.location.assign(next.href);
    },
    [webgpuAggregationBackend],
  );

  const resetViewport = useCallback(() => {
    const plot = plotRef.current;
    const resetSeed = resetViewportSeedRef.current;
    if (plot === null || resetSeed === null) {
      return;
    }

    cancelPendingViewportWrite();
    cancelPendingViewportReconcile();
    viewportHistoryRef.current = [];
    pendingViewportSyncRef.current = null;
    suppressViewportHistoryRef.current = false;
    lastViewportApplySourceRef.current = 'reset';
    plot.update({
      focusedSubplotId: null,
      viewport: resetSeed,
    });
    const fullAggregation = plot.commands.getStateSnapshot().aggregation;
    const defaultViewport = createDefaultHistogramViewport(fullAggregation);
    resetViewportSeedRef.current = cloneHistogramViewport(defaultViewport);
    plot.update({
      focusedSubplotId: null,
      viewport: defaultViewport,
    });
    const updatedSnapshot = plot.commands.getStateSnapshot();
    lastCommittedViewportRef.current = updatedSnapshot.viewport;
    setSnapshot(updatedSnapshot);
    plot.commands.render();

    setSearchParams((currentParams) => {
      const nextParams = new URLSearchParams(currentParams);
      nextParams.delete(HISTOGRAM_FOCUSED_SUBPLOT_PARAM);
      for (const key of [...nextParams.keys()]) {
        if (key.startsWith(`${HISTOGRAM_VIEWPORT_PREFIX}.`)) {
          nextParams.delete(key);
        }
      }
      return nextParams;
    });
  }, [cancelPendingViewportReconcile, cancelPendingViewportWrite, setSearchParams]);

  const handleRouteLevelMiddleUndo = useCallback(() => {
    window.setTimeout(() => {
      const plot = plotRef.current;
      const previousViewport =
        viewportHistoryRef.current[viewportHistoryRef.current.length - 1] ?? null;
      const currentViewport = plot?.commands.getStateSnapshot().viewport ?? null;
      const latestCommittedViewport = lastCommittedViewportRef.current;
      if (
        plot === null ||
        previousViewport === null ||
        currentViewport === null ||
        latestCommittedViewport === null ||
        !areHistogramViewportsApproximatelyEqual(currentViewport, latestCommittedViewport)
      ) {
        return;
      }
      suppressViewportHistoryRef.current = true;
      lastViewportApplySourceRef.current = 'undo';
      plot.commands.setViewport(previousViewport, 'programmatic');
    }, 0);
  }, []);

  const clearSelection = useCallback(() => {
    plotRef.current?.commands.clearSelection();
    setSelection(null);
    setExportStatus('Selection cleared.');
  }, []);

  const handleCopySelectedIds = useCallback(async () => {
    if (datasetState.status !== 'loaded' || selection === null) {
      return;
    }
    const resolvedSelection = resolveSelectionForExport(plotRef.current, selection);
    if (resolvedSelection === null) {
      return;
    }
    const exportResult = materializeSelectedIds(datasetState.columns, resolvedSelection);
    if (!exportResult.available) {
      setExportStatus(exportResult.message);
      return;
    }
    await navigator.clipboard?.writeText(exportResult.text);
    setExportStatus(`Copied ${exportResult.count.toLocaleString()} selected IDs.`);
  }, [datasetState, selection]);

  const handleDownloadSelectedRecords = useCallback(() => {
    if (datasetState.status !== 'loaded' || selection === null) {
      return;
    }
    const resolvedSelection = resolveSelectionForExport(plotRef.current, selection);
    if (resolvedSelection === null) {
      return;
    }
    const exportResult = materializeSelectedRecords(
      datasetState.columns,
      resolvedSelection,
    );
    if (!exportResult.available) {
      setExportStatus(exportResult.message);
      return;
    }
    const blob = new Blob([exportResult.text], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'histogram-fast-selected-records.ndjson';
    anchor.click();
    URL.revokeObjectURL(url);
    setExportStatus(
      `Downloaded ${exportResult.count.toLocaleString()} selected records.`,
    );
  }, [datasetState, selection]);

  return (
    <main className="prototype-shell histogram-fast-prototype-shell">
      <section className="workspace">
        <div className="workspace-grid histogram-fast-workspace-grid">
          <section className="parallel-main-panel" aria-label="Histogram chart panel">
            <div className="chart-region">
              <div className="histogram-fast-chart-shell">
              <div
                className="histogram-fast-webgl-host"
                data-cursor={snapshot?.cursor ?? 'default'}
                data-record-count={
                  datasetState.status === 'loaded'
                    ? datasetState.metadata.recordCount
                    : undefined
                }
                data-render-state={rendererState.status}
                data-renderer={
                  rendererBackend === 'webgpu'
                    ? 'webgpu-histogram'
                    : 'webgl2-histogram'
                }
                data-testid="histogram-fast-route-host"
                onPointerDownCapture={(event) => {
                  if (event.button !== 1) {
                    return;
                  }
                  pendingMiddleUndoGestureRef.current = {
                    moved: false,
                    x: event.clientX,
                    y: event.clientY,
                  };
                }}
                onPointerMoveCapture={(event) => {
                  const gesture = pendingMiddleUndoGestureRef.current;
                  if (gesture === null || gesture.moved) {
                    return;
                  }
                  if (
                    Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >
                    MIDDLE_CLICK_MAX_MOVE_CSS_PX
                  ) {
                    gesture.moved = true;
                  }
                }}
                onPointerUpCapture={(event) => {
                  const gesture = pendingMiddleUndoGestureRef.current;
                  pendingMiddleUndoGestureRef.current = null;
                  if (event.button !== 1 || gesture === null || gesture.moved) {
                    return;
                  }
                  handleRouteLevelMiddleUndo();
                }}
                ref={hostRef}
              />
              {snapshot !== null ? (
                <HistogramRouteOverlays
                  hover={hover}
                  measurement={measurement}
                  overlays={overlays}
                  pendingBinSizeBySubplot={pendingBinSizeBySubplot}
                  spec={datasetState.status === 'loaded' ? datasetState.spec : null}
                  snapshot={snapshot}
                />
              ) : null}
              {datasetState.status === 'loading' ? (
                <div className="histogram-fast-render-status">Loading histogram data</div>
              ) : null}
              {datasetState.status === 'error' ? (
                <div className="histogram-fast-render-error">{datasetState.message}</div>
              ) : null}
              {rendererState.status === 'error' ? (
                <div className="histogram-fast-render-error">
                  {rendererState.message ?? 'Histogram renderer error.'}
                </div>
              ) : null}
              </div>
            </div>
          </section>
          <aside className="control-panel">
            <DemoSidebarHeader
              links={[
                { icon: 'overview', label: 'Overview', to: createThemeAwareTo('/', searchParams, themeMode) },
              ]}
              title={rendererBackend === 'webgpu' ? 'm-histogram WebGPU' : 'm-histogram'}
            />
            <section className="control-section">
              <h2>Dataset</h2>
              {rendererBackend === 'webgpu' ? (
                <div className="scatter-webgpu-dataset-controls">
                  <div
                    aria-label="WebGPU histogram dataset size"
                    className="segmented-control"
                    data-testid="histogram-webgpu-point-count"
                  >
                    {HISTOGRAM_WEBGPU_POINT_COUNTS.map((count) => (
                      <button
                        className={webgpuPointCount === count ? 'is-active' : undefined}
                        disabled={histMode === 'bar'}
                        key={count}
                        onClick={() => selectWebgpuPointCount(count)}
                        type="button"
                      >
                        {count / 1_000_000}M
                      </button>
                    ))}
                  </div>
                  <div
                    aria-label="WebGPU histogram table mode"
                    className="segmented-control scatter-webgpu-table-mode-control"
                    data-testid="histogram-webgpu-table-mode"
                  >
                    {(['single', 'multi'] as const).map((mode) => (
                      <button
                        aria-pressed={tableMode === mode}
                        className={tableMode === mode ? 'is-active' : undefined}
                        disabled={histMode === 'bar'}
                        key={mode}
                        onClick={() => selectWebgpuTableMode(mode)}
                        type="button"
                      >
                        {mode === 'single' ? 'Single table' : 'Multiple tables'}
                      </button>
                    ))}
                  </div>
                  <details
                    className="control-disclosure scatter-webgpu-dataset-details"
                    data-testid="histogram-webgpu-dataset-details"
                  >
                    <summary>Dataset details</summary>
                    <div className="control-disclosure-body">
                      <p className="compact-note">
                        Uses the same locally generated, paged dataset as m-scatter
                        WebGPU: process phase, acceptance, signal value, and the same
                        per-record palette.
                      </p>
                      <p className="compact-note">
                        Every selected record contributes to aggregation at every size.
                        Multiple tables adds the same fixed 1,000-record secondary table.
                      </p>
                    </div>
                  </details>
                  <div className="scatter-fast-display-mode-control">
                    <span id="histogram-webgpu-input-mode-label">Input mode</span>
                    <div
                      aria-labelledby="histogram-webgpu-input-mode-label"
                      className="segmented-control scatter-fast-plot-mode-radio-group histogram-webgpu-input-mode-control"
                      data-testid="histogram-webgpu-input-mode"
                      role="radiogroup"
                    >
                      {([
                        { label: 'Raw records', value: 'histogram' },
                        { label: 'Pre-aggregated bars', value: 'bar' },
                      ] as const).map((option) => (
                        <label
                          className={histMode === option.value ? 'is-active' : undefined}
                          key={option.value}
                        >
                          <input
                            checked={histMode === option.value}
                            name="histogram-webgpu-input-mode"
                            onChange={() => selectHistogramMode(option.value)}
                            type="radio"
                            value={option.value}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="scatter-fast-display-mode-control">
                    <span id="histogram-webgpu-aggregation-backend-label">
                      Aggregation backend
                    </span>
                    <div
                      aria-labelledby="histogram-webgpu-aggregation-backend-label"
                      className="segmented-control scatter-fast-plot-mode-radio-group scatter-fast-aggregation-backend-radio-group"
                      data-testid="histogram-webgpu-aggregation-backend"
                      role="radiogroup"
                    >
                      {([
                        { label: 'Auto', value: 'auto' },
                        { label: 'Rust/WASM', value: 'rust-wasm' },
                        { label: 'TypeScript', value: 'typescript' },
                      ] as const).map((option) => (
                        <label
                          className={
                            webgpuAggregationBackend === option.value
                              ? 'is-active'
                              : undefined
                          }
                          data-disabled={histMode === 'bar' ? 'true' : undefined}
                          key={option.value}
                        >
                          <input
                            checked={webgpuAggregationBackend === option.value}
                            disabled={histMode === 'bar'}
                            name="histogram-webgpu-aggregation-backend"
                            onChange={() => selectWebgpuAggregationBackend(option.value)}
                            type="radio"
                            value={option.value}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div
                    aria-live="polite"
                    className="scatter-fast-aggregation-backend-indicator"
                    data-backend={webgpuDiagnostics?.aggregation.backend ?? 'pending'}
                    data-testid="histogram-webgpu-aggregation-backend-active"
                    role="status"
                  >
                    {histMode === 'bar'
                      ? 'pre-aggregated (bypassed)'
                      : webgpuDiagnostics?.aggregation.backend === 'rust-wasm'
                        ? 'Running now: Rust/WASM'
                        : webgpuDiagnostics?.aggregation.backend === 'typescript'
                          ? 'Running now: TypeScript'
                          : 'Starting aggregation…'}
                    {webgpuDiagnostics?.aggregation.fallbackReason === undefined
                      ? null
                      : ` — ${webgpuDiagnostics.aggregation.fallbackReason}`}
                  </div>
                  <small>
                    Auto and Rust/WASM prefer WebAssembly with an exact TypeScript
                    fallback.
                  </small>
                </div>
              ) : null}
              <dl className="metrics-grid">
                <div>
                  <dt>Records</dt>
                  <dd>
                    {datasetState.status === 'loaded'
                      ? datasetState.metadata.recordCount.toLocaleString()
                      : 'loading'}
                  </dd>
                </div>
                <div>
                  <dt>Tables</dt>
                  <dd>{histMode === 'bar' ? 'bar payload' : tableMode}</dd>
                </div>
                <div>
                  <dt>Parameters</dt>
                  <dd>
                    {datasetState.status === 'loaded'
                      ? datasetState.spec.parameters.length.toLocaleString()
                      : 'pending'}
                  </dd>
                </div>
                <div>
                  <dt>Render</dt>
                  <dd>{rendererState.status}</dd>
                </div>
              </dl>
            </section>
            <section className="control-section">
              <h2>Viewport</h2>
              <div className="route-viewport-controls">
                <div className="route-viewport-group">
                  <span className="route-viewport-group-label">Subplot size</span>
                  <div
                    aria-label="m-histogram subplot size controls"
                    className="route-focus-controls"
                  >
                    <button
                      className={focusedSubplotId === null ? 'is-active' : ''}
                      data-testid="histogram-fast-focus-all"
                      onClick={() => updateSearchParam(HISTOGRAM_FOCUSED_SUBPLOT_PARAM, null)}
                      type="button"
                    >
                      All
                    </button>
                    {datasetState.status === 'loaded'
                      ? datasetState.spec.subplots.map((subplot) => (
                          <button
                            className={
                              focusedSubplotId === subplot.id ? 'is-active' : ''
                            }
                            data-testid={`histogram-fast-focus-${subplot.id}`}
                            key={subplot.id}
                            onClick={() =>
                              updateSearchParam(
                                HISTOGRAM_FOCUSED_SUBPLOT_PARAM,
                                focusedSubplotId === subplot.id ? null : subplot.id,
                              )
                            }
                            type="button"
                          >
                            {subplot.label}
                          </button>
                        ))
                      : null}
                  </div>
                </div>
                <div className="route-viewport-group">
                  <button
                    aria-label="Reset viewport"
                    className="secondary-link route-reset-button"
                    data-testid="histogram-fast-reset-viewport"
                    disabled={snapshot?.aggregation === undefined}
                    onClick={resetViewport}
                    type="button"
                  >
                    Reset viewport
                  </button>
                </div>
              </div>
            </section>
            <InteractionCheatSheet
              groups={HISTOGRAM_SHORTCUT_GROUPS}
              tryItems={HISTOGRAM_TRY_THIS_ITEMS}
            />
            <section className="control-section">
              <h2>Current selection</h2>
              <dl className="selection-grid">
                <div>
                  <dt>Selected bins</dt>
                  <dd>{selection?.selectedBinCount.toLocaleString('en-US') ?? 'none'}</dd>
                </div>
                <div>
                  <dt>Selected records</dt>
                  <dd>
                    {selection?.selectedSourceCount.toLocaleString('en-US') ?? 'none'}
                  </dd>
                </div>
              </dl>
              <button
                className="secondary-link"
                disabled={selection === null || selection.selectedSourceCount === 0}
                onClick={handleCopySelectedIds}
                type="button"
              >
                Copy selected IDs
              </button>
              <button
                className="secondary-link"
                disabled={selection === null || selection.selectedSourceCount === 0}
                onClick={handleDownloadSelectedRecords}
                type="button"
              >
                Download selected records
              </button>
              <button
                className="secondary-link"
                disabled={selection === null}
                onClick={clearSelection}
                type="button"
              >
                Clear selection
              </button>
              <p className="histogram-fast-export-status">{exportStatus}</p>
            </section>
            <section className="control-section">
              <details className="control-disclosure route-advanced-diagnostics">
                <summary>
                  <h2>Advanced diagnostics</h2>
                </summary>
                <div className="control-disclosure-body">
                  <details className="control-disclosure">
                    <summary>Renderer and bin metrics</summary>
                    <div className="control-disclosure-body">
                      <dl className="diagnostic-list">
                        {diagnostics.items.map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </details>
                  <details className="control-disclosure">
                    <summary>Selection callback payload</summary>
                    <div className="control-disclosure-body">
                      <pre
                        className="compact-code-block"
                        data-testid="histogram-fast-selection-filter-preview"
                      >
                        <code>{selectionCallbackPreview}</code>
                      </pre>
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

function HistogramRouteOverlays(props: {
  hover: HistogramHoverEvent | null;
  measurement: HistogramMeasurementEvent | null;
  overlays: readonly HistogramOverlayDescriptor[];
  pendingBinSizeBySubplot: Readonly<
    Record<HistogramSubplotId, PendingHistogramBinSizeState>
  >;
  spec: HistogramPlotSpec | null;
  snapshot: HistogramStateSnapshot;
}) {
  const {
    hover,
    measurement,
    overlays,
    pendingBinSizeBySubplot,
    snapshot,
    spec,
  } = props;
  const { layout } = snapshot.render;
  const viewBox = `0 0 ${Math.max(1, layout.widthCssPx)} ${Math.max(1, layout.heightCssPx)}`;
  const committedShapes = overlays.flatMap((overlay) =>
    overlay.kind === 'committed-selection' ? overlay.shapes : [],
  );
  const pendingBinSizeEntries = Object.entries(pendingBinSizeBySubplot);

  return (
    <>
      <svg
        aria-hidden="true"
        className="histogram-fast-overlay"
        viewBox={viewBox}
      >
        {layout.plotRects.map((rect) => (
          <HistogramSubplotOverlay
            key={rect.id}
            rect={rect}
            spec={spec}
            snapshot={snapshot}
          />
        ))}
        {overlays
          .filter((overlay) => overlay.kind !== 'committed-selection')
          .map((overlay) => renderDescriptorOverlay(overlay))}
        {committedShapes.length === 0 ? null : (
          <g
            className="histogram-fast-committed-selection-overlay"
            data-committed-lasso-count={String(
              committedShapes.filter((shape) => shape.kind === 'lasso').length,
            )}
            data-committed-rectangle-count={String(
              committedShapes.filter((shape) => shape.kind === 'rectangle').length,
            )}
            data-committed-selection-count={String(committedShapes.length)}
            data-testid="histogram-fast-committed-selection-overlay"
            opacity="0"
          >
            {committedShapes.map((shape, index) =>
              shape.kind === 'rectangle' ? (
                <rect
                  className="histogram-fast-committed-selection"
                  data-testid="histogram-fast-committed-rectangle-selection-box"
                  height={shape.rect.heightCssPx}
                  key={`${shape.kind}:${shape.subplotId ?? 'subplot'}:${shape.rect.xCssPx}:${shape.rect.yCssPx}:${index}`}
                  width={shape.rect.widthCssPx}
                  x={shape.rect.xCssPx}
                  y={shape.rect.yCssPx}
                />
              ) : (
                <polyline
                  className="histogram-fast-lasso histogram-fast-committed-selection-path"
                  data-testid="histogram-fast-committed-lasso-selection-path"
                  key={`${shape.kind}:${shape.subplotId ?? 'subplot'}:${index}`}
                  points={shape.points
                    .map((point) => `${point.xCssPx},${point.yCssPx}`)
                    .join(' ')}
                />
              ),
            )}
          </g>
        )}
        {hover !== null
          ? renderHoverGuide(hover, layout.plotRects, snapshot.viewport)
          : null}
        {measurement !== null
          ? renderMeasurementGuide(measurement, layout.plotRects, snapshot.viewport)
          : null}
      </svg>
      {pendingBinSizeEntries.map(([subplotId, pendingState]) => {
        const rect = layout.plotRects.find((candidate) => candidate.id === subplotId);
        if (rect === undefined) {
          return null;
        }
        return (
          <div
            className="histogram-fast-bin-size-pending-overlay"
            data-status={pendingState.status}
            data-testid="histogram-fast-bin-size-pending-overlay"
            key={`pending-bin-size:${subplotId}`}
            style={{
              alignItems: 'flex-start',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-start',
              height: `${rect.heightCssPx}px`,
              left: `${rect.xCssPx}px`,
              top: `${rect.yCssPx}px`,
              width: `${rect.widthCssPx}px`,
            }}
          >
            <span className="histogram-fast-bin-size-pending-badge">
              {formatPendingBinSizeStatus(pendingState.status)}
            </span>
            <span className="histogram-fast-bin-size-pending-value">
              {formatPendingBinSizeLabel(spec, subplotId, pendingState.binSize)}
            </span>
          </div>
        );
      })}
      {measurement !== null ? (
        <div
          className="histogram-fast-cursor-tooltip"
          style={{
            transform: `translate(${Math.min(
              layout.widthCssPx - 220,
              resolveMeasurementTooltipAnchor(measurement).canvasX + 12,
            )}px, ${Math.max(
              8,
              resolveMeasurementTooltipAnchor(measurement).canvasY - 8,
            )}px)`,
          }}
        >
          <strong>
            {spec === null
              ? measurement.reference.bin.subplotId
              : resolveHistogramSubplotLabel(spec, measurement.reference.bin.subplotId)}
          </strong>
          <span>
            {formatHistogramMeasurementSummary(spec, measurement)}
          </span>
          <span>{formatHistogramSourceSummary(measurement.reference.source)}</span>
        </div>
      ) : hover !== null ? (
        <div
          className="histogram-fast-cursor-tooltip"
          style={{
            transform: `translate(${Math.min(
              layout.widthCssPx - 220,
              hover.canvasPoint.canvasX + 12,
            )}px, ${Math.max(8, hover.canvasPoint.canvasY - 8)}px)`,
          }}
        >
          <strong>
            {spec === null
              ? hover.bin.bin.subplotId
              : resolveHistogramSubplotLabel(spec, hover.bin.bin.subplotId)}
          </strong>
          <span>
            {formatHistogramBinRange(
              spec === null
                ? undefined
                : resolveHistogramParameterForSubplot(spec, hover.bin.bin.subplotId),
              hover.bin.bin,
            )}
          </span>
          <span>{hover.bin.count.toLocaleString()} records</span>
          <span>{formatHistogramSourceSummary(hover.bin.source)}</span>
        </div>
      ) : null}
    </>
  );
}

function HistogramSubplotOverlay(props: {
  rect: HistogramPlotRect;
  spec: HistogramPlotSpec | null;
  snapshot: HistogramStateSnapshot;
}) {
  const { rect, snapshot, spec } = props;
  const subplotViewport = snapshot.viewport.subplotById[rect.id];
  const subplotSpec = snapshot.render.aggregation.subplots.find(
    (subplot) => subplot.subplotId === rect.id,
  );
  const parameterSpec =
    spec === null ? undefined : resolveHistogramParameterForSubplot(spec, rect.id);
  if (subplotViewport === undefined || subplotSpec === undefined) {
    return null;
  }
  const xTicks = createHistogramAxisTicks(parameterSpec, subplotViewport.x);
  const yTicks = createTicks(subplotViewport.y);
  const yAxisTitle = formatHistogramCountAxisTitle(
    parameterSpec,
    subplotSpec.parameterKey,
  );

  return (
    <g>
      <rect
        className="histogram-fast-overlay-plot-frame"
        data-plot-id={rect.id}
        height={rect.heightCssPx}
        width={rect.widthCssPx}
        x={rect.xCssPx}
        y={rect.yCssPx}
      />
      {xTicks.map((tick) => {
        const x = histogramAxisToPixel(
          tick.value,
          subplotViewport.x,
          rect.xCssPx,
          rect.xCssPx + rect.widthCssPx,
        );
        return (
          <g key={`x-${tick.value}`}>
            <line
              className="histogram-fast-overlay-grid-line"
              x1={x}
              x2={x}
              y1={rect.yCssPx}
              y2={rect.yCssPx + rect.heightCssPx}
            />
            <text
              className="histogram-fast-overlay-x-label"
              textAnchor="middle"
              x={x}
              y={rect.yCssPx + rect.heightCssPx + 16}
            >
              {tick.label}
            </text>
          </g>
        );
      })}
      {yTicks.map((tick) => {
        const y = histogramAxisToPixel(
          tick,
          subplotViewport.y,
          rect.yCssPx + rect.heightCssPx,
          rect.yCssPx,
        );
        return (
          <g key={`y-${tick}`}>
            <line
              className="histogram-fast-overlay-grid-line"
              x1={rect.xCssPx}
              x2={rect.xCssPx + rect.widthCssPx}
              y1={y}
              y2={y}
            />
            <text
              className="histogram-fast-overlay-y-label"
              textAnchor="end"
              x={rect.xCssPx - 8}
              y={y + 4}
            >
              {formatCompactNumber(tick)}
            </text>
          </g>
        );
      })}
      <text
        className="histogram-fast-overlay-axis-title"
        dominantBaseline="middle"
        lengthAdjust="spacingAndGlyphs"
        textAnchor="middle"
        textLength={getHistogramYAxisTitleTextLength(yAxisTitle, rect)}
        transform={`rotate(-90 ${rect.xCssPx - HISTOGRAM_Y_AXIS_TITLE_X_OFFSET} ${rect.yCssPx + rect.heightCssPx / 2})`}
        x={rect.xCssPx - HISTOGRAM_Y_AXIS_TITLE_X_OFFSET}
        y={rect.yCssPx + rect.heightCssPx / 2}
      >
        {yAxisTitle}
      </text>
    </g>
  );
}

function renderDescriptorOverlay(overlay: HistogramOverlayDescriptor) {
  if (overlay.kind === 'rectangle-selection' || overlay.kind === 'rectangle-zoom') {
    return (
      <rect
        className={`histogram-fast-${overlay.kind}`}
        height={overlay.rect.heightCssPx}
        key={overlay.id}
        width={overlay.rect.widthCssPx}
        x={overlay.rect.xCssPx}
        y={overlay.rect.yCssPx}
      />
    );
  }
  if (overlay.kind === 'lasso') {
    return (
      <polyline
        className="histogram-fast-lasso"
        key={overlay.id}
        points={overlay.points
          .map((point) => `${point.xCssPx},${point.yCssPx}`)
          .join(' ')}
      />
    );
  }
  if (overlay.kind === 'hover-guide') {
    return (
      <circle
        className="histogram-fast-hover-anchor"
        cx={overlay.anchor.xCssPx}
        cy={overlay.anchor.yCssPx}
        key={overlay.id}
        r={4}
      />
    );
  }
  if (overlay.kind === 'measurement-guide') {
    return (
      <circle
        className="histogram-fast-measurement-anchor"
        cx={overlay.reference.canvasX}
        cy={overlay.reference.canvasY}
        key={overlay.id}
        r={5}
      />
    );
  }
  return null;
}

function renderHoverGuide(
  hover: HistogramHoverEvent,
  plotRects: readonly HistogramPlotRect[],
  viewport: HistogramViewport,
) {
  const rect = plotRects.find((candidate) => candidate.id === hover.bin.bin.subplotId);
  const subplotViewport = viewport.subplotById[hover.bin.bin.subplotId];
  if (rect === undefined || subplotViewport === undefined) {
    return null;
  }
  const x = hover.canvasPoint.canvasX;
  const y = hover.canvasPoint.canvasY;
  return (
    <g className="histogram-fast-hover-guide">
      <line x1={x} x2={x} y1={rect.yCssPx} y2={rect.yCssPx + rect.heightCssPx} />
      <line x1={rect.xCssPx} x2={rect.xCssPx + rect.widthCssPx} y1={y} y2={y} />
      <circle cx={x} cy={y} r={4} />
    </g>
  );
}

function renderMeasurementGuide(
  measurement: HistogramMeasurementEvent,
  plotRects: readonly HistogramPlotRect[],
  viewport: HistogramViewport,
) {
  const rect = plotRects.find(
    (candidate) => candidate.id === measurement.reference.bin.subplotId,
  );
  const subplotViewport = viewport.subplotById[measurement.reference.bin.subplotId];
  const referencePoint = measurement.reference.canvasPoint;
  const currentPoint = measurement.current?.canvasPoint;
  if (rect === undefined || subplotViewport === undefined || referencePoint === undefined) {
    return null;
  }
  return (
    <g className="histogram-fast-measurement-guide">
      <circle cx={referencePoint.canvasX} cy={referencePoint.canvasY} r={5} />
      {currentPoint !== undefined ? (
        <>
          <line
            x1={referencePoint.canvasX}
            x2={currentPoint.canvasX}
            y1={referencePoint.canvasY}
            y2={currentPoint.canvasY}
          />
          <circle cx={currentPoint.canvasX} cy={currentPoint.canvasY} r={5} />
        </>
      ) : null}
    </g>
  );
}

async function loadHistogramSingleTableDataset(
  startedAt: number,
  searchParams: URLSearchParams,
): Promise<Extract<HistogramDatasetState, { status: 'loaded' }>> {
  const source = await loadScatterFastBenchmarkSource(searchParams);
  const adapted = adaptScatterFastBenchmarkSourceForHistogram(source);
  return {
    columns: adapted.columns,
    loadMs: performance.now() - startedAt,
    metadata: adapted.metadata,
    recordExportAvailable: true,
    sourceFormat: source.sourceFormat,
    spec: adapted.spec,
    status: 'loaded',
  };
}

function parseHistogramWebgpuPointCount(params: URLSearchParams): number {
  const value = Number(params.get(HISTOGRAM_WEBGPU_POINT_COUNT_PARAM));
  return HISTOGRAM_WEBGPU_POINT_COUNTS.includes(
    value as (typeof HISTOGRAM_WEBGPU_POINT_COUNTS)[number],
  )
    ? value
    : HISTOGRAM_WEBGPU_POINT_COUNTS[0];
}

function parseHistogramWebgpuAggregationBackend(
  params: URLSearchParams,
): HistogramWebgpuAggregationBackend {
  const value = params.get(HISTOGRAM_WEBGPU_AGGREGATION_BACKEND_PARAM);
  return value === 'rust-wasm' || value === 'typescript' ? value : 'auto';
}

function isHistogramWebgpuPlot(
  plot: HistogramPlotInstance,
): plot is HistogramWebgpuPlotInstance {
  return typeof (plot as Partial<HistogramWebgpuPlotInstance>).getWebgpuDiagnostics ===
    'function';
}

async function loadHistogramMixedTableDataset(
  startedAt: number,
  fixtureUrl: string,
): Promise<Extract<HistogramDatasetState, { status: 'loaded' }>> {
  try {
    const loaded = await loadFastPlotMixedTableFixture(fixtureUrl);
    const adapted = adaptMixedTablesForHistogram(loaded.fixture);
    return {
      columns: adapted.columns,
      loadMs: performance.now() - startedAt,
      metadata: adapted.metadata,
      recordExportAvailable: true,
      sourceFormat: 'mixed-table-json',
      spec: adapted.spec,
      status: 'loaded',
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      throw new Error(
        `${error.message} Generate it with: pnpm generate:data -- --kind mixed-tables --count 1000000 --secondary-count 1000 --seed 1`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function loadHistogramBarDataset(
  startedAt: number,
): Promise<Extract<HistogramDatasetState, { status: 'loaded' }>> {
  const response = await fetch(HISTOGRAM_BARS_DATASET_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(
      `Histogram bar data not found at ${HISTOGRAM_BARS_DATASET_URL}. Generate it with: pnpm generate:data -- --kind histogram-bars --seed 1`,
    );
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      `Histogram bar data not found at ${HISTOGRAM_BARS_DATASET_URL}. Generate it with: pnpm generate:data -- --kind histogram-bars --seed 1`,
    );
  }
  const payload = (await response.json()) as HistogramBarDemoPayload;
  const adapted = adaptHistogramBarDemoPayload(payload);
  return {
    aggregation: adapted.aggregation,
    loadMs: performance.now() - startedAt,
    metadata: {
      recordCount: adapted.aggregation.pointCount,
      tableNames: [],
      tableRecordCounts: {},
    },
    recordExportAvailable: adapted.aggregation.subplots.some(
      (subplot) => subplot.sourceIndicesAvailable,
    ),
    sourceFormat: 'histogram-bars-json',
    spec: adapted.spec,
    status: 'loaded',
  };
}

function createRouteBinSizes(
  spec: HistogramPlotSpec,
  params: URLSearchParams,
): readonly HistogramBinSizeState[] {
  const sharedBinSize = parseLegacyRawBinSize(params);
  return spec.subplots.flatMap((subplot) => {
    const parameter = spec.parameters.find(
      (candidate) => candidate.key === subplot.parameterKey,
    );
    if (
      parameter === undefined ||
      parameter.kind === 'categorical' ||
      parameter.kind === 'boolean'
    ) {
      return [];
    }
    const domainSpan =
      parameter.domain !== undefined
        ? Math.abs(parameter.domain.max - parameter.domain.min)
        : DEFAULT_BIN_COUNT;
    const subplotBinSize = parseSubplotBinSize(params, subplot.id);
    const binSize =
      subplotBinSize ??
      sharedBinSize ??
      Math.max(domainSpan / DEFAULT_BIN_COUNT, 1);
    return [
      {
        binSize,
        mode: 'continuous',
        parameterKey: subplot.parameterKey,
        subplotId: subplot.id,
      },
    ];
  });
}

function buildRouteAggregationForViewport(
  datasetState: Extract<HistogramDatasetState, { status: 'loaded' }>,
  histMode: HistogramRouteMode,
  binSizes: readonly HistogramBinSizeState[],
  selectedSourceIndices: Uint32Array,
): HistogramAggregationSet | null {
  if (histMode === 'bar') {
    return datasetState.aggregation ?? null;
  }
  if (datasetState.columns === undefined) {
    return datasetState.aggregation ?? null;
  }
  return buildHistogramAggregation(datasetState.columns, {
    binSizes,
    plotSpec: datasetState.spec,
    selectedSourceIndices,
  });
}

function createHistogramRendererTheme(themeMode: 'light' | 'dark'): HistogramRendererTheme {
  const theme = getPlotTheme(themeMode);
  return {
    backgroundColor: rgbaToUnitTuple(theme.backgroundRgba),
    defaultBarColor: rgbaToUnitTuple(theme.lineRgba),
    gridLineColor: rgbaToUnitTuple(theme.gridMajorRgba),
    hoverOverlayColor: rgbaToUnitTuple(theme.preselectedRgba),
    outOfRangeMarkerColor:
      themeMode === 'dark'
        ? [0.769, 0.71, 0.992, 0.82]
        : [0.545, 0.361, 0.965, 0.82],
    selectedOverlayColor: getCommittedSelectionOverlayColor(themeMode),
    subplotBackgroundColor: rgbaToUnitTuple(theme.subplotBackgroundRgba),
  };
}

function parseHistogramRouteMode(params: URLSearchParams): HistogramRouteMode {
  return params.get(HISTOGRAM_MODE_PARAM) === 'bar' ? 'bar' : 'histogram';
}

function parseLegacyRawBinSize(params: URLSearchParams): number | null {
  const value = Number(params.get(HISTOGRAM_BIN_SIZE_PARAM));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseHistogramSelectionMode(
  params: URLSearchParams,
): HistogramSelectionMode {
  return params.get('mode') === 'lasso' ? 'lasso' : 'select';
}

function isHistogramSelectionMode(value: string | null): value is HistogramSelectionMode {
  return value === 'select' || value === 'lasso';
}

function parseHistogramInteractionAxis(params: URLSearchParams): InteractionAxis {
  const value = params.get('axis');
  return isInteractionAxis(value) ? value : 'x';
}

function parseSubplotBinSize(
  params: URLSearchParams,
  subplotId: HistogramSubplotId,
): number | null {
  const value = Number(params.get(`${HISTOGRAM_BIN_SIZE_PREFIX}.${subplotId}`));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function updateBinSizeSearchParams(
  baseParams: URLSearchParams,
  subplotId: HistogramSubplotId,
  binSize: number,
): URLSearchParams {
  const nextParams = new URLSearchParams(baseParams);
  nextParams.delete(HISTOGRAM_BIN_SIZE_PARAM);
  nextParams.set(
    `${HISTOGRAM_BIN_SIZE_PREFIX}.${subplotId}`,
    formatNumberParam(clampPositiveNumber(binSize)),
  );
  return nextParams;
}

function resolveContinuousBinTargetSubplotId(
  spec: HistogramPlotSpec | null,
  activeSubplotId: string | null,
  focusedSubplotId: string | null,
): HistogramSubplotId | null {
  if (spec === null) {
    return null;
  }
  const continuousSubplotIds = spec.subplots
    .filter((subplot) => {
      const parameter = spec.parameters.find(
        (candidate) => candidate.key === subplot.parameterKey,
      );
      return (
        parameter !== undefined &&
        parameter.kind !== 'categorical' &&
        parameter.kind !== 'boolean'
      );
    })
    .map((subplot) => subplot.id);
  if (continuousSubplotIds.length === 0) {
    return null;
  }
  if (activeSubplotId !== null && continuousSubplotIds.includes(activeSubplotId)) {
    return activeSubplotId;
  }
  if (focusedSubplotId !== null && continuousSubplotIds.includes(focusedSubplotId)) {
    return focusedSubplotId;
  }
  return continuousSubplotIds[0] ?? null;
}

function parseSourceIndexList(value: string | null): Uint32Array {
  if (value === null || value.trim() === '') {
    return new Uint32Array(0);
  }
  const indices = value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isInteger(part) && part >= 0);
  return new Uint32Array(indices);
}

function normalizeFocusedSubplotParam(params: URLSearchParams): string | null {
  const value = params.get(HISTOGRAM_FOCUSED_SUBPLOT_PARAM);
  return value === null || value.trim() === '' ? null : value;
}

function createHistogramViewportSearchKey(params: URLSearchParams): string {
  return createFilteredHistogramSearchKey(
    params,
    (key) => key.startsWith(`${HISTOGRAM_VIEWPORT_PREFIX}.`),
  );
}

function createHistogramBinSizeSearchKey(params: URLSearchParams): string {
  return createFilteredHistogramSearchKey(
    params,
    (key) =>
      key === HISTOGRAM_BIN_SIZE_PARAM ||
      key.startsWith(`${HISTOGRAM_BIN_SIZE_PREFIX}.`),
  );
}

function createFilteredHistogramSearchKey(
  params: URLSearchParams,
  includeKey: (key: string) => boolean,
): string {
  const filtered = new URLSearchParams();
  for (const [key, value] of [...params.entries()]
    .filter(([key]) => includeKey(key))
    .sort(([left], [right]) => left.localeCompare(right))) {
    filtered.append(key, value);
  }
  return filtered.toString();
}

function parseHistogramViewportSearchParams(
  params: URLSearchParams,
  fallback: HistogramViewport,
): HistogramViewport {
  return {
    subplotById: Object.fromEntries(
      Object.entries(fallback.subplotById).map(([subplotId, fallbackViewport]) => {
        const prefix = `${HISTOGRAM_VIEWPORT_PREFIX}.${subplotId}`;
        const xMin = parseFiniteParam(params, `${prefix}.xMin`);
        const xMax = parseFiniteParam(params, `${prefix}.xMax`);
        const yMin = parseFiniteParam(params, `${prefix}.yMin`);
        const yMax = parseFiniteParam(params, `${prefix}.yMax`);
        return [
          subplotId,
          {
            x:
              xMin !== null && xMax !== null && xMin < xMax
                ? { max: xMax, min: xMin }
                : fallbackViewport.x,
            y:
              yMin !== null && yMax !== null && yMin < yMax
                ? { max: yMax, min: yMin }
                : fallbackViewport.y,
          },
        ];
      }),
    ),
  };
}

function writeHistogramViewportSearchParams(
  baseParams: URLSearchParams,
  viewport: HistogramViewport,
): URLSearchParams {
  const nextParams = new URLSearchParams(baseParams);
  for (const key of [...nextParams.keys()]) {
    if (key.startsWith(`${HISTOGRAM_VIEWPORT_PREFIX}.`)) {
      nextParams.delete(key);
    }
  }
  for (const [subplotId, subplotViewport] of Object.entries(viewport.subplotById)) {
    const prefix = `${HISTOGRAM_VIEWPORT_PREFIX}.${subplotId}`;
    nextParams.set(`${prefix}.xMin`, formatNumberParam(subplotViewport.x.min));
    nextParams.set(`${prefix}.xMax`, formatNumberParam(subplotViewport.x.max));
    nextParams.set(`${prefix}.yMin`, formatNumberParam(subplotViewport.y.min));
    nextParams.set(`${prefix}.yMax`, formatNumberParam(subplotViewport.y.max));
  }
  return nextParams;
}

function cloneHistogramViewport(viewport: HistogramViewport): HistogramViewport {
  return {
    subplotById: Object.fromEntries(
      Object.entries(viewport.subplotById).map(([subplotId, subplotViewport]) => [
        subplotId,
        {
          x: { ...subplotViewport.x },
          y: { ...subplotViewport.y },
        },
      ]),
    ),
  };
}

function areHistogramViewportsEqual(
  left: HistogramViewport,
  right: HistogramViewport,
): boolean {
  const leftEntries = Object.entries(left.subplotById);
  const rightEntries = Object.entries(right.subplotById);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (const [subplotId, leftViewport] of leftEntries) {
    const rightViewport = right.subplotById[subplotId];
    if (
      rightViewport === undefined ||
      leftViewport.x.min !== rightViewport.x.min ||
      leftViewport.x.max !== rightViewport.x.max ||
      leftViewport.y.min !== rightViewport.y.min ||
      leftViewport.y.max !== rightViewport.y.max
    ) {
      return false;
    }
  }
  return true;
}

function areHistogramViewportsApproximatelyEqual(
  left: HistogramViewport,
  right: HistogramViewport,
): boolean {
  const leftEntries = Object.entries(left.subplotById);
  const rightEntries = Object.entries(right.subplotById);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (const [subplotId, leftViewport] of leftEntries) {
    const rightViewport = right.subplotById[subplotId];
    if (
      rightViewport === undefined ||
      !areNumbersApproximatelyEqual(leftViewport.x.min, rightViewport.x.min) ||
      !areNumbersApproximatelyEqual(leftViewport.x.max, rightViewport.x.max) ||
      !areNumbersApproximatelyEqual(leftViewport.y.min, rightViewport.y.min) ||
      !areNumbersApproximatelyEqual(leftViewport.y.max, rightViewport.y.max)
    ) {
      return false;
    }
  }
  return true;
}

function areHistogramBinSizeStatesEqual(
  left: readonly HistogramBinSizeState[],
  right: readonly HistogramBinSizeState[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftState = left[index];
    const rightState = right[index];
    if (
      leftState?.subplotId !== rightState?.subplotId ||
      leftState?.parameterKey !== rightState?.parameterKey ||
      leftState?.mode !== rightState?.mode ||
      leftState?.binSize !== rightState?.binSize
    ) {
      return false;
    }
  }
  return true;
}

function areNumbersApproximatelyEqual(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= scale * 1e-6;
}

function createDiagnostics(input: {
  activeContinuousBinResolution: HistogramContinuousBinResolution | null;
  activeContinuousSubplotId: HistogramSubplotId | null;
  activeRequestedBinSize: number | null;
  lastBinSizeCycle: HistogramBinSizeCycleMetrics | null;
  pendingBinSizeBySubplot: Readonly<
    Record<HistogramSubplotId, PendingHistogramBinSizeState>
  >;
  datasetState: HistogramDatasetState;
  histMode: HistogramRouteMode;
  hover: HistogramHoverEvent | null;
  interactionAxis: InteractionAxis;
  measurement: HistogramMeasurementEvent | null;
  metrics: HistogramMetricsEvent | null;
  rendererState: RendererState;
  selectionMode: HistogramSelectionMode;
  selection: HistogramSelectionEvent | null;
  snapshot: HistogramStateSnapshot | null;
  tableMode: FastRouteTableMode;
  viewportSyncDiagnostics: {
    lastViewportApplySource: HistogramViewportApplySource | null;
    lastViewportWriteSeq: number | null;
    viewportCommitSeq: number;
  };
  webgpuDiagnostics: HistogramWebgpuPlotDiagnostics | null;
}): {
  items: readonly (readonly [string, string])[];
  routeState: HistogramRouteHookState | null;
} {
  const aggregation = input.snapshot?.aggregation;
  const binCount = aggregation?.metrics.binCount ?? 0;
  const populatedBinCount =
    aggregation?.subplots.reduce(
      (sum, subplot) =>
        sum + subplot.bins.filter((bin) => bin.totalCount > 0).length,
      0,
    ) ?? 0;
  const stackSegmentCount =
    aggregation?.subplots.reduce(
      (sum, subplot) =>
        sum +
        subplot.bins.reduce(
          (binSum, bin) => binSum + Math.max(1, bin.stack.length),
          0,
        ),
      0,
    ) ?? 0;
  const selectedCount = input.selection?.selectedSourceCount ?? 0;
  const sourceIndicesAvailable =
    aggregation?.subplots.every((subplot) => subplot.sourceIndicesAvailable) ?? false;
  const recordCount =
    input.datasetState.status === 'loaded' ? input.datasetState.metadata.recordCount : 0;
  const parameterCount =
    input.datasetState.status === 'loaded' ? input.datasetState.spec.parameters.length : 0;
  const pendingBinSizeEntries = Object.entries(input.pendingBinSizeBySubplot);
  const activePendingBinSize =
    input.activeContinuousSubplotId === null
      ? undefined
      : input.pendingBinSizeBySubplot[input.activeContinuousSubplotId];
  const effectiveBinSize =
    input.activeContinuousBinResolution?.effectiveBinSize ??
    input.lastBinSizeCycle?.effectiveBinSize ??
    null;
  const visibleBinCount =
    input.activeContinuousBinResolution?.effectiveVisibleBinCount ??
    input.lastBinSizeCycle?.visibleBinCount ??
    null;
  const requestedVisibleBinCount =
    input.activeContinuousBinResolution?.requestedVisibleBinCount ??
    input.lastBinSizeCycle?.requestedVisibleBinCount ??
    null;
  const binSizeStatus =
    activePendingBinSize !== undefined
      ? 'pending'
      : input.activeContinuousBinResolution?.status ??
        input.lastBinSizeCycle?.status ??
        null;
  const routeState =
    input.datasetState.status === 'loaded'
      ? {
          activeSubplotId: input.snapshot?.activeSubplotId ?? null,
          axisMode: input.interactionAxis,
          binCount,
          binSizeComputeMs: input.lastBinSizeCycle?.computeMs ?? null,
          binSize: input.activeRequestedBinSize,
          binSizeDebounceMs: input.lastBinSizeCycle?.debounceMs ?? null,
          binSizeEffective: effectiveBinSize,
          binSizeMembershipFinalizeMs:
            input.lastBinSizeCycle?.membershipFinalizeMs ?? null,
          binSizeObservableMs: input.lastBinSizeCycle?.observableMs ?? null,
          binSizePending: activePendingBinSize !== undefined,
          binSizePendingCount: pendingBinSizeEntries.length,
          binSizePendingSubplotId: activePendingBinSize
            ? input.activeContinuousSubplotId
            : (pendingBinSizeEntries[0]?.[0] ?? null),
          binSizeRequestedVisibleBinCount: requestedVisibleBinCount,
          binSizeStatus: binSizeStatus,
          binSizeVisibleBinCount: visibleBinCount,
          engineAxisMode: input.snapshot?.axisMode ?? null,
          engineMode: input.snapshot?.mode ?? null,
          focusedSubplotId: input.snapshot?.focusedSubplotId ?? null,
          histMode: input.histMode,
          hoverActive: input.hover !== null,
          measurementActive: input.measurement !== null,
          mode: input.selectionMode,
          parameterCount,
          populatedBinCount,
          recordCount,
          renderState: input.rendererState,
          selectedCount,
          sourceIndicesAvailable,
          stackSegmentCount,
          tableMode: input.tableMode,
          lastViewportApplySource: input.viewportSyncDiagnostics.lastViewportApplySource,
          lastViewportWriteSeq: input.viewportSyncDiagnostics.lastViewportWriteSeq,
          viewport: input.snapshot?.viewport ?? null,
          viewportCommitSeq: input.viewportSyncDiagnostics.viewportCommitSeq,
        }
      : null;

  return {
    items: [
      ['Render', `${input.rendererState.status}${input.rendererState.message ? `: ${input.rendererState.message}` : ''}`],
      ['Records', recordCount.toLocaleString()],
      ['Tables', input.histMode === 'bar' ? 'bar payload' : input.tableMode],
      ['Parameters', parameterCount.toLocaleString()],
      [
        'Bin size',
        input.activeRequestedBinSize === null
          ? 'n/a'
          : `${input.activeContinuousSubplotId ?? 'active'} requested ${input.activeRequestedBinSize.toPrecision(4)}${
              effectiveBinSize !== null
              ? ` effective ${effectiveBinSize.toPrecision(4)}`
              : ''
            }`,
      ],
      [
        'Bin update',
        pendingBinSizeEntries.length === 0
          ? (binSizeStatus ?? 'idle')
          : pendingBinSizeEntries
              .map(
                ([subplotId, pendingState]) =>
                  `${subplotId} ${pendingState.status} ${pendingState.binSize.toPrecision(4)}`,
              )
              .join(', '),
      ],
      [
        'Visible bins',
        visibleBinCount === null
          ? 'n/a'
          : requestedVisibleBinCount === null
            ? visibleBinCount.toLocaleString()
            : `${visibleBinCount.toLocaleString()} effective / ${requestedVisibleBinCount.toLocaleString()} requested`,
      ],
      ['Bins', binCount.toLocaleString()],
      ['Populated', populatedBinCount.toLocaleString()],
      ['Stacks', stackSegmentCount.toLocaleString()],
      ['Aggregate ms', formatOptionalMs(input.metrics?.aggregateBuildMs)],
      [
        'Indexed rows',
        input.webgpuDiagnostics === null
          ? 'n/a'
          : input.webgpuDiagnostics.aggregation.indexedRowCount.toLocaleString(),
      ],
      [
        'Visited rows',
        input.webgpuDiagnostics === null
          ? 'n/a'
          : input.webgpuDiagnostics.aggregation.lastVisitedRowCount.toLocaleString(),
      ],
      [
        'Reused subplots',
        input.webgpuDiagnostics === null
          ? 'n/a'
          : input.webgpuDiagnostics.aggregation.lastReusedSubplotCount.toLocaleString(),
      ],
      ['Render ms', input.metrics?.phase === 'render' ? formatOptionalMs(input.metrics.durationMs) : 'n/a'],
      ['Selected', selectedCount.toLocaleString()],
      ['Hover', input.hover === null ? 'none' : input.hover.bin.bin.subplotId],
      ['Measure', input.measurement === null ? 'none' : 'active'],
      ['Source index', sourceIndicesAvailable ? 'available' : 'aggregate only'],
    ],
    routeState,
  };
}

function serializeHistogramSelectionCallbackPreview(
  selection: HistogramSelectionEvent | null,
): string {
  if (selection === null) {
    return JSON.stringify(
      {
        callback: 'selectionchange',
        filters: [],
        note: 'No committed selection callback yet.',
        selectedSourceCount: 0,
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      callback: 'selectionchange',
      filters: selection.filters.map((filter) => ({
        binCount: filter.binDescriptors.length,
        firstBin:
          filter.binDescriptors[0] === undefined
            ? null
            : {
                max: toPreviewNumber(filter.binDescriptors[0].max),
                min: toPreviewNumber(filter.binDescriptors[0].min),
              },
        parameterKey: filter.parameterKey,
        pointCount: filter.points?.length ?? 0,
        ranges: {
          value: toPreviewRange(filter.ranges.value),
          x: toPreviewRange(filter.ranges.x),
          y:
            filter.ranges.y === undefined
              ? undefined
              : toPreviewRange(filter.ranges.y),
        },
        dimensions: filter.dimensions.map((dimension) => ({
          axis: dimension.axis,
          parameterKey: dimension.parameterKey,
          range: toPreviewRange(dimension.range),
          source: dimension.source,
          valueType: dimension.valueType,
          values: dimension.values,
        })),
        shape: filter.shape,
        source: filter.source,
        subplotId: filter.subplotId,
      })),
      kind: selection.kind,
      selectedBinCount: selection.selectedBinCount,
      selectedSourceCount: selection.selectedSourceCount,
      sourceIndices: {
        available: selection.sourceIndicesAvailable,
        count: selection.sourceIndices.length,
        sample: Array.from(selection.sourceIndices.slice(0, 8)),
        status: selection.sourceIndicesStatus ?? 'available',
        type: 'Uint32Array',
      },
      tool: selection.tool,
    },
    null,
    2,
  );
}

function toPreviewRange(range: HistogramRange): HistogramRange {
  return {
    max: toPreviewNumber(range.max),
    min: toPreviewNumber(range.min),
  };
}

function toPreviewNumber(value: number): number {
  return Number.isFinite(value) ? Number(value.toPrecision(12)) : value;
}

function materializeSelectedIds(
  columns: HistogramColumns | undefined,
  selection: HistogramSelectionEvent,
):
  | { available: true; count: number; text: string }
  | { available: false; message: string } {
  if (!selection.sourceIndicesAvailable || selection.sourceIndices.length === 0) {
    return {
      available: false,
      message:
        selection.selectedBinCount > 0
          ? 'Record export unavailable for selected aggregate bins without membership.'
          : 'No selected records.',
    };
  }
  if (columns === undefined) {
    return {
      available: false,
      message: 'Record export unavailable for this bar payload.',
    };
  }
  const ids = Array.from(selection.sourceIndices, (sourceIndex) =>
    columns.ids[sourceIndex] ?? String(sourceIndex),
  );
  return {
    available: true,
    count: ids.length,
    text: ids.join('\n'),
  };
}

function resolveSelectionForExport(
  plot: HistogramPlotInstance | null,
  selection: HistogramSelectionEvent | null,
): HistogramSelectionEvent | null {
  if (selection === null) {
    return null;
  }
  if (
    (selection.sourceIndicesAvailable &&
      selection.sourceIndicesStatus !== 'pending') ||
    selection.selectedBinCount === 0
  ) {
    return selection;
  }
  return plot?.commands.materializeSelectionSourceIndices() ?? selection;
}

function serializeSelectedIdsForBenchmark(
  plot: HistogramPlotInstance | null,
  datasetState: HistogramDatasetState,
  selection: HistogramSelectionEvent | null,
): HistogramBenchmarkSerializationResult {
  const startedAt = performance.now();
  if (datasetState.status !== 'loaded' || selection === null) {
    return {
      available: false,
      byteLength: null,
      count: 0,
      message: 'No selected records.',
      ms: performance.now() - startedAt,
    };
  }
  const resolvedSelection = resolveSelectionForExport(plot, selection);
  if (resolvedSelection === null) {
    return {
      available: false,
      byteLength: null,
      count: 0,
      message: 'No selected records.',
      ms: performance.now() - startedAt,
    };
  }
  const exportResult = materializeSelectedIds(datasetState.columns, resolvedSelection);
  if (!exportResult.available) {
    return {
      available: false,
      byteLength: null,
      count: 0,
      message: exportResult.message,
      ms: performance.now() - startedAt,
    };
  }
  return {
    available: true,
    byteLength: new Blob([exportResult.text]).size,
    count: exportResult.count,
    ms: performance.now() - startedAt,
  };
}

function selectRectangleForBenchmark(
  plot: HistogramPlotInstance | null,
): HistogramBenchmarkSelectionResult {
  const startedAt = performance.now();
  if (plot === null) {
    return {
      available: false,
      message: 'm-histogram is unavailable.',
      ms: performance.now() - startedAt,
      selectedBinCount: null,
      selectedSourceCount: null,
      selectionComputeMs: null,
    };
  }
  const snapshot = plot.commands.getStateSnapshot();
  const plotRect = snapshot.render.layout.plotRects[0];
  if (plotRect === undefined) {
    return {
      available: false,
      message: 'm-histogram plot rect is unavailable.',
      ms: performance.now() - startedAt,
      selectedBinCount: null,
      selectedSourceCount: null,
      selectionComputeMs: null,
    };
  }
  const selection = plot.commands.selectRectangle({
    bounds: {
      maxX: plotRect.xCssPx + plotRect.widthCssPx * 0.82,
      maxY: plotRect.yCssPx + plotRect.heightCssPx * 0.82,
      minX: plotRect.xCssPx + plotRect.widthCssPx * 0.18,
      minY: plotRect.yCssPx + plotRect.heightCssPx * 0.18,
    },
    kind: 'replace',
    subplotId: plotRect.id,
  });
  return {
    available: selection !== null,
    message: selection === null ? 'Rectangle selection returned no result.' : undefined,
    ms: performance.now() - startedAt,
    selectedBinCount: selection?.selectedBinCount ?? null,
    selectedSourceCount: selection?.selectedSourceCount ?? null,
    selectionComputeMs: selection?.durationMs ?? null,
  };
}

function materializeSelectedRecords(
  columns: HistogramColumns | undefined,
  selection: HistogramSelectionEvent,
):
  | { available: true; count: number; text: string }
  | { available: false; message: string } {
  if (!selection.sourceIndicesAvailable || selection.sourceIndices.length === 0) {
    return {
      available: false,
      message:
        selection.selectedBinCount > 0
          ? 'Record export unavailable for selected aggregate bins without membership.'
          : 'No selected records.',
    };
  }
  if (columns === undefined) {
    return {
      available: false,
      message: 'Record export unavailable for this bar payload.',
    };
  }
  const lines: string[] = [];
  const sourceIndices = selection.sourceIndices.slice(0, EXPORT_SAMPLE_LIMIT);
  for (const sourceIndex of sourceIndices) {
    const record: Record<string, unknown> = {
      id: columns.ids[sourceIndex] ?? String(sourceIndex),
      sourceIndex,
      table: columns.tableBySourceIndex?.[sourceIndex],
    };
    for (const [key, values] of Object.entries(columns.valuesByParameter)) {
      record[key] = stringifyRecordValue(values[sourceIndex]);
    }
    lines.push(JSON.stringify(record));
  }
  return {
    available: true,
    count: sourceIndices.length,
    text: `${lines.join('\n')}\n`,
  };
}

function serializeSelectedRecordsForBenchmark(
  plot: HistogramPlotInstance | null,
  datasetState: HistogramDatasetState,
  selection: HistogramSelectionEvent | null,
): HistogramBenchmarkSerializationResult {
  const startedAt = performance.now();
  if (datasetState.status !== 'loaded' || selection === null) {
    return {
      available: false,
      byteLength: null,
      count: 0,
      message: 'No selected records.',
      ms: performance.now() - startedAt,
    };
  }
  const resolvedSelection = resolveSelectionForExport(plot, selection);
  if (resolvedSelection === null) {
    return {
      available: false,
      byteLength: null,
      count: 0,
      message: 'No selected records.',
      ms: performance.now() - startedAt,
    };
  }
  const exportResult = materializeSelectedRecords(
    datasetState.columns,
    resolvedSelection,
  );
  if (!exportResult.available) {
    return {
      available: false,
      byteLength: null,
      count: 0,
      message: exportResult.message,
      ms: performance.now() - startedAt,
    };
  }
  return {
    available: true,
    byteLength: new Blob([exportResult.text]).size,
    count: exportResult.count,
    ms: performance.now() - startedAt,
  };
}

function stringifyRecordValue(value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function createTicks(range: { max: number; min: number }): readonly number[] {
  const span = range.max - range.min;
  if (!Number.isFinite(span) || span <= 0) {
    return [range.min];
  }
  return [0, 0.25, 0.5, 0.75, 1].map((t) => range.min + span * t);
}

function parseFiniteParam(params: URLSearchParams, key: string): number | null {
  const value = Number(params.get(key));
  return Number.isFinite(value) ? value : null;
}

function clampPositiveNumber(value: number): number {
  return Math.min(1e18, Math.max(1e-9, value));
}

function hasPendingHistogramAggregationMembership(
  aggregation: HistogramAggregationSet,
): boolean {
  return aggregation.subplots.some(
    (subplot) => subplot.sourceIndicesState === 'pending',
  );
}

function adjustRawBinSize(
  delta: number,
  current: number | null,
  fallback: number,
): number {
  const multiplier = delta < 0 ? 0.82 : 1.22;
  return clampPositiveNumber((current ?? fallback) * multiplier);
}

function formatNumberParam(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toPrecision(8);
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1,
    notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
  }).format(value);
}

function formatOptionalMs(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${value.toFixed(2)} ms`;
}

function resolveHistogramParameterForSubplot(
  spec: HistogramPlotSpec,
  subplotId: string,
) {
  const subplot = spec.subplots.find((candidate) => candidate.id === subplotId);
  return subplot === undefined
    ? undefined
    : spec.parameters.find((candidate) => candidate.key === subplot.parameterKey);
}

function resolveHistogramSubplotLabel(
  spec: HistogramPlotSpec,
  subplotId: string,
): string {
  return (
    spec.subplots.find((candidate) => candidate.id === subplotId)?.label ?? subplotId
  );
}

function formatHistogramAxisTitle(
  parameter: HistogramPlotSpec['parameters'][number] | undefined,
  fallback: string,
): string {
  if (parameter === undefined) {
    return fallback;
  }
  return appendUnitIfMissing(parameter.label, parameter.unit);
}

function formatHistogramCountAxisTitle(
  parameter: HistogramPlotSpec['parameters'][number] | undefined,
  fallback: string,
): string {
  return `# ${formatHistogramAxisTitle(parameter, fallback)}`;
}

function appendUnitIfMissing(label: string, unit: string | undefined): string {
  if (unit === undefined || unit === '') {
    return label;
  }
  const normalizedLabel = label.trim().toLowerCase();
  const normalizedUnit = unit.trim().toLowerCase();
  if (
    normalizedLabel.endsWith(`(${normalizedUnit})`) ||
    normalizedLabel.endsWith(` ${normalizedUnit}`)
  ) {
    return label;
  }
  return `${label} (${unit})`;
}

function formatPendingBinSizeLabel(
  spec: HistogramPlotSpec | null,
  subplotId: string,
  binSize: number,
): string {
  const parameter =
    spec === null ? undefined : resolveHistogramParameterForSubplot(spec, subplotId);
  const axisTitle =
    spec === null ? subplotId : formatHistogramAxisTitle(parameter, subplotId);
  return `${axisTitle}: ${formatHistogramAxisValue(parameter, binSize)}`;
}

function formatPendingBinSizeStatus(
  status: PendingHistogramBinSizeState['status'],
): string {
  switch (status) {
    case 'queued':
      return 'Queued bin update';
    case 'computing':
      return 'Rebuilding visible bins';
    case 'finalizing-membership':
      return 'Finalizing visible membership';
    default:
      return 'Updating bins';
  }
}

function formatHistogramMeasurementSummary(
  spec: HistogramPlotSpec | null,
  measurement: HistogramMeasurementEvent,
): string {
  const parameter =
    spec === null
      ? undefined
      : resolveHistogramParameterForSubplot(spec, measurement.reference.bin.subplotId);
  const referenceLabel = formatHistogramBinRange(parameter, measurement.reference.bin);
  if (measurement.current === null) {
    return `Reference ${referenceLabel} with ${measurement.reference.count.toLocaleString()} records. ${formatHistogramSourceSummary(measurement.reference.source)}`;
  }
  const currentLabel = formatHistogramBinRange(parameter, measurement.current.bin);
  const comparison = compareHistogramMeasurementReferences(
    measurement.reference,
    measurement.current,
  );
  return `${referenceLabel} (${measurement.reference.count.toLocaleString()}) to ${currentLabel} (${measurement.current.count.toLocaleString()}), ${formatHistogramMeasurementDeltaLabel(parameter, comparison, measurement)}. ${formatHistogramSourceSummary(measurement.reference.source)}`;
}

function formatHistogramSourceSummary(
  source: HistogramHoverEvent['bin']['source'],
): string {
  if (source === undefined) {
    return 'Source n/a';
  }
  return [
    source.datasetKey === undefined ? null : `dataset ${source.datasetKey}`,
    source.tableKey === undefined ? null : `table ${source.tableKey}`,
    source.fieldKey === undefined ? null : `field ${source.fieldKey}`,
  ]
    .filter((part): part is string => part !== null)
    .join(', ') || 'Source n/a';
}

function resolveMeasurementTooltipAnchor(measurement: HistogramMeasurementEvent) {
  return measurement.current?.canvasPoint ?? measurement.reference.canvasPoint ?? {
    canvasX: 8,
    canvasY: 8,
  };
}

function formatHistogramMeasurementDeltaLabel(
  parameter: HistogramPlotSpec['parameters'][number] | undefined,
  comparison: ReturnType<typeof compareHistogramMeasurementReferences>,
  measurement: HistogramMeasurementEvent,
): string {
  const countDelta = comparison.countDelta;
  const countLabel =
    countDelta === 0
      ? 'count 0'
      : `count ${countDelta > 0 ? '+' : ''}${countDelta.toLocaleString()}`;
  if (measurement.current?.bin.category !== undefined) {
    const referenceLabel = formatHistogramBinLabel(parameter, measurement.reference.bin);
    const currentLabel = formatHistogramBinLabel(parameter, measurement.current.bin);
    return `${referenceLabel} -> ${currentLabel}, ${countLabel}`;
  }
  const centerDelta = comparison.rangeCenterDelta;
  const centerLabel = formatHistogramDeltaValue(parameter, centerDelta);
  return `${countLabel}, center ${centerDelta > 0 ? '+' : ''}${centerLabel}`;
}

function formatHistogramDeltaValue(
  parameter: HistogramPlotSpec['parameters'][number] | undefined,
  value: number,
): string {
  if (parameter?.kind === 'datetime-ns') {
    return parameter.unit === undefined || parameter.unit === ''
      ? `${formatCompactNumber(value)} ms`
      : `${formatCompactNumber(value)} ${parameter.unit}`;
  }
  return formatHistogramAxisValue(parameter, value);
}

function getHistogramYAxisTitleTextLength(
  title: string,
  rect: HistogramPlotRect,
): number | undefined {
  const availableLength =
    rect.heightCssPx - HISTOGRAM_Y_AXIS_TITLE_VERTICAL_PADDING_CSS_PX * 2;
  if (availableLength < 24) {
    return undefined;
  }

  return Math.min(availableLength, Math.max(24, title.length * 6.6));
}

function resolveHistogramContinuousBinResolutionForSubplot(
  aggregation: HistogramAggregationSet | null | undefined,
  subplotId: HistogramSubplotId,
): HistogramContinuousBinResolution | null {
  return (
    aggregation?.subplots.find((subplot) => subplot.subplotId === subplotId)
      ?.continuousBinResolution ?? null
  );
}

export type { HistogramRouteHookState };
