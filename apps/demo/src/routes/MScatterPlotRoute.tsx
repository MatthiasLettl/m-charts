import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type SetStateAction,
} from 'react';
import { flushSync } from 'react-dom';
import { useSearchParams } from 'react-router-dom';

import {
  MIXED_TABLE_FIXTURE_URL,
  parseFastRouteTableMode,
  type FastRouteTableMode,
} from '../data/fastRouteDataMode.ts';
import {
  SCATTER_FAST_COLUMNAR_URL,
  SCATTER_FAST_DATASET_URL,
  SCATTER_FAST_SCHEMA_URL,
  resolveFastPlotFixtureUrl,
  resolveScatterFastSchemaDataUrl,
  resolveScatterFastSchemaUrl,
} from '../data/fastPlotTableSources.ts';
import {
  loadScatterDatasetWithMetrics,
  SAMPLE_DATASET_URL,
} from '../data/loadDataset.ts';
import {
  createLazySingleTableRecordIdentityArray,
  createLazySingleValueArray,
} from '../data/identity.ts';
import { MIXED_TABLE_NAMES, type MixedTableFixture } from '../data/mixedTableFixtures.ts';
import {
  SCATTER_Y_ATTRIBUTES,
  type ScatterDataset,
  type ScatterYAttribute,
} from '../data/types.ts';
import {
  SCATTER_WEBGPU_SCHEMA,
  type ScatterWebgpuPagedManifest,
  type ScatterWebgpuPagedManifestPage,
} from '../data/scatterWebgpuDatasetFormat.ts';
import {
  deleteStoredScatterWebgpuDataset,
  generateAndStoreScatterWebgpuDataset,
  getStoredScatterWebgpuDataset,
  readStoredScatterWebgpuPage,
  SCATTER_WEBGPU_DEMO_POINT_COUNTS,
} from '../data/scatterWebgpuDatasetStore.ts';
import {
  FAST_SCATTER_HEATMAP_BIN_SIZE_PARAM,
  FAST_SCATTER_VISUALIZATION_PARAM,
  MAX_FAST_SCATTER_HEATMAP_BIN_SIZE_PX,
  MIN_FAST_SCATTER_HEATMAP_BIN_SIZE_PX,
  formatHeatmapBinSizeSearchParam,
  formatFastScatterVisualizationMode,
  isPlotInteractionGateActive,
  normalizeInteractionShortcutKey,
  parseFastScatterVisualizationMode,
  parseHeatmapBinSizeSearchParam,
  parsePrototypeSearchParams,
  serializePrototypeSearchParams,
  type InteractionAxis,
  type InteractionMode,
  type PlotInteractionGateState,
  type PrototypeSearchState,
  type ViewportState,
} from '../state/viewSearchParams.ts';
import { createThemeAwareTo } from '../state/themeMode.ts';
import {
  FAST_SCATTER_WEBGPU_AGGREGATION_BACKEND_PARAM,
  parseFastScatterWebgpuAggregationBackend,
} from '../state/webgpuAggregationBackend.ts';
import { useThemeMode } from '../theme/ThemeModeProvider.tsx';
import { getFastScatterTheme } from '../theme/plotTheme.ts';
import { DemoSidebarHeader, InteractionCheatSheet } from './DemoRouteChrome.tsx';
import {
  adaptMixedTablesForFastScatter,
  adaptScatterDatasetForFastScatter,
} from 'm-charts/m-scatter';
import { diagnoseWebgpuSupport } from 'm-charts/plot-engine-webgpu';
import {
  axisToPixel,
  calculateFastScatterDomain,
  computeFastScatterOutOfRangeMarkers,
  encodeFastScatterSchemaRows,
  createFastScatterViewportWithSharedX,
  createFastScatterSourceDisplayFields,
  createFastScatterMeasurementDisplayFields,
  createFastScatterNavigatorSummary,
  createFastScatterSelectionState,
  createDefaultFastScatterViewport,
  createFastScatterLayout,
  createFastScatterCompactHoverIndex,
  createFastScatterHoverIndex,
  FAST_SCATTER_DEFAULT_OPACITY_SCALE,
  FAST_SCATTER_OPACITY_SCALE_PARAM,
  FAST_SCATTER_POINT_SIZE_SCALE_PARAM,
  formatOpacityScaleParam,
  formatPointSizeScaleParam,
  formatFastScatterPointForDisplay,
  getNextOpacityScale,
  getNextPointSizeScale,
  getPreviousOpacityScale,
  getPreviousPointSizeScale,
  materializeFastScatterSelectedIds,
  normalizeFastScatterHeatmapPalette,
  parseOpacityScaleSearchParam,
  parsePointSizeScaleSearchParam,
  snapOpacityScaleToStep,
  serializeFastScatterSelectedRecordsForExport,
  type FastScatterAlphaMode,
  type FastScatterBufferBuildMetrics,
  type FastScatterDatasetSchema,
  type FastScatterDisplayColumns,
  type FastScatterEncodedAxis,
  type FastScatterEncodedSchemaColumns,
  type FastScatterEncodeSchemaResult,
  type FastScatterHeatmapPalette,
  type FastScatterHoverEvent,
  type FastScatterHoverIndexSet,
  type FastScatterMeasurementEvent,
  type FastScatterMeasurementReference,
  type FastScatterMetricsEvent,
  type FastScatterPlotSpec,
  type FastScatterNavigatorSummary,
  type FastScatterOutOfRangeResult,
  type FastScatterPlotRect,
  type FastScatterRange,
  type FastScatterRenderingMode,
  type FastScatterSelectionEvent,
  type FastScatterSelectionState,
  type FastScatterViewport,
  type FastScatterViewportChangeReason,
  type FastScatterViewportChangePhase,
  type FastScatterVisualizationMode,
} from 'm-charts/m-scatter';
import {
  createDefaultScatterBindings,
  createScatterPlot,
  type ScatterOverlayDescriptor,
  type ScatterPlotInstance,
  type ScatterPlotOptions,
  type ScatterRenderState,
} from 'm-charts/m-scatter';
import {
  createScatterWebgpuPlot,
  type FastScatterWebgpuAggregationBackend,
  type FastScatterWebgpuDiagnostics,
  type FastScatterWebgpuPackedStyles,
  type ScatterWebgpuPlotInstance,
  type ScatterWebgpuPlotOptions,
} from 'm-charts/m-scatter-webgpu';
import { FastScatterOverlay } from 'm-charts/m-scatter';

declare global {
  interface Window {
    __scatterFastSelectionTestHook?: {
      exportSelectedIds: () => string[];
      exportSelectedRecordsText: () => string;
      getSelectedCount: () => number;
      getSelectedSampleIds: (sampleSize?: number) => string[];
      getSelectedSourceIndices: () => number[];
    };
    __scatterFastHoverTestHook?: {
      clearHoverSourceIndex: () => void;
      getCurrentHover: () => FastScatterHoverEvent | null;
      getHoverSourceIndex: () => number | null;
      setHoverSourceIndex: (sourceIndex: number | null) => void;
    };
    __scatterFastMeasurementTestHook?: {
      getCurrent: () => FastScatterMeasurementReference | null;
      getReference: () => FastScatterMeasurementReference | null;
      getSession: () => FastScatterMeasurementEvent | null;
    };
    __scatterFastRouteStateTestHook?: {
      clearSelection: () => void;
      clearFocusedPlot: () => void;
      getTableMode: () => FastRouteTableMode;
      getDefaultViewport: () => ViewportState | null;
      getFocusedPlotId: () => string | null;
      getFastViewport: () => FastScatterViewport | null;
      getWebgpuDiagnostics: () => FastScatterWebgpuDiagnostics | null;
      getHeatmapBinSizePx: () => number;
      getOpacityScale: () => number;
      getPendingViewportCommit: () => {
        dueInMs: number | null;
        phase: FastScatterViewportChangePhase;
        reason: 'drag' | 'navigator' | 'wheel';
        viewport: FastScatterViewport;
      } | null;
      getPlotInteractionState: () => PlotInteractionGateState & { active: boolean };
      getPointSizeScale: () => number;
      getState: () => PrototypeSearchState | null;
      getVisualizationMode: () => FastScatterVisualizationMode;
      getXMode: () => FastScatterXMode;
      resetViewport: () => void;
      setAxis: (axis: InteractionAxis) => void;
      setFocusedPlot: (plotId: string | null) => void;
      setFastViewport: (
        viewport: FastScatterViewport,
        reason?: FastScatterViewportChangeReason,
        phase?: FastScatterViewportChangePhase,
      ) => void;
      setHeatmapBinSizePx: (binSizePx: number) => void;
      setMode: (mode: InteractionMode) => void;
      setOpacityScale: (scale: number) => void;
      setPointSizeScale: (scale: number) => void;
      setSelectedSourceIndices: (sourceIndices: Uint32Array) => void;
      setSearchState: (state: PrototypeSearchState) => void;
      setVisualizationMode: (mode: FastScatterVisualizationMode) => void;
      setXMode: (mode: FastScatterXMode) => void;
      setSharedXRange: (
        x: FastScatterRange,
        reason?: FastScatterViewportChangeReason,
        phase?: FastScatterViewportChangePhase,
      ) => void;
      setViewportFromRoute: (viewport: ViewportState) => void;
    };
  }
}

type DatasetLoadState =
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
      adaptedDataset: LoadedFastScatterDataset;
      bufferBuildMetrics: FastScatterBufferBuildMetrics;
      dataset: ScatterDataset;
      compatibilityBuildMs?: number;
      columnarBytes?: number;
      columnarDecodeMs?: number;
      fetchMs: number;
      loadTimeMs: number;
      parseMs: number;
      schemaEncodeMs?: number;
      sourceFormat:
        | 'columnar-binary'
        | 'json-records'
        | 'legacy-json-records'
        | 'mixed-table-json'
        | 'indexeddb-webgpu-binary'
        | 'paged-webgpu-binary';
      sourceUrl: string;
      tableMetadata?: FastScatterRouteTableMetadata;
    };

interface LoadedFastScatterDataset {
  columns: FastScatterDisplayColumns;
  hoverIndex?: FastScatterHoverIndexSet | null;
  isLegacyViewport: boolean;
  packedStyles?: FastScatterWebgpuPackedStyles;
  spec: FastScatterPlotSpec;
}

interface FastScatterRouteTableMetadata {
  tableCount: number;
  tableNames: readonly string[];
  tableRecordCounts: Readonly<Record<string, number>>;
}

type FastScatterXMode = 'index' | 'value';

const PLOT_LABELS = {
  a: 'Metric A',
  b: 'Metric B',
  c: 'Metric C',
} as const;

const EMPTY_SELECTED_SOURCE_INDICES = new Uint32Array(0);
const SELECTION_SAMPLE_SIZE = 5;
const INITIAL_PLOT_INTERACTION_GATE_STATE: PlotInteractionGateState = {
  hasFocusWithin: false,
  isHovered: false,
};
const SCATTER_SHORTCUT_GROUPS = [
  {
    items: [
      { keys: ['Left drag'], action: 'Rectangle zoom' },
      { keys: ['Alt', 'Shift', 'Left drag'], action: 'Force both-axis zoom' },
      { keys: ['Middle drag'], action: 'Pan freely' },
    ],
    label: 'Viewport',
  },
  {
    items: [
      { keys: ['Right drag'], action: 'Select points or aggregates' },
      { keys: ['Space', 'Right drag'], action: 'Lasso select' },
      { keys: ['Ctrl', 'Right drag'], action: 'Append to selection' },
      { keys: ['Space', 'Ctrl', 'Right drag'], action: 'Append lasso selection' },
      { keys: ['Shift'], action: 'Inspect point or aggregate' },
      { keys: ['Shift', 'Right drag'], action: 'Measure between positions' },
    ],
    label: 'Select and inspect',
  },
  {
    items: [
      { keys: ['Alt', 'Wheel'], action: 'Zoom x axis' },
      { keys: ['Shift', 'Wheel'], action: 'Zoom focused subplot y axis' },
      { keys: ['Ctrl', 'Wheel'], action: 'Zoom x and y axes' },
      { keys: ['Wheel'], action: 'Adjust point size or heat-bin size' },
      { keys: ['Escape'], action: 'Clear selection and point markers' },
      { keys: ['Middle click'], action: 'Undo last viewport change' },
    ],
    label: 'Keyboard and wheel',
  },
  {
    items: [
      { keys: ['Double click point'], action: 'Toggle point marker' },
    ],
    label: 'Markers',
  },
] as const;

const SCATTER_TRY_THIS_ITEMS = [
  {
    label: 'Zoom',
    detail: 'Left-drag a rectangle in a subplot; Alt+Shift forces both axes.',
  },
  {
    label: 'Select',
    detail: 'Right-drag for a rectangle, or hold Space while right-dragging for lasso.',
  },
  {
    label: 'Inspect',
    detail: 'Hold Shift over points or heat aggregates to inspect the nearest record.',
  },
  {
    label: 'Measure',
    detail: 'Hold Shift and right-drag from one point or aggregate to another.',
  },
  {
    label: 'Pan',
    detail: 'Middle-drag the plot, or drag the navigator window below the chart.',
  },
] as const;
const DEFAULT_FAST_SCATTER_X_MODE: FastScatterXMode = 'value';
const FAST_SCATTER_X_MODE_PARAM = 'xMode';
const FAST_SCATTER_X_AXIS_PARAM = 'xAxis';
const FAST_SCATTER_HEATMAP_PALETTE_PARAM = 'heatPalette';
const FAST_SCATTER_HEATMAP_PALETTES = ['mono', 'viridis', 'magma', 'turbo'] as const;
const FAST_SCATTER_HEATMAP_BIN_SIZE_STEP_PX = 2;
const FAST_SCATTER_VISUALIZATION_MODE_OPTIONS = [
  { label: 'Scatter', value: 'points' },
  { label: 'Bubble', value: 'bubble' },
  { label: 'Heat map', value: 'heatmap' },
] as const satisfies readonly {
  label: string;
  value: FastScatterVisualizationMode;
}[];
const FAST_SCATTER_WEBGPU_AGGREGATION_BACKEND_OPTIONS = [
  { label: 'Auto', value: 'auto' },
  { label: 'Rust/WASM', value: 'rust-wasm' },
  { label: 'TypeScript', value: 'typescript' },
] as const satisfies readonly {
  label: string;
  value: FastScatterWebgpuAggregationBackend;
}[];
const VIEWPORT_HISTORY_LIMIT = 48;
const DRAG_SEARCH_WRITE_DEBOUNCE_MS = 180;
const WHEEL_SEARCH_WRITE_DEBOUNCE_MS = 450;

type LoadedDatasetState = Extract<DatasetLoadState, { status: 'loaded' }>;

interface RendererMetricsState {
  aggregateController: {
    aggregateMode: 'bubble' | 'heatmap';
    durationMs: number;
    mode: 'sync' | 'worker';
    transferMs: number;
  } | null;
  hoverOverlay: {
    drawCalls: number;
    durationMs: number;
    sourceIndex: number | null;
    uploadBytes: number;
  } | null;
  hoverLookup: {
    candidateCount: number;
    distancePx: number | null;
    durationMs: number;
    plotId: string | null;
    source: string;
    sourceIndex: number | null;
    yKey: string | null;
  } | null;
  redraw: {
    cacheBytes: number;
    cachedInteractionFrame: boolean;
    coalescedFrameCount: number;
    cpuDurationMs: number;
    estimatedPeakBytes: number;
    gpuDurationMs?: number;
    residentBytes: number;
    submittedFrameCount: number;
  } | null;
  firstCanvasRender: {
    delayMs: number;
    drawCalls: number;
    visiblePointCount: number;
  } | null;
  selectedOverlay: {
    durationMs: number;
    maskBuildMs: number;
    maskGpuUploadMs: number;
    selectedPointCount: number;
    uploadBytes: number;
  } | null;
  setup: {
    durationMs: number;
    gpuTimerSupported: boolean;
    linkMs: number;
    shaderCompileMs: number;
  } | null;
  upload: {
    bufferCount: number;
    durationMs: number;
    uploadBytes: number;
  } | null;
  dragPan: {
    axisMode: string;
    deltaX: number;
    deltaY: number;
    durationMs: number;
    plotId: string;
    updateCount: number;
  } | null;
  wheelZoom: {
    axisMode: string;
    durationMs: number;
    plotId: string;
    scale: number;
  } | null;
  rectangleZoom: {
    axisMode: string;
    durationMs: number;
    plotId: string;
    rectHeight: number;
    rectWidth: number;
  } | null;
  rectangleSelection: {
    candidateCount: number;
    computeMs: number;
    durationMs: number;
    mode: string;
    observableMs: number;
    plotId: string;
    sampleIds: readonly string[];
    selectedCount: number;
    transferMs: number;
  } | null;
  selectedRecordExport: {
    byteLength: number;
    durationMs: number;
    recordCount: number;
    mode: 'copy' | 'download';
    status: 'copied' | 'downloaded' | 'failed';
  } | null;
  lassoSelection: {
    candidateCount: number;
    computeMs: number;
    durationMs: number;
    lassoPointCount: number;
    mode: string;
    observableMs: number;
    plotId: string;
    sampleIds: readonly string[];
    selectedCount: number;
    transferMs: number;
  } | null;
  navigator: {
    durationMs: number;
    summaryBinCount?: number;
    summaryDurationMs?: number;
    updateCount: number;
    windowMax: number;
    windowMin: number;
  } | null;
  outOfRange: {
    candidateCount: number;
    durationMs: number;
    markerCount: number;
  } | null;
  measurement: {
    activeDeltaCount: number;
    durationMs: number;
    referenceCount: number;
  } | null;
}

export interface MScatterPlotRouteProps {
  rendererBackend?: 'webgl2' | 'webgpu';
}

export function MScatterPlotRoute({
  rendererBackend = 'webgl2',
}: MScatterPlotRouteProps = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { themeMode } = useThemeMode();
  const xMode = useMemo(() => parseFastScatterXMode(searchParams), [searchParams]);
  const webgpuAggregationBackend = useMemo(
    () => parseFastScatterWebgpuAggregationBackend(searchParams),
    [searchParams],
  );
  const fastScatterTheme = useMemo(
    () => getFastScatterTheme(themeMode),
    [themeMode],
  );
  const [datasetState, setDatasetState] = useState<DatasetLoadState>({
    status: 'loading',
  });
  const tableMode = useMemo(() => parseFastRouteTableMode(searchParams), [searchParams]);
  const mixedTableFixtureUrl = useMemo(
    () => resolveFastPlotFixtureUrl(searchParams, MIXED_TABLE_FIXTURE_URL),
    [searchParams],
  );
  const scatterFastSchemaDataUrl = useMemo(
    () => resolveScatterFastSchemaDataUrl(searchParams),
    [searchParams],
  );
  const scatterFastSchemaUrl = useMemo(
    () => resolveScatterFastSchemaUrl(searchParams),
    [searchParams],
  );
  const webgpuPointCount = useMemo(
    () => rendererBackend === 'webgpu' ? parseWebgpuPointCount(searchParams) : null,
    [rendererBackend, searchParams],
  );
  const useHttpWebgpuDataset =
    rendererBackend === 'webgpu' && searchParams.get(WEBGPU_DATA_SOURCE_PARAM) === 'http';
  const datasetGenerationAbortRef = useRef<AbortController | null>(null);
  const componentActiveRef = useRef(true);
  const [datasetRefreshVersion, setDatasetRefreshVersion] = useState(0);
  const shouldLoadLegacyScatterDatasetRef = useRef(
    import.meta.env.DEV &&
      !searchParams.has('__e2eScatterFastSchemaDataset') &&
      (searchParams.has('__e2eDataset') || SAMPLE_DATASET_URL.includes('scatter-e2e')),
  );

  useEffect(() => {
    let isActive = true;
    const abortController = new AbortController();
    const startedAt = performance.now();

    async function loadDataset() {
      try {
        const loadResult =
          webgpuPointCount !== null
            ? await loadWebgpuScatterDataset(
                startedAt,
                webgpuPointCount,
                abortController.signal,
                useHttpWebgpuDataset ? 'http' : 'indexeddb',
                tableMode === 'multi'
                  ? deriveSecondaryTableFixtureUrl(mixedTableFixtureUrl)
                  : null,
              )
            : tableMode === 'multi'
            ? await loadMixedTableFastScatterDataset(startedAt, mixedTableFixtureUrl)
            : shouldLoadLegacyScatterDatasetRef.current
              ? await loadLegacyFastScatterDataset(startedAt)
              : await loadSchemaFastScatterDataset(
                  startedAt,
                  scatterFastSchemaDataUrl,
                  scatterFastSchemaUrl,
                );

        if (!isActive) {
          return;
        }

        setDatasetState({
          status: 'loaded',
          ...loadResult,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }

        if (
          error instanceof LocalWebgpuDatasetUnavailableError &&
          webgpuPointCount !== null
        ) {
          setDatasetState({ status: 'missing', pointCount: webgpuPointCount });
          return;
        }

        setDatasetState({
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Unknown scatter-fast dataset load error.',
        });
      }
    }

    void loadDataset();

    return () => {
      isActive = false;
      abortController.abort();
    };
  }, [
    mixedTableFixtureUrl,
    scatterFastSchemaDataUrl,
    scatterFastSchemaUrl,
    datasetRefreshVersion,
    tableMode,
    useHttpWebgpuDataset,
    webgpuPointCount,
  ]);

  useEffect(() => {
    componentActiveRef.current = true;
    return () => {
      componentActiveRef.current = false;
      datasetGenerationAbortRef.current?.abort();
    };
  }, []);

  const generateWebgpuDataset = useCallback(async () => {
    if (webgpuPointCount === null) return;
    datasetGenerationAbortRef.current?.abort();
    const abortController = new AbortController();
    datasetGenerationAbortRef.current = abortController;
    setDatasetState({
      status: 'generating',
      completedPages: 0,
      pageCount: Math.ceil(webgpuPointCount / 250_000),
      pointCount: webgpuPointCount,
    });
    try {
      await generateAndStoreScatterWebgpuDataset({
        onProgress: ({ completedPages, pageCount }) => {
          if (
            componentActiveRef.current &&
            datasetGenerationAbortRef.current === abortController &&
            !abortController.signal.aborted
          ) {
            setDatasetState({
              status: 'generating',
              completedPages,
              pageCount,
              pointCount: webgpuPointCount,
            });
          }
        },
        pointCount: webgpuPointCount,
        signal: abortController.signal,
      });
      if (
        componentActiveRef.current &&
        datasetGenerationAbortRef.current === abortController &&
        !abortController.signal.aborted
      ) {
        setDatasetRefreshVersion((version) => version + 1);
      }
    } catch (error) {
      if (
        !componentActiveRef.current ||
        datasetGenerationAbortRef.current !== abortController
      ) {
        return;
      }
      if (abortController.signal.aborted) {
        setDatasetState({ status: 'missing', pointCount: webgpuPointCount });
      } else {
        setDatasetState({
          status: 'missing',
          message: error instanceof Error
            ? error.message
            : 'Unknown WebGPU dataset generation error.',
          pointCount: webgpuPointCount,
        });
      }
    } finally {
      if (datasetGenerationAbortRef.current === abortController) {
        datasetGenerationAbortRef.current = null;
      }
    }
  }, [webgpuPointCount]);

  const deleteWebgpuDataset = useCallback(async () => {
    if (webgpuPointCount === null) return;
    datasetGenerationAbortRef.current?.abort();
    try {
      await deleteStoredScatterWebgpuDataset(webgpuPointCount);
      setDatasetState({ status: 'missing', pointCount: webgpuPointCount });
    } catch (error) {
      setDatasetState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not delete the local dataset.',
      });
    }
  }, [webgpuPointCount]);

  const selectWebgpuPointCount = useCallback((pointCount: number) => {
    if (pointCount === webgpuPointCount) return;
    const next = new URL(window.location.href);
    next.searchParams.set(WEBGPU_POINT_COUNT_PARAM, String(pointCount));
    window.location.assign(next.href);
  }, [webgpuPointCount]);

  const xAxisKey = useMemo(
    () =>
      datasetState.status === 'loaded'
        ? parseFastScatterXAxisKey(searchParams, datasetState.adaptedDataset)
        : null,
    [datasetState, searchParams],
  );

  const plottedDataset = useMemo<LoadedFastScatterDataset | null>(() => {
    if (datasetState.status !== 'loaded') {
      return null;
    }

    return createFastScatterRouteDatasetForXMode(
      createFastScatterRouteDatasetForXAxis(datasetState.adaptedDataset, xAxisKey),
      xMode,
    );
  }, [datasetState, xAxisKey, xMode]);
  const xAxisOptions = useMemo(
    () =>
      datasetState.status === 'loaded'
        ? createFastScatterXAxisOptions(datasetState.adaptedDataset)
        : [],
    [datasetState],
  );

  const scatterDomain = useMemo(() => {
    if (plottedDataset === null) {
      return null;
    }

    return calculateFastScatterDomain(plottedDataset.columns, plottedDataset.spec);
  }, [plottedDataset]);

  const defaultViewport = useMemo<ViewportState | null>(() => {
    if (plottedDataset === null || scatterDomain === null) {
      return null;
    }

    return createPrototypeViewportFromFastScatterViewport(
      createDefaultFastScatterViewport(scatterDomain),
      plottedDataset.spec,
    );
  }, [plottedDataset, scatterDomain]);

  const defaultFastViewport = useMemo<FastScatterViewport | null>(() => {
    if (scatterDomain === null) {
      return null;
    }

    return createDefaultFastScatterViewport(scatterDomain);
  }, [scatterDomain]);

  const urlState = useMemo<PrototypeSearchState | null>(() => {
    if (defaultViewport === null) {
      return null;
    }

    return parsePrototypeSearchParams(searchParams, defaultViewport);
  }, [defaultViewport, searchParams]);

  const [rendererState, setRendererState] = useState<{
    message?: string;
    status: ScatterRenderState;
  }>({ status: 'idle' });
  const fastScatterPlotRef = useRef<ScatterPlotInstance | null>(null);
  const [renderMetrics, setRenderMetrics] = useState<FastScatterMetricsEvent | null>(
    null,
  );
  const [rendererMetrics, setRendererMetrics] = useState<RendererMetricsState>(
    createInitialRendererMetrics,
  );
  const searchParamsRef = useRef(searchParams);
  const urlStateRef = useRef<PrototypeSearchState | null>(urlState);
  const pendingInteractionSearchStateRef = useRef<PrototypeSearchState | null>(null);
  const pendingInteractionFastViewportRef = useRef<FastScatterViewport | null>(null);
  const pendingInteractionReasonRef = useRef<'drag' | 'navigator' | 'wheel' | null>(
    null,
  );
  const pendingInteractionPhaseRef = useRef<FastScatterViewportChangePhase>('preview');
  const pendingInteractionDueAtRef = useRef<number | null>(null);
  const interactionSearchFrameRef = useRef(0);
  const interactionWheelTimeoutRef = useRef(0);
  const [transientFastViewport, setTransientFastViewport] =
    useState<FastScatterViewport | null>(null);
  const renderMetricDetail = useMemo(() => parseRenderMetricDetail(renderMetrics), [
    renderMetrics,
  ]);
  const [selectedSourceIndices, setSelectedSourceIndices] = useState<Uint32Array>(() =>
    createInitialSelectedSourceIndices(searchParams),
  );
  const [latestSelectionEvent, setLatestSelectionEvent] =
    useState<FastScatterSelectionEvent | null>(null);
  const [hoverSourceIndex, setHoverSourceIndex] = useState<number | null>(() =>
    createInitialHoverSourceIndex(searchParams),
  );
  const renderingMode: FastScatterRenderingMode = 'points';
  const pointSizeScale = useMemo(
    () => parsePointSizeScaleSearchParam(searchParams),
    [searchParams],
  );
  const opacityScale = useMemo(
    () => parseOpacityScaleSearchParam(searchParams),
    [searchParams],
  );
  const [visualizationModeState, setVisualizationModeState] =
    useState<FastScatterVisualizationMode>(() =>
      parseFastScatterVisualizationMode(searchParams),
    );
  const visualizationMode = visualizationModeState;
  const activeWebgpuAggregationBackend = visualizationMode === 'points'
    ? null
    : renderMetricDetail?.aggregate?.backend ?? null;
  const currentAggregateControllerMetrics = useMemo(
    () =>
      resolveAggregateControllerMetricsForVisualizationMode(
        rendererMetrics.aggregateController,
        visualizationMode,
      ),
    [rendererMetrics.aggregateController, visualizationMode],
  );
  const heatmapBinSizePx = useMemo(
    () => parseHeatmapBinSizeSearchParam(searchParams),
    [searchParams],
  );
  const heatmapPalette = useMemo(
    () => parseFastScatterHeatmapPalette(searchParams),
    [searchParams],
  );
  const [hoverInspection, setHoverInspection] = useState<FastScatterHoverEvent | null>(
    null,
  );
  const [measurementInspection, setMeasurementInspection] =
    useState<FastScatterMeasurementEvent | null>(null);
  const [focusedPlotId, setFocusedPlotId] = useState<string | null>(null);
  const [activePlotId, setActivePlotId] = useState<string | null>(null);
  const [plotInteractionGate, setPlotInteractionGate] = useState<PlotInteractionGateState>(
    INITIAL_PLOT_INTERACTION_GATE_STATE,
  );
  const [heldMode, setHeldMode] = useState<InteractionMode | null>(null);
  const heldModeKeyRef = useRef<string | null>(null);
  const opacityScaleRef = useRef(opacityScale);
  const pointSizeScaleRef = useRef(pointSizeScale);
  const pointSizeFrameRef = useRef(0);
  const pointSizeUrlTimeoutRef = useRef(0);
  const pendingPointSizeDirectionRef = useRef<'decrease' | 'increase' | null>(null);
  const pendingOpacityScaleRef = useRef<number | null>(null);
  const xModeRef = useRef<FastScatterXMode>(xMode);
  const viewportHistoryRef = useRef<FastScatterViewport[]>([]);
  const suppressViewportHistoryRef = useRef(false);
  const selectedState = useMemo<FastScatterSelectionState | null>(() => {
    if (plottedDataset === null) {
      return null;
    }

    return createFastScatterSelectionState(
      plottedDataset.columns,
      selectedSourceIndices,
      { sampleSize: SELECTION_SAMPLE_SIZE },
    );
  }, [plottedDataset, selectedSourceIndices]);
  const selectionCallbackPreview = useMemo(
    () => serializeFastScatterSelectionCallbackPreview(latestSelectionEvent),
    [latestSelectionEvent],
  );

  const writeSearchState = useCallback(
    (state: PrototypeSearchState) => {
      const baseParams = searchParamsRef.current;
      const nextParams = serializePrototypeSearchParams(state, baseParams);

      if (nextParams.toString() !== baseParams.toString()) {
        setSearchParams(nextParams, { replace: true });
      }
    },
    [setSearchParams],
  );

  const cancelPendingInteractionSearchFrame = useCallback(() => {
    if (interactionSearchFrameRef.current !== 0) {
      window.cancelAnimationFrame(interactionSearchFrameRef.current);
      interactionSearchFrameRef.current = 0;
    }
  }, []);

  const cancelPendingInteractionWheelWrite = useCallback(() => {
    pendingInteractionDueAtRef.current = null;
    if (interactionWheelTimeoutRef.current !== 0) {
      window.clearTimeout(interactionWheelTimeoutRef.current);
      interactionWheelTimeoutRef.current = 0;
    }
  }, []);

  const cancelPendingInteractionSearchState = useCallback(() => {
    pendingInteractionSearchStateRef.current = null;
    pendingInteractionFastViewportRef.current = null;
    pendingInteractionReasonRef.current = null;
    pendingInteractionPhaseRef.current = 'preview';
    setTransientFastViewport(null);
    cancelPendingInteractionSearchFrame();
    cancelPendingInteractionWheelWrite();
  }, [cancelPendingInteractionSearchFrame, cancelPendingInteractionWheelWrite]);

  const updatePointSizeScale = useCallback(
    (scale: number) => {
      cancelPendingInteractionSearchState();
      fastScatterPlotRef.current?.update({ pointSizeScale: scale });
      if (pointSizeUrlTimeoutRef.current !== 0) {
        window.clearTimeout(pointSizeUrlTimeoutRef.current);
      }
      pointSizeUrlTimeoutRef.current = window.setTimeout(() => {
        pointSizeUrlTimeoutRef.current = 0;
        const baseParams = new URLSearchParams(window.location.search);
        const nextParams = new URLSearchParams(baseParams);
        nextParams.set(FAST_SCATTER_POINT_SIZE_SCALE_PARAM, formatPointSizeScaleParam(scale));
        if (nextParams.toString() !== baseParams.toString()) {
          setSearchParams(nextParams, { replace: true });
        }
      }, 150);
    },
    [cancelPendingInteractionSearchState, setSearchParams],
  );

  const updateOpacityScale = useCallback(
    (scale: number) => {
      cancelPendingInteractionSearchState();
      const nextOpacityScale = snapOpacityScaleToStep(scale);
      opacityScaleRef.current = nextOpacityScale;
      pendingOpacityScaleRef.current = nextOpacityScale;
      const baseParams = new URLSearchParams(window.location.search);
      const nextParams = new URLSearchParams(baseParams);
      nextParams.set(
        FAST_SCATTER_OPACITY_SCALE_PARAM,
        formatOpacityScaleParam(nextOpacityScale),
      );

      if (nextParams.toString() !== baseParams.toString()) {
        setSearchParams(nextParams, { replace: true });
        return;
      }

      pendingOpacityScaleRef.current = null;
    },
    [cancelPendingInteractionSearchState, setSearchParams],
  );

  const updateVisualizationMode = useCallback(
    (mode: FastScatterVisualizationMode) => {
      cancelPendingInteractionSearchState();
      const baseParams = new URLSearchParams(window.location.search);
      const nextParams = new URLSearchParams(baseParams);
      nextParams.set(
        FAST_SCATTER_VISUALIZATION_PARAM,
        formatFastScatterVisualizationMode(mode),
      );

      if (nextParams.toString() !== baseParams.toString()) {
        window.history.replaceState(null, '', `${window.location.pathname}?${nextParams}`);
        searchParamsRef.current = nextParams;
      }
      setHoverInspection(null);
      setHoverSourceIndex(null);
      fastScatterPlotRef.current?.update({
        hoverSourceIndex: null,
        visualizationMode: mode,
      });
      fastScatterPlotRef.current?.commands.render();
      setVisualizationModeState(mode);
    },
    [cancelPendingInteractionSearchState],
  );

  const updateWebgpuAggregationBackend = useCallback(
    (backend: FastScatterWebgpuAggregationBackend) => {
      cancelPendingInteractionSearchState();
      const baseParams = new URLSearchParams(window.location.search);
      const nextParams = new URLSearchParams(baseParams);
      nextParams.set(FAST_SCATTER_WEBGPU_AGGREGATION_BACKEND_PARAM, backend);
      if (nextParams.toString() === baseParams.toString()) return;
      searchParamsRef.current = nextParams;
      setRenderMetrics(null);
      setRendererMetrics(createInitialRendererMetrics());
      setSearchParams(nextParams, { replace: true });
    },
    [cancelPendingInteractionSearchState, setSearchParams],
  );

  const updateHeatmapBinSizePx = useCallback(
    (binSizePx: number) => {
      cancelPendingInteractionSearchState();
      const baseParams = new URLSearchParams(searchParamsRef.current);
      const nextParams = new URLSearchParams(baseParams);
      nextParams.set(
        FAST_SCATTER_HEATMAP_BIN_SIZE_PARAM,
        formatHeatmapBinSizeSearchParam(binSizePx),
      );

      if (nextParams.toString() !== baseParams.toString()) {
        searchParamsRef.current = nextParams;
        setSearchParams(nextParams, { replace: true });
      }
    },
    [cancelPendingInteractionSearchState, setSearchParams],
  );

  const adjustHeatmapBinSizePx = useCallback(
    (deltaPx: number) => {
      const currentSize = parseHeatmapBinSizeSearchParam(searchParamsRef.current);
      updateHeatmapBinSizePx(currentSize + deltaPx);
    },
    [updateHeatmapBinSizePx],
  );

  const updateHeatmapPalette = useCallback(
    (palette: FastScatterHeatmapPalette) => {
      cancelPendingInteractionSearchState();
      const baseParams = new URLSearchParams(window.location.search);
      const nextParams = new URLSearchParams(baseParams);
      nextParams.set(
        FAST_SCATTER_HEATMAP_PALETTE_PARAM,
        normalizeFastScatterHeatmapPalette(palette),
      );

      if (nextParams.toString() !== baseParams.toString()) {
        setSearchParams(nextParams, { replace: true });
      }
    },
    [cancelPendingInteractionSearchState, setSearchParams],
  );

  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);

  useEffect(() => {
    urlStateRef.current = urlState;
  }, [urlState]);

  useEffect(() => {
    xModeRef.current = xMode;
  }, [xMode]);

  useEffect(() => {
    const pendingOpacityScale = pendingOpacityScaleRef.current;

    if (pendingOpacityScale !== null && opacityScale !== pendingOpacityScale) {
      return;
    }

    pendingOpacityScaleRef.current = null;
    opacityScaleRef.current = opacityScale;
  }, [opacityScale]);

  useEffect(() => {
    pointSizeScaleRef.current = pointSizeScale;
  }, [pointSizeScale]);

  useEffect(() => () => {
    if (pointSizeFrameRef.current !== 0) {
      window.cancelAnimationFrame(pointSizeFrameRef.current);
    }
    if (pointSizeUrlTimeoutRef.current !== 0) {
      window.clearTimeout(pointSizeUrlTimeoutRef.current);
    }
  }, []);

  useEffect(
    () => () => {
      cancelPendingInteractionSearchFrame();
      cancelPendingInteractionWheelWrite();
    },
    [cancelPendingInteractionSearchFrame, cancelPendingInteractionWheelWrite],
  );

  const fastViewport = useMemo<FastScatterViewport | null>(() => {
    if (plottedDataset === null || defaultFastViewport === null) {
      return null;
    }

    if (!plottedDataset.isLegacyViewport) {
      return parseFastScatterSearchViewport(
        searchParams,
        plottedDataset.spec,
        defaultFastViewport,
      );
    }

    if (urlState === null) {
      return defaultFastViewport;
    }

    return {
      x: urlState.viewport.x,
      yByPlot: Object.fromEntries(
        plottedDataset.spec.plots.map((plot, index) => [
          plot.id,
          getPrototypeViewportYRange(urlState.viewport, plot.yKey, index),
        ]),
      ),
    };
  }, [defaultFastViewport, plottedDataset, searchParams, urlState]);
  const effectiveMode = heldMode ?? normalizeFastScatterRouteMode(urlState?.mode);
  const renderedFastViewport = transientFastViewport ?? fastViewport;
  const plotInteractionActive = isPlotInteractionGateActive(plotInteractionGate);

  useEffect(() => {
    if (
      transientFastViewport === null ||
      fastViewport === null ||
      pendingInteractionFastViewportRef.current !== null ||
      !areFastScatterViewportsEqual(transientFastViewport, fastViewport)
    ) {
      return;
    }

    setTransientFastViewport((current) => {
      if (
        current === null ||
        !areFastScatterViewportsEqual(current, fastViewport)
      ) {
        return current;
      }

      return null;
    });
  }, [fastViewport, transientFastViewport]);

  const updateUrlState = useCallback(
    (state: PrototypeSearchState) => {
      cancelPendingInteractionSearchState();
      if (plottedDataset !== null && !plottedDataset.isLegacyViewport) {
        writeFastScatterSearchState({
          axis: state.axis,
          baseParams: searchParamsRef.current,
          mode: state.mode,
          setSearchParams,
          spec: plottedDataset.spec,
          viewport: renderedFastViewport ??
            defaultFastViewport ?? { x: state.viewport.x, yByPlot: {} },
        });
        return;
      }

      writeSearchState(state);
    },
    [
      cancelPendingInteractionSearchState,
      defaultFastViewport,
      renderedFastViewport,
      plottedDataset,
      setSearchParams,
      writeSearchState,
    ],
  );

  const handleFastViewportChange = useCallback(
    (
      viewport: FastScatterViewport,
      reason: FastScatterViewportChangeReason = 'programmatic',
      phase: FastScatterViewportChangePhase = 'commit',
    ) => {
      const currentUrlState = urlStateRef.current;
      const currentFastViewport =
        pendingInteractionFastViewportRef.current ?? fastViewport;
      if (
        plottedDataset === null ||
        currentUrlState === null ||
        currentFastViewport === null
      ) {
        return;
      }

      const debounceMs = getViewportCommitDebounceMs(reason, phase);
      const hasPendingInteraction =
        pendingInteractionReasonRef.current !== null &&
        pendingInteractionFastViewportRef.current !== null;

      if (!suppressViewportHistoryRef.current) {
        if (debounceMs === null || !hasPendingInteraction) {
          const previousViewport = currentFastViewport;
          const latestHistoryEntry =
            viewportHistoryRef.current[viewportHistoryRef.current.length - 1] ?? null;

          if (
            !areFastScatterViewportsEqual(previousViewport, viewport) &&
            (latestHistoryEntry === null ||
              !areFastScatterViewportsEqual(latestHistoryEntry, previousViewport))
          ) {
            viewportHistoryRef.current = [
              ...viewportHistoryRef.current.slice(-(VIEWPORT_HISTORY_LIMIT - 1)),
              cloneFastScatterViewport(previousViewport),
            ];
          }
        }
      } else {
        suppressViewportHistoryRef.current = false;
      }

      const nextState = {
        axis: currentUrlState.axis,
        mode: normalizeFastScatterRouteMode(currentUrlState.mode),
        viewport: plottedDataset.isLegacyViewport
          ? convertFastViewportToPrototypeViewport(
              viewport,
              plottedDataset.spec,
              currentUrlState.viewport,
            )
          : currentUrlState.viewport,
      };
      const writeNextState = (viewportToWrite: FastScatterViewport) => {
        if (plottedDataset.isLegacyViewport) {
          writeSearchState(nextState);
          return;
        }

        writeFastScatterSearchState({
          axis: nextState.axis,
          baseParams: searchParamsRef.current,
          mode: nextState.mode,
          setSearchParams,
          spec: plottedDataset.spec,
          viewport: viewportToWrite,
        });
      };

      if (debounceMs === null) {
        cancelPendingInteractionSearchState();
        writeNextState(viewport);
        return;
      }

      pendingInteractionSearchStateRef.current = nextState;
      pendingInteractionFastViewportRef.current = viewport;
      pendingInteractionReasonRef.current = normalizePendingViewportReason(reason);
      pendingInteractionPhaseRef.current = phase;
      cancelPendingInteractionWheelWrite();
      if (phase === 'preview') {
        pendingInteractionDueAtRef.current = null;
        return;
      }
      pendingInteractionDueAtRef.current = performance.now() + debounceMs;
      interactionWheelTimeoutRef.current = window.setTimeout(() => {
        interactionWheelTimeoutRef.current = 0;
        pendingInteractionDueAtRef.current = null;
        const pendingState = pendingInteractionSearchStateRef.current;
        const pendingFastViewport = pendingInteractionFastViewportRef.current;
        pendingInteractionSearchStateRef.current = null;
        pendingInteractionFastViewportRef.current = null;
        pendingInteractionReasonRef.current = null;
        pendingInteractionPhaseRef.current = 'preview';
        if (pendingState !== null && pendingFastViewport !== null) {
          writeNextState(pendingFastViewport);
        }
      }, debounceMs);
    },
    [
      cancelPendingInteractionSearchState,
      cancelPendingInteractionWheelWrite,
      fastViewport,
      plottedDataset,
      setSearchParams,
      writeSearchState,
    ],
  );

  const handleFastSelectionChange = useCallback(
    (selection: FastScatterSelectionEvent) => {
      setSelectedSourceIndices(selection.sourceIndices);
      setLatestSelectionEvent(selection);
      setRendererMetrics((previous) => ({
        ...previous,
        rectangleSelection:
          selection.tool === 'rectangle'
            ? {
                candidateCount: previous.rectangleSelection?.candidateCount ?? 0,
                computeMs: selection.durationMs ?? 0,
                durationMs: selection.durationMs ?? 0,
                mode: previous.rectangleSelection?.mode ?? 'pending',
                observableMs: selection.durationMs ?? 0,
                plotId: selection.plotId ?? 'unknown',
                sampleIds: selection.sampleIds ?? [],
                selectedCount: selection.selectedCount,
                transferMs: previous.rectangleSelection?.transferMs ?? 0,
              }
            : previous.rectangleSelection,
        lassoSelection:
          selection.tool === 'lasso'
            ? {
                candidateCount: previous.lassoSelection?.candidateCount ?? 0,
                computeMs: selection.durationMs ?? 0,
                durationMs: selection.durationMs ?? 0,
                lassoPointCount: previous.lassoSelection?.lassoPointCount ?? 0,
                mode: previous.lassoSelection?.mode ?? 'pending',
                observableMs: selection.durationMs ?? 0,
                plotId: selection.plotId ?? 'unknown',
                sampleIds: selection.sampleIds ?? [],
                selectedCount: selection.selectedCount,
                transferMs: previous.lassoSelection?.transferMs ?? 0,
              }
            : previous.lassoSelection,
      }));
    },
    [],
  );

  const clearSelectedSourceIndices = useCallback(() => {
    const selection = fastScatterPlotRef.current?.commands.clearSelection();
    setSelectedSourceIndices(selection?.sourceIndices ?? EMPTY_SELECTED_SOURCE_INDICES);
    setLatestSelectionEvent(selection ?? null);
    setRendererMetrics((previous) => ({
      ...previous,
      selectedRecordExport: null,
    }));
  }, []);

  const materializeSelectedRecordsForUserExport = useCallback(
    (mode: 'copy' | 'download') => {
      if (datasetState.status !== 'loaded' || selectedSourceIndices.length === 0) {
        return null;
      }

      const startedAt = performance.now();
      const text = serializeFastScatterSelectedRecordsForExport(
        datasetState.adaptedDataset.columns,
        selectedSourceIndices,
      );
      const durationMs = performance.now() - startedAt;

      setRendererMetrics((previous) => ({
        ...previous,
        selectedRecordExport: {
          byteLength: new Blob([text]).size,
          durationMs,
          recordCount: selectedSourceIndices.length,
          mode,
          status: mode === 'copy' ? 'copied' : 'downloaded',
        },
      }));

      return text;
    },
    [datasetState, selectedSourceIndices],
  );

  const handleCopySelectedIds = useCallback(async () => {
    const text = materializeSelectedRecordsForUserExport('copy');

    if (text === null) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setRendererMetrics((previous) => ({
        ...previous,
        selectedRecordExport:
          previous.selectedRecordExport === null
            ? null
            : {
                ...previous.selectedRecordExport,
                status: 'failed',
              },
      }));
    }
  }, [materializeSelectedRecordsForUserExport]);

  const handleDownloadSelectedRecords = useCallback(() => {
    const text = materializeSelectedRecordsForUserExport('download');

    if (text === null) {
      return;
    }

    const exportBlob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const exportUrl = URL.createObjectURL(exportBlob);
    const link = document.createElement('a');

    link.href = exportUrl;
    link.download = 'scatter-fast-selected-records.tsv';
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(exportUrl);
  }, [materializeSelectedRecordsForUserExport]);

  const handleFastHoverChange = useCallback(
    (hover: FastScatterHoverEvent | null) => {
      setHoverInspection(hover);
      setHoverSourceIndex(hover?.point.sourceIndex ?? null);
      if (hover?.source !== 'measure') {
        return;
      }
      setRendererMetrics((previous) => ({
        ...previous,
        measurement: {
          activeDeltaCount:
            measurementInspection !== null && plottedDataset !== null
              ? plottedDataset.spec.plots.length + 1
              : 0,
          durationMs: hover.durationMs,
          referenceCount: measurementInspection === null ? 0 : 1,
        },
      }));
    },
    [measurementInspection, plottedDataset],
  );

  const handleFastMeasurementChange = useCallback(
    (measurement: FastScatterMeasurementEvent | null) => {
      setMeasurementInspection(measurement);
      setRendererMetrics((previous) => ({
        ...previous,
        measurement: {
          activeDeltaCount:
            measurement === null || plottedDataset === null
              ? 0
              : plottedDataset.spec.plots.length + 1,
          durationMs: previous.measurement?.durationMs ?? 0,
          referenceCount: measurement === null ? 0 : 1,
        },
      }));
    },
    [plottedDataset],
  );

  const measurementFieldCount =
    measurementInspection === null || plottedDataset === null
      ? 0
      : plottedDataset.spec.plots.length + 1;

  const latestSelectionMetrics =
    rendererMetrics.lassoSelection ?? rendererMetrics.rectangleSelection;

  const resetViewport = useCallback(() => {
    const currentUrlState = urlStateRef.current;
    if (
      currentUrlState === null ||
      defaultViewport === null ||
      defaultFastViewport === null ||
      plottedDataset === null
    ) {
      return;
    }

    cancelPendingInteractionSearchState();
    viewportHistoryRef.current = [];
    setFocusedPlotId(null);
    if (!plottedDataset.isLegacyViewport) {
      writeFastScatterSearchState({
        axis: currentUrlState.axis,
        baseParams: searchParamsRef.current,
        mode: normalizeFastScatterRouteMode(currentUrlState.mode),
        setSearchParams,
        spec: plottedDataset.spec,
        viewport: defaultFastViewport,
      });
      return;
    }

    writeSearchState({
      ...currentUrlState,
      viewport: defaultViewport,
    });
  }, [
    cancelPendingInteractionSearchState,
    defaultFastViewport,
    defaultViewport,
    plottedDataset,
    setSearchParams,
    writeSearchState,
  ]);

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

  const handleActivePlotChange = useCallback((plotId: string | null) => {
    setActivePlotId((current) => (current === plotId ? current : plotId));
  }, []);

  const handlePointSizeWheelAdjust = useCallback(
    (direction: 'decrease' | 'increase') => {
      pendingPointSizeDirectionRef.current = direction;
      if (pointSizeFrameRef.current !== 0) return;
      pointSizeFrameRef.current = window.requestAnimationFrame(() => {
        pointSizeFrameRef.current = 0;
        const pendingDirection = pendingPointSizeDirectionRef.current;
        pendingPointSizeDirectionRef.current = null;
        if (pendingDirection === null) return;
        const currentScale = pointSizeScaleRef.current;
        const nextScale = pendingDirection === 'increase'
          ? getNextPointSizeScale(currentScale)
          : getPreviousPointSizeScale(currentScale);
        if (nextScale === currentScale) return;
        pointSizeScaleRef.current = nextScale;
        updatePointSizeScale(nextScale);
      });
    },
    [updatePointSizeScale],
  );

  const handleHeatmapBinWheelAdjust = useCallback(
    (direction: 'decrease' | 'increase') => {
      adjustHeatmapBinSizePx(
        direction === 'increase'
          ? FAST_SCATTER_HEATMAP_BIN_SIZE_STEP_PX
          : -FAST_SCATTER_HEATMAP_BIN_SIZE_STEP_PX,
      );
    },
    [adjustHeatmapBinSizePx],
  );

  const undoZoom = useCallback(() => {
    const previousViewport = viewportHistoryRef.current.pop();

    if (previousViewport === undefined) {
      return;
    }

    suppressViewportHistoryRef.current = true;
    handleFastViewportChange(previousViewport, 'programmatic');
  }, [handleFastViewportChange]);

  const updateXMode = useCallback(
    (nextMode: FastScatterXMode) => {
      if (
        nextMode === xModeRef.current ||
        datasetState.status !== 'loaded' ||
        plottedDataset === null ||
        renderedFastViewport === null
      ) {
        return;
      }

      if (rendererBackend === 'webgpu') {
        const nextParams = new URLSearchParams(searchParamsRef.current);
        nextParams.set(FAST_SCATTER_X_MODE_PARAM, nextMode);
        clearFastScatterViewportSearchParams(nextParams);
        navigateWithFullPageRefresh(nextParams);
        return;
      }

      const axisDataset = createFastScatterRouteDatasetForXAxis(
        datasetState.adaptedDataset,
        xAxisKey,
      );
      const nextDataset = createFastScatterRouteDatasetForXMode(
        axisDataset,
        nextMode,
      );
      const nextViewport = convertFastScatterXModeViewport({
        currentMode: xModeRef.current,
        currentViewport: renderedFastViewport,
        nextMode,
        plottedColumns: axisDataset.columns,
      });
      const nextDefaultViewport = createDefaultFastScatterViewport(
        calculateFastScatterDomain(nextDataset.columns, nextDataset.spec),
      );
      const viewportToWrite =
        nextViewport === null
          ? nextDefaultViewport
          : { ...renderedFastViewport, x: nextViewport.x };
      const currentUrlState = urlStateRef.current;

      if (currentUrlState === null) {
        return;
      }

      viewportHistoryRef.current = [];
      const nextParams = new URLSearchParams(searchParamsRef.current);
      nextParams.set(FAST_SCATTER_X_MODE_PARAM, nextMode);

      if (nextDataset.isLegacyViewport) {
        const nextRouteState: PrototypeSearchState = {
          ...currentUrlState,
          viewport: convertFastViewportToPrototypeViewport(
            viewportToWrite,
            nextDataset.spec,
            currentUrlState.viewport,
          ),
        };
        const serialized = serializePrototypeSearchParams(nextRouteState, nextParams);
        setSearchParams(serialized, { replace: true });
        return;
      }

      writeFastScatterSearchState({
        axis: currentUrlState.axis,
        baseParams: nextParams,
        mode: normalizeFastScatterRouteMode(currentUrlState.mode),
        setSearchParams,
        spec: nextDataset.spec,
        viewport: viewportToWrite,
      });
    },
    [
      datasetState,
      plottedDataset,
      renderedFastViewport,
      rendererBackend,
      setSearchParams,
      xAxisKey,
    ],
  );

  const updateXAxisKey = useCallback(
    (key: string) => {
      if (datasetState.status !== 'loaded') {
        return;
      }

      if (rendererBackend === 'webgpu') {
        if (key === xAxisKey) return;
        const nextParams = new URLSearchParams(searchParamsRef.current);
        nextParams.set(FAST_SCATTER_X_AXIS_PARAM, key);
        nextParams.set(FAST_SCATTER_X_MODE_PARAM, DEFAULT_FAST_SCATTER_X_MODE);
        clearFastScatterViewportSearchParams(nextParams);
        navigateWithFullPageRefresh(nextParams);
        return;
      }

      const nextDataset = createFastScatterRouteDatasetForXAxis(
        datasetState.adaptedDataset,
        key,
      );
      const nextViewport = createDefaultFastScatterViewport(
        calculateFastScatterDomain(nextDataset.columns, nextDataset.spec),
      );
      const currentUrlState = urlStateRef.current;

      if (currentUrlState === null) {
        return;
      }

      viewportHistoryRef.current = [];
      const nextParams = new URLSearchParams(searchParamsRef.current);
      nextParams.set(FAST_SCATTER_X_AXIS_PARAM, nextDataset.columns.xKey ?? key);
      nextParams.set(FAST_SCATTER_X_MODE_PARAM, DEFAULT_FAST_SCATTER_X_MODE);
      writeFastScatterSearchState({
        axis: currentUrlState.axis,
        baseParams: nextParams,
        mode: normalizeFastScatterRouteMode(currentUrlState.mode),
        setSearchParams,
        spec: nextDataset.spec,
        viewport: nextViewport,
      });
    },
    [datasetState, rendererBackend, setSearchParams, xAxisKey],
  );

  useEffect(() => {
    if (urlState === null) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const shortcutTargetIgnored = shouldIgnoreShortcutTarget(event.target);
      const shouldHandleShortcut = plotInteractionActive && !shortcutTargetIgnored;

      if (shouldHandleShortcut && event.key === 'Shift' && !event.repeat) {
        event.preventDefault();
        heldModeKeyRef.current = 'shift';
        setHeldMode('hover');
        return;
      }

      if (!shouldHandleShortcut || event.metaKey) {
        return;
      }

      if ((event.key === 'Escape' || event.code === 'Escape') && !event.repeat) {
        event.preventDefault();
        clearSelectedSourceIndices();
        return;
      }

      const key = normalizeInteractionShortcutKey(event.key);
      const nextOpacityScale = getOpacityScaleForShortcut(
        key,
        normalizeInteractionShortcutKey(event.code),
        opacityScaleRef.current,
      );

      if (event.altKey || event.ctrlKey) {
        return;
      }

      if (nextOpacityScale === null) {
        return;
      }

      event.preventDefault();
      updateOpacityScale(nextOpacityScale);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift' && heldModeKeyRef.current === 'shift') {
        event.preventDefault();
        heldModeKeyRef.current = null;
        setHeldMode(null);
      }
    };

    const handleWindowBlur = () => {
      heldModeKeyRef.current = null;
      setHeldMode(null);
      handlePlotInteractionFocusChange(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [
    clearSelectedSourceIndices,
    plotInteractionActive,
    handlePlotInteractionFocusChange,
    updateOpacityScale,
    urlState,
  ]);

  useEffect(() => {
    if (!isDemoTestControlEnabled(searchParams, '__e2eScatterFastRouteStateHook')) {
      return;
    }

    window.__scatterFastRouteStateTestHook = {
      clearSelection: clearSelectedSourceIndices,
      clearFocusedPlot: () => setFocusedPlotId(null),
      getTableMode: () => parseFastRouteTableMode(new URLSearchParams(window.location.search)),
      getDefaultViewport: () => defaultViewport,
      getFocusedPlotId: () => focusedPlotId,
      getFastViewport: () =>
        fastScatterPlotRef.current?.commands.getStateSnapshot().viewport ??
        renderedFastViewport,
      getWebgpuDiagnostics: () => {
        const plot = fastScatterPlotRef.current as ScatterWebgpuPlotInstance | null;
        return plot?.getWebgpuDiagnostics?.() ?? null;
      },
      getHeatmapBinSizePx: () => heatmapBinSizePx,
      getOpacityScale: () => opacityScale,
      getPendingViewportCommit: () => {
        const pendingViewport = pendingInteractionFastViewportRef.current;
        const pendingReason = pendingInteractionReasonRef.current;

        if (pendingViewport === null || pendingReason === null) {
          return null;
        }

        const dueAt = pendingInteractionDueAtRef.current;
        return {
          dueInMs: dueAt === null ? null : Math.max(0, dueAt - performance.now()),
          phase: pendingInteractionPhaseRef.current,
          reason: pendingReason,
          viewport: pendingViewport,
        };
      },
      getPlotInteractionState: () => ({
        ...plotInteractionGate,
        active: isPlotInteractionGateActive(plotInteractionGate),
      }),
      getPointSizeScale: () => pointSizeScale,
      getState: () => urlState,
      getVisualizationMode: () => visualizationMode,
      getXMode: () => xMode,
      resetViewport,
      setAxis: (axis) => {
        if (urlState !== null) {
          updateUrlState({ ...urlState, axis });
        }
      },
      setFocusedPlot: (plotId) => {
        const normalized =
          plotId === null ||
          plottedDataset === null ||
          !plottedDataset.spec.plots.some((plot) => plot.id === plotId)
            ? null
            : plotId;
        setFocusedPlotId(normalized);
      },
      setFastViewport: (viewport, reason = 'programmatic', phase = 'commit') => {
        const plot = fastScatterPlotRef.current;
        if (plot === null) {
          handleFastViewportChange(viewport, reason, phase);
          return;
        }
        plot.commands.setViewport(viewport, reason, phase);
      },
      setHeatmapBinSizePx: updateHeatmapBinSizePx,
      setMode: (mode) => {
        if (urlState !== null) {
          updateUrlState({ ...urlState, mode });
        }
      },
      setOpacityScale: updateOpacityScale,
      setPointSizeScale: updatePointSizeScale,
      setSelectedSourceIndices: (sourceIndices) => {
        fastScatterPlotRef.current?.update({ selectedSourceIndices: sourceIndices });
      },
      setSearchState: writeSearchState,
      setVisualizationMode: updateVisualizationMode,
      setXMode: updateXMode,
      setSharedXRange: (x, reason = 'navigator', phase = 'commit') => {
        if (renderedFastViewport !== null) {
          const viewport = createFastScatterViewportWithSharedX(renderedFastViewport, x);
          const plot = fastScatterPlotRef.current;
          if (plot === null) {
            handleFastViewportChange(viewport, reason, phase);
            return;
          }
          plot.commands.setViewport(viewport, reason, phase);
        }
      },
      setViewportFromRoute: (viewport) => {
        if (urlState !== null) {
          writeSearchState({ ...urlState, viewport });
        }
      },
    };

    return () => {
      delete window.__scatterFastRouteStateTestHook;
    };
  }, [
    clearSelectedSourceIndices,
    defaultViewport,
    datasetState,
    renderedFastViewport,
    focusedPlotId,
    handleFastViewportChange,
    heatmapBinSizePx,
    opacityScale,
    plotInteractionGate,
    plottedDataset,
    pointSizeScale,
    resetViewport,
    searchParams,
    updateHeatmapBinSizePx,
    updateOpacityScale,
    updatePointSizeScale,
    updateUrlState,
    updateVisualizationMode,
    updateXMode,
    urlState,
    visualizationMode,
    writeSearchState,
    xMode,
  ]);

  return (
    <main className="prototype-shell scatter-fast-prototype-shell">
      <section
        className="workspace"
        aria-label="m-scatter workspace"
      >
        <div className="workspace-grid scatter-fast-workspace-grid">
          <section className="scatter-fast-chart-shell" aria-label="m-scatter chart shell">
            {datasetState.status === 'error' ? (
              <div className="workspace-placeholder" role="alert">
                <h2>Scatter dataset unavailable</h2>
                <p>{datasetState.message}</p>
              </div>
            ) : rendererBackend === 'webgpu' &&
                (datasetState.status === 'missing' || datasetState.status === 'generating') ? (
              <WebgpuDatasetSetup
                datasetState={datasetState}
                onCancel={() => datasetGenerationAbortRef.current?.abort()}
                onGenerate={() => void generateWebgpuDataset()}
                onSelectPointCount={selectWebgpuPointCount}
                pointCount={webgpuPointCount ?? DEFAULT_WEBGPU_POINT_COUNT}
              />
            ) : (
              <PlaceholderChartShell
                rendererBackend={rendererBackend}
                datasetState={datasetState}
                effectiveMode={effectiveMode}
                fastViewport={renderedFastViewport}
                onMetrics={setRenderMetrics}
                onRendererMetrics={setRendererMetrics}
                onRenderStateChange={(status, message) => {
                  setRendererState({ message, status });
                }}
                plotRef={fastScatterPlotRef}
                onViewportChange={handleFastViewportChange}
                onViewportUndoRequest={undoZoom}
                hoverSourceIndex={hoverSourceIndex}
                focusedPlotId={focusedPlotId}
                activePlotId={activePlotId}
                onActivePlotChange={handleActivePlotChange}
                hoverInspection={hoverInspection}
                heatmapBinSizePx={heatmapBinSizePx}
                heatmapPalette={heatmapPalette}
                measurementInspection={measurementInspection}
                onHoverChange={handleFastHoverChange}
                onMeasurementChange={handleFastMeasurementChange}
                onHeatmapBinSizeWheelAdjust={handleHeatmapBinWheelAdjust}
                onPointSizeWheelAdjust={handlePointSizeWheelAdjust}
                plottedDataset={plottedDataset}
                plotInteractionGate={plotInteractionGate}
                opacityScale={opacityScale}
                pointSizeScale={pointSizeScale}
                onPlotInteractionFocusChange={handlePlotInteractionFocusChange}
                onPlotInteractionHoverChange={handlePlotInteractionHoverChange}
                onPlotInteractionSurfacePointerDown={focusPlotInteractionSurface}
                renderingMode={renderingMode}
                selectedSourceIndices={selectedState?.sourceIndices}
                onSelectionChange={handleFastSelectionChange}
                urlState={urlState}
                theme={fastScatterTheme}
                visualizationMode={visualizationMode}
                webgpuAggregationBackend={webgpuAggregationBackend}
              />
            )}
          </section>
          <aside
            className="control-panel"
            aria-label="m-scatter diagnostics"
            data-table-mode={tableMode}
            data-table-count={datasetState.status === 'loaded' ? (datasetState.tableMetadata?.tableCount ?? 0) : 0}
            data-table-record-counts={
              datasetState.status === 'loaded'
                ? formatScatterTableRecordCounts(datasetState.tableMetadata?.tableRecordCounts)
                : 'none'
            }
            data-alpha-scale={formatDiagnosticNumber(
              renderMetricDetail?.renderPolicy?.alphaScale,
            )}
            data-blend-mode={renderMetricDetail?.renderPolicy?.blendMode ?? 'pending'}
            data-density-points-per-pixel={formatDiagnosticNumber(
              renderMetricDetail?.renderPolicy?.densityPointsPerPixel,
            )}
            data-point-size-scale={formatDiagnosticNumber(
              renderMetricDetail?.renderPolicy?.pointSizeScale,
            )}
            data-user-opacity-scale={formatDiagnosticNumber(opacityScale)}
            data-effective-opacity-scale={formatDiagnosticNumber(
              renderMetricDetail?.renderPolicy?.effectiveOpacityScale,
            )}
            data-user-point-size-scale={formatDiagnosticNumber(pointSizeScale)}
            data-effective-point-size-scale={formatDiagnosticNumber(
              renderMetricDetail?.renderPolicy?.effectivePointSizeScale,
            )}
            data-requested-rendering-mode={
              renderMetricDetail?.renderPolicy?.requestedRenderingMode ?? renderingMode
            }
            data-aggregate-status={
              visualizationMode === 'points'
                ? 'points'
                : renderMetrics?.phase === 'render' ||
                    renderMetrics?.displayMode === visualizationMode ||
                    (renderMetricDetail?.aggregate != null &&
                      renderMetricDetail.aggregate.displayMode === visualizationMode)
                  ? 'ready'
                  : renderMetricDetail?.aggregate == null ||
                      renderMetricDetail.aggregate.displayMode !== visualizationMode
                  ? 'pending'
                  : 'ready'
            }
            data-aggregate-backend={
              renderMetricDetail?.aggregate?.backend ??
              (visualizationMode === 'points' ? 'not-applicable' : 'pending')
            }
            data-aggregate-backend-preference={webgpuAggregationBackend}
            data-aggregate-count={formatDiagnosticInteger(
              renderMetrics?.aggregateCount,
            )}
            data-aggregate-cell-count={formatDiagnosticInteger(
              renderMetrics?.cellCount,
            )}
            data-aggregate-populated-cell-count={formatDiagnosticInteger(
              renderMetrics?.populatedCellCount,
            )}
            data-aggregate-build-ms={formatDiagnosticNumber(
              renderMetricDetail?.aggregate?.aggregateBuildMs,
            )}
            data-aggregate-upload-bytes={formatDiagnosticInteger(
              renderMetrics?.uploadBytes,
            )}
            data-aggregate-worker-mode={
              currentAggregateControllerMetrics?.mode ?? 'pending'
            }
            data-aggregate-worker-observable-ms={formatDiagnosticNumber(
              currentAggregateControllerMetrics?.durationMs,
            )}
            data-aggregate-worker-transfer-ms={formatDiagnosticNumber(
              currentAggregateControllerMetrics?.transferMs,
            )}
            data-subplot-count={formatDiagnosticInteger(
              plottedDataset?.spec.plots.length,
            )}
            data-effective-rendering-mode={
              renderMetricDetail?.renderPolicy?.effectiveRenderingMode ?? 'pending'
            }
            data-point-rendering-policy={
              renderMetricDetail?.renderPolicy?.renderingPolicy ?? 'pending'
            }
            data-render-policy={renderMetricDetail?.renderPolicy?.mode ?? 'pending'}
            data-renderer-buffer-count={formatDiagnosticInteger(
              rendererMetrics.upload?.bufferCount,
            )}
            data-renderer-draw-calls={formatDiagnosticInteger(renderMetrics?.drawCalls)}
            data-renderer-gpu-timer={
              rendererMetrics.setup?.gpuTimerSupported === undefined
                ? 'pending'
                : rendererMetrics.setup.gpuTimerSupported
                  ? 'supported'
                  : 'cpu-fallback'
            }
            data-renderer-redraw-cpu-ms={formatDiagnosticNumber(
              rendererMetrics.redraw?.cpuDurationMs,
            )}
            data-renderer-redraw-gpu-ms={formatDiagnosticNumber(
              rendererMetrics.redraw?.gpuDurationMs,
            )}
            data-renderer-cache-bytes={formatDiagnosticInteger(
              rendererMetrics.redraw?.cacheBytes,
            )}
            data-renderer-cached-frame={
              rendererMetrics.redraw?.cachedInteractionFrame === undefined
                ? 'pending'
                : rendererMetrics.redraw.cachedInteractionFrame ? 'true' : 'false'
            }
            data-renderer-coalesced-frames={formatDiagnosticInteger(
              rendererMetrics.redraw?.coalescedFrameCount,
            )}
            data-renderer-submitted-frames={formatDiagnosticInteger(
              rendererMetrics.redraw?.submittedFrameCount,
            )}
            data-renderer-resident-bytes={formatDiagnosticInteger(
              rendererMetrics.redraw?.residentBytes,
            )}
            data-renderer-estimated-peak-bytes={formatDiagnosticInteger(
              rendererMetrics.redraw?.estimatedPeakBytes,
            )}
            data-first-canvas-render-schedule-ms={formatDiagnosticNumber(
              rendererMetrics.firstCanvasRender?.delayMs,
            )}
            data-first-canvas-render-draw-calls={formatDiagnosticInteger(
              rendererMetrics.firstCanvasRender?.drawCalls,
            )}
            data-first-canvas-render-visible-points={formatDiagnosticInteger(
              rendererMetrics.firstCanvasRender?.visiblePointCount,
            )}
            data-renderer-setup-ms={formatDiagnosticNumber(
              rendererMetrics.setup?.durationMs,
            )}
            data-renderer-shader-compile-ms={formatDiagnosticNumber(
              rendererMetrics.setup?.shaderCompileMs,
            )}
            data-renderer-upload-bytes={formatDiagnosticInteger(
              rendererMetrics.upload?.uploadBytes,
            )}
            data-renderer-upload-ms={formatDiagnosticNumber(
              rendererMetrics.upload?.durationMs,
            )}
            data-renderer-visible-points={formatDiagnosticInteger(
              renderMetrics?.visiblePointCount,
            )}
            data-dataset-record-count={
              plottedDataset === null ? 'pending' : String(plottedDataset.columns.x.length)
            }
            data-dataset-fetch-ms={formatDiagnosticNumber(
              datasetState.status === 'loaded' ? datasetState.fetchMs : undefined,
            )}
            data-dataset-parse-ms={formatDiagnosticNumber(
              datasetState.status === 'loaded' ? datasetState.parseMs : undefined,
            )}
            data-schema-encode-ms={formatDiagnosticNumber(
              datasetState.status === 'loaded' ? datasetState.schemaEncodeMs : undefined,
            )}
            data-compatibility-object-materialization-ms={formatDiagnosticNumber(
              datasetState.status === 'loaded'
                ? datasetState.compatibilityBuildMs
                : undefined,
            )}
            data-dataset-load-ms={formatDiagnosticNumber(
              datasetState.status === 'loaded' ? datasetState.loadTimeMs : undefined,
            )}
            data-dataset-source-format={
              datasetState.status === 'loaded' ? datasetState.sourceFormat : 'pending'
            }
            data-columnar-decode-ms={formatDiagnosticNumber(
              datasetState.status === 'loaded'
                ? datasetState.columnarDecodeMs
                : undefined,
            )}
            data-columnar-bytes={formatDiagnosticInteger(
              datasetState.status === 'loaded'
                ? datasetState.columnarBytes
                : undefined,
            )}
            data-buffer-build-ms={formatDiagnosticNumber(
              datasetState.status === 'loaded'
                ? datasetState.bufferBuildMetrics.buildMs
                : undefined,
            )}
            data-buffer-memory-bytes={formatDiagnosticInteger(
              datasetState.status === 'loaded'
                ? datasetState.bufferBuildMetrics.byteLength
                : undefined,
            )}
            data-buffer-record-count={formatDiagnosticInteger(
              datasetState.status === 'loaded'
                ? datasetState.bufferBuildMetrics.recordCount
                : undefined,
            )}
            data-buffer-y-key-count={formatDiagnosticInteger(
              datasetState.status === 'loaded'
                ? datasetState.bufferBuildMetrics.yKeyCount
                : undefined,
            )}
            data-drag-pan-axis={rendererMetrics.dragPan?.axisMode ?? 'pending'}
            data-drag-pan-delta-x={formatDiagnosticNumber(
              rendererMetrics.dragPan?.deltaX,
            )}
            data-drag-pan-delta-y={formatDiagnosticNumber(
              rendererMetrics.dragPan?.deltaY,
            )}
            data-drag-pan-ms={formatDiagnosticNumber(
              rendererMetrics.dragPan?.durationMs,
            )}
            data-drag-pan-plot={rendererMetrics.dragPan?.plotId ?? 'pending'}
            data-drag-pan-updates={formatDiagnosticInteger(
              rendererMetrics.dragPan?.updateCount,
            )}
            data-selected-count={formatDiagnosticInteger(
              selectedState?.selectedCount,
            )}
            data-selected-id-sample={
              selectedState === null ? 'pending' : formatIdSample(selectedState.sampleIds)
            }
            data-selected-source-model="uint32-source-indices"
            data-selection-worker-candidates={formatDiagnosticInteger(
              latestSelectionMetrics?.candidateCount,
            )}
            data-selection-worker-compute-ms={formatDiagnosticNumber(
              latestSelectionMetrics?.computeMs,
            )}
            data-selection-worker-mode={latestSelectionMetrics?.mode ?? 'pending'}
            data-selection-worker-observable-ms={formatDiagnosticNumber(
              latestSelectionMetrics?.observableMs,
            )}
            data-selection-worker-transfer-ms={formatDiagnosticNumber(
              latestSelectionMetrics?.transferMs,
            )}
            data-selected-record-export-bytes={formatDiagnosticInteger(
              rendererMetrics.selectedRecordExport?.byteLength,
            )}
            data-selected-record-export-count={formatDiagnosticInteger(
              rendererMetrics.selectedRecordExport?.recordCount,
            )}
            data-selected-record-export-mode={
              rendererMetrics.selectedRecordExport?.mode ?? 'pending'
            }
            data-selected-record-export-ms={formatDiagnosticNumber(
              rendererMetrics.selectedRecordExport?.durationMs,
            )}
            data-selected-record-export-status={
              rendererMetrics.selectedRecordExport?.status ?? 'pending'
            }
            data-selected-overlay-update-ms={formatDiagnosticNumber(
              rendererMetrics.selectedOverlay?.durationMs,
            )}
            data-selected-overlay-mask-build-ms={formatDiagnosticNumber(
              rendererMetrics.selectedOverlay?.maskBuildMs,
            )}
            data-selected-overlay-mask-upload-ms={formatDiagnosticNumber(
              rendererMetrics.selectedOverlay?.maskGpuUploadMs,
            )}
            data-selected-overlay-upload-bytes={formatDiagnosticInteger(
              rendererMetrics.selectedOverlay?.uploadBytes,
            )}
            data-selected-overlay-point-count={formatDiagnosticInteger(
              rendererMetrics.selectedOverlay?.selectedPointCount,
            )}
            data-hover-source-index={
              hoverSourceIndex === null ? 'none' : String(hoverSourceIndex)
            }
            data-hover-lookup-candidates={formatDiagnosticInteger(
              rendererMetrics.hoverLookup?.candidateCount,
            )}
            data-hover-lookup-ms={formatDiagnosticNumber(
              rendererMetrics.hoverLookup?.durationMs,
            )}
            data-hover-lookup-source={rendererMetrics.hoverLookup?.source ?? 'pending'}
            data-hover-lookup-plot={rendererMetrics.hoverLookup?.plotId ?? 'pending'}
            data-focused-plot={focusedPlotId ?? 'all'}
            data-plot-interaction-active={plotInteractionActive ? 'true' : 'false'}
            data-plot-interaction-focused={
              plotInteractionGate.hasFocusWithin ? 'true' : 'false'
            }
            data-plot-interaction-hovered={plotInteractionGate.isHovered ? 'true' : 'false'}
            data-hover-overlay-update-ms={formatDiagnosticNumber(
              rendererMetrics.hoverOverlay?.durationMs,
            )}
            data-hover-overlay-draw-calls={formatDiagnosticInteger(
              rendererMetrics.hoverOverlay?.drawCalls,
            )}
            data-hover-overlay-upload-bytes={formatDiagnosticInteger(
              rendererMetrics.hoverOverlay?.uploadBytes,
            )}
            data-measurement-active={measurementInspection === null ? 'false' : 'true'}
            data-measurement-current-field-count={String(measurementFieldCount)}
            data-measurement-reference-source-index={
              measurementInspection === null
                ? 'none'
                : String(measurementInspection.reference.sourceIndex)
            }
            data-measurement-update-ms={formatDiagnosticNumber(
              rendererMetrics.measurement?.durationMs,
            )}
            data-wheel-zoom-axis={rendererMetrics.wheelZoom?.axisMode ?? 'pending'}
            data-wheel-zoom-ms={formatDiagnosticNumber(
              rendererMetrics.wheelZoom?.durationMs,
            )}
            data-wheel-zoom-plot={rendererMetrics.wheelZoom?.plotId ?? 'pending'}
            data-wheel-zoom-scale={formatDiagnosticNumber(
              rendererMetrics.wheelZoom?.scale,
            )}
            data-rectangle-zoom-axis={
              rendererMetrics.rectangleZoom?.axisMode ?? 'pending'
            }
            data-rectangle-zoom-ms={formatDiagnosticNumber(
              rendererMetrics.rectangleZoom?.durationMs,
            )}
            data-rectangle-zoom-plot={
              rendererMetrics.rectangleZoom?.plotId ?? 'pending'
            }
            data-rectangle-zoom-width={formatDiagnosticNumber(
              rendererMetrics.rectangleZoom?.rectWidth,
            )}
            data-rectangle-selection-count={formatDiagnosticInteger(
              rendererMetrics.rectangleSelection?.selectedCount,
            )}
            data-rectangle-selection-candidates={formatDiagnosticInteger(
              rendererMetrics.rectangleSelection?.candidateCount,
            )}
            data-rectangle-selection-compute-ms={formatDiagnosticNumber(
              rendererMetrics.rectangleSelection?.computeMs,
            )}
            data-rectangle-selection-id-sample={
              rendererMetrics.rectangleSelection === null
                ? 'pending'
                : formatIdSample(rendererMetrics.rectangleSelection.sampleIds)
            }
            data-rectangle-selection-mode={
              rendererMetrics.rectangleSelection?.mode ?? 'pending'
            }
            data-rectangle-selection-ms={formatDiagnosticNumber(
              rendererMetrics.rectangleSelection?.durationMs,
            )}
            data-rectangle-selection-observable-ms={formatDiagnosticNumber(
              rendererMetrics.rectangleSelection?.observableMs,
            )}
            data-rectangle-selection-plot={
              rendererMetrics.rectangleSelection?.plotId ?? 'pending'
            }
            data-rectangle-selection-transfer-ms={formatDiagnosticNumber(
              rendererMetrics.rectangleSelection?.transferMs,
            )}
            data-lasso-selection-candidates={formatDiagnosticInteger(
              rendererMetrics.lassoSelection?.candidateCount,
            )}
            data-lasso-selection-count={formatDiagnosticInteger(
              rendererMetrics.lassoSelection?.selectedCount,
            )}
            data-lasso-selection-compute-ms={formatDiagnosticNumber(
              rendererMetrics.lassoSelection?.computeMs,
            )}
            data-lasso-selection-id-sample={
              rendererMetrics.lassoSelection === null
                ? 'pending'
                : formatIdSample(rendererMetrics.lassoSelection.sampleIds)
            }
            data-lasso-selection-mode={rendererMetrics.lassoSelection?.mode ?? 'pending'}
            data-lasso-selection-ms={formatDiagnosticNumber(
              rendererMetrics.lassoSelection?.durationMs,
            )}
            data-lasso-selection-observable-ms={formatDiagnosticNumber(
              rendererMetrics.lassoSelection?.observableMs,
            )}
            data-lasso-selection-plot={
              rendererMetrics.lassoSelection?.plotId ?? 'pending'
            }
            data-lasso-selection-points={formatDiagnosticInteger(
              rendererMetrics.lassoSelection?.lassoPointCount,
            )}
            data-lasso-selection-transfer-ms={formatDiagnosticNumber(
              rendererMetrics.lassoSelection?.transferMs,
            )}
            data-navigator-drag-ms={formatDiagnosticNumber(
              rendererMetrics.navigator?.durationMs,
            )}
            data-navigator-summary-ms={formatDiagnosticNumber(
              rendererMetrics.navigator?.summaryDurationMs,
            )}
            data-navigator-summary-bins={formatDiagnosticInteger(
              rendererMetrics.navigator?.summaryBinCount,
            )}
            data-navigator-window-max={formatDiagnosticNumber(
              rendererMetrics.navigator?.windowMax,
            )}
            data-navigator-window-min={formatDiagnosticNumber(
              rendererMetrics.navigator?.windowMin,
            )}
            data-out-of-range-candidates={formatDiagnosticInteger(
              rendererMetrics.outOfRange?.candidateCount,
            )}
            data-out-of-range-marker-count={formatDiagnosticInteger(
              rendererMetrics.outOfRange?.markerCount,
            )}
            data-out-of-range-ms={formatDiagnosticNumber(
              rendererMetrics.outOfRange?.durationMs,
            )}
            data-x-mode={xMode}
            data-axis={urlState?.axis ?? 'pending'}
            data-heatmap-bin-size-px={String(heatmapBinSizePx)}
            data-held-mode={heldMode ?? 'none'}
            data-mode={
              urlState === null ? 'pending' : normalizeFastScatterRouteMode(urlState.mode)
            }
            data-visualization-mode={visualizationMode}
            data-viewport-a-max={formatDiagnosticNumber(urlState?.viewport.a.max)}
            data-viewport-a-min={formatDiagnosticNumber(urlState?.viewport.a.min)}
            data-viewport-b-max={formatDiagnosticNumber(urlState?.viewport.b.max)}
            data-viewport-b-min={formatDiagnosticNumber(urlState?.viewport.b.min)}
            data-viewport-c-max={formatDiagnosticNumber(urlState?.viewport.c.max)}
            data-viewport-c-min={formatDiagnosticNumber(urlState?.viewport.c.min)}
            data-viewport-x-max={formatDiagnosticNumber(urlState?.viewport.x.max)}
            data-viewport-x-min={formatDiagnosticNumber(urlState?.viewport.x.min)}
            data-testid="scatter-fast-route-diagnostics"
          >
            <DemoSidebarHeader
              links={[
                { icon: 'overview', label: 'Overview', to: createThemeAwareTo('/', searchParams, themeMode) },
              ]}
              title={rendererBackend === 'webgpu' ? 'm-scatter WebGPU' : 'm-scatter'}
            />
            <section className="control-section">
              <h2>Dataset</h2>
              {rendererBackend === 'webgpu' ? (
                <div className="scatter-webgpu-dataset-controls">
                  <div
                    aria-label="WebGPU dataset size"
                    className="segmented-control"
                    data-testid="scatter-webgpu-dataset-size"
                  >
                    {SCATTER_WEBGPU_DEMO_POINT_COUNTS.map((pointCount) => (
                      <button
                        className={webgpuPointCount === pointCount ? 'is-active' : undefined}
                        disabled={datasetState.status === 'generating'}
                        key={pointCount}
                        onClick={() => selectWebgpuPointCount(pointCount)}
                        type="button"
                      >
                        {formatCompactPointCount(pointCount)}
                      </button>
                    ))}
                  </div>
                  <p className="compact-note">
                    Primary table size. The multiple-table demo adds a fixed 1,000-record
                    secondary table with shared and secondary-only columns.
                  </p>
                  <p className="compact-note">
                    Settled point views draw every visible record through one million per
                    subplot. Denser views use a deterministic representative sample;
                    rectangle and lasso selection still evaluate every source record.
                  </p>
                  {!useHttpWebgpuDataset && datasetState.status === 'loaded' ? (
                    <button
                      className="secondary-link"
                      data-testid="scatter-webgpu-delete-dataset"
                      onClick={() => void deleteWebgpuDataset()}
                      type="button"
                    >
                      Delete local dataset
                    </button>
                  ) : null}
                </div>
              ) : null}
              <dl className="metrics-grid">
                <div>
                  <dt>Records</dt>
                  <dd>
                    {datasetState.status === 'loaded'
                      ? formatCount(plottedDataset?.columns.x.length ?? 0)
                      : 'loading'}
                  </dd>
                </div>
                <div>
                  <dt>Tables</dt>
                  <dd>
                    {datasetState.status === 'loaded'
                      ? `${datasetState.tableMetadata?.tableCount ?? 1} (${tableMode})`
                      : tableMode}
                  </dd>
                </div>
                <div>
                  <dt>Plots</dt>
                  <dd>{plottedDataset?.spec.plots.length ?? 'pending'}</dd>
                </div>
                <div>
                  <dt>Display</dt>
                  <dd>{visualizationMode}</dd>
                </div>
              </dl>
            </section>
            <section className="control-section scatter-fast-display-controls">
              <h2>Display</h2>
              <div className="scatter-fast-control-stack">
                <div className="scatter-fast-display-mode-control">
                  <span id="scatter-fast-plot-mode-label">Plot mode</span>
                  <div
                    aria-labelledby="scatter-fast-plot-mode-label"
                    className="segmented-control scatter-fast-plot-mode-radio-group"
                    data-testid="scatter-fast-visualization-mode-select"
                    role="radiogroup"
                  >
                    {FAST_SCATTER_VISUALIZATION_MODE_OPTIONS.map((option) => (
                      <label
                        className={
                          visualizationMode === option.value ? 'is-active' : undefined
                        }
                        data-disabled={
                          plottedDataset === null ? 'true' : undefined
                        }
                        key={option.value}
                      >
                        <input
                          checked={visualizationMode === option.value}
                          disabled={plottedDataset === null}
                          name="scatter-fast-visualization-mode"
                          onChange={() => updateVisualizationMode(option.value)}
                          type="radio"
                          value={option.value}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                {rendererBackend === 'webgpu' ? (
                  <div className="scatter-fast-display-mode-control">
                    <span id="scatter-fast-aggregation-backend-label">
                      Aggregation backend
                    </span>
                    <div
                      aria-labelledby="scatter-fast-aggregation-backend-label"
                      className="segmented-control scatter-fast-plot-mode-radio-group"
                      data-testid="scatter-fast-aggregation-backend-select"
                      role="radiogroup"
                    >
                      {FAST_SCATTER_WEBGPU_AGGREGATION_BACKEND_OPTIONS.map((option) => (
                        <label
                          className={
                            webgpuAggregationBackend === option.value
                              ? 'is-active'
                              : undefined
                          }
                          key={option.value}
                        >
                          <input
                            checked={webgpuAggregationBackend === option.value}
                            name="scatter-fast-aggregation-backend"
                            onChange={() => updateWebgpuAggregationBackend(option.value)}
                            type="radio"
                            value={option.value}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                    <div
                      aria-live="polite"
                      className="scatter-fast-aggregation-backend-indicator"
                      data-backend={activeWebgpuAggregationBackend ?? 'pending'}
                      data-testid="scatter-fast-aggregation-backend-active-indicator"
                      role="status"
                    >
                      <span aria-hidden="true" />
                      {visualizationMode === 'points'
                        ? 'Inactive in Scatter mode'
                        : activeWebgpuAggregationBackend === null
                          ? 'Starting aggregation…'
                          : activeWebgpuAggregationBackend === 'rust-wasm'
                            ? 'Running now: Rust/WASM'
                            : activeWebgpuAggregationBackend === 'typescript' &&
                                webgpuAggregationBackend !== 'typescript'
                              ? 'Running now: TypeScript fallback'
                              : activeWebgpuAggregationBackend === 'typescript'
                                ? 'Running now: TypeScript'
                                : 'Running now: external aggregation'}
                    </div>
                    <small>
                      Bubble and heat-map aggregation only. Auto and Rust/WASM prefer
                      WebAssembly with an exact TypeScript fallback.
                    </small>
                  </div>
                ) : null}
                {visualizationMode === 'heatmap' ? (
                  <div className="scatter-fast-context-controls">
                    <label className="scatter-fast-heatmap-palette-control">
                      <span>Palette</span>
                      <select
                        aria-label="Heat-map color palette"
                        data-testid="scatter-fast-heatmap-palette"
                        disabled={plottedDataset === null}
                        onChange={(event) =>
                          updateHeatmapPalette(
                            parseFastScatterHeatmapPaletteValue(
                              event.currentTarget.value,
                            ),
                          )
                        }
                        value={heatmapPalette}
                      >
                        {FAST_SCATTER_HEATMAP_PALETTES.map((palette) => (
                          <option key={palette} value={palette}>
                            {formatHeatmapPaletteLabel(palette)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div
                      aria-label="m-scatter heat-map bin size"
                      className="scatter-fast-heatmap-bin-control"
                      data-active="true"
                      data-testid="scatter-fast-heatmap-bin-control"
                    >
                      <label
                        className="scatter-fast-heatmap-bin-slider"
                        data-testid="scatter-fast-heatmap-bin-slider-shell"
                      >
                        <span
                          className="scatter-fast-heatmap-bin-value"
                          data-testid="scatter-fast-heatmap-bin-size"
                        >{`Heat ${formatHeatmapBinSizeLabel(heatmapBinSizePx)}`}</span>
                        <input
                          aria-label="Heat-map bin size"
                          data-testid="scatter-fast-heatmap-bin-input"
                          disabled={plottedDataset === null}
                          max={MAX_FAST_SCATTER_HEATMAP_BIN_SIZE_PX}
                          min={MIN_FAST_SCATTER_HEATMAP_BIN_SIZE_PX}
                          onChange={(event) =>
                            updateHeatmapBinSizePx(
                              Number.parseInt(event.currentTarget.value, 10),
                            )
                          }
                          step={FAST_SCATTER_HEATMAP_BIN_SIZE_STEP_PX}
                          type="range"
                          value={heatmapBinSizePx}
                        />
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
            <section className="control-section scatter-fast-view-controls">
              <h2>Axes</h2>
              <div className="scatter-fast-control-stack" data-testid="scatter-fast-toolbar">
                <label className="scatter-fast-x-axis-control">
                  <span>X axis</span>
                  <select
                    aria-label="m-scatter x axis"
                    data-testid="scatter-fast-x-axis"
                    disabled={plottedDataset === null || xAxisOptions.length <= 1}
                    onChange={(event) => updateXAxisKey(event.currentTarget.value)}
                    value={xAxisKey ?? xAxisOptions[0]?.key ?? ''}
                  >
                    {xAxisOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div
                  aria-label="m-scatter x mode"
                  className="segmented-control axis-control"
                  role="group"
                >
                  {(['value', 'index'] as const).map((option) => (
                    <button
                      aria-label={option === 'value' ? 'X values' : 'X index'}
                      className={xMode === option ? 'is-active' : ''}
                      disabled={plottedDataset === null}
                      key={option}
                      onClick={() => updateXMode(option)}
                      type="button"
                    >
                      <span>{option === 'value' ? 'X values' : 'X index'}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
            <section className="control-section">
              <h2>Viewport</h2>
              <div className="scatter-fast-viewport-controls">
                <div className="scatter-fast-viewport-group">
                  <span className="scatter-fast-viewport-group-label">Subplot size</span>
                  <div
                    aria-label="m-scatter subplot size controls"
                    className="scatter-fast-focus-controls"
                  >
                    <button
                      className={focusedPlotId === null ? 'is-active' : ''}
                      data-testid="scatter-fast-focus-all"
                      onClick={() => setFocusedPlotId(null)}
                      type="button"
                    >
                      All
                    </button>
                    {plottedDataset !== null
                      ? plottedDataset.spec.plots.map((plot) => (
                          <button
                            className={focusedPlotId === plot.id ? 'is-active' : ''}
                            data-testid={`scatter-fast-focus-${plot.id}`}
                            key={plot.id}
                            onClick={() =>
                              setFocusedPlotId((current) =>
                                current === plot.id ? null : plot.id,
                              )
                            }
                            type="button"
                          >
                            {plot.label}
                          </button>
                        ))
                      : null}
                  </div>
                </div>
                <div className="scatter-fast-viewport-group">
                  <button
                    aria-label="Reset viewport"
                    className="secondary-link scatter-fast-reset-button"
                    data-testid="scatter-fast-reset-viewport"
                    disabled={
                      urlState === null ||
                      defaultViewport === null ||
                      defaultFastViewport === null
                    }
                    onClick={resetViewport}
                    type="button"
                  >
                    Reset viewport
                  </button>
                </div>
              </div>
            </section>
            <InteractionCheatSheet
              groups={SCATTER_SHORTCUT_GROUPS}
              tryItems={SCATTER_TRY_THIS_ITEMS}
            />
            <section className="control-section">
              <h2>Current selection</h2>
              <dl className="selection-grid">
                <div>
                  <dt>Selected</dt>
                  <dd>{formatMaybeCount(selectedState?.selectedCount)}</dd>
                </div>
                {selectedState !== null && selectedState.selectedCount > 0 ? (
                  <div>
                    <dt>Sample IDs</dt>
                    <dd>{formatIdSample(selectedState.sampleIds)}</dd>
                  </div>
                ) : null}
              </dl>
              {selectedState === null ? (
                <p className="compact-note">Selection state is loading.</p>
              ) : selectedState.selectedCount === 0 ? (
                <p className="compact-note">
                  Right-drag over points to select records.
                </p>
              ) : (
                <div className="button-row">
                  <button onClick={clearSelectedSourceIndices} type="button">
                    Clear selection
                  </button>
                  <button onClick={handleCopySelectedIds} type="button">
                    Copy selected IDs
                  </button>
                  <button onClick={handleDownloadSelectedRecords} type="button">
                    Download selected records
                  </button>
                </div>
              )}
            </section>
            <section className="control-section scatter-fast-debug-panels">
              <details className="control-disclosure route-advanced-diagnostics">
                <summary>
                  <h2>Advanced diagnostics</h2>
                </summary>
                <div className="control-disclosure-body">
              <details
                className="control-disclosure"
                data-testid="scatter-fast-renderer-diagnostics"
              >
                <summary>Renderer diagnostics</summary>
                <div className="control-disclosure-body">
              <dl className="diagnostic-list">
                <div>
                  <dt>Status</dt>
                  <dd>{datasetState.status}</dd>
                </div>
                <div>
                  <dt>Renderer</dt>
                  <dd>{rendererBackend === 'webgpu' ? 'WebGPU points' : 'WebGL2 points'}</dd>
                </div>
                <div>
                  <dt>Render mode</dt>
                  <dd data-testid="scatter-fast-requested-rendering-mode">
                    {renderMetricDetail?.renderPolicy?.requestedRenderingMode ??
                      renderingMode}
                  </dd>
                </div>
                <div>
                  <dt>Effective render</dt>
                  <dd data-testid="scatter-fast-effective-rendering-mode">
                    {renderMetricDetail?.renderPolicy?.effectiveRenderingMode ??
                      'pending'}
                  </dd>
                </div>
                <div>
                  <dt>Display mode</dt>
                  <dd data-testid="scatter-fast-visualization-mode">
                    {visualizationMode}
                  </dd>
                </div>
                <div>
                  <dt>Heat bins</dt>
                  <dd data-testid="scatter-fast-heatmap-bin-size-diagnostics">
                    {formatHeatmapBinSizeLabel(heatmapBinSizePx)}
                  </dd>
                </div>
                <div>
                  <dt>Aggregate status</dt>
                  <dd data-testid="scatter-fast-aggregate-status">
                    {visualizationMode === 'points'
                      ? 'points'
                      : renderMetricDetail?.aggregate === undefined
                        ? 'pending'
                        : 'ready'}
                  </dd>
                </div>
                {rendererBackend === 'webgpu' ? (
                  <>
                    <div>
                      <dt>Aggregate requested</dt>
                      <dd data-testid="scatter-fast-aggregate-backend-preference">
                        {webgpuAggregationBackend}
                      </dd>
                    </div>
                    <div>
                      <dt>Aggregate active</dt>
                      <dd data-testid="scatter-fast-aggregate-backend-active">
                        {renderMetricDetail?.aggregate?.backend ??
                          (visualizationMode === 'points' ? 'not applicable' : 'pending')}
                      </dd>
                    </div>
                  </>
                ) : null}
                <div>
                  <dt>Aggregate total</dt>
                  <dd data-testid="scatter-fast-aggregate-count">
                    {renderMetrics?.aggregateCount === undefined
                      ? 'pending'
                      : formatCount(renderMetrics.aggregateCount)}
                  </dd>
                </div>
                <div>
                  <dt>Heatmap cells</dt>
                  <dd data-testid="scatter-fast-aggregate-cell-count">
                    {renderMetrics?.cellCount === undefined
                      ? 'pending'
                      : `${formatCount(renderMetrics.cellCount)} / ${formatCount(
                          renderMetrics.populatedCellCount ?? 0,
                        )}`}
                  </dd>
                </div>
                <div>
                  <dt>Aggregate build</dt>
                  <dd data-testid="scatter-fast-aggregate-build-ms">
                    {formatDuration(renderMetricDetail?.aggregate?.aggregateBuildMs ?? null)}
                  </dd>
                </div>
                <div>
                  <dt>Aggregate upload</dt>
                  <dd data-testid="scatter-fast-aggregate-upload-bytes">
                    {renderMetrics?.uploadBytes === undefined
                      ? 'pending'
                      : formatBytes(renderMetrics.uploadBytes)}
                  </dd>
                </div>
                <div>
                  <dt>Aggregate execution</dt>
                  <dd data-testid="scatter-fast-aggregate-worker-mode">
                    {currentAggregateControllerMetrics?.mode ?? 'pending'}
                    {' / '}
                    {formatDuration(
                      currentAggregateControllerMetrics?.transferMs ?? null,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>User size</dt>
                  <dd data-testid="scatter-fast-user-point-size-scale">
                    {formatPointSizeScaleLabel(pointSizeScale)}
                  </dd>
                </div>
                <div>
                  <dt>User opacity</dt>
                  <dd data-testid="scatter-fast-user-opacity-scale">
                    {formatOpacityScaleLabel(opacityScale)}
                  </dd>
                </div>
                <div>
                  <dt>Effective size</dt>
                  <dd data-testid="scatter-fast-effective-point-size-scale">
                    {renderMetricDetail?.renderPolicy?.effectivePointSizeScale ===
                    undefined
                      ? 'pending'
                      : formatPointSizeScaleLabel(
                          renderMetricDetail.renderPolicy.effectivePointSizeScale,
                        )}
                  </dd>
                </div>
                <div>
                  <dt>Render state</dt>
                  <dd>{rendererState.status}</dd>
                </div>
                <div>
                  <dt>Last redraw</dt>
                  <dd>{formatDuration(renderMetrics?.durationMs ?? null)}</dd>
                </div>
                <div>
                  <dt>GPU timer</dt>
                  <dd data-testid="scatter-fast-gpu-timer">
                    {formatGpuTimerState(rendererMetrics.setup?.gpuTimerSupported)}
                  </dd>
                </div>
                <div>
                  <dt>GPU redraw</dt>
                  <dd data-testid="scatter-fast-redraw-gpu">
                    {formatDuration(rendererMetrics.redraw?.gpuDurationMs ?? null)}
                  </dd>
                </div>
                <div>
                  <dt>Draw calls</dt>
                  <dd data-testid="scatter-fast-draw-calls">
                    {renderMetrics?.drawCalls ?? 'pending'}
                  </dd>
                </div>
                <div>
                  <dt>Subplots</dt>
                  <dd data-testid="scatter-fast-subplot-count">
                    {renderMetrics?.subplotCount ?? 'pending'}
                  </dd>
                </div>
                <div>
                  <dt>Source buffers</dt>
                  <dd data-testid="scatter-fast-source-buffers">
                    {renderMetricDetail?.sharedSourceBuffers === true
                      ? 'shared'
                      : 'pending'}
                  </dd>
                </div>
                <div>
                  <dt>Visible points</dt>
                  <dd data-testid="scatter-fast-visible-points">
                    {formatMaybeCount(renderMetrics?.visiblePointCount)}
                  </dd>
                </div>
                <div>
                  <dt>Selected</dt>
                  <dd data-testid="scatter-fast-selected-count">
                    {formatMaybeCount(selectedState?.selectedCount)}
                  </dd>
                </div>
                <div>
                  <dt>Selection sample</dt>
                  <dd data-testid="scatter-fast-selected-id-sample">
                    {selectedState === null
                      ? 'pending'
                      : formatIdSample(selectedState.sampleIds)}
                  </dd>
                </div>
                <div>
                  <dt>Record export</dt>
                  <dd data-testid="scatter-fast-selected-record-export">
                    {rendererMetrics.selectedRecordExport === null
                      ? 'pending'
                      : `${rendererMetrics.selectedRecordExport.mode} ${rendererMetrics.selectedRecordExport.status}: ${formatDuration(
                          rendererMetrics.selectedRecordExport.durationMs,
                        )}, ${formatCount(
                          rendererMetrics.selectedRecordExport.recordCount,
                        )} records`}
                  </dd>
                </div>
                <div>
                  <dt>Selected overlay</dt>
                  <dd data-testid="scatter-fast-selected-overlay-update">
                    {formatDuration(rendererMetrics.selectedOverlay?.durationMs ?? null)}
                  </dd>
                </div>
                <div>
                  <dt>Selected mask</dt>
                  <dd data-testid="scatter-fast-selected-mask-update">
                    {formatDuration(rendererMetrics.selectedOverlay?.maskBuildMs ?? null)}
                    {' / '}
                    {formatDuration(
                      rendererMetrics.selectedOverlay?.maskGpuUploadMs ?? null,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Selection execution</dt>
                  <dd data-testid="scatter-fast-selection-worker-path">
                    {latestSelectionMetrics === null
                      ? 'pending'
                      : `${latestSelectionMetrics.mode}: ${formatDuration(
                          latestSelectionMetrics.computeMs,
                        )}, ${formatMaybeCount(
                          latestSelectionMetrics.candidateCount,
                        )} candidates`}
                  </dd>
                </div>
                <div>
                  <dt>Hover source</dt>
                  <dd data-testid="scatter-fast-hover-source-index">
                    {hoverSourceIndex === null ? 'none' : hoverSourceIndex}
                  </dd>
                </div>
                <div>
                  <dt>Hover overlay</dt>
                  <dd data-testid="scatter-fast-hover-overlay-update">
                    {formatDuration(rendererMetrics.hoverOverlay?.durationMs ?? null)}
                  </dd>
                </div>
                <div>
                  <dt>Hover lookup</dt>
                  <dd data-testid="scatter-fast-hover-lookup">
                    {rendererMetrics.hoverLookup === null
                      ? 'pending'
                      : `${rendererMetrics.hoverLookup.source}: ${formatDuration(
                          rendererMetrics.hoverLookup.durationMs,
                        )}, ${rendererMetrics.hoverLookup.candidateCount} candidates`}
                  </dd>
                </div>
                <div>
                  <dt>Measure active</dt>
                  <dd data-testid="scatter-fast-measurement-active">
                    {measurementInspection === null ? 'no' : 'yes'}
                  </dd>
                </div>
                <div>
                  <dt>Measure ref</dt>
                  <dd data-testid="scatter-fast-measurement-reference-source-index">
                    {measurementInspection === null
                      ? 'none'
                      : measurementInspection.reference.sourceIndex}
                  </dd>
                </div>
                <div>
                  <dt>Measure fields</dt>
                  <dd data-testid="scatter-fast-measurement-current-field-count">
                    {measurementFieldCount}
                  </dd>
                </div>
                <div>
                  <dt>Measure timing</dt>
                  <dd data-testid="scatter-fast-measurement-update">
                    {formatDuration(rendererMetrics.measurement?.durationMs ?? null)}
                  </dd>
                </div>
                <div>
                  <dt>Wheel zoom</dt>
                  <dd data-testid="scatter-fast-wheel-zoom-update">
                    {formatDuration(rendererMetrics.wheelZoom?.durationMs ?? null)}
                  </dd>
                </div>
                <div>
                  <dt>Rectangle zoom</dt>
                  <dd data-testid="scatter-fast-rectangle-zoom-update">
                    {formatDuration(rendererMetrics.rectangleZoom?.durationMs ?? null)}
                  </dd>
                </div>
                <div>
                  <dt>Rectangle select</dt>
                  <dd data-testid="scatter-fast-rectangle-selection-update">
                    {formatDuration(
                      rendererMetrics.rectangleSelection?.durationMs ?? null,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Rect select path</dt>
                  <dd data-testid="scatter-fast-rectangle-selection-path">
                    {formatSelectionPath(rendererMetrics.rectangleSelection)}
                  </dd>
                </div>
                <div>
                  <dt>Lasso select</dt>
                  <dd data-testid="scatter-fast-lasso-selection-update">
                    {formatDuration(rendererMetrics.lassoSelection?.durationMs ?? null)}
                  </dd>
                </div>
                <div>
                  <dt>Lasso path</dt>
                  <dd data-testid="scatter-fast-lasso-selection-path-metrics">
                    {formatSelectionPath(rendererMetrics.lassoSelection)}
                  </dd>
                </div>
                <div>
                  <dt>Drag pan</dt>
                  <dd data-testid="scatter-fast-drag-pan-update">
                    {formatDuration(rendererMetrics.dragPan?.durationMs ?? null)}
                  </dd>
                </div>
                <div>
                  <dt>Navigator</dt>
                  <dd data-testid="scatter-fast-navigator-drag-update">
                    {formatDuration(rendererMetrics.navigator?.durationMs ?? null)}
                  </dd>
                </div>
                <div>
                  <dt>Mode</dt>
                  <dd>{effectiveMode}</dd>
                </div>
                <div>
                  <dt>Held mode</dt>
                  <dd>{heldMode ?? 'none'}</dd>
                </div>
                <div>
                  <dt>Axis</dt>
                  <dd>{urlState?.axis ?? 'pending'}</dd>
                </div>
                <div>
                  <dt>Alpha policy</dt>
                  <dd data-testid="scatter-fast-alpha-policy">
                    {renderMetricDetail?.renderPolicy?.mode ?? 'pending'}
                  </dd>
                </div>
                <div>
                  <dt>Alpha scale</dt>
                  <dd>
                    {formatMaybeNumber(renderMetricDetail?.renderPolicy?.alphaScale)}
                  </dd>
                </div>
                <div>
                  <dt>Effective opacity</dt>
                  <dd data-testid="scatter-fast-effective-opacity-scale">
                    {formatMaybeNumber(
                      renderMetricDetail?.renderPolicy?.effectiveOpacityScale,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Point density</dt>
                  <dd>
                    {formatMaybeNumber(
                      renderMetricDetail?.renderPolicy?.densityPointsPerPixel,
                    )}
                    {' pts/px'}
                  </dd>
                </div>
              </dl>
                </div>
              </details>
              <details
                className="control-disclosure"
                data-testid="scatter-fast-selection-diagnostics"
              >
                <summary>Selection export</summary>
                <div className="control-disclosure-body">
              <dl className="diagnostic-list">
                <div>
                  <dt>Selected</dt>
                  <dd data-testid="scatter-fast-selection-panel-count">
                    {formatMaybeCount(selectedState?.selectedCount)}
                  </dd>
                </div>
                <div>
                  <dt>Sample IDs</dt>
                  <dd data-testid="scatter-fast-selection-panel-id-sample">
                    {selectedState === null
                      ? 'pending'
                      : formatIdSample(selectedState.sampleIds)}
                  </dd>
                </div>
                <div>
                  <dt>Execution path</dt>
                  <dd data-testid="scatter-fast-selection-panel-worker-path">
                    {latestSelectionMetrics?.mode ?? 'pending'}
                  </dd>
                </div>
                <div>
                  <dt>Candidates</dt>
                  <dd data-testid="scatter-fast-selection-panel-candidates">
                    {formatMaybeCount(latestSelectionMetrics?.candidateCount)}
                  </dd>
                </div>
                <div>
                  <dt>Compute / transfer</dt>
                  <dd data-testid="scatter-fast-selection-panel-worker-timing">
                    {formatDuration(latestSelectionMetrics?.computeMs ?? null)}
                    {' / '}
                    {formatDuration(latestSelectionMetrics?.transferMs ?? null)}
                  </dd>
                </div>
                <div>
                  <dt>Export</dt>
                  <dd data-testid="scatter-fast-selection-panel-export">
                    {rendererMetrics.selectedRecordExport === null
                      ? 'pending'
                      : `${rendererMetrics.selectedRecordExport.status}, ${formatDuration(
                          rendererMetrics.selectedRecordExport.durationMs,
                        )}`}
                  </dd>
                </div>
              </dl>
                </div>
              </details>
              <details
                className="control-disclosure"
                data-testid="scatter-fast-selection-filter-preview"
              >
                <summary>Selection callback payload</summary>
                <div className="control-disclosure-body">
                  <pre className="compact-code-block">
                    <code>{selectionCallbackPreview}</code>
                  </pre>
                </div>
              </details>
              <details
                className="control-disclosure"
                data-testid="scatter-fast-dataset-diagnostics"
              >
                <summary>Dataset diagnostics</summary>
                <div className="control-disclosure-body">
              <dl className="diagnostic-list">
                <div>
                  <dt>Source</dt>
                  <dd>
                    {datasetState.status === 'loaded'
                      ? datasetState.sourceUrl
                      : SCATTER_FAST_DATASET_URL}
                  </dd>
                </div>
                <div>
                  <dt>Format</dt>
                  <dd data-testid="scatter-fast-dataset-source-format">
                    {datasetState.status === 'loaded'
                      ? datasetState.sourceFormat
                      : 'pending'}
                  </dd>
                </div>
                <div>
                  <dt>Table mode</dt>
                  <dd data-testid="scatter-fast-table-mode">{tableMode}</dd>
                </div>
                <div>
                  <dt>Table records</dt>
                  <dd data-testid="scatter-fast-table-record-counts">
                    {datasetState.status === 'loaded'
                      ? formatScatterTableRecordCounts(
                          datasetState.tableMetadata?.tableRecordCounts,
                        )
                      : 'none'}
                  </dd>
                </div>
                <div>
                  <dt>Records</dt>
                  <dd data-testid="scatter-fast-dataset-record-count">
                    {datasetState.status === 'loaded'
                      ? formatCount(plottedDataset?.columns.x.length ?? 0)
                      : 'pending'}
                  </dd>
                </div>
                <div>
                  <dt>Fetch</dt>
                  <dd data-testid="scatter-fast-dataset-fetch-ms">
                    {formatDuration(
                      datasetState.status === 'loaded' ? datasetState.fetchMs : null,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Parse</dt>
                  <dd data-testid="scatter-fast-dataset-parse-ms">
                    {formatDuration(
                      datasetState.status === 'loaded' ? datasetState.parseMs : null,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Total load</dt>
                  <dd data-testid="scatter-fast-dataset-load-ms">
                    {formatDuration(
                      datasetState.status === 'loaded' ? datasetState.loadTimeMs : null,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Buffer build</dt>
                  <dd data-testid="scatter-fast-buffer-build-ms">
                    {formatDuration(
                      datasetState.status === 'loaded'
                        ? datasetState.bufferBuildMetrics.buildMs
                        : null,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Buffer memory</dt>
                  <dd data-testid="scatter-fast-buffer-memory">
                    {datasetState.status === 'loaded'
                      ? formatBytes(datasetState.bufferBuildMetrics.byteLength)
                      : 'pending'}
                  </dd>
                </div>
                <div>
                  <dt>Buffer rows / y</dt>
                  <dd data-testid="scatter-fast-buffer-shape">
                    {datasetState.status === 'loaded'
                      ? `${formatCount(
                          datasetState.bufferBuildMetrics.recordCount,
                        )} / ${datasetState.bufferBuildMetrics.yKeyCount}`
                      : 'pending'}
                  </dd>
                </div>
                <div>
                  <dt>GPU upload</dt>
                  <dd data-testid="scatter-fast-upload-ms">
                    {formatDuration(rendererMetrics.upload?.durationMs ?? null)}
                  </dd>
                </div>
                <div>
                  <dt>Upload bytes</dt>
                  <dd data-testid="scatter-fast-upload-bytes">
                    {rendererMetrics.upload === null
                      ? 'pending'
                      : formatBytes(rendererMetrics.upload.uploadBytes)}
                  </dd>
                </div>
                <div>
                  <dt>Shader compile/link</dt>
                  <dd data-testid="scatter-fast-shader-ms">
                    {formatDuration(rendererMetrics.setup?.shaderCompileMs ?? null)}
                    {' / '}
                    {formatDuration(rendererMetrics.setup?.linkMs ?? null)}
                  </dd>
                </div>
              </dl>
                </div>
              </details>
              <details
                className="control-disclosure"
                data-testid="scatter-fast-viewport-diagnostics"
              >
                <summary>Viewport ranges</summary>
                <div className="control-disclosure-body">
              <dl className="diagnostic-list">
                <div>
                  <dt>X</dt>
                  <dd>{formatRange(urlState?.viewport.x)}</dd>
                </div>
                {SCATTER_Y_ATTRIBUTES.map((attribute) => (
                  <div key={attribute}>
                    <dt>{PLOT_LABELS[attribute]}</dt>
                    <dd>{formatRange(urlState?.viewport[attribute])}</dd>
                  </div>
                ))}
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

async function loadWebgpuScatterDataset(
  startedAt: number,
  pointCount: number,
  signal: AbortSignal,
  source: 'http' | 'indexeddb',
  secondaryFixtureUrl: string | null,
): Promise<Omit<LoadedDatasetState, 'status'>> {
  const primaryPromise = source === 'http'
    ? loadPagedWebgpuScatterDataset(
        startedAt,
        pointCount,
        signal,
        undefined,
        secondaryFixtureUrl === null,
      )
    : loadStoredWebgpuScatterDataset(
        startedAt,
        pointCount,
        signal,
        secondaryFixtureUrl === null,
      );
  if (secondaryFixtureUrl === null) {
    return primaryPromise;
  }
  const primary = await primaryPromise;
  const secondary = await loadMixedTableFastScatterDataset(
    startedAt,
    secondaryFixtureUrl,
  );
  return appendSecondaryTableToWebgpuDataset(primary, secondary);
}

function parseRenderMetricDetail(
  metrics: FastScatterMetricsEvent | null,
): {
  aggregate?: {
    aggregateBuildMs: number;
    aggregateDrawCalls: number;
    backend?: 'external' | 'rust-wasm' | 'typescript';
    displayMode: FastScatterVisualizationMode;
    totalAggregateCount: number;
    totalCellCount: number;
    totalPopulatedCellCount: number;
    totalVisiblePointCount: number;
    uploadBytes: number;
  } | null;
  renderPolicy?: {
    alphaScale: number;
    blendMode: string;
    densityPointsPerPixel: number;
    effectiveOpacityScale: number;
    effectivePointSizeScale: number;
    effectiveRenderingMode: string;
    mode: FastScatterAlphaMode;
    pointSizeScale: number;
    renderingPolicy: string;
    requestedRenderingMode: FastScatterRenderingMode;
    userOpacityScale: number;
    userPointSizeScale: number;
  };
  sharedSourceBuffers?: boolean;
} | null {
  if (metrics?.detail === undefined) {
    return null;
  }

  try {
    return JSON.parse(metrics.detail) as { sharedSourceBuffers?: boolean };
  } catch {
    return null;
  }
}

function createInitialRendererMetrics(): RendererMetricsState {
  return {
    aggregateController: null,
    dragPan: null,
    firstCanvasRender: null,
    hoverOverlay: null,
    hoverLookup: null,
    lassoSelection: null,
    measurement: null,
    navigator: null,
    outOfRange: null,
    rectangleZoom: null,
    rectangleSelection: null,
    redraw: null,
    selectedRecordExport: null,
    selectedOverlay: null,
    setup: null,
    upload: null,
    wheelZoom: null,
  };
}

function updateRendererMetrics(
  previous: RendererMetricsState,
  metrics: FastScatterMetricsEvent,
): RendererMetricsState {
  const detail = parseMetricDetail(metrics.detail);

  if (metrics.phase === 'init') {
    return {
      ...previous,
      setup: {
        durationMs: metrics.durationMs ?? 0,
        gpuTimerSupported: metrics.gpuTimerSupported ?? false,
        linkMs: readNumber(detail.linkMs),
        shaderCompileMs: readNumber(detail.shaderCompileMs),
      },
    };
  }

  if (metrics.phase === 'buffer-upload') {
    return {
      ...previous,
      upload: {
        bufferCount: readNumber(detail.bufferCount),
        durationMs: metrics.durationMs ?? 0,
        uploadBytes: readNumber(detail.uploadBytes),
      },
    };
  }

  if (metrics.phase === 'render') {
    const aggregateDetail =
      detail.aggregate !== null &&
      typeof detail.aggregate === 'object' &&
      !Array.isArray(detail.aggregate)
        ? (detail.aggregate as Record<string, unknown>)
        : null;
    const hoverOverlay =
      detail.hoverOverlay !== null &&
      typeof detail.hoverOverlay === 'object' &&
      !Array.isArray(detail.hoverOverlay)
        ? (detail.hoverOverlay as Record<string, unknown>)
        : null;
    return {
      ...previous,
      firstCanvasRender:
        previous.firstCanvasRender === null
          ? {
              delayMs: readNumber(detail.firstCanvasRenderScheduleMs),
              drawCalls: metrics.drawCalls ?? readNumber(detail.drawCalls),
              visiblePointCount:
                metrics.visiblePointCount ?? readNumber(detail.visiblePointCount),
            }
          : previous.firstCanvasRender,
      hoverOverlay:
        hoverOverlay === null
          ? previous.hoverOverlay
          : {
              drawCalls: readNumber(hoverOverlay.drawCalls),
              durationMs: previous.hoverOverlay?.durationMs ?? 0,
              sourceIndex: readOptionalNumber(hoverOverlay.sourceIndex) ?? null,
              uploadBytes: previous.hoverOverlay?.uploadBytes ?? 0,
            },
      aggregateController:
        aggregateDetail?.displayMode === 'bubble'
          ? {
              aggregateMode: 'bubble',
              durationMs: metrics.durationMs ?? readNumber(detail.cpuDurationMs),
              mode: 'sync',
              transferMs: 0,
            }
          : previous.aggregateController,
      redraw: {
        cacheBytes: readNumber(detail.cacheBytes),
        cachedInteractionFrame: detail.cachedInteractionFrame === true,
        coalescedFrameCount: readNumber(detail.coalescedFrameCount),
        cpuDurationMs: metrics.durationMs ?? readNumber(detail.cpuDurationMs),
        estimatedPeakBytes: readNumber(detail.estimatedPeakBytes),
        gpuDurationMs:
          metrics.gpuDurationMs ?? readOptionalNumber(detail.gpuDurationMs) ??
          previous.redraw?.gpuDurationMs,
        residentBytes: readNumber(detail.residentBytes),
        submittedFrameCount: readNumber(detail.submittedFrameCount),
      },
    };
  }

  if (metrics.phase === 'interaction' && detail.operation === 'aggregate-controller') {
    const aggregateMode =
      detail.aggregateMode === 'heatmap' ? 'heatmap' : 'bubble';
    return {
      ...previous,
      aggregateController: {
        aggregateMode,
        durationMs: metrics.durationMs ?? 0,
        mode:
          detail.executionMode === 'worker'
            ? 'worker'
            : 'sync',
        transferMs: readNumber(detail.transferMs),
      },
    };
  }

  if (
    metrics.phase === 'selection' &&
    detail.operation === 'selected-mask-overlay'
  ) {
    return {
      ...previous,
      selectedOverlay: {
        durationMs: metrics.durationMs ?? 0,
        maskBuildMs: readNumber(detail.maskBuildMs),
        maskGpuUploadMs: readNumber(detail.maskGpuUploadMs),
        selectedPointCount: metrics.selectedPointCount ?? readNumber(detail.selectedPointCount),
        uploadBytes: readNumber(detail.uploadBytes),
      },
    };
  }

  if (metrics.phase === 'selection' && detail.operation === 'lasso-selection') {
    return {
      ...previous,
      lassoSelection: {
        candidateCount: readNumber(detail.candidateCount),
        computeMs: readNumber(detail.computeMs),
        durationMs: metrics.durationMs ?? 0,
        lassoPointCount: readNumber(detail.lassoPointCount),
        mode: String(detail.mode ?? 'unknown'),
        observableMs: readNumber(detail.observableMs),
        plotId: String(detail.plotId ?? 'unknown'),
        sampleIds: readStringArray(detail.sampleIds),
        selectedCount: metrics.selectedPointCount ?? readNumber(detail.selectedCount),
        transferMs: readNumber(detail.transferMs),
      },
    };
  }

  if (metrics.phase === 'selection' && detail.operation === 'rectangle-selection') {
    return {
      ...previous,
      rectangleSelection: {
        candidateCount: readNumber(detail.candidateCount),
        computeMs: readNumber(detail.computeMs),
        durationMs: metrics.durationMs ?? 0,
        mode: String(detail.mode ?? 'unknown'),
        observableMs: readNumber(detail.observableMs),
        plotId: String(detail.plotId ?? 'unknown'),
        sampleIds: readStringArray(detail.sampleIds),
        selectedCount: metrics.selectedPointCount ?? readNumber(detail.selectedCount),
        transferMs: readNumber(detail.transferMs),
      },
    };
  }

  if (metrics.phase === 'hover' && detail.operation === 'hover-source-index-overlay') {
    return {
      ...previous,
      hoverOverlay: {
        drawCalls: previous.hoverOverlay?.drawCalls ?? 0,
        durationMs: metrics.durationMs ?? 0,
        sourceIndex: readOptionalNumber(detail.sourceIndex) ?? null,
        uploadBytes: readNumber(detail.uploadBytes),
      },
    };
  }

  if (metrics.phase === 'hover' && detail.operation === 'nearest-point-lookup') {
    return {
      ...previous,
      hoverLookup: {
        candidateCount: readNumber(detail.candidateCount),
        distancePx: readOptionalNumber(detail.distancePx) ?? null,
        durationMs: metrics.durationMs ?? 0,
        plotId: typeof detail.plotId === 'string' ? detail.plotId : null,
        source: String(detail.source ?? 'unknown'),
        sourceIndex: readOptionalNumber(detail.sourceIndex) ?? null,
        yKey: typeof detail.yKey === 'string' ? detail.yKey : null,
      },
    };
  }

  if (metrics.phase === 'interaction' && detail.operation === 'wheel-zoom') {
    return {
      ...previous,
      wheelZoom: {
        axisMode: String(detail.axisMode ?? 'unknown'),
        durationMs: metrics.durationMs ?? 0,
        plotId: String(detail.plotId ?? 'unknown'),
        scale: readNumber(detail.scale),
      },
    };
  }

  if (metrics.phase === 'interaction' && detail.operation === 'rectangle-zoom') {
    return {
      ...previous,
      rectangleZoom: {
        axisMode: String(detail.axisMode ?? 'unknown'),
        durationMs: metrics.durationMs ?? 0,
        plotId: String(detail.plotId ?? 'unknown'),
        rectHeight: readNumber(detail.rectHeight),
        rectWidth: readNumber(detail.rectWidth),
      },
    };
  }

  if (metrics.phase === 'interaction' && detail.operation === 'drag-pan') {
    return {
      ...previous,
      dragPan: {
        axisMode: String(detail.axisMode ?? 'unknown'),
        deltaX: readNumber(detail.deltaX),
        deltaY: readNumber(detail.deltaY),
        durationMs: metrics.durationMs ?? 0,
        plotId: String(detail.plotId ?? 'unknown'),
        updateCount: readNumber(detail.updateCount),
      },
    };
  }

  if (metrics.phase === 'interaction' && detail.operation === 'navigator-drag') {
    return {
      ...previous,
      navigator: {
        durationMs: metrics.durationMs ?? 0,
        summaryBinCount: previous.navigator?.summaryBinCount,
        summaryDurationMs: previous.navigator?.summaryDurationMs,
        updateCount: readNumber(detail.updateCount),
        windowMax: readNumber(detail.windowMax),
        windowMin: readNumber(detail.windowMin),
      },
    };
  }

  if (metrics.phase === 'interaction' && detail.operation === 'navigator-summary') {
    return {
      ...previous,
      navigator: {
        durationMs: previous.navigator?.durationMs ?? 0,
        summaryBinCount: readNumber(detail.binCount),
        summaryDurationMs: metrics.durationMs ?? 0,
        updateCount: previous.navigator?.updateCount ?? 0,
        windowMax: previous.navigator?.windowMax ?? 0,
        windowMin: previous.navigator?.windowMin ?? 0,
      },
    };
  }

  if (metrics.phase === 'interaction' && detail.operation === 'out-of-range') {
    return {
      ...previous,
      outOfRange: {
        candidateCount: readNumber(detail.candidateCount),
        durationMs: metrics.durationMs ?? 0,
        markerCount: readNumber(detail.markerCount),
      },
    };
  }

  return previous;
}

function resolveAggregateControllerMetricsForVisualizationMode(
  aggregateController: RendererMetricsState['aggregateController'],
  visualizationMode: FastScatterVisualizationMode,
): RendererMetricsState['aggregateController'] {
  if (visualizationMode === 'points' || aggregateController === null) {
    return null;
  }

  return aggregateController.aggregateMode === visualizationMode
    ? aggregateController
    : null;
}

function parseMetricDetail(detail: string | undefined): Record<string, unknown> {
  if (detail === undefined) {
    return {};
  }

  try {
    const parsed = JSON.parse(detail);
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function convertFastViewportToPrototypeViewport(
  viewport: FastScatterViewport,
  spec: FastScatterPlotSpec,
  fallback: ViewportState,
): ViewportState {
  const nextViewport: ViewportState = {
    ...fallback,
    x: viewport.x,
  };

  for (let index = 0; index < spec.plots.length; index += 1) {
    const plot = spec.plots[index]!;
    const yRange = viewport.yByPlot[plot.id];
    const yKey = getPrototypeViewportYKey(plot.yKey, index);

    if (yRange !== undefined) {
      nextViewport[yKey] = yRange;
    }
  }

  return nextViewport;
}

function parseFastScatterSearchViewport(
  params: URLSearchParams,
  spec: FastScatterPlotSpec,
  defaultViewport: FastScatterViewport,
): FastScatterViewport {
  const x = parseFastScatterRange(params, 'xMin', 'xMax') ?? defaultViewport.x;
  const yByPlot: Record<string, FastScatterRange> = {};

  for (const plot of spec.plots) {
    yByPlot[plot.id] =
      parseFastScatterRange(
        params,
        getFastScatterViewportParamName(plot.id, 'min'),
        getFastScatterViewportParamName(plot.id, 'max'),
      ) ??
      defaultViewport.yByPlot[plot.id] ?? { min: 0, max: 1 };
  }

  return { x, yByPlot };
}

function writeFastScatterSearchState({
  axis,
  baseParams,
  mode,
  setSearchParams,
  spec,
  viewport,
}: {
  axis: InteractionAxis;
  baseParams: URLSearchParams;
  mode: InteractionMode;
  setSearchParams: (
    params: URLSearchParams,
    options: { replace: boolean },
  ) => void;
  spec: FastScatterPlotSpec;
  viewport: FastScatterViewport;
}): void {
  const params = new URLSearchParams(baseParams);

  params.set('mode', mode);
  params.set('axis', axis);
  params.set('xMin', formatViewportParamNumber(viewport.x.min));
  params.set('xMax', formatViewportParamNumber(viewport.x.max));

  for (const attribute of SCATTER_Y_ATTRIBUTES) {
    params.delete(`${attribute}Min`);
    params.delete(`${attribute}Max`);
  }

  for (const plot of spec.plots) {
    const range = viewport.yByPlot[plot.id];
    if (range === undefined) {
      continue;
    }

    params.set(
      getFastScatterViewportParamName(plot.id, 'min'),
      formatViewportParamNumber(range.min),
    );
    params.set(
      getFastScatterViewportParamName(plot.id, 'max'),
      formatViewportParamNumber(range.max),
    );
  }

  if (params.toString() !== baseParams.toString()) {
    setSearchParams(params, { replace: true });
  }
}

function parseFastScatterXMode(params: URLSearchParams): FastScatterXMode {
  return params.get(FAST_SCATTER_X_MODE_PARAM) === 'index'
    ? 'index'
    : DEFAULT_FAST_SCATTER_X_MODE;
}

function parseFastScatterHeatmapPalette(
  params: URLSearchParams,
): FastScatterHeatmapPalette {
  return parseFastScatterHeatmapPaletteValue(
    params.get(FAST_SCATTER_HEATMAP_PALETTE_PARAM),
  );
}

function parseFastScatterHeatmapPaletteValue(
  value: string | null,
): FastScatterHeatmapPalette {
  return normalizeFastScatterHeatmapPalette(
    FAST_SCATTER_HEATMAP_PALETTES.includes(value as FastScatterHeatmapPalette)
      ? (value as FastScatterHeatmapPalette)
      : undefined,
  );
}

function normalizeFastScatterRouteMode(
  mode: InteractionMode | null | undefined,
): InteractionMode {
  return mode === undefined ||
    mode === null ||
    mode === 'zoom' ||
    mode === 'hover' ||
    mode === 'measure'
    ? 'pan'
    : mode;
}

function createFastScatterRouteDatasetForXMode(
  dataset: LoadedFastScatterDataset,
  xMode: FastScatterXMode,
): LoadedFastScatterDataset {
  if (xMode === 'value') {
    return dataset;
  }

  const { columns, spec } = dataset;
  const indexX = Float64Array.from({ length: columns.x.length }, (_, index) => index);
  const sourceXKey = columns.xKey;
  const xKey = columns.xKey ?? '__scatter_fast_route_index_x__';
  const nextColumns: FastScatterDisplayColumns = {
    ...columns,
    axisByColumn:
      {
        ...(columns.axisByColumn ?? {}),
        [xKey]: {
          columnKey: xKey,
          domain:
            indexX.length <= 1
              ? { min: 0, max: 1 }
              : { min: 0, max: indexX.length - 1 },
          indexDisplay: {
            sourceAxis: sourceXKey === undefined ? undefined : columns.axisByColumn?.[sourceXKey],
            sourceValues: columns.x,
          },
          kind: 'numeric',
          parameterName: 'index',
          title: createIndexModeAxisTitle(spec.xLabel),
        } satisfies FastScatterEncodedAxis,
      },
    x: indexX,
    xKey,
  };

  return {
    ...dataset,
    columns: nextColumns,
    hoverIndex: null,
    spec: {
      ...spec,
      xLabel: createIndexModeAxisTitle(spec.xLabel),
    },
  };
}

function createFastScatterRouteDatasetForXAxis(
  dataset: LoadedFastScatterDataset,
  requestedXKey: string | null,
): LoadedFastScatterDataset {
  const options = createFastScatterXAxisOptions(dataset);
  const nextXKey = options.some((option) => option.key === requestedXKey)
    ? requestedXKey
    : dataset.columns.xKey;

  if (nextXKey === null || nextXKey === undefined || nextXKey === dataset.columns.xKey) {
    return dataset;
  }

  const nextXValues = dataset.columns.y[nextXKey];
  if (nextXValues === undefined) {
    return dataset;
  }

  const previousXKey = dataset.columns.xKey ?? '__scatter_fast_source_x__';
  const nextY: Record<string, FastScatterDisplayColumns['x']> = {};
  nextY[previousXKey] = dataset.columns.x;
  for (const [key, values] of Object.entries(dataset.columns.y)) {
    if (key !== nextXKey) {
      nextY[key] = values;
    }
  }

  const axis = dataset.columns.axisByColumn?.[nextXKey];
  const previousAxis = dataset.columns.xKey === undefined
    ? undefined
    : dataset.columns.axisByColumn?.[dataset.columns.xKey];

  return {
    ...dataset,
    columns: {
      ...dataset.columns,
      axisByColumn: {
        ...(dataset.columns.axisByColumn ?? {}),
        ...(previousAxis === undefined ? {} : { [previousXKey]: previousAxis }),
      },
      x: nextXValues,
      xKey: nextXKey,
      xOrder: createRouteXOrder(nextXValues),
      y: nextY,
    },
    hoverIndex: null,
    spec: {
      xLabel: axis?.title ?? nextXKey,
      plots: [
        {
          id: previousXKey,
          label: previousAxis?.title ?? dataset.spec.xLabel,
          yKey: previousXKey,
        },
        ...dataset.spec.plots
          .filter((plot) => plot.yKey !== nextXKey)
          .map((plot) => ({ ...plot })),
      ],
    },
  };
}

function createFastScatterXAxisOptions(
  dataset: LoadedFastScatterDataset,
): readonly { key: string; label: string }[] {
  const options: { key: string; label: string }[] = [];
  const xKey = dataset.columns.xKey;
  if (xKey !== undefined) {
    options.push({
      key: xKey,
      label: dataset.columns.axisByColumn?.[xKey]?.title ?? dataset.spec.xLabel,
    });
  }

  for (const plot of dataset.spec.plots) {
    if (options.some((option) => option.key === plot.yKey)) {
      continue;
    }
    options.push({
      key: plot.yKey,
      label: dataset.columns.axisByColumn?.[plot.yKey]?.title ?? plot.label,
    });
  }

  return options;
}

function parseFastScatterXAxisKey(
  params: URLSearchParams,
  dataset: LoadedFastScatterDataset,
): string | null {
  const requested = params.get(FAST_SCATTER_X_AXIS_PARAM);
  const options = createFastScatterXAxisOptions(dataset);

  return options.some((option) => option.key === requested)
    ? requested
    : dataset.columns.xKey ?? options[0]?.key ?? null;
}

function createRouteXOrder(values: FastScatterDisplayColumns['x']): Uint32Array | undefined {
  if (values.length < 2) {
    return undefined;
  }

  let previous = sortableRouteXValue(values[0]);
  if (!Number.isFinite(previous)) {
    return sortRouteXValues(values);
  }

  for (let index = 1; index < values.length; index += 1) {
    const next = sortableRouteXValue(values[index]);
    if (!Number.isFinite(next)) {
      return sortRouteXValues(values);
    }

    if (next < previous) {
      return sortRouteXValues(values);
    }
    previous = next;
  }

  return undefined;
}

function sortRouteXValues(values: FastScatterDisplayColumns['x']): Uint32Array {
  const order = Uint32Array.from({ length: values.length }, (_, orderIndex) => orderIndex);
  order.sort((left, right) => {
    const leftValue = sortableRouteXValue(values[left]);
    const rightValue = sortableRouteXValue(values[right]);
    return leftValue === rightValue ? left - right : leftValue - rightValue;
  });
  return order;
}

function sortableRouteXValue(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value)
    ? Number.POSITIVE_INFINITY
    : value;
}

function convertFastScatterXModeViewport({
  currentMode,
  currentViewport,
  nextMode,
  plottedColumns,
}: {
  currentMode: FastScatterXMode;
  currentViewport: FastScatterViewport;
  nextMode: FastScatterXMode;
  plottedColumns: FastScatterDisplayColumns;
}): FastScatterViewport | null {
  if (currentMode === nextMode) {
    return currentViewport;
  }

  const { x } = currentViewport;
  const sourceX = plottedColumns.x;
  const nextX =
    nextMode === 'index'
      ? {
          min: mapAxisValueToIndex(sourceX, x.min),
          max: mapAxisValueToIndex(sourceX, x.max),
        }
      : {
          min: mapIndexToAxisValue(sourceX, x.min),
          max: mapIndexToAxisValue(sourceX, x.max),
        };

  if (
    !Number.isFinite(nextX.min) ||
    !Number.isFinite(nextX.max) ||
    nextX.min >= nextX.max
  ) {
    return null;
  }

  return {
    x: nextX,
    yByPlot: currentViewport.yByPlot,
  };
}

function cloneFastScatterViewport(viewport: FastScatterViewport): FastScatterViewport {
  return {
    x: { ...viewport.x },
    yByPlot: Object.fromEntries(
      Object.entries(viewport.yByPlot).map(([plotId, range]) => [plotId, { ...range }]),
    ),
  };
}

function areFastScatterViewportsEqual(
  first: FastScatterViewport,
  second: FastScatterViewport,
): boolean {
  const allPlotIds = new Set([
    ...Object.keys(first.yByPlot),
    ...Object.keys(second.yByPlot),
  ]);

  return (
    areFastScatterRangesEqualLocal(first.x, second.x) &&
    [...allPlotIds].every((plotId) =>
      areFastScatterRangesEqualLocal(first.yByPlot[plotId], second.yByPlot[plotId]),
    )
  );
}

function getViewportCommitDebounceMs(
  reason: FastScatterViewportChangeReason,
  phase: FastScatterViewportChangePhase,
): number | null {
  if (phase === 'commit') {
    return null;
  }
  if (reason === 'wheel') {
    return WHEEL_SEARCH_WRITE_DEBOUNCE_MS;
  }

  if (
    (reason === 'drag' || reason === 'navigator') && phase === 'preview'
  ) {
    return DRAG_SEARCH_WRITE_DEBOUNCE_MS;
  }

  return null;
}

function normalizePendingViewportReason(
  reason: FastScatterViewportChangeReason,
): 'drag' | 'navigator' | 'wheel' {
  if (reason === 'navigator') {
    return 'navigator';
  }

  if (reason === 'wheel') {
    return 'wheel';
  }

  return 'drag';
}

function areFastScatterRangesEqualLocal(
  first: FastScatterRange | undefined,
  second: FastScatterRange | undefined,
): boolean {
  if (first === undefined || second === undefined) {
    return first === second;
  }

  return (
    Math.abs(first.min - second.min) <= 1e-9 &&
    Math.abs(first.max - second.max) <= 1e-9
  );
}

function createIndexModeAxisTitle(label: string): string {
  return `${label} (index)`;
}

function mapIndexToAxisValue(
  values: FastScatterDisplayColumns['x'],
  index: number,
): number {
  if (values.length === 0) {
    return index;
  }

  const clamped = Math.max(0, Math.min(values.length - 1, index));
  const lowerIndex = Math.floor(clamped);
  const upperIndex = Math.ceil(clamped);
  const lower = values[lowerIndex] ?? values[0] ?? clamped;
  const upper = values[upperIndex] ?? lower;
  const t = clamped - lowerIndex;

  return lower + (upper - lower) * t;
}

function mapAxisValueToIndex(
  values: FastScatterDisplayColumns['x'],
  value: number,
): number {
  if (values.length <= 1) {
    return 0;
  }

  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? first;

  if (value <= first) {
    return 0;
  }

  if (value >= last) {
    return values.length - 1;
  }

  let low = 0;
  let high = values.length - 1;

  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = values[middle] ?? first;

    if (candidate <= value) {
      low = middle;
    } else {
      high = middle;
    }
  }

  const lower = values[low] ?? first;
  const upper = values[high] ?? lower;

  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) {
    return low;
  }

  return low + (value - lower) / (upper - lower);
}

function parseFastScatterRange(
  params: URLSearchParams,
  minName: string,
  maxName: string,
): FastScatterRange | null {
  const min = parseFiniteSearchNumber(params.get(minName));
  const max = parseFiniteSearchNumber(params.get(maxName));

  return min === null || max === null || min >= max ? null : { min, max };
}

function parseFiniteSearchNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function getFastScatterViewportParamName(
  plotId: string,
  edge: 'min' | 'max',
): string {
  return `sf.${encodeURIComponent(plotId)}.${edge}`;
}

function formatViewportParamNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

function clearFastScatterViewportSearchParams(params: URLSearchParams): void {
  params.delete('xMin');
  params.delete('xMax');
  for (const attribute of SCATTER_Y_ATTRIBUTES) {
    params.delete(`${attribute}Min`);
    params.delete(`${attribute}Max`);
  }
  for (const key of [...params.keys()]) {
    if (key.startsWith('sf.')) params.delete(key);
  }
}

function navigateWithFullPageRefresh(params: URLSearchParams): void {
  const next = new URL(window.location.href);
  next.search = params.toString();
  window.location.assign(next.href);
}

function getPrototypeViewportYRange(
  viewport: ViewportState,
  yKey: string,
  plotIndex: number,
): FastScatterRange {
  return viewport[getPrototypeViewportYKey(yKey, plotIndex)];
}

function createPrototypeViewportFromFastScatterViewport(
  viewport: FastScatterViewport,
  spec: FastScatterPlotSpec,
): ViewportState {
  return {
    x: viewport.x,
    ...Object.fromEntries(
      SCATTER_Y_ATTRIBUTES.map((attribute, index) => {
        const plot = spec.plots[index];

        return [
          attribute,
          plot === undefined
            ? { min: 0, max: 1 }
            : viewport.yByPlot[plot.id] ?? { min: 0, max: 1 },
        ];
      }),
    ),
  } as ViewportState;
}

function getPrototypeViewportYKey(
  yKey: string,
  plotIndex: number,
): ScatterYAttribute {
  return isScatterYAttribute(yKey)
    ? yKey
    : SCATTER_Y_ATTRIBUTES[Math.min(plotIndex, SCATTER_Y_ATTRIBUTES.length - 1)]!;
}

async function loadLegacyFastScatterDataset(
  startedAt: number,
): Promise<Omit<LoadedDatasetState, 'status'>> {
  const { dataset, metrics } = await loadScatterDatasetWithMetrics(SAMPLE_DATASET_URL);
  const adaptedDataset = adaptScatterDatasetForFastScatter(dataset);
  const columns = attachSingleTableIdentityToFastScatterColumns(adaptedDataset.columns);

  return {
    adaptedDataset: {
      ...adaptedDataset,
      columns,
      isLegacyViewport: true,
    },
    bufferBuildMetrics: adaptedDataset.columns.metrics,
    dataset,
    fetchMs: metrics.fetchMs,
    loadTimeMs: performance.now() - startedAt,
    parseMs: metrics.parseMs,
    sourceFormat: 'legacy-json-records',
    sourceUrl: SAMPLE_DATASET_URL,
    tableMetadata: createSingleTableMetadata(columns.x.length),
  };
}

async function loadSchemaFastScatterDataset(
  startedAt: number,
  datasetUrl: string,
  schemaUrl: string,
): Promise<Omit<LoadedDatasetState, 'status'>> {
  const columnar =
    datasetUrl === SCATTER_FAST_DATASET_URL && schemaUrl === SCATTER_FAST_SCHEMA_URL
      ? await loadColumnarFastScatterDataset(startedAt, schemaUrl).catch(() => null)
      : null;
  if (columnar !== null) {
    return columnar;
  }

  const fetchStartedAt = performance.now();
  const [datasetResponse, schemaResponse] = await Promise.all([
    fetch(datasetUrl, { headers: { Accept: 'application/json' } }),
    fetch(schemaUrl, { headers: { Accept: 'application/json' } }),
  ]);
  const fetchMs = performance.now() - fetchStartedAt;

  if (!datasetResponse.ok || !schemaResponse.ok) {
    const mixedTableDataset = await loadMixedTableFastScatterDataset(
      startedAt,
      MIXED_TABLE_FIXTURE_URL,
    ).catch(() => null);
    if (mixedTableDataset !== null) {
      return mixedTableDataset;
    }

    throw new Error(
      `m-scatter schema dataset not found. Generate it with: pnpm generate:data -- --kind scatter-fast --count 1000000 --seed 1`,
    );
  }

  const parseStartedAt = performance.now();
  const [datasetPayload, schema] = (await Promise.all([
    datasetResponse.json(),
    schemaResponse.json(),
  ])) as [{ records?: unknown }, FastScatterDatasetSchema];
  const parseMs = performance.now() - parseStartedAt;

  if (!Array.isArray(datasetPayload.records)) {
    throw new Error('m-scatter schema dataset must include records.');
  }

  const encodeStartedAt = performance.now();
  const encoded = encodeFastScatterSchemaRows(
    datasetPayload.records as readonly Readonly<Record<string, unknown>>[],
    schema,
  );
  const columns = attachSingleTableIdentityToFastScatterColumns(encoded.columns);
  const buildMs = performance.now() - encodeStartedAt;
  const compatibilityStartedAt = performance.now();
  const dataset = createSchemaMetadataScatterDataset(encoded);
  const compatibilityBuildMs = performance.now() - compatibilityStartedAt;
  const byteLength =
    columns.x.byteLength +
    Object.values(columns.y).reduce((sum, column) => sum + column.byteLength, 0) +
    (columns.color?.byteLength ?? 0) +
    (columns.opacity?.byteLength ?? 0) +
    (columns.size?.byteLength ?? 0) +
    (columns.rotationDegrees?.byteLength ?? 0) +
    (columns.rotationRadians?.byteLength ?? 0) +
    (columns.shape?.byteLength ?? 0) +
    columns.sourceIndex.byteLength;

  return {
    adaptedDataset: {
      columns,
      isLegacyViewport: false,
      spec: encoded.spec,
    },
    bufferBuildMetrics: {
      buildMs,
      byteLength,
      recordCount: columns.x.length,
      yKeyCount: Object.keys(columns.y).length,
    },
    compatibilityBuildMs,
    dataset,
    fetchMs,
    loadTimeMs: performance.now() - startedAt,
    parseMs,
    schemaEncodeMs: buildMs,
    sourceFormat: 'json-records',
    sourceUrl: datasetUrl,
    tableMetadata: createSingleTableMetadata(columns.x.length),
  };
}

async function loadMixedTableFastScatterDataset(
  startedAt: number,
  fixtureUrl: string,
): Promise<Omit<LoadedDatasetState, 'status'>> {
  const fetchStartedAt = performance.now();
  const response = await fetch(fixtureUrl, {
    headers: { Accept: 'application/json' },
  });
  const fetchMs = performance.now() - fetchStartedAt;

  if (!response.ok) {
    throw new Error('Mixed-table fixture not available.');
  }

  const parseStartedAt = performance.now();
  const payload: unknown = await response.json();
  const parseMs = performance.now() - parseStartedAt;

  if (!isMixedTableFixturePayload(payload)) {
    throw new Error('Mixed-table fixture payload is invalid.');
  }

  const encodeStartedAt = performance.now();
  const adaptedDataset = adaptMixedTablesForFastScatter(payload);
  const buildMs = performance.now() - encodeStartedAt;
  const compatibilityStartedAt = performance.now();
  const dataset = createSchemaMetadataScatterDataset({
    columns: adaptedDataset.columns,
    spec: adaptedDataset.spec,
  });
  const compatibilityBuildMs = performance.now() - compatibilityStartedAt;
  const byteLength =
    adaptedDataset.columns.x.byteLength +
    Object.values(adaptedDataset.columns.y).reduce(
      (sum, column) => sum + column.byteLength,
      0,
    ) +
    (adaptedDataset.columns.color?.byteLength ?? 0) +
    (adaptedDataset.columns.opacity?.byteLength ?? 0) +
    (adaptedDataset.columns.size?.byteLength ?? 0) +
    (adaptedDataset.columns.rotationDegrees?.byteLength ?? 0) +
    (adaptedDataset.columns.rotationRadians?.byteLength ?? 0) +
    (adaptedDataset.columns.shape?.byteLength ?? 0) +
    adaptedDataset.columns.sourceIndex.byteLength;

  return {
    adaptedDataset: {
      columns: adaptedDataset.columns,
      isLegacyViewport: false,
      spec: adaptedDataset.spec,
    },
    bufferBuildMetrics: {
      buildMs,
      byteLength,
      recordCount: adaptedDataset.columns.x.length,
      yKeyCount: Object.keys(adaptedDataset.columns.y).length,
    },
    compatibilityBuildMs,
    dataset,
    fetchMs,
    loadTimeMs: performance.now() - startedAt,
    parseMs,
    schemaEncodeMs: buildMs,
    sourceFormat: 'mixed-table-json',
    sourceUrl: fixtureUrl,
    tableMetadata: {
      tableCount: adaptedDataset.metadata.tableNames.length,
      tableNames: adaptedDataset.metadata.tableNames,
      tableRecordCounts: adaptedDataset.metadata.tableRecordCounts,
    },
  };
}

function isMixedTableFixturePayload(payload: unknown): payload is MixedTableFixture {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    Array.isArray((payload as { tables?: unknown }).tables) &&
    typeof (payload as { metadata?: { count?: unknown } }).metadata?.count === 'number'
  );
}

function formatScatterTableRecordCounts(
  tableRecordCounts: Readonly<Record<string, number>> | undefined,
): string {
  const entries = Object.entries(tableRecordCounts ?? {});
  return entries.length === 0
    ? 'none'
    : entries.map(([name, count]) => `${name}:${count}`).join(',');
}

function attachSingleTableIdentityToFastScatterColumns<
  TColumns extends FastScatterDisplayColumns,
>(columns: TColumns): TColumns {
  const tableName = MIXED_TABLE_NAMES[0];

  return {
    ...columns,
    recordIdentityBySourceIndex: createLazySingleTableRecordIdentityArray(
      columns.ids,
      tableName,
    ),
    tableBySourceIndex: createLazySingleValueArray(columns.ids.length, tableName),
  };
}

function createSingleTableMetadata(recordCount: number): FastScatterRouteTableMetadata {
  const tableName = MIXED_TABLE_NAMES[0];
  return {
    tableCount: 1,
    tableNames: [tableName],
    tableRecordCounts: { [tableName]: recordCount },
  };
}

interface ScatterFastColumnarManifest {
  binary: string;
  columns: Record<string, ScatterFastColumnarColumn>;
  count: number;
  domains: Record<string, { max: number; min: number }>;
  idPrefix: string;
  idWidth: number;
  timestampOriginNs: string;
  version: 1;
}

interface ScatterFastColumnarColumn {
  byteLength: number;
  byteOffset: number;
  length: number;
  type: string;
}

async function loadColumnarFastScatterDataset(
  startedAt: number,
  schemaUrl: string,
): Promise<Omit<LoadedDatasetState, 'status'>> {
  const fetchStartedAt = performance.now();
  const [manifestResponse, schemaResponse] = await Promise.all([
    fetch(SCATTER_FAST_COLUMNAR_URL, { headers: { Accept: 'application/json' } }),
    fetch(schemaUrl, { headers: { Accept: 'application/json' } }),
  ]);
  if (!manifestResponse.ok || !schemaResponse.ok) {
    throw new Error('m-scatter columnar dataset is not available.');
  }

  const parseStartedAt = performance.now();
  const [manifest, schema] = (await Promise.all([
    manifestResponse.json(),
    schemaResponse.json(),
  ])) as [ScatterFastColumnarManifest, FastScatterDatasetSchema];
  const parseMs = performance.now() - parseStartedAt;
  const binaryUrl = new URL(manifest.binary, manifestResponse.url).toString();
  const binaryResponse = await fetch(binaryUrl, {
    headers: { Accept: 'application/octet-stream' },
  });
  if (!binaryResponse.ok) {
    throw new Error('m-scatter columnar binary payload is not available.');
  }
  const binaryBuffer = await binaryResponse.arrayBuffer();
  const fetchMs = performance.now() - fetchStartedAt;

  const decodeStartedAt = performance.now();
  const encoded = decodeScatterFastColumnarManifest(manifest, schema, binaryBuffer);
  const columns = attachSingleTableIdentityToFastScatterColumns(encoded.columns);
  const buildMs = performance.now() - decodeStartedAt;
  const compatibilityStartedAt = performance.now();
  const dataset = createSchemaMetadataScatterDataset({ columns, spec: encoded.spec });
  const compatibilityBuildMs = performance.now() - compatibilityStartedAt;

  return {
    adaptedDataset: {
      columns,
      isLegacyViewport: false,
      spec: encoded.spec,
    },
    bufferBuildMetrics: {
      buildMs,
      byteLength: binaryBuffer.byteLength,
      recordCount: columns.x.length,
      yKeyCount: Object.keys(columns.y).length,
    },
    columnarBytes: binaryBuffer.byteLength,
    columnarDecodeMs: buildMs,
    compatibilityBuildMs,
    dataset,
    fetchMs,
    loadTimeMs: performance.now() - startedAt,
    parseMs,
    schemaEncodeMs: 0,
    sourceFormat: 'columnar-binary',
    sourceUrl: SCATTER_FAST_COLUMNAR_URL,
    tableMetadata: createSingleTableMetadata(columns.x.length),
  };
}

function decodeScatterFastColumnarManifest(
  manifest: ScatterFastColumnarManifest,
  schema: FastScatterDatasetSchema,
  binaryBuffer: ArrayBuffer,
): FastScatterEncodeSchemaResult {
  if (manifest.version !== 1) {
    throw new Error(`Unsupported scatter-fast columnar version ${manifest.version}.`);
  }

  const timestampNs = readColumnarArray<BigInt64Array>(
    manifest,
    binaryBuffer,
    'timestampNs',
    'BigInt64Array',
    BigInt64Array,
  );
  const ids = createLazyIdArray(manifest.idPrefix, manifest.idWidth, manifest.count);
  const axisByColumn = createColumnarAxisMap(manifest, schema, timestampNs);
  const columns: FastScatterEncodedSchemaColumns = {
    axisByColumn,
    color: readColumnarArray(manifest, binaryBuffer, 'color', 'Uint8Array', Uint8Array),
    colorFormat: 'rgba8',
    ids,
    opacity: readColumnarArray(
      manifest,
      binaryBuffer,
      'opacity',
      'Float32Array',
      Float32Array,
    ),
    rotation: readColumnarArray(
      manifest,
      binaryBuffer,
      'rotationRadians',
      'Float32Array',
      Float32Array,
    ),
    rotationDegrees: readColumnarArray(
      manifest,
      binaryBuffer,
      'rotationDegrees',
      'Float32Array',
      Float32Array,
    ),
    rotationRadians: readColumnarArray(
      manifest,
      binaryBuffer,
      'rotationRadians',
      'Float32Array',
      Float32Array,
    ),
    shape: readColumnarArray(manifest, binaryBuffer, 'shape', 'Uint8Array', Uint8Array),
    size: readColumnarArray(manifest, binaryBuffer, 'size', 'Float32Array', Float32Array),
    sourceIndex: readColumnarArray(
      manifest,
      binaryBuffer,
      'sourceIndex',
      'Uint32Array',
      Uint32Array,
    ),
    x: readColumnarArray(manifest, binaryBuffer, 'x', 'Float64Array', Float64Array),
    xKey: schema.x.column,
    y: {
      accepted: readColumnarArray(
        manifest,
        binaryBuffer,
        'accepted',
        'Float64Array',
        Float64Array,
      ),
      phase: readColumnarArray(manifest, binaryBuffer, 'phase', 'Float64Array', Float64Array),
      signalValue: readColumnarArray(
        manifest,
        binaryBuffer,
        'signalValue',
        'Float64Array',
        Float64Array,
      ),
    },
  };

  return {
    columns,
    spec: {
      xLabel: createColumnarAxisTitle(requireColumnarSchemaColumn(schema, schema.x.column), schema.x.title),
      plots: schema.plots.map((plot) => {
        const column = requireColumnarSchemaColumn(schema, plot.y.column);

        return {
          id: plot.id,
          label: plot.label ?? createColumnarAxisTitle(column, plot.y.title),
          yKey: plot.y.column,
        };
      }),
    },
  };
}

function readColumnarArray<TArray extends ArrayBufferView>(
  manifest: ScatterFastColumnarManifest,
  buffer: ArrayBuffer,
  name: string,
  expectedType: string,
  constructor: {
    new (buffer: ArrayBuffer, byteOffset: number, length: number): TArray;
  },
): TArray {
  const column = manifest.columns[name];
  if (column === undefined || column.type !== expectedType) {
    throw new Error(`m-scatter columnar column "${name}" is missing or invalid.`);
  }

  return new constructor(buffer, column.byteOffset, column.length);
}

function createColumnarAxisMap(
  manifest: ScatterFastColumnarManifest,
  schema: FastScatterDatasetSchema,
  timestampNs: BigInt64Array,
): Readonly<Record<string, FastScatterEncodedAxis>> {
  const axisByColumn: Record<string, FastScatterEncodedAxis> = {};
  for (const column of schema.columns) {
    if (column.role !== 'x' && column.role !== 'y') {
      continue;
    }

    const domain = manifest.domains[column.key] ?? { min: 0, max: 0 };
    if (column.axisType === 'datetime-ns') {
      axisByColumn[column.key] = {
        columnKey: column.key,
        datetimeOriginNs: manifest.timestampOriginNs,
        datetimeOriginNsBigInt: BigInt(manifest.timestampOriginNs),
        domain,
        epochNsValues: createLazyBigIntStringArray(timestampNs),
        kind: 'datetime-ns',
        parameterName: column.parameterName ?? column.key,
        ...(column.source === undefined ? {} : { source: column.source }),
        title: createColumnarAxisTitle(column),
        unit: column.unit,
      };
    } else if (column.axisType === 'categorical' || column.axisType === 'boolean') {
      axisByColumn[column.key] = {
        categories: (column.categories ?? []).map((category, index) => ({
          encoded: category.order ?? index,
          label: category.label ?? String(category.value),
          value: String(category.value),
        })),
        columnKey: column.key,
        domain,
        kind: column.axisType,
        parameterName: column.parameterName ?? column.key,
        ...(column.source === undefined ? {} : { source: column.source }),
        title: createColumnarAxisTitle(column),
        unit: column.unit,
      };
    } else {
      axisByColumn[column.key] = {
        columnKey: column.key,
        domain,
        kind: 'numeric',
        parameterName: column.parameterName ?? column.key,
        ...(column.source === undefined ? {} : { source: column.source }),
        title: createColumnarAxisTitle(column),
        unit: column.unit,
      };
    }
  }

  return axisByColumn;
}

function createLazyIdArray(
  prefix: string,
  width: number,
  count: number,
): readonly string[] {
  return new Proxy({ length: count }, {
    get(target, property) {
      if (property === 'length') {
        return target.length;
      }
      if (typeof property === 'string' && /^\d+$/u.test(property)) {
        const index = Number(property);
        return index < target.length ? `${prefix}${String(index).padStart(width, '0')}` : undefined;
      }

      return undefined;
    },
  }) as unknown as readonly string[];
}

function createLazyBigIntStringArray(values: BigInt64Array): readonly string[] {
  return new Proxy({ length: values.length }, {
    get(target, property) {
      if (property === 'length') {
        return target.length;
      }
      if (typeof property === 'string' && /^\d+$/u.test(property)) {
        const index = Number(property);
        return index < values.length ? values[index]?.toString() : undefined;
      }

      return undefined;
    },
  }) as unknown as readonly string[];
}

function requireColumnarSchemaColumn(
  schema: FastScatterDatasetSchema,
  key: string,
): FastScatterDatasetSchema['columns'][number] {
  const column = schema.columns.find((candidate) => candidate.key === key);
  if (column === undefined) {
    throw new Error(`m-scatter columnar schema column "${key}" is missing.`);
  }

  return column;
}

function createColumnarAxisTitle(
  column: FastScatterDatasetSchema['columns'][number],
  override?: string,
): string {
  const base = override ?? column.title ?? column.parameterName ?? column.key;

  return column.unit === undefined ? base : `${base} (${column.unit})`;
}

function createSchemaMetadataScatterDataset(
  encoded: FastScatterEncodeSchemaResult,
): ScatterDataset {
  return {
    metadata: {
      attributes: {
        category: 'category',
        color: 'color',
        id: 'id',
        opacity: 'opacity',
        rotation: 'rotation',
        shape: 'shape',
        size: 'size',
        styleGroup: 'styleGroup',
        x: 'x',
        y: ['a', 'b', 'c'],
      },
      categories: ['core'],
      count: encoded.columns.x.length,
      createdAt: new Date(0).toISOString(),
      seed: 0,
      styleGroups: ['default'],
      styles: {
        color: { attribute: 'color', format: '#RRGGBB' },
        opacity: { attribute: 'opacity', max: 1, min: 0 },
        rotation: { attribute: 'rotation', max: 360, min: 0, nullable: true, unit: 'deg' },
        shape: { attribute: 'shape', values: ['circle', 'rectangle', 'triangle', 'pin', 'arrow'] },
        size: { attribute: 'size', max: 8, min: 1, unit: 'px' },
      },
    },
    records: [],
  };
}

const DEFAULT_WEBGPU_POINT_COUNT = 1_000_000;
const MAX_WEBGPU_DEMO_POINT_COUNT = 25_000_000;
const WEBGPU_POINT_COUNT_PARAM = 'points';
const WEBGPU_DATA_SOURCE_PARAM = 'webgpuData';
const SCATTER_WEBGPU_10M_MANIFEST_URL = '/data/scatter-webgpu-10m.json';
const SCATTER_WEBGPU_25M_MANIFEST_URL = '/data/scatter-webgpu-25m.json';
const WEBGPU_STYLE_PREFETCH_PAGES = 4;

function webgpuManifestUrl(pointCount: number): string {
  return pointCount > 10_000_000
    ? SCATTER_WEBGPU_25M_MANIFEST_URL
    : SCATTER_WEBGPU_10M_MANIFEST_URL;
}

class PagedWebgpuDatasetUnavailableError extends Error {}
class LocalWebgpuDatasetUnavailableError extends Error {}

interface ScatterWebgpuPageSource {
  loadCoordinatePage: (
    page: ScatterWebgpuPagedManifestPage,
    pageIndex: number,
    signal: AbortSignal,
  ) => Promise<ArrayBuffer>;
  loadStylePage: (
    page: ScatterWebgpuPagedManifestPage,
    pageIndex: number,
    signal: AbortSignal,
  ) => Promise<ArrayBuffer>;
  manifest: ScatterWebgpuPagedManifest;
  schema: FastScatterDatasetSchema;
  sourceFormat: 'indexeddb-webgpu-binary' | 'paged-webgpu-binary';
  sourceUrl: string;
}

async function loadStoredWebgpuScatterDataset(
  startedAt: number,
  requestedPointCount: number,
  signal: AbortSignal,
  buildHoverIndex = true,
): Promise<Omit<LoadedDatasetState, 'status'>> {
  const stored = await getStoredScatterWebgpuDataset(requestedPointCount);
  if (stored === null) {
    throw new LocalWebgpuDatasetUnavailableError(
      'Generate this WebGPU dataset in the browser before loading it.',
    );
  }
  const loadPage = (
    kind: 'coordinates' | 'styles',
    _page: ScatterWebgpuPagedManifestPage,
    pageIndex: number,
    pageSignal: AbortSignal,
  ) => {
    throwIfAborted(pageSignal);
    return readStoredScatterWebgpuPage(stored.datasetId, kind, pageIndex);
  };
  return loadPagedWebgpuScatterDataset(
    startedAt,
    requestedPointCount,
    signal,
    {
      loadCoordinatePage: (page, pageIndex, pageSignal) =>
        loadPage('coordinates', page, pageIndex, pageSignal),
      loadStylePage: (page, pageIndex, pageSignal) =>
        loadPage('styles', page, pageIndex, pageSignal),
      manifest: stored.manifest,
      schema: SCATTER_WEBGPU_SCHEMA,
      sourceFormat: 'indexeddb-webgpu-binary',
      sourceUrl: `indexeddb://${stored.datasetId}`,
    },
    buildHoverIndex,
  );
}

async function loadPagedWebgpuScatterDataset(
  startedAt: number,
  requestedPointCount: number,
  signal: AbortSignal,
  providedSource?: ScatterWebgpuPageSource,
  buildHoverIndex = true,
): Promise<Omit<LoadedDatasetState, 'status'>> {
  const fetchStartedAt = performance.now();
  await assertWebgpuPointCapacity(requestedPointCount);
  throwIfAborted(signal);
  let source = providedSource;
  if (source === undefined) {
    const manifestUrl = webgpuManifestUrl(requestedPointCount);
    const [manifestResponse, schemaResponse] = await Promise.all([
      fetch(manifestUrl, { signal }),
      fetch(SCATTER_FAST_SCHEMA_URL, { signal }),
    ]);
    if (!manifestResponse.ok || !schemaResponse.ok) {
      throw new PagedWebgpuDatasetUnavailableError(
        'The diagnostic HTTP WebGPU dataset is not available.',
      );
    }
    const [manifest, schema] = (await Promise.all([
      manifestResponse.json(),
      schemaResponse.json(),
    ])) as [ScatterWebgpuPagedManifest, FastScatterDatasetSchema];
    source = {
      loadCoordinatePage: async (page, _pageIndex, pageSignal) => {
        const response = await fetch(new URL(page.binary, manifestResponse.url), {
          signal: pageSignal,
        });
        if (!response.ok) {
          throw new Error(`WebGPU scatter page ${page.binary} is unavailable.`);
        }
        return response.arrayBuffer();
      },
      loadStylePage: async (page, _pageIndex, pageSignal) => {
        const response = await fetch(new URL(page.styleBinary, manifestResponse.url), {
          signal: pageSignal,
        });
        if (!response.ok) {
          throw new Error(`WebGPU scatter style page ${page.styleBinary} is unavailable.`);
        }
        return response.arrayBuffer();
      },
      manifest,
      schema,
      sourceFormat: 'paged-webgpu-binary',
      sourceUrl: manifestUrl,
    };
  }
  const { manifest, schema } = source;
  throwIfAborted(signal);
  if (
    (manifest.version !== 2 && manifest.version !== 3 &&
      manifest.version !== 4 && manifest.version !== 5 && manifest.version !== 6 &&
      manifest.version !== 7) ||
    manifest.format !== 'm-scatter-webgpu-paged' ||
    !Number.isSafeInteger(manifest.count) || !Array.isArray(manifest.pages)
  ) {
    throw new Error('The paged WebGPU scatter manifest is invalid.');
  }
  const pointCount = Math.min(requestedPointCount, manifest.count);
  if (pointCount !== requestedPointCount) {
    throw new Error(
      `Paged WebGPU dataset contains ${manifest.count} points, but ${requestedPointCount} were requested.`,
    );
  }
  throwIfAborted(signal);
  const scaledX = manifest.version >= 4;
  const generatedX = manifest.xStorage === 'generated-overlap-index';
  const x = generatedX
    ? createGeneratedOverlapXColumn(pointCount)
    : scaledX
      ? new Uint32Array(pointCount)
      : new Float64Array(pointCount);
  const phase = new Uint8Array(pointCount);
  const accepted = new Uint8Array(pointCount);
  const compactSignal = manifest.version >= 5;
  const signalValue = compactSignal
    ? new Uint16Array(pointCount)
    : new Float32Array(pointCount);
  let binaryBytes = 0;

  const coordinatePages = manifest.pages.filter((page) => page.startIndex < pointCount);
  await runBoundedTasks(coordinatePages, 4, async (page) => {
    throwIfAborted(signal);
    const pageIndex = manifest.pages.indexOf(page);
    const buffer = await source.loadCoordinatePage(page, pageIndex, signal);
    binaryBytes += buffer.byteLength;
    const copyCount = Math.min(page.count, pointCount - page.startIndex);
    if (!generatedX && scaledX) {
      copyPagedWebgpuColumn(
        x as Uint32Array, page, buffer, 'x', 'Uint32Array', Uint32Array, copyCount,
      );
    } else if (!generatedX) {
      copyPagedWebgpuColumn(
        x as Float64Array, page, buffer, 'x', 'Float64Array', Float64Array, copyCount,
      );
    }
    copyPagedWebgpuColumn(phase, page, buffer, 'phase', 'Uint8Array', Uint8Array, copyCount);
    copyPagedWebgpuColumn(accepted, page, buffer, 'accepted', 'Uint8Array', Uint8Array, copyCount);
    if (compactSignal) {
      copyPagedWebgpuColumn(
        signalValue as Uint16Array,
        page,
        buffer,
        'signalValue',
        'Uint16Array',
        Uint16Array,
        copyCount,
      );
    } else {
      copyPagedWebgpuColumn(
        signalValue as Float32Array,
        page,
        buffer,
        'signalValue',
        'Float32Array',
        Float32Array,
        copyCount,
      );
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
  const fetchMs = performance.now() - fetchStartedAt;
  const ids = createLazyIdArray(manifest.idPrefix, manifest.idWidth, pointCount);
  const y = { accepted, phase, signalValue };
  const runtimeManifest = pointCount === manifest.count
    ? manifest
    : {
        ...manifest,
        domains: {
          ...manifest.domains,
          signalValue: calculateTypedArrayDomain(signalValue),
          timestampNs: calculateTypedArrayDomain(x),
        },
      };
  const axisByColumn = createPagedWebgpuAxisMap(runtimeManifest, schema, x);
  const columns = {
    axisByColumn,
    ids,
    x,
    xKey: schema.x.column,
    y,
  } as FastScatterDisplayColumns;
  const spec: FastScatterPlotSpec = {
    xLabel: createColumnarAxisTitle(
      requireColumnarSchemaColumn(schema, schema.x.column),
      schema.x.title,
    ),
    plots: schema.plots.map((plot) => {
      const column = requireColumnarSchemaColumn(schema, plot.y.column);
      return {
        id: plot.id,
        label: plot.label ?? createColumnarAxisTitle(column, plot.y.title),
        yKey: plot.y.column,
      };
    }),
  };
  const indexStartedAt = performance.now();
  const hoverIndex = !buildHoverIndex
    ? null
    : pointCount <= DEFAULT_WEBGPU_POINT_COUNT
      ? createFastScatterHoverIndex(columns, {
          yKeys: spec.plots.map((plot) => plot.yKey),
        })
      : await createFastScatterCompactHoverIndex(columns, {
          sortedX: true,
          yDomainByKey: runtimeManifest.domains,
          yKeys: spec.plots.map((plot) => plot.yKey),
        });
  const buildMs = performance.now() - indexStartedAt;
  const hoverIndexBytes = hoverIndex === null
    ? 0
    : calculateFastScatterHoverIndexBytes(hoverIndex, columns);
  const dataset = createSchemaMetadataScatterDataset({
    columns: columns as FastScatterEncodedSchemaColumns,
    spec,
  });
  const residentBytes = x.byteLength + phase.byteLength + accepted.byteLength +
    signalValue.byteLength + hoverIndexBytes;

  return {
    adaptedDataset: {
      columns,
      hoverIndex,
      isLegacyViewport: false,
      packedStyles: {
        createPages: () => streamPagedWebgpuStyles(
          manifest.pages,
          pointCount,
          signal,
          manifest.styleStrideBytes ?? 12,
          source.loadStylePage,
        ),
        maxPointSize: manifest.maxPointSize,
        pointCount,
        styleStrideBytes: manifest.styleStrideBytes ?? 12,
      },
      spec,
    },
    bufferBuildMetrics: {
      buildMs,
      byteLength: residentBytes,
      recordCount: pointCount,
      yKeyCount: spec.plots.length,
    },
    columnarBytes: binaryBytes,
    columnarDecodeMs: 0,
    dataset,
    fetchMs,
    loadTimeMs: performance.now() - startedAt,
    parseMs: 0,
    schemaEncodeMs: 0,
    sourceFormat: source.sourceFormat,
    sourceUrl: source.sourceUrl,
    tableMetadata: createSingleTableMetadata(pointCount),
  };
}

function deriveSecondaryTableFixtureUrl(fixtureUrl: string): string {
  return fixtureUrl.replace(/\.json(?=($|[?#]))/u, '.secondary.json');
}

async function appendSecondaryTableToWebgpuDataset(
  primary: Omit<LoadedDatasetState, 'status'>,
  secondary: Omit<LoadedDatasetState, 'status'>,
): Promise<Omit<LoadedDatasetState, 'status'>> {
  const startedAt = performance.now();
  const primaryColumns = primary.adaptedDataset.columns;
  const secondaryColumns = secondary.adaptedDataset.columns;
  const primaryCount = primaryColumns.x.length;
  const secondaryCount = secondaryColumns.x.length;
  const totalCount = primaryCount + secondaryCount;
  const x = appendWebgpuTableXColumn(primaryColumns.x, secondaryCount);
  const y: Record<string, FastScatterDisplayColumns['x']> = {};
  const primaryYKeys = new Set(Object.keys(primaryColumns.y));

  for (const [key, primaryValues] of Object.entries(primaryColumns.y)) {
    const secondaryValues = secondaryColumns.y[key];
    y[key] = appendWebgpuSharedYColumn(
      primaryValues,
      secondaryValues,
      primaryColumns.axisByColumn?.[key],
      secondaryCount,
    );
  }
  for (const [key, secondaryValues] of Object.entries(secondaryColumns.y)) {
    if (primaryYKeys.has(key)) continue;
    const values = new Float32Array(totalCount);
    values.fill(Number.NaN, 0, primaryCount);
    for (let index = 0; index < secondaryCount; index += 1) {
      values[primaryCount + index] = secondaryValues[index] ?? Number.NaN;
    }
    y[key] = values;
  }

  const primaryXKey = primaryColumns.xKey;
  const primaryXAxis = primaryXKey === undefined
    ? undefined
    : primaryColumns.axisByColumn?.[primaryXKey];
  const xDomain = (x as ArrayLike<number> & { generatedOverlapIndex?: boolean })
    .generatedOverlapIndex
      ? {
          min: 0,
          max: totalCount === 0 ? 0 : generatedOverlapXValue(totalCount - 1),
        }
      : calculateTypedArrayDomain(x);
  const axisByColumn: Record<string, FastScatterEncodedAxis> = {
    ...(secondaryColumns.axisByColumn ?? {}),
    ...(primaryColumns.axisByColumn ?? {}),
  };
  for (const [key, values] of Object.entries(y)) {
    const axis = axisByColumn[key];
    if (axis !== undefined && axis.kind === 'numeric') {
      axisByColumn[key] = {
        ...axis,
        domain: calculateTypedArrayDomain(values),
      };
    }
  }
  if (primaryXKey !== undefined && primaryXAxis !== undefined) {
    axisByColumn[primaryXKey] = primaryXAxis.kind === 'datetime-ns'
      ? {
          ...primaryXAxis,
          domain: xDomain,
          epochNsValues: createLazyEpochNsArray(
            primaryXAxis.datetimeOriginNs,
            x as Float64Array | Uint32Array,
            primaryXAxis.encodedScaleMs ?? 1,
          ),
        }
      : { ...primaryXAxis, domain: xDomain };
  }

  const ids = createCombinedReadonlyArray(primaryColumns.ids, secondaryColumns.ids);
  const primaryTableName = primary.tableMetadata?.tableNames[0] ?? MIXED_TABLE_NAMES[0];
  const secondaryTableName = secondary.tableMetadata?.tableNames[0] ?? MIXED_TABLE_NAMES[1];
  const tableBySourceIndex = createCombinedReadonlyArray(
    createLazySingleValueArray(primaryCount, primaryTableName),
    createLazySingleValueArray(secondaryCount, secondaryTableName),
  );
  const recordIdentityBySourceIndex = new Proxy({ length: totalCount }, {
    get(target, property) {
      if (property === 'length') return target.length;
      if (typeof property !== 'string' || !/^\d+$/u.test(property)) return undefined;
      const sourceIndex = Number(property);
      if (sourceIndex >= totalCount) return undefined;
      return {
        id: ids[sourceIndex] ?? String(sourceIndex),
        sourceIndex,
        table: tableBySourceIndex[sourceIndex] ?? primaryTableName,
      };
    },
  }) as unknown as NonNullable<FastScatterDisplayColumns['recordIdentityBySourceIndex']>;
  const plots = [
    ...primary.adaptedDataset.spec.plots,
    ...secondary.adaptedDataset.spec.plots.filter(
      (plot) => !primary.adaptedDataset.spec.plots.some(
        (primaryPlot) => primaryPlot.yKey === plot.yKey,
      ),
    ),
  ];
  const columns: FastScatterDisplayColumns = {
    axisByColumn,
    ids,
    recordIdentityBySourceIndex,
    tableBySourceIndex,
    x,
    xKey: primaryXKey,
    y,
  };
  const spec: FastScatterPlotSpec = {
    plots,
    xLabel: primary.adaptedDataset.spec.xLabel,
  };
  const hoverIndex = totalCount <= DEFAULT_WEBGPU_POINT_COUNT
    ? createFastScatterHoverIndex(columns, {
        yKeys: plots.map((plot) => plot.yKey),
      })
    : await createFastScatterCompactHoverIndex(columns, {
        sortedX: true,
        yDomainByKey: Object.fromEntries(
          Object.entries(axisByColumn).map(([key, axis]) => [key, axis.domain]),
        ),
        yKeys: plots.map((plot) => plot.yKey),
      });
  const hoverIndexBytes = calculateFastScatterHoverIndexBytes(hoverIndex, columns);
  const packedStyles = appendWebgpuPackedStyles(
    primary.adaptedDataset.packedStyles,
    secondaryColumns,
    primaryCount,
  );
  const byteLength = Object.values(y).reduce((sum, values) => sum + values.byteLength, 0) +
    x.byteLength + hoverIndexBytes;

  return {
    ...primary,
    adaptedDataset: {
      columns,
      hoverIndex,
      isLegacyViewport: false,
      packedStyles,
      spec,
    },
    bufferBuildMetrics: {
      buildMs: primary.bufferBuildMetrics.buildMs + performance.now() - startedAt,
      byteLength,
      recordCount: totalCount,
      yKeyCount: Object.keys(y).length,
    },
    dataset: {
      ...primary.dataset,
      metadata: {
        ...primary.dataset.metadata,
        count: totalCount,
      },
    },
    fetchMs: primary.fetchMs + secondary.fetchMs,
    loadTimeMs: Math.max(primary.loadTimeMs, secondary.loadTimeMs) +
      performance.now() - startedAt,
    parseMs: primary.parseMs + secondary.parseMs,
    schemaEncodeMs: (primary.schemaEncodeMs ?? 0) + (secondary.schemaEncodeMs ?? 0),
    sourceUrl: `${primary.sourceUrl} + ${secondary.sourceUrl}`,
    tableMetadata: {
      tableCount: 2,
      tableNames: [primaryTableName, secondaryTableName],
      tableRecordCounts: {
        [primaryTableName]: primaryCount,
        [secondaryTableName]: secondaryCount,
      },
    },
  };
}

function appendWebgpuTableXColumn(
  primary: FastScatterDisplayColumns['x'],
  secondaryCount: number,
): FastScatterDisplayColumns['x'] {
  const totalCount = primary.length + secondaryCount;
  if ((primary as ArrayLike<number> & { generatedOverlapIndex?: boolean }).generatedOverlapIndex) {
    return createGeneratedOverlapXColumn(totalCount);
  }
  const result = new Float64Array(totalCount);
  result.set(primary as Float64Array, 0);
  const start = primary.length === 0 ? 0 : (primary[primary.length - 1] ?? 0) + 1;
  for (let index = 0; index < secondaryCount; index += 1) {
    result[primary.length + index] = start + index;
  }
  return result;
}

function appendWebgpuSharedYColumn(
  primary: FastScatterDisplayColumns['x'],
  secondary: FastScatterDisplayColumns['x'] | undefined,
  axis: FastScatterEncodedAxis | undefined,
  secondaryCount: number,
): FastScatterDisplayColumns['x'] {
  const totalCount = primary.length + secondaryCount;
  if (primary instanceof Uint8Array) {
    const result = new Uint8Array(totalCount);
    result.set(primary);
    for (let index = 0; index < secondaryCount; index += 1) {
      result[primary.length + index] = secondary?.[index] ?? 0;
    }
    return result;
  }
  if (primary instanceof Uint16Array) {
    const result = new Uint16Array(totalCount);
    result.set(primary);
    const scale = axis?.kind === 'numeric' ? axis.encodedScale ?? 1 : 1;
    for (let index = 0; index < secondaryCount; index += 1) {
      result[primary.length + index] = Math.round((secondary?.[index] ?? 0) / scale);
    }
    return result;
  }
  const result = new Float32Array(totalCount);
  result.set(primary);
  for (let index = 0; index < secondaryCount; index += 1) {
    result[primary.length + index] = secondary?.[index] ?? Number.NaN;
  }
  return result;
}

function createCombinedReadonlyArray<T>(
  first: readonly T[],
  second: readonly T[],
): readonly T[] {
  const firstLength = first.length;
  const length = firstLength + second.length;
  return new Proxy({ length }, {
    get(target, property) {
      if (property === 'length') return target.length;
      if (typeof property !== 'string' || !/^\d+$/u.test(property)) return undefined;
      const index = Number(property);
      return index < firstLength ? first[index] : second[index - firstLength];
    },
  }) as unknown as readonly T[];
}

function appendWebgpuPackedStyles(
  primary: FastScatterWebgpuPackedStyles | undefined,
  secondary: FastScatterDisplayColumns,
  primaryCount: number,
): FastScatterWebgpuPackedStyles | undefined {
  if (primary === undefined) return undefined;
  const styleStrideBytes = primary.styleStrideBytes ?? 4;
  const secondaryData = packWebgpuTableStyles(secondary, styleStrideBytes);
  const secondaryMaxPointSize = calculateTypedArrayDomain(
    secondary.size ?? new Float32Array(0),
  ).max;
  return {
    createPages: async function* createPages() {
      if ('data' in primary) {
        yield { data: primary.data, startPoint: 0 };
      } else {
        yield* primary.createPages();
      }
      yield { data: secondaryData, startPoint: primaryCount };
    },
    maxPointSize: Math.max(primary.maxPointSize, secondaryMaxPointSize),
    pointCount: primaryCount + secondary.x.length,
    styleStrideBytes,
  };
}

function packWebgpuTableStyles(
  columns: FastScatterDisplayColumns,
  styleStrideBytes: 4 | 8 | 12,
): Uint32Array {
  const wordsPerPoint = styleStrideBytes / Uint32Array.BYTES_PER_ELEMENT;
  const result = new Uint32Array(columns.x.length * wordsPerPoint);
  const resultFloats = new Float32Array(result.buffer);
  const color = columns.color;
  for (let index = 0; index < columns.x.length; index += 1) {
    const colorOffset = index * 4;
    const red = color?.[colorOffset] ?? 37;
    const green = color?.[colorOffset + 1] ?? 99;
    const blue = color?.[colorOffset + 2] ?? 235;
    const alpha = color?.[colorOffset + 3] ?? 255;
    const opacity = Math.round(Math.max(0, Math.min(1, columns.opacity?.[index] ?? 1)) * 255);
    const shape = Math.max(0, Math.min(7, columns.shape?.[index] ?? 0));
    const rotation = columns.rotationRadians?.[index] ?? columns.rotation?.[index] ?? 0;
    const fullTurn = Math.PI * 2;
    const signedRotation = ((rotation + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
    const normalizedRotation = (signedRotation + Math.PI) / fullTurn;
    const size = Math.max(0, columns.size?.[index] ?? 3);
    if (styleStrideBytes === 4) {
      const rgb565 = Math.round((red / 255) * 31) |
        (Math.round((green / 255) * 63) << 5) |
        (Math.round((blue / 255) * 31) << 11);
      result[index] = (
        rgb565 |
        (Math.round(((opacity * alpha) / (255 * 255)) * 15) << 16) |
        (shape << 20) |
        (Math.round(normalizedRotation * 63) << 23) |
        (Math.max(0, Math.min(7, Math.round(size - 1))) << 29)
      ) >>> 0;
      continue;
    }
    const outputOffset = index * wordsPerPoint;
    result[outputOffset] = (red | (green << 8) | (blue << 16) | (alpha << 24)) >>> 0;
    if (styleStrideBytes === 8) {
      result[outputOffset + 1] = (
        opacity |
        (shape << 8) |
        (Math.round(normalizedRotation * 1023) << 11) |
        (Math.min(2047, Math.round(size * 4)) << 21)
      ) >>> 0;
    } else {
      result[outputOffset + 1] = (
        opacity |
        (shape << 8) |
        (Math.round(normalizedRotation * 65535) << 16)
      ) >>> 0;
      resultFloats[outputOffset + 2] = size;
    }
  }
  return result;
}

async function assertWebgpuPointCapacity(pointCount: number): Promise<void> {
  const support = await diagnoseWebgpuSupport();
  if (!support.adapterAvailable || support.limits === undefined) {
    // Preserve the renderer lifecycle on unavailable platforms so the chart
    // surface can expose its normal WebGPU availability error. Capacity checks
    // apply only when an adapter returned concrete limits.
    return;
  }
  const styleBytes = pointCount * 4;
  const styleAllocationBytes = styleBytes > 128 * 1024 * 1024
    ? Math.ceil(styleBytes / 16) * 8
    : styleBytes;
  const coordinateBytes = pointCount * Float32Array.BYTES_PER_ELEMENT;
  const requiredBindingBytes = Math.max(
    coordinateBytes,
    Math.min(styleBytes, 128 * 1024 * 1024),
  );
  const failures: string[] = [];
  if (support.limits.maxBufferSize < Math.max(styleAllocationBytes, coordinateBytes)) {
    failures.push(
      `maxBufferSize=${support.limits.maxBufferSize} requires at least ${Math.max(styleAllocationBytes, coordinateBytes)}`,
    );
  }
  if (support.limits.maxStorageBufferBindingSize < requiredBindingBytes) {
    failures.push(
      `maxStorageBufferBindingSize=${support.limits.maxStorageBufferBindingSize} requires at least ${requiredBindingBytes}`,
    );
  }
  if (support.limits.maxStorageBuffersPerShaderStage < 7) {
    failures.push(
      `maxStorageBuffersPerShaderStage=${support.limits.maxStorageBuffersPerShaderStage} requires at least 7`,
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `This WebGPU adapter cannot render ${pointCount.toLocaleString()} individually styled points: ${failures.join('; ')}.`,
    );
  }
}

async function runBoundedTasks<T>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(values.length, Math.max(1, Math.floor(concurrency)));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      await task(values[index]!);
    }
  }));
}

function calculateTypedArrayDomain(
  values: Float32Array | Float64Array | Uint8Array | Uint16Array | Uint32Array,
): FastScatterRange {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return {
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
  };
}

function copyPagedWebgpuColumn<
  TArray extends Float32Array | Float64Array | Uint8Array | Uint16Array | Uint32Array,
>(
  target: TArray,
  page: ScatterWebgpuPagedManifestPage,
  buffer: ArrayBuffer,
  name: string,
  expectedType: string,
  constructor: { new(buffer: ArrayBuffer, byteOffset: number, length: number): TArray },
  copyCount: number,
  targetOffset = page.startIndex,
): void {
  const descriptor = page.columns[name];
  if (descriptor === undefined || descriptor.type !== expectedType) {
    throw new Error(`WebGPU scatter page column ${name} is missing or invalid.`);
  }
  const values = new constructor(buffer, descriptor.byteOffset, descriptor.length);
  target.set(values.subarray(0, copyCount) as TArray, targetOffset);
}

async function* streamPagedWebgpuStyles(
  pages: readonly ScatterWebgpuPagedManifestPage[],
  pointCount: number,
  signal: AbortSignal,
  strideBytes: 4 | 8 | 12,
  loadPage: ScatterWebgpuPageSource['loadStylePage'],
): AsyncGenerator<{ data: Uint32Array; startPoint: number }> {
  const activePages = pages.filter((page) => page.startIndex < pointCount);
  const pendingBuffers = new Map<number, Promise<ArrayBuffer>>();
  const prefetch = (pageIndex: number) => {
    const page = activePages[pageIndex];
    if (page !== undefined) {
      pendingBuffers.set(pageIndex, loadPage(page, pages.indexOf(page), signal));
    }
  };
  for (
    let pageIndex = 0;
    pageIndex < Math.min(WEBGPU_STYLE_PREFETCH_PAGES, activePages.length);
    pageIndex += 1
  ) {
    prefetch(pageIndex);
  }
  for (let pageIndex = 0; pageIndex < activePages.length; pageIndex += 1) {
    const page = activePages[pageIndex]!;
    const buffer = await pendingBuffers.get(pageIndex)!;
    pendingBuffers.delete(pageIndex);
    prefetch(pageIndex + WEBGPU_STYLE_PREFETCH_PAGES);
    const pagePointCount = Math.min(page.count, pointCount - page.startIndex);
    const expectedByteLength = pagePointCount * strideBytes;
    if (
      buffer.byteLength < expectedByteLength ||
      page.styleByteLength !== page.count * strideBytes
    ) {
      throw new Error(`WebGPU scatter style page ${page.styleBinary} is invalid.`);
    }
    yield {
      data: new Uint32Array(buffer, 0, pagePointCount * (strideBytes / 4)),
      startPoint: page.startIndex,
    };
  }
}

function createPagedWebgpuAxisMap(
  manifest: ScatterWebgpuPagedManifest,
  schema: FastScatterDatasetSchema,
  x: Float64Array | Uint32Array,
): Readonly<Record<string, FastScatterEncodedAxis>> {
  const result: Record<string, FastScatterEncodedAxis> = {};
  for (const column of schema.columns) {
    if (column.role !== 'x' && column.role !== 'y') continue;
    const domain = manifest.domains[column.key] ?? { min: 0, max: 0 };
    if (column.axisType === 'datetime-ns') {
      result[column.key] = {
        columnKey: column.key,
        datetimeOriginNs: manifest.timestampOriginNs,
        datetimeOriginNsBigInt: BigInt(manifest.timestampOriginNs),
        ...(manifest.xScaleMs === undefined ? {} : { encodedScaleMs: manifest.xScaleMs }),
        domain,
        epochNsValues: createLazyEpochNsArray(
          manifest.timestampOriginNs,
          x,
          manifest.xScaleMs ?? 1,
        ),
        kind: 'datetime-ns',
        parameterName: column.parameterName ?? column.key,
        title: createColumnarAxisTitle(column),
        unit: column.unit,
      };
    } else if (column.axisType === 'categorical' || column.axisType === 'boolean') {
      result[column.key] = {
        categories: (column.categories ?? []).map((category, index) => ({
          encoded: category.order ?? index,
          label: category.label ?? String(category.value),
          value: String(category.value),
        })),
        columnKey: column.key,
        domain,
        kind: column.axisType,
        parameterName: column.parameterName ?? column.key,
        title: createColumnarAxisTitle(column),
        unit: column.unit,
      };
    } else {
      result[column.key] = {
        columnKey: column.key,
        domain,
        ...(manifest.columnScales?.[column.key] === undefined
          ? {}
          : { encodedScale: manifest.columnScales[column.key] }),
        kind: 'numeric',
        parameterName: column.parameterName ?? column.key,
        title: createColumnarAxisTitle(column),
        unit: column.unit,
      };
    }
  }
  return result;
}

function createLazyEpochNsArray(
  origin: string,
  x: Float64Array | Uint32Array,
  scaleMs: number,
): readonly string[] {
  const originNs = BigInt(origin);
  return new Proxy({ length: x.length }, {
    get(target, property) {
      if (property === 'length') return target.length;
      if (typeof property === 'string' && /^\d+$/u.test(property)) {
        const index = Number(property);
        if (index >= target.length) return undefined;
        return (
          originNs + BigInt(Math.round((x[index] ?? 0) * scaleMs * 1_000_000))
        ).toString();
      }
      return undefined;
    },
  }) as unknown as readonly string[];
}

function createGeneratedOverlapXColumn(pointCount: number): Uint32Array {
  const target = {
    byteLength: 0,
    generatedOverlapIndex: true,
    length: pointCount,
  };
  return new Proxy(target, {
    get(source, property) {
      if (property === Symbol.iterator) {
        return function* iterator() {
          for (let index = 0; index < pointCount; index += 1) {
            yield generatedOverlapXValue(index);
          }
        };
      }
      if (property in source) return source[property as keyof typeof source];
      if (typeof property === 'string' && /^\d+$/u.test(property)) {
        const index = Number(property);
        return index < pointCount ? generatedOverlapXValue(index) : undefined;
      }
      return undefined;
    },
  }) as unknown as Uint32Array;
}

function generatedOverlapXValue(index: number): number {
  const blockStart = Math.floor(index / 24) * 24;
  const offset = index - blockStart;
  if (offset >= 2 && offset < 5) return blockStart + 2;
  if (offset >= 14 && offset < 16) return blockStart + 14;
  return index;
}

function parseWebgpuPointCount(searchParams: URLSearchParams): number {
  const raw = searchParams.get(WEBGPU_POINT_COUNT_PARAM);
  if (raw === null) return DEFAULT_WEBGPU_POINT_COUNT;
  const count = Number(raw);
  return Number.isSafeInteger(count) && count > 0
    ? Math.min(MAX_WEBGPU_DEMO_POINT_COUNT, count)
    : DEFAULT_WEBGPU_POINT_COUNT;
}

function calculateFastScatterHoverIndexBytes(
  index: FastScatterHoverIndexSet,
  columns?: Pick<FastScatterDisplayColumns, 'y'>,
): number {
  const seen = new Set<ArrayBufferLike>(
    Object.values(columns?.y ?? {}).map((values) => values.buffer),
  );
  let total = 0;
  const add = (values: ArrayBufferView) => {
    if (seen.has(values.buffer)) return;
    seen.add(values.buffer);
    total += values.byteLength;
  };
  for (const grid of Object.values(index.gridsByYKey)) {
    add(grid.cellOffsets);
    add(grid.pointIndices);
  }
  for (const compact of Object.values(index.compactByYKey ?? {})) {
    add(compact.yBins);
    add(compact.blockOccupancy);
    add(compact.overviewIndices);
  }
  return total;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new DOMException('WebGPU dataset loading was aborted.', 'AbortError');
  }
}

function toWebgpuPlotOptions(
  options: ScatterPlotOptions,
  packedStyles?: FastScatterWebgpuPackedStyles,
  aggregationBackend: FastScatterWebgpuAggregationBackend = 'auto',
): ScatterWebgpuPlotOptions {
  const indexedStyle =
    packedStyles === undefined &&
    options.columns.color === undefined &&
    options.columns.opacity === undefined &&
    options.columns.rotation === undefined &&
    options.columns.shape === undefined &&
    options.columns.size === undefined;
  return {
    ...options,
    aggregationBackend,
    canvasClassName: 'scatter-fast-engine-canvas scatter-fast-webgpu-canvas',
    hostClassName: 'scatter-fast-engine-host scatter-fast-webgpu-host',
    indexedStyle,
    packedStyles,
    requestTimestampQuery: true,
    visualizationMode: options.visualizationMode,
  };
}

function PlaceholderChartShell({
  rendererBackend,
  datasetState,
  effectiveMode,
  fastViewport,
  focusedPlotId,
  activePlotId,
  heatmapBinSizePx,
  heatmapPalette,
  hoverInspection,
  measurementInspection,
  hoverSourceIndex,
  onActivePlotChange,
  onMetrics,
  onHoverChange,
  onHeatmapBinSizeWheelAdjust,
  onMeasurementChange,
  onPointSizeWheelAdjust,
  onPlotInteractionFocusChange,
  onPlotInteractionHoverChange,
  onPlotInteractionSurfacePointerDown,
  plotRef,
  onRendererMetrics,
  onRenderStateChange,
  onSelectionChange,
  onViewportChange,
  onViewportUndoRequest,
  pointSizeScale,
  plottedDataset,
  plotInteractionGate,
  renderingMode,
  selectedSourceIndices,
  urlState,
  theme,
  opacityScale,
  visualizationMode,
  webgpuAggregationBackend,
}: {
  rendererBackend: 'webgl2' | 'webgpu';
  datasetState: Exclude<DatasetLoadState, { status: 'error' }>;
  effectiveMode: InteractionMode;
  fastViewport: FastScatterViewport | null;
  focusedPlotId: string | null;
  activePlotId: string | null;
  heatmapBinSizePx: number;
  heatmapPalette: FastScatterHeatmapPalette;
  hoverInspection: FastScatterHoverEvent | null;
  measurementInspection: FastScatterMeasurementEvent | null;
  hoverSourceIndex: number | null;
  onActivePlotChange: (plotId: string | null) => void;
  onMetrics: (metrics: FastScatterMetricsEvent) => void;
  onHoverChange: (hover: FastScatterHoverEvent | null) => void;
  onHeatmapBinSizeWheelAdjust: (direction: 'decrease' | 'increase') => void;
  onMeasurementChange: (measurement: FastScatterMeasurementEvent | null) => void;
  onPointSizeWheelAdjust: (direction: 'decrease' | 'increase') => void;
  onPlotInteractionFocusChange: (hasFocusWithin: boolean) => void;
  onPlotInteractionHoverChange: (isHovered: boolean) => void;
  onPlotInteractionSurfacePointerDown: (element: HTMLDivElement | null) => void;
  plotRef: RefObject<ScatterPlotInstance | null>;
  onRendererMetrics: (action: SetStateAction<RendererMetricsState>) => void;
  onRenderStateChange: (state: ScatterRenderState, message?: string) => void;
  onSelectionChange: (selection: FastScatterSelectionEvent) => void;
  onViewportChange: (
    viewport: FastScatterViewport,
    reason?: FastScatterViewportChangeReason,
    phase?: FastScatterViewportChangePhase,
  ) => void;
  onViewportUndoRequest: () => void;
  pointSizeScale: number;
  plottedDataset: LoadedFastScatterDataset | null;
  plotInteractionGate: PlotInteractionGateState;
  renderingMode: FastScatterRenderingMode;
  selectedSourceIndices: Uint32Array | undefined;
  urlState: PrototypeSearchState | null;
  theme: ReturnType<typeof getFastScatterTheme>;
  opacityScale: number;
  visualizationMode: FastScatterVisualizationMode;
  webgpuAggregationBackend: FastScatterWebgpuAggregationBackend;
}) {
  useEffect(() => {
    if (
      datasetState.status !== 'loaded' ||
      selectedSourceIndices === undefined ||
      !isDemoTestControlEnabled(
        new URLSearchParams(window.location.search),
        '__e2eScatterFastSelectionHook',
      )
    ) {
      return;
    }

    const columns = datasetState.adaptedDataset.columns;
    window.__scatterFastSelectionTestHook = {
      exportSelectedIds: () =>
        materializeFastScatterSelectedIds(columns, selectedSourceIndices),
      exportSelectedRecordsText: () =>
        serializeFastScatterSelectedRecordsForExport(columns, selectedSourceIndices),
      getSelectedCount: () => selectedSourceIndices.length,
      getSelectedSourceIndices: () => Array.from(selectedSourceIndices),
      getSelectedSampleIds: (sampleSize = SELECTION_SAMPLE_SIZE) =>
        materializeFastScatterSelectedIds(
          columns,
          selectedSourceIndices.slice(0, Math.max(0, Math.floor(sampleSize))),
        ),
    };

    return () => {
      delete window.__scatterFastSelectionTestHook;
    };
  }, [datasetState, selectedSourceIndices]);

  useEffect(() => {
    if (
      plottedDataset === null ||
      !isDemoTestControlEnabled(
        new URLSearchParams(window.location.search),
        '__e2eScatterFastHoverHook',
      )
    ) {
      return;
    }

    window.__scatterFastHoverTestHook = {
      clearHoverSourceIndex: () => {
        plotRef.current?.commands.setHoverSourceIndex(null);
      },
      getCurrentHover: () => hoverInspection,
      getHoverSourceIndex: () =>
        plotRef.current?.commands.getStateSnapshot().hoverSourceIndex ?? hoverSourceIndex,
      setHoverSourceIndex: (sourceIndex) => {
        if (sourceIndex === null) {
          plotRef.current?.commands.setHoverSourceIndex(null);
          return;
        }

        const normalized = Math.floor(sourceIndex);
        const nextSourceIndex =
          Number.isSafeInteger(normalized) &&
          normalized >= 0 &&
          normalized < plottedDataset.columns.x.length
            ? normalized
            : null;
        plotRef.current?.commands.setHoverSourceIndex(nextSourceIndex);
      },
    };

    return () => {
      delete window.__scatterFastHoverTestHook;
    };
  }, [
    hoverInspection,
    hoverSourceIndex,
    plottedDataset,
    plotRef,
  ]);

  useEffect(() => {
    if (
      datasetState.status !== 'loaded' ||
      !isDemoTestControlEnabled(
        new URLSearchParams(window.location.search),
        '__e2eScatterFastMeasurementHook',
      )
    ) {
      return;
    }

    window.__scatterFastMeasurementTestHook = {
      getCurrent: () => measurementInspection?.current ?? null,
      getReference: () => measurementInspection?.reference ?? null,
      getSession: () => measurementInspection,
    };

    return () => {
      delete window.__scatterFastMeasurementTestHook;
    };
  }, [
    datasetState.status,
    measurementInspection,
  ]);

  const engineHostRef = useRef<HTMLDivElement | null>(null);
  const lastHoverMetricsPublishedAtRef = useRef(Number.NEGATIVE_INFINITY);
  const pendingInteractionMetricsRef = useRef<FastScatterMetricsEvent | null>(null);
  const [engineHostSize, setEngineHostSize] = useState({ height: 0, width: 0 });
  const [engineCursor, setEngineCursor] = useState('default');
  const [immediateHoverInspection, setImmediateHoverInspection] =
    useState<FastScatterHoverEvent | null>(hoverInspection);
  const [immediateMeasurementInspection, setImmediateMeasurementInspection] =
    useState<FastScatterMeasurementEvent | null>(measurementInspection);
  const [previewViewport, setPreviewViewport] = useState<FastScatterViewport | null>(null);
  const previewViewportClearFrameRef = useRef(0);
  const [engineOverlays, setEngineOverlays] = useState<
    readonly ScatterOverlayDescriptor[]
  >([]);
  const [navigatorSummary, setNavigatorSummary] =
    useState<FastScatterNavigatorSummary | null>(null);
  const [outOfRangeResult, setOutOfRangeResult] =
    useState<FastScatterOutOfRangeResult | null>(null);
  const [engineRenderState, setEngineRenderState] = useState<{
    message?: string;
    status: ScatterRenderState;
  }>({ status: 'idle' });
  const pointMarkerSourceIndicesRef = useRef<readonly number[]>([]);
  const hasFastViewport = fastViewport !== null;

  const currentEngineOptions = useMemo<ScatterPlotOptions | null>(() => {
    if (plottedDataset === null || fastViewport === null) {
      return null;
    }

    const query = new URLSearchParams(window.location.search);
    return {
      axisMode: urlState?.axis ?? 'xy',
      canvasClassName: 'scatter-fast-webgl-canvas',
      columns: plottedDataset.columns,
      focusedPlotId,
      forceWebglUnavailable: isDemoTestControlEnabled(
        query,
        '__e2eScatterFastDisableWebgl',
      ),
      heatmapBinSizePx,
      heatmapPalette,
      hoverIndex: plottedDataset.hoverIndex,
      hostClassName: 'scatter-fast-webgl-host',
      mode: effectiveMode,
      onMetrics: (metrics) => {
        if (metrics.phase === 'render') {
          onMetrics(metrics);
        }
        onRendererMetrics((previous) => updateRendererMetrics(previous, metrics));
      },
      opacityScale,
      pointSizeScale,
      preserveDrawingBuffer: isDemoTestControlEnabled(query, '__e2ePreserveDrawingBuffer'),
      renderingMode,
      selectedSourceIndices,
      spec: plottedDataset.spec,
      theme,
      viewport: fastViewport,
      visualizationMode,
    };
  }, [
    effectiveMode,
    fastViewport,
    focusedPlotId,
    heatmapBinSizePx,
    heatmapPalette,
    opacityScale,
    onMetrics,
    onRendererMetrics,
    plottedDataset,
    pointSizeScale,
    renderingMode,
    selectedSourceIndices,
    theme,
    urlState?.axis,
    visualizationMode,
  ]);
  const latestEngineOptionsRef = useRef<ScatterPlotOptions | null>(null);
  const latestEngineHandlersRef = useRef({
    onActivePlotChange,
    onHeatmapBinSizeWheelAdjust,
    onHoverChange,
    onMeasurementChange,
    onMetrics,
    onPointSizeWheelAdjust,
    onRendererMetrics,
    onRenderStateChange,
    onSelectionChange,
    onViewportChange,
    onViewportUndoRequest,
  });

  useEffect(() => {
    latestEngineOptionsRef.current = currentEngineOptions;
  }, [currentEngineOptions]);

  useEffect(() => {
    latestEngineHandlersRef.current = {
      onActivePlotChange,
      onHeatmapBinSizeWheelAdjust,
      onHoverChange,
      onMeasurementChange,
      onMetrics,
      onPointSizeWheelAdjust,
      onRendererMetrics,
      onRenderStateChange,
      onSelectionChange,
      onViewportChange,
      onViewportUndoRequest,
    };
  }, [
    onActivePlotChange,
    onHeatmapBinSizeWheelAdjust,
    onHoverChange,
    onMeasurementChange,
    onMetrics,
    onPointSizeWheelAdjust,
    onRendererMetrics,
    onRenderStateChange,
    onSelectionChange,
    onViewportChange,
    onViewportUndoRequest,
  ]);

  useEffect(() => {
    const host = engineHostRef.current;
    if (host === null) {
      return;
    }

    const updateSize = () => {
      const hostRect = host.getBoundingClientRect();
      const parentRect = host.parentElement?.getBoundingClientRect();
      const shell = host.closest('.scatter-fast-chart-shell');
      const shellRect = shell?.getBoundingClientRect();
      const rect =
        hostRect.width > 0 && hostRect.height > 0
          ? hostRect
          : parentRect !== undefined && parentRect.width > 0 && parentRect.height > 0
            ? parentRect
            : shellRect !== undefined && shellRect.width > 0 && shellRect.height > 0
              ? {
                  height: shellRect.height,
                  width: shellRect.width,
                }
              : hostRect;
      setEngineHostSize((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { height: rect.height, width: rect.width },
      );
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(host);

    return () => {
      observer.disconnect();
    };
  }, [plottedDataset, fastViewport]);

  useEffect(() => {
    const host = engineHostRef.current;
    const initialOptions = latestEngineOptionsRef.current;
    if (host === null || initialOptions === null) {
      return;
    }

    const plot =
      rendererBackend === 'webgpu'
        ? createScatterWebgpuPlot(
            host,
            toWebgpuPlotOptions(
              initialOptions,
              plottedDataset?.packedStyles,
              webgpuAggregationBackend,
            ),
          )
        : createScatterPlot(host, initialOptions);

    plotRef.current = plot;
    plot.canvas.dataset.testid =
      rendererBackend === 'webgpu'
        ? 'scatter-fast-webgpu-canvas'
        : 'scatter-fast-webgl-canvas';
    plot.use(
      createDefaultScatterBindings({
        easterEgg: { sequence: 'future' },
        inputElement: host.parentElement ?? host,
        suppressContextMenu: true,
      }),
    );
    for (const sourceIndex of pointMarkerSourceIndicesRef.current) {
      plot.commands.togglePointMarker({ sourceIndex });
    }
    plot.update({ onMetrics: undefined });

    const subscriptions = [
      plot.on('viewportchange', ({ phase, reason, viewport }) => {
        if (previewViewportClearFrameRef.current !== 0) {
          window.cancelAnimationFrame(previewViewportClearFrameRef.current);
          previewViewportClearFrameRef.current = 0;
        }
        if (rendererBackend !== 'webgpu' || phase === 'commit') {
          setPreviewViewport(viewport);
        }
        latestEngineHandlersRef.current.onViewportChange(viewport, reason, phase);
        if (phase === 'commit' && pendingInteractionMetricsRef.current !== null) {
          const pendingMetrics = pendingInteractionMetricsRef.current;
          pendingInteractionMetricsRef.current = null;
          latestEngineHandlersRef.current.onRendererMetrics((previous) =>
            updateRendererMetrics(previous, pendingMetrics),
          );
        }
        if (phase === 'commit') {
          previewViewportClearFrameRef.current = window.requestAnimationFrame(() => {
            previewViewportClearFrameRef.current = 0;
            setPreviewViewport(null);
          });
        }
      }),
      plot.on('selectionchange', (selection) => {
        latestEngineHandlersRef.current.onSelectionChange(selection);
      }),
      plot.on('hoverchange', (hover) => {
        flushSync(() => setImmediateHoverInspection(hover));
        startTransition(() => {
          latestEngineHandlersRef.current.onHoverChange(hover);
        });
      }),
      plot.on('measurementchange', (measurement) => {
        flushSync(() => setImmediateMeasurementInspection(measurement));
        startTransition(() => {
          latestEngineHandlersRef.current.onMeasurementChange(measurement);
        });
      }),
      plot.on('activeplotchange', ({ plotId }) => {
        latestEngineHandlersRef.current.onActivePlotChange(plotId);
      }),
      plot.on('cursorchange', ({ cursor }) => {
        setEngineCursor(cursor);
      }),
      plot.on('renderstatechange', ({ message, state }) => {
        setEngineRenderState({ message, status: state });
        latestEngineHandlersRef.current.onRenderStateChange(state, message);
      }),
      plot.on('metrics', (metrics) => {
        if (
          rendererBackend === 'webgpu' && metrics.phase === 'render' &&
          parseMetricDetail(metrics.detail).cachedInteractionFrame === true
        ) {
          return;
        }
        if (metrics.phase === 'render') {
          latestEngineHandlersRef.current.onMetrics(metrics);
        }
        if (metrics.phase === 'hover') {
          const now = performance.now();
          if (now - lastHoverMetricsPublishedAtRef.current < 100) {
            return;
          }
          lastHoverMetricsPublishedAtRef.current = now;
          startTransition(() => {
            latestEngineHandlersRef.current.onRendererMetrics((previous) =>
              updateRendererMetrics(previous, metrics),
            );
          });
          return;
        }
        if (rendererBackend === 'webgpu' && metrics.phase === 'interaction') {
          pendingInteractionMetricsRef.current = metrics;
          return;
        }
        latestEngineHandlersRef.current.onRendererMetrics((previous) =>
          updateRendererMetrics(previous, metrics),
        );
      }),
      plot.on('pointsizeadjustrequest', ({ delta }) => {
        latestEngineHandlersRef.current.onPointSizeWheelAdjust(
          delta >= 0 ? 'increase' : 'decrease',
        );
      }),
      plot.on('heatmapbinsizeadjustrequest', ({ delta }) => {
        latestEngineHandlersRef.current.onHeatmapBinSizeWheelAdjust(
          delta >= 0 ? 'increase' : 'decrease',
        );
      }),
      plot.on('viewportundorequest', () => {
        latestEngineHandlersRef.current.onViewportUndoRequest();
      }),
      plot.on('overlaychange', ({ overlays }) => {
        setEngineOverlays(overlays);
      }),
    ];

    const renderSnapshot = plot.commands.getRenderSnapshot();
    setEngineCursor(plot.commands.getStateSnapshot().cursor);
    setEngineOverlays(plot.commands.getOverlays());
    setEngineRenderState({
      message: renderSnapshot.renderStateMessage,
      status: renderSnapshot.renderState,
    });
    latestEngineHandlersRef.current.onRenderStateChange(
      renderSnapshot.renderState,
      renderSnapshot.renderStateMessage,
    );
    if (rendererBackend === 'webgpu') {
      const message = 'Initializing WebGPU adapter, pipelines, and persistent buffers.';
      setEngineRenderState({ message, status: 'rendering' });
      latestEngineHandlersRef.current.onRenderStateChange('rendering', message);
    }

    return () => {
      if (previewViewportClearFrameRef.current !== 0) {
        window.cancelAnimationFrame(previewViewportClearFrameRef.current);
        previewViewportClearFrameRef.current = 0;
      }
      pointMarkerSourceIndicesRef.current =
        plot.commands.getStateSnapshot().pointMarkerSourceIndices;
      subscriptions.forEach((unsubscribe) => unsubscribe());
      setEngineOverlays([]);
      setEngineCursor('default');
      setEngineRenderState({ status: 'idle' });
      if (plotRef.current === plot) {
        plotRef.current = null;
      }
      plot.dispose();
    };
  }, [
    hasFastViewport,
    plottedDataset,
    plotRef,
    rendererBackend,
    webgpuAggregationBackend,
  ]);

  useEffect(() => {
    if (plottedDataset === null || fastViewport === null) {
      return;
    }

    const plot = plotRef.current;
    if (plot === null) {
      return;
    }

    const updateOptions: Partial<ScatterPlotOptions> = {
      axisMode: urlState?.axis ?? 'xy',
      columns: plottedDataset.columns,
      focusedPlotId,
      heatmapBinSizePx,
      heatmapPalette,
      hoverIndex: plottedDataset.hoverIndex,
      mode: effectiveMode,
      opacityScale,
      pointSizeScale,
      renderingMode,
      selectedSourceIndices,
      spec: plottedDataset.spec,
      theme,
      viewport: fastViewport,
      visualizationMode,
    };
    if (
      areFastScatterViewportsEqual(
        plot.commands.getStateSnapshot().viewport,
        fastViewport,
      )
    ) {
      delete updateOptions.viewport;
    }
    plot.update(updateOptions);
  }, [
    effectiveMode,
    fastViewport,
    focusedPlotId,
    heatmapBinSizePx,
    heatmapPalette,
    opacityScale,
    plottedDataset,
    plotRef,
    pointSizeScale,
    renderingMode,
    selectedSourceIndices,
    theme,
    urlState?.axis,
    visualizationMode,
  ]);

  const engineLayout = useMemo(() => {
    if (
      plottedDataset === null ||
      engineHostSize.width <= 0 ||
      engineHostSize.height <= 0
    ) {
      return null;
    }

    return createFastScatterLayout(plottedDataset.spec, {
      focusedPlotId,
      heightCssPx: engineHostSize.height,
      navigatorCssPx: 36,
      widthCssPx: engineHostSize.width,
    });
  }, [engineHostSize.height, engineHostSize.width, focusedPlotId, plottedDataset]);

  useEffect(() => {
    if (plottedDataset === null || engineLayout === null) {
      return;
    }

    const binCount = Math.max(48, Math.min(260, Math.floor(engineLayout.widthCssPx / 4)));
    return scheduleAfterFirstPaint(() => {
      const startedAt = performance.now();
      const summary = createFastScatterNavigatorSummary({
        binCount,
        domain: calculateFastScatterDomain(plottedDataset.columns, plottedDataset.spec).x,
        x: plottedDataset.columns.x,
      });
      setNavigatorSummary(summary);
      onRendererMetrics((previous) =>
        updateRendererMetrics(previous, {
          at: performance.now(),
          detail: JSON.stringify({
            binCount: summary.bins.length,
            operation: 'navigator-summary',
          }),
          durationMs: performance.now() - startedAt,
          phase: 'interaction',
          pointCount: plottedDataset.columns.x.length,
        }),
      );
    });
  }, [engineLayout, onRendererMetrics, plottedDataset]);

  useEffect(() => {
    if (plottedDataset === null || engineLayout === null || fastViewport === null) {
      return;
    }

    return scheduleAfterFirstPaint(() => {
      const result = computeFastScatterOutOfRangeMarkers({
        columns: plottedDataset.columns,
        plotRects: engineLayout.plotRects,
        sampleStride: Math.max(
          1,
          Math.ceil(plottedDataset.columns.x.length / 1_000_000),
        ),
        spec: plottedDataset.spec,
        viewport: fastViewport,
      });
      setOutOfRangeResult(result);
      onRendererMetrics((previous) =>
        updateRendererMetrics(previous, {
          at: performance.now(),
          detail: JSON.stringify({
            candidateCount: result.candidateCount,
            markerCount: result.markerCount,
            operation: 'out-of-range',
          }),
          durationMs: result.durationMs,
          phase: 'interaction',
        }),
      );
    });
  }, [engineLayout, fastViewport, onRendererMetrics, plottedDataset]);

  const routeEngineOverlays = useMemo<readonly ScatterOverlayDescriptor[]>(() => {
    if (
      plottedDataset === null ||
      engineLayout === null ||
      fastViewport === null ||
      outOfRangeResult === null ||
      outOfRangeResult.markerCount === 0
    ) {
      return engineOverlays;
    }
    return [
      ...engineOverlays,
      {
        candidateCount: outOfRangeResult.candidateCount,
        durationMs: outOfRangeResult.durationMs,
        id: 'out-of-range-markers',
        kind: 'out-of-range-markers',
        markers: outOfRangeResult.markers,
      },
    ];
  }, [engineLayout, engineOverlays, fastViewport, outOfRangeResult, plottedDataset]);

  if (plottedDataset !== null && fastViewport !== null) {
    const plotReadyForInteraction =
      engineLayout !== null && engineRenderState.status === 'ready';

    return (
      <div className="scatter-fast-render-shell">
        <div
          aria-label="m-scatter plot interaction surface"
          aria-busy={plotReadyForInteraction ? undefined : true}
          className="fast-plot-interaction-surface"
          data-active-plot={activePlotId ?? 'none'}
          data-interaction-active={
            isPlotInteractionGateActive(plotInteractionGate) ? 'true' : 'false'
          }
          data-interaction-focused={
            plotInteractionGate.hasFocusWithin ? 'true' : 'false'
          }
          data-interaction-hovered={plotInteractionGate.isHovered ? 'true' : 'false'}
          data-plot-ready={plotReadyForInteraction ? 'true' : 'false'}
          data-testid="scatter-fast-interaction-surface"
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              onPlotInteractionFocusChange(false);
            }
          }}
          onFocusCapture={() => {
            onPlotInteractionFocusChange(true);
          }}
          onPointerDownCapture={(event) => {
            onPlotInteractionSurfacePointerDown(event.currentTarget);
          }}
          onPointerEnter={() => {
            onPlotInteractionHoverChange(true);
          }}
          onPointerLeave={() => {
            onPlotInteractionHoverChange(false);
          }}
          tabIndex={0}
        >
          <div
            ref={engineHostRef}
            aria-label={`${rendererBackend === 'webgpu' ? 'WebGPU' : 'WebGL2'} scatter-fast point canvas host`}
            className={
              rendererBackend === 'webgpu'
                ? 'scatter-fast-webgpu-host'
                : 'scatter-fast-webgl-host'
            }
            data-axis={urlState?.axis ?? 'xy'}
            data-cursor={engineCursor}
            data-focused-plot={focusedPlotId ?? 'all'}
            data-mode={effectiveMode}
            data-record-count={plottedDataset.columns.x.length}
            data-render-policy="metrics-reported"
            data-render-state={engineRenderState.status}
            data-renderer={`${rendererBackend}-points`}
            data-requested-rendering-mode={renderingMode ?? 'points'}
            data-testid="scatter-fast-chart-shell"
            data-x-axis-label={plottedDataset.spec.xLabel}
            data-y-axis-labels={plottedDataset.spec.plots
              .map((plot) => plot.label)
              .join('|')}
            onAuxClick={(event) => {
              if (event.button === 1 || event.button === 2) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            onDragStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          />
          {engineLayout === null ? null : (
            <FastScatterOverlay
              columns={plottedDataset.columns}
              heightCssPx={engineLayout.heightCssPx}
              plotRects={engineLayout.plotRects}
              spec={plottedDataset.spec}
              viewport={previewViewport ?? fastViewport}
              widthCssPx={engineLayout.widthCssPx}
            />
          )}
          {engineLayout === null ? null : (
            <MScatterEngineOverlayLayer
              columns={plottedDataset.columns}
              heightCssPx={engineLayout.heightCssPx}
              hover={immediateHoverInspection}
              measurement={immediateMeasurementInspection}
              navigatorSummary={navigatorSummary}
              overlays={routeEngineOverlays}
              plotRects={engineLayout.plotRects}
              spec={plottedDataset.spec}
              viewport={previewViewport ?? fastViewport}
              widthCssPx={engineLayout.widthCssPx}
            />
          )}
          {engineRenderState.status === 'rendering' ? (
            <span className="scatter-fast-render-status" data-testid="scatter-fast-render-status">
              {engineRenderState.message ?? `Rendering ${rendererBackend === 'webgpu' ? 'WebGPU' : 'WebGL2'} scatter...`}
            </span>
          ) : null}
          {engineRenderState.status === 'error' ? (
            <span
              className="scatter-fast-render-error"
              data-testid="scatter-fast-render-error"
              role="alert"
            >
              {engineRenderState.message}
            </span>
          ) : null}
          {plotReadyForInteraction ? null : (
            <PlotLoadingOverlay
              detail={engineRenderState.message ?? 'Loading renderer and plot data'}
              label="Preparing scatter plot"
              testId="scatter-fast-plot-loading"
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="scatter-fast-placeholder"
      data-x-mode={parseFastScatterXMode(new URLSearchParams(window.location.search))}
      data-mode={
        urlState === null ? 'pending' : normalizeFastScatterRouteMode(urlState.mode)
      }
      data-axis={urlState?.axis ?? 'pending'}
      data-record-count={
        plottedDataset === null ? 'pending' : String(plottedDataset.columns.x.length)
      }
      data-testid="scatter-fast-chart-shell"
    >
      <div className="scatter-fast-placeholder-copy">
        <p>
          Placeholder shell for the custom scatter renderer using the existing
          scatter dataset and URL state.
        </p>
      </div>
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

function WebgpuDatasetSetup({
  datasetState,
  onCancel,
  onGenerate,
  onSelectPointCount,
  pointCount,
}: {
  datasetState: Extract<DatasetLoadState, { status: 'generating' | 'missing' }>;
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
      data-testid="scatter-webgpu-dataset-setup"
    >
      <h2>Generate the WebGPU demo dataset</h2>
      <p>
        The data is generated in this browser and kept in IndexedDB for future visits.
        Nothing is uploaded. The selected dataset uses about {formatBytes(pointCount * 8)}
        {' '}of browser storage. In multiple-table mode, the build-generated 1,000-record
        secondary table is added after the primary dataset loads.
      </p>
      {datasetState.status === 'missing' && datasetState.message !== undefined ? (
        <p role="alert">{datasetState.message}</p>
      ) : null}
      <div
        aria-label="WebGPU dataset size"
        className="segmented-control"
        role="group"
      >
        {SCATTER_WEBGPU_DEMO_POINT_COUNTS.map((candidate) => (
          <button
            className={pointCount === candidate ? 'is-active' : undefined}
            disabled={datasetState.status === 'generating'}
            key={candidate}
            onClick={() => onSelectPointCount(candidate)}
            type="button"
          >
            {formatCompactPointCount(candidate)} points
          </button>
        ))}
      </div>
      {datasetState.status === 'generating' ? (
        <div aria-live="polite" className="scatter-webgpu-generation-progress" role="status">
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
          data-testid="scatter-webgpu-generate-dataset"
          onClick={onGenerate}
          type="button"
        >
          Generate {formatCompactPointCount(pointCount)} points locally
        </button>
      )}
    </div>
  );
}

function formatCompactPointCount(pointCount: number): string {
  return pointCount >= 1_000_000
    ? `${pointCount / 1_000_000}M`
    : pointCount.toLocaleString();
}

function MScatterEngineOverlayLayer({
  columns,
  heightCssPx,
  hover,
  measurement,
  navigatorSummary,
  overlays,
  plotRects,
  spec,
  viewport,
  widthCssPx,
}: {
  columns: FastScatterDisplayColumns;
  heightCssPx: number;
  hover: FastScatterHoverEvent | null;
  measurement: FastScatterMeasurementEvent | null;
  navigatorSummary: FastScatterNavigatorSummary | null;
  overlays: readonly ScatterOverlayDescriptor[];
  plotRects: readonly FastScatterPlotRect[];
  spec: FastScatterPlotSpec;
  viewport: FastScatterViewport;
  widthCssPx: number;
}) {
  const rectangleZoomOverlays = overlays.filter(
    (overlay) => overlay.kind === 'rectangle-zoom',
  );
  const rectangleSelectionOverlays = overlays.filter(
    (overlay) => overlay.kind === 'rectangle-selection',
  );
  const lassoOverlays = overlays.filter((overlay) => overlay.kind === 'lasso');
  const committedShapes = overlays.flatMap((overlay) =>
    overlay.kind === 'committed-selection' ? overlay.shapes : [],
  );
  const hoverGuides = overlays.filter((overlay) => overlay.kind === 'hover-guide');
  const measurementGuides = overlays.filter(
    (overlay) => overlay.kind === 'measurement-guide',
  );
  const pointMarkers = overlays.filter((overlay) => overlay.kind === 'point-marker');
  const cursorTooltip = overlays.find((overlay) => overlay.kind === 'cursor-tooltip');
  const navigatorOverlay = overlays.find((overlay) => overlay.kind === 'navigator');
  const outOfRangeOverlay = overlays.find(
    (overlay) => overlay.kind === 'out-of-range-markers',
  );
  const aggregateInspection =
    hover?.aggregate === undefined || hover.canvasPoint === undefined
      ? null
      : {
          aggregate: hover.aggregate,
          visual: resolveRouteAggregateInspectionVisual({
            aggregate: hover.aggregate,
            plotId: hover.point.plotId,
            plotRects,
            viewport,
          }),
          xCssPx: hover.canvasPoint.canvasX,
          yCssPx: hover.canvasPoint.canvasY,
        };
  const tooltip =
    createRouteCursorTooltip({
      columns,
      hover,
      measurement,
      spec,
    });
  const cursorTooltipAnchor =
    cursorTooltip?.anchor ??
    (hover === null
      ? undefined
      : {
          xCssPx: hover.canvasPoint.canvasX,
          yCssPx: hover.canvasPoint.canvasY,
        });
  const tooltipPlacement =
    cursorTooltipAnchor === undefined || tooltip === null
      ? null
      : resolveRouteCursorTooltipPlacement(
          cursorTooltipAnchor.xCssPx,
          cursorTooltipAnchor.yCssPx,
          widthCssPx,
          heightCssPx,
          tooltip.fields.length,
        );

  return (
    <>
      {rectangleZoomOverlays.length === 0 ? null : (
        <svg
          aria-hidden="true"
          className="scatter-fast-rectangle-zoom-overlay"
          data-testid="scatter-fast-rectangle-zoom-overlay"
          height={heightCssPx}
          viewBox={`0 0 ${widthCssPx} ${heightCssPx}`}
          width={widthCssPx}
        >
          {rectangleZoomOverlays.map((overlay) => (
            <rect
              className="scatter-fast-rectangle-zoom-box"
              data-plot-id={overlay.plotId}
              data-testid="scatter-fast-rectangle-zoom-box"
              height={overlay.rect.heightCssPx}
              key={overlay.id}
              width={overlay.rect.widthCssPx}
              x={overlay.rect.xCssPx}
              y={overlay.rect.yCssPx}
            />
          ))}
        </svg>
      )}
      {rectangleSelectionOverlays.length === 0 ? null : (
        <svg
          aria-hidden="true"
          className="scatter-fast-rectangle-selection-overlay"
          data-testid="scatter-fast-rectangle-selection-overlay"
          height={heightCssPx}
          viewBox={`0 0 ${widthCssPx} ${heightCssPx}`}
          width={widthCssPx}
        >
          {rectangleSelectionOverlays.map((overlay) => (
            <rect
              className="scatter-fast-rectangle-selection-box"
              data-plot-id={overlay.plotId}
              data-testid="scatter-fast-rectangle-selection-box"
              height={overlay.rect.heightCssPx}
              key={overlay.id}
              width={overlay.rect.widthCssPx}
              x={overlay.rect.xCssPx}
              y={overlay.rect.yCssPx}
            />
          ))}
        </svg>
      )}
      {lassoOverlays.length === 0 ? null : (
        <svg
          aria-hidden="true"
          className="scatter-fast-lasso-selection-overlay"
          data-testid="scatter-fast-lasso-selection-overlay"
          height={heightCssPx}
          viewBox={`0 0 ${widthCssPx} ${heightCssPx}`}
          width={widthCssPx}
        >
          {lassoOverlays.map((overlay) => (
            <path
              className="scatter-fast-lasso-selection-path"
              data-plot-id={overlay.plotId}
              data-testid="scatter-fast-lasso-selection-path"
              d={createFastScatterRouteLassoPath(overlay.points)}
              key={overlay.id}
            />
          ))}
        </svg>
      )}
      {committedShapes.length === 0 ? null : (
        <svg
          aria-hidden="true"
          className="scatter-fast-committed-selection-overlay"
          data-committed-lasso-count={String(
            committedShapes.filter((shape) => shape.kind === 'lasso').length,
          )}
          data-committed-rectangle-count={String(
            committedShapes.filter((shape) => shape.kind === 'rectangle').length,
          )}
          data-committed-selection-count={String(committedShapes.length)}
          data-testid="scatter-fast-committed-selection-overlay"
          height={heightCssPx}
          viewBox={`0 0 ${widthCssPx} ${heightCssPx}`}
          width={widthCssPx}
        >
          {committedShapes.map((shape, index) =>
            shape.kind === 'rectangle' ? (
              <rect
                className="scatter-fast-rectangle-selection-box scatter-fast-committed-selection-box"
                data-plot-id={shape.plotId}
                data-testid="scatter-fast-committed-rectangle-selection-box"
                height={shape.rect.heightCssPx}
                key={`${shape.kind}:${shape.plotId}:${shape.rect.xCssPx}:${shape.rect.yCssPx}:${index}`}
                width={shape.rect.widthCssPx}
                x={shape.rect.xCssPx}
                y={shape.rect.yCssPx}
              />
            ) : (
              <path
                className="scatter-fast-lasso-selection-path scatter-fast-committed-selection-path"
                data-plot-id={shape.plotId}
                data-testid="scatter-fast-committed-lasso-selection-path"
                d={createFastScatterRouteLassoPath(shape.points)}
                key={`${shape.kind}:${shape.plotId}:${index}`}
              />
            ),
          )}
        </svg>
      )}
      {hoverGuides.length === 0 && measurementGuides.length === 0 ? null : (
        <svg
          aria-hidden="true"
          className="scatter-fast-inspection-guide-layer"
          data-measurement-active={measurementGuides.length === 0 ? 'false' : 'true'}
          data-testid="scatter-fast-inspection-guide-layer"
          height={heightCssPx}
          viewBox={`0 0 ${widthCssPx} ${heightCssPx}`}
          width={widthCssPx}
        >
          {measurementGuides.map((overlay) => (
            <g
              className="scatter-fast-inspection-crosshair-reference"
              data-testid="scatter-fast-measurement-reference-guide"
              key={`${overlay.id}:reference`}
            >
              <circle
                className="scatter-fast-inspection-anchor"
                cx={overlay.reference.xCssPx}
                cy={overlay.reference.yCssPx}
                data-plot-id={overlay.plotId}
                data-testid="scatter-fast-inspection-anchor"
                r={4}
              />
              <line
                className="scatter-fast-inspection-connector"
                data-plot-id={overlay.plotId}
                data-testid="scatter-fast-inspection-connector"
                x1={overlay.reference.xCssPx}
                x2={overlay.current.xCssPx}
                y1={overlay.reference.yCssPx}
                y2={overlay.current.yCssPx}
              />
            </g>
          ))}
          {hoverGuides.map((overlay) => (
            <g
              className="scatter-fast-inspection-crosshair"
              data-source-index={overlay.sourceIndex}
              data-testid="scatter-fast-current-hover-guide"
              key={overlay.id}
            >
              <line
                className="scatter-fast-inspection-crosshair-line scatter-fast-inspection-crosshair-line-x"
                x1={overlay.anchor.xCssPx}
                x2={overlay.anchor.xCssPx}
                y1={0}
                y2={heightCssPx}
              />
              <line
                className="scatter-fast-inspection-crosshair-line scatter-fast-inspection-crosshair-line-y"
                x1={0}
                x2={widthCssPx}
                y1={overlay.anchor.yCssPx}
                y2={overlay.anchor.yCssPx}
              />
              <circle
                className="scatter-fast-inspection-anchor"
                cx={overlay.anchor.xCssPx}
                cy={overlay.anchor.yCssPx}
                data-plot-id={overlay.plotId}
                data-testid="scatter-fast-inspection-anchor"
                r={4}
              />
            </g>
          ))}
        </svg>
      )}
      {pointMarkers.length === 0 ? null : (
        <svg
          aria-hidden="true"
          className="scatter-fast-point-marker-layer"
          data-marker-count={pointMarkers.length}
          data-testid="scatter-fast-point-marker-layer"
          height={heightCssPx}
          viewBox={`0 0 ${widthCssPx} ${heightCssPx}`}
          width={widthCssPx}
        >
          {pointMarkers.map((marker) => {
            const labelX = Math.max(56, Math.min(widthCssPx - 56, marker.line.xCssPx));
            const labelY = Math.max(
              marker.line.y1CssPx + 12,
              Math.min(marker.line.y2CssPx - 8, marker.point.yCssPx - 10),
            );

            return (
              <g
                className="scatter-fast-point-marker"
                data-plot-id={marker.plotId}
                data-source-index={marker.sourceIndex}
                data-testid="scatter-fast-point-marker"
                data-y-key={marker.yKey}
                key={marker.id}
              >
                <line
                  className="scatter-fast-point-marker-line"
                  data-testid="scatter-fast-point-marker-line"
                  x1={marker.line.xCssPx}
                  x2={marker.line.xCssPx}
                  y1={marker.line.y1CssPx}
                  y2={marker.line.y2CssPx}
                />
                <circle
                  className="scatter-fast-point-marker-anchor"
                  cx={marker.point.xCssPx}
                  cy={marker.point.yCssPx}
                  data-testid="scatter-fast-point-marker-anchor"
                  r={3.5}
                />
                <text
                  className="scatter-fast-point-marker-label"
                  data-testid="scatter-fast-point-marker-label"
                  dominantBaseline="middle"
                  textAnchor="middle"
                  x={labelX}
                  y={labelY}
                >
                  {marker.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {aggregateInspection === null ? null : (
        <svg
          aria-hidden="true"
          className="scatter-fast-aggregate-inspection-layer"
          data-testid={
            aggregateInspection.aggregate.kind === 'bubble'
              ? 'scatter-fast-inspection-aggregate-bubble'
              : 'scatter-fast-inspection-aggregate-heatmap'
          }
          height={heightCssPx}
          viewBox={`0 0 ${widthCssPx} ${heightCssPx}`}
          width={widthCssPx}
        >
          {aggregateInspection.aggregate.kind === 'bubble' ? (
            <circle
              className="scatter-fast-inspection-aggregate-shape scatter-fast-inspection-aggregate-bubble"
              cx={aggregateInspection.xCssPx}
              cy={aggregateInspection.yCssPx}
              data-aggregate-count={aggregateInspection.aggregate.count}
              r={
                aggregateInspection.visual?.kind === 'bubble'
                  ? aggregateInspection.visual.radiusCssPx
                  : 8
              }
            />
          ) : (
            <rect
              className="scatter-fast-inspection-aggregate-shape scatter-fast-inspection-aggregate-heatmap"
              data-aggregate-count={aggregateInspection.aggregate.count}
              height={
                aggregateInspection.visual?.kind === 'heatmap'
                  ? aggregateInspection.visual.heightCssPx
                  : 16
              }
              width={
                aggregateInspection.visual?.kind === 'heatmap'
                  ? aggregateInspection.visual.widthCssPx
                  : 16
              }
              x={
                aggregateInspection.visual?.kind === 'heatmap'
                  ? aggregateInspection.visual.xCssPx
                  : aggregateInspection.xCssPx - 8
              }
              y={
                aggregateInspection.visual?.kind === 'heatmap'
                  ? aggregateInspection.visual.yCssPx
                  : aggregateInspection.yCssPx - 8
              }
            />
          )}
        </svg>
      )}
      {outOfRangeOverlay === undefined ? null : (
        <svg
          aria-hidden="true"
          className="scatter-fast-out-of-range-layer"
          data-candidate-count={outOfRangeOverlay.candidateCount ?? 0}
          data-marker-count={outOfRangeOverlay.markers.length}
          data-testid="scatter-fast-out-of-range-layer"
          height={heightCssPx}
          viewBox={`0 0 ${widthCssPx} ${heightCssPx}`}
          width={widthCssPx}
        >
          {outOfRangeOverlay.markers.map((marker, index) => (
            <MScatterOutOfRangeMarkerView
              marker={marker}
              key={`${marker.plotId}:${marker.side}:${marker.xCssPx}:${marker.yCssPx}:${index}`}
            />
          ))}
        </svg>
      )}
      {navigatorOverlay === undefined ? null : (
        <svg
          aria-label="X overview navigator"
          className="scatter-fast-navigator x-navigator"
          data-domain-min={formatNavigatorAttr(navigatorOverlay.domain.min)}
          data-domain-max={formatNavigatorAttr(navigatorOverlay.domain.max)}
          data-testid="x-navigator"
          data-window-min={formatNavigatorAttr(navigatorOverlay.window.min)}
          data-window-max={formatNavigatorAttr(navigatorOverlay.window.max)}
          data-window-min-label={navigatorOverlay.windowLabel.min}
          data-window-max-label={navigatorOverlay.windowLabel.max}
          height={navigatorOverlay.rect.heightCssPx}
          role="img"
          style={{
            height: navigatorOverlay.rect.heightCssPx,
            left: navigatorOverlay.rect.xCssPx,
            pointerEvents: 'none',
            top: navigatorOverlay.rect.yCssPx,
            width: navigatorOverlay.rect.widthCssPx,
          }}
          viewBox={`0 0 ${navigatorOverlay.rect.widthCssPx} ${navigatorOverlay.rect.heightCssPx}`}
          width={navigatorOverlay.rect.widthCssPx}
        >
          <rect
            className="scatter-fast-navigator-background"
            height={navigatorOverlay.rect.heightCssPx}
            width={navigatorOverlay.rect.widthCssPx}
            x={0}
            y={0}
          />
          <path
            className="scatter-fast-navigator-density"
            d={
              navigatorSummary === null
                ? ''
                : createNavigatorAreaPath(
                    navigatorSummary,
                    navigatorOverlay.rect.widthCssPx,
                    navigatorOverlay.rect.heightCssPx,
                  )
            }
          />
          <path
            className="scatter-fast-navigator-line"
            d={
              navigatorSummary === null
                ? ''
                : createNavigatorLinePath(
                    navigatorSummary,
                    navigatorOverlay.rect.widthCssPx,
                    navigatorOverlay.rect.heightCssPx,
                  )
            }
          />
          <rect
            className="scatter-fast-navigator-window x-navigator-window"
            data-testid="x-navigator-window"
            data-window-min={formatNavigatorAttr(navigatorOverlay.window.min)}
            data-window-max={formatNavigatorAttr(navigatorOverlay.window.max)}
            data-window-min-label={navigatorOverlay.windowLabel.min}
            data-window-max-label={navigatorOverlay.windowLabel.max}
            height={navigatorOverlay.viewportRect.heightCssPx}
            width={navigatorOverlay.viewportRect.widthCssPx}
            x={navigatorOverlay.viewportRect.xCssPx - navigatorOverlay.rect.xCssPx}
            y={navigatorOverlay.viewportRect.yCssPx - navigatorOverlay.rect.yCssPx}
          />
          <line
            className="scatter-fast-navigator-handle"
            x1={navigatorOverlay.viewportRect.xCssPx - navigatorOverlay.rect.xCssPx}
            x2={navigatorOverlay.viewportRect.xCssPx - navigatorOverlay.rect.xCssPx}
            y1={5}
            y2={navigatorOverlay.rect.heightCssPx - 5}
          />
          <line
            className="scatter-fast-navigator-handle"
            x1={
              navigatorOverlay.viewportRect.xCssPx -
              navigatorOverlay.rect.xCssPx +
              navigatorOverlay.viewportRect.widthCssPx
            }
            x2={
              navigatorOverlay.viewportRect.xCssPx -
              navigatorOverlay.rect.xCssPx +
              navigatorOverlay.viewportRect.widthCssPx
            }
            y1={5}
            y2={navigatorOverlay.rect.heightCssPx - 5}
          />
        </svg>
      )}
      {cursorTooltipAnchor === undefined || tooltip === null ? null : (
        <div
          aria-hidden="true"
          className="scatter-fast-cursor-tooltip"
          data-cursor-x={cursorTooltipAnchor.xCssPx.toFixed(2)}
          data-cursor-y={cursorTooltipAnchor.yCssPx.toFixed(2)}
          data-field-count={String(tooltip.fields.length)}
          data-mode={tooltip.mode}
          data-placement-x={tooltipPlacement?.placementX ?? 'right'}
          data-placement-y={tooltipPlacement?.placementY ?? 'below'}
          data-record-id={tooltip.recordId}
          data-record-x-formatted={tooltip.xFormatted}
          data-record-y-formatted={tooltip.yFormatted}
          data-source-index={String(tooltip.sourceIndex)}
          data-testid="scatter-fast-cursor-tooltip"
          data-visible="true"
          style={{
            transform: tooltipPlacement?.transform,
          }}
        >
          <div className="scatter-fast-cursor-tooltip-header">
            <strong>{tooltip.recordId}</strong>
            <span>{tooltip.mode === 'measure' ? 'Measure' : 'Hover'}</span>
          </div>
          <dl className="scatter-fast-cursor-tooltip-fields">
            {tooltip.fields.map((field) => (
              <div
                data-active={field.active ? 'true' : 'false'}
                data-field-delta={field.delta}
                data-field-key={field.key}
                data-field-label={field.label}
                data-field-value={field.value}
                data-testid="scatter-fast-cursor-tooltip-field"
                key={field.key}
              >
                <dt>{field.label}</dt>
                <dd>
                  {field.value}
                  {field.delta === undefined ? null : (
                    <span className="scatter-fast-cursor-tooltip-delta">
                      {field.delta}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </>
  );
}

function resolveRouteAggregateInspectionVisual({
  aggregate,
  plotId,
  plotRects,
  viewport,
}: {
  aggregate: NonNullable<FastScatterHoverEvent['aggregate']>;
  plotId: string;
  plotRects: readonly FastScatterPlotRect[];
  viewport: FastScatterViewport;
}):
  | {
      kind: 'bubble';
      radiusCssPx: number;
    }
  | {
      heightCssPx: number;
      kind: 'heatmap';
      widthCssPx: number;
      xCssPx: number;
      yCssPx: number;
    }
  | null {
  if (aggregate.visual?.kind === 'bubble') {
    return {
      kind: 'bubble',
      radiusCssPx: aggregate.visual.radiusCssPx,
    };
  }

  if (aggregate.kind !== 'heatmap' || aggregate.axis === undefined) {
    return null;
  }

  const plotRect = plotRects.find((candidate) => candidate.id === plotId);
  const yRange = viewport.yByPlot[plotId];
  if (plotRect === undefined || yRange === undefined) {
    return null;
  }

  const xMin = axisToPixel(
    aggregate.axis.x.min,
    viewport.x,
    plotRect.xCssPx,
    plotRect.xCssPx + plotRect.widthCssPx,
  );
  const xMax = axisToPixel(
    aggregate.axis.x.max,
    viewport.x,
    plotRect.xCssPx,
    plotRect.xCssPx + plotRect.widthCssPx,
  );
  const yMin = axisToPixel(
    aggregate.axis.y.min,
    yRange,
    plotRect.yCssPx + plotRect.heightCssPx,
    plotRect.yCssPx,
  );
  const yMax = axisToPixel(
    aggregate.axis.y.max,
    yRange,
    plotRect.yCssPx + plotRect.heightCssPx,
    plotRect.yCssPx,
  );
  const xCssPx = Math.min(xMin, xMax);
  const yCssPx = Math.min(yMin, yMax);
  const widthCssPx = Math.abs(xMax - xMin);
  const heightCssPx = Math.abs(yMax - yMin);

  if (
    !Number.isFinite(xCssPx) ||
    !Number.isFinite(yCssPx) ||
    !Number.isFinite(widthCssPx) ||
    !Number.isFinite(heightCssPx) ||
    widthCssPx <= 0 ||
    heightCssPx <= 0
  ) {
    return null;
  }

  return {
    heightCssPx,
    kind: 'heatmap',
    widthCssPx,
    xCssPx,
    yCssPx,
  };
}

function createFastScatterRouteLassoPath(
  points: readonly { xCssPx: number; yCssPx: number }[],
): string {
  if (points.length === 0) {
    return '';
  }

  const [firstPoint, ...rest] = points;
  return [
    `M ${firstPoint.xCssPx.toFixed(2)} ${firstPoint.yCssPx.toFixed(2)}`,
    ...rest.map((point) => `L ${point.xCssPx.toFixed(2)} ${point.yCssPx.toFixed(2)}`),
    points.length > 2 ? 'Z' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function createNavigatorAreaPath(
  summary: FastScatterNavigatorSummary,
  widthCssPx: number,
  heightCssPx: number,
): string {
  const linePath = createNavigatorLinePath(summary, widthCssPx, heightCssPx);
  if (linePath === '') {
    return '';
  }

  return `${linePath} L ${widthCssPx.toFixed(2)} ${(heightCssPx - 7).toFixed(
    2,
  )} L 0 ${(heightCssPx - 7).toFixed(2)} Z`;
}

function createNavigatorLinePath(
  summary: FastScatterNavigatorSummary,
  widthCssPx: number,
  heightCssPx: number,
): string {
  if (summary.bins.length === 0 || widthCssPx <= 0 || heightCssPx <= 0) {
    return '';
  }

  const baseline = heightCssPx - 7;
  const plotHeight = Math.max(1, heightCssPx - 14);
  const denominator = Math.max(1, summary.bins.length - 1);

  return summary.bins
    .map((bin, index) => {
      const xCssPx = (index / denominator) * widthCssPx;
      const yCssPx = baseline - bin.maxY * plotHeight;
      const command = index === 0 ? 'M' : 'L';

      return `${command} ${xCssPx.toFixed(2)} ${yCssPx.toFixed(2)}`;
    })
    .join(' ');
}

function formatNavigatorAttr(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'pending';
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

function MScatterOutOfRangeMarkerView({
  marker,
}: {
  marker: NonNullable<
    Extract<ScatterOverlayDescriptor, { kind: 'out-of-range-markers' }>
  >['markers'][number];
}) {
  const size = marker.count >= 10 ? 9 : marker.count >= 2 ? 7 : 5.5;
  const opacity = marker.count >= 10 ? 0.82 : marker.count >= 2 ? 0.68 : 0.54;
  const halfSize = size / 2;

  return (
    <g
      className={`scatter-fast-out-of-range-marker scatter-fast-out-of-range-marker-${marker.side}`}
      data-axis={marker.axis}
      data-marker-shape="rectangle"
      data-plot-id={marker.plotId}
      data-side={marker.side}
      data-source-index={marker.sourceIndex}
      data-testid="scatter-fast-out-of-range-marker"
      transform={`translate(${marker.xCssPx.toFixed(2)} ${marker.yCssPx.toFixed(2)})`}
    >
      <rect
        className="scatter-fast-out-of-range-marker-rectangle"
        data-testid="scatter-fast-out-of-range-marker-rectangle"
        fill="#8b5cf6"
        height={size}
        opacity={opacity}
        rx={0}
        stroke="#ffffff"
        strokeOpacity={0.78}
        strokeWidth={1}
        width={size}
        x={-halfSize}
        y={-halfSize}
      />
    </g>
  );
}

function createRouteCursorTooltip({
  columns,
  hover,
  measurement,
  spec,
}: {
  columns: FastScatterDisplayColumns;
  hover: FastScatterHoverEvent | null;
  measurement: FastScatterMeasurementEvent | null;
  spec: FastScatterPlotSpec;
}) {
  if (hover === null) {
    return null;
  }
  const display = formatFastScatterPointForDisplay(hover.point, columns);
  const fields = createRouteCursorTooltipFields({
    columns,
    hover,
    measurement,
    spec,
  });
  if (hover.source === 'measure' && measurement?.reference.id !== undefined) {
    fields.push({
      active: true,
      key: 'reference',
      label: 'reference',
      value: measurement.reference.id,
    });
  }
  const tableName = hover.point.record?.tableKey ?? hover.point.record?.table;
  if (tableName !== undefined) {
    fields.push({
      active: false,
      key: 'table',
      label: 'table',
      value: tableName,
    });
  }
  return {
    fields,
    mode: hover.source === 'measure' ? 'measure' : 'hover',
    recordId:
      hover.aggregate === undefined
        ? hover.point.id
        : hover.aggregate.kind === 'bubble'
          ? 'Bubble'
          : 'Heat bin',
    sourceIndex: hover.point.sourceIndex,
    xFormatted: display.x.label,
    yFormatted: display.y.label,
  };
}

function createRouteCursorTooltipFields({
  columns,
  hover,
  measurement,
  spec,
}: {
  columns: FastScatterDisplayColumns;
  hover: FastScatterHoverEvent;
  measurement: FastScatterMeasurementEvent | null;
  spec: FastScatterPlotSpec;
}): Array<{
  active: boolean;
  delta?: string;
  key: string;
  label: string;
  value: string;
}> {
  if (hover.source === 'measure' && measurement?.current !== null && measurement !== null) {
    const current = measurement.current;
    if (current.aggregate !== undefined) {
      return createRouteAggregateCursorTooltipFields(current.aggregate, spec);
    }
    return [
      ...createFastScatterMeasurementDisplayFields({
        activeYKey: hover.point.yKey,
        columns,
        currentSourceIndex: current.sourceIndex,
        referenceSourceIndex: measurement.reference.sourceIndex,
        spec,
      }),
    ];
  }

  if (hover.aggregate !== undefined) {
    return createRouteAggregateCursorTooltipFields(hover.aggregate, spec);
  }

  return [
    ...createFastScatterSourceDisplayFields({
      activeYKey: hover.point.yKey,
      columns,
      sourceIndex: hover.point.sourceIndex,
      spec,
    }),
  ];
}

function createRouteAggregateCursorTooltipFields(
  aggregate: NonNullable<FastScatterHoverEvent['aggregate']>,
  spec: FastScatterPlotSpec,
): Array<{
  active: boolean;
  key: string;
  label: string;
  value: string;
}> {
  return [
    {
      active: true,
      key: 'aggregate-count',
      label: aggregate.kind === 'bubble' ? 'Bubble count' : 'Bin count',
      value: aggregate.count.toLocaleString('en-US'),
    },
    {
      active: false,
      key: aggregate.kind === 'bubble' ? 'x' : 'aggregate-x',
      label: aggregate.kind === 'bubble' ? spec.xLabel : 'X range',
      value: aggregate.xLabel,
    },
    {
      active: false,
      key: aggregate.kind === 'bubble' ? 'y' : 'aggregate-y',
      label: 'y',
      value: aggregate.yLabel,
    },
  ];
}

function resolveRouteCursorTooltipPlacement(
  xCssPx: number,
  yCssPx: number,
  widthCssPx: number,
  heightCssPx: number,
  fieldCount: number,
): { placementX: 'left' | 'right'; placementY: 'above' | 'below'; transform: string } {
  const estimatedWidth = 224;
  const estimatedHeight = 64 + fieldCount * 28;
  const offset = 14;
  const inset = 8;
  const placeLeft = xCssPx + offset + estimatedWidth > widthCssPx - inset;
  const placeAbove = yCssPx + offset + estimatedHeight > heightCssPx - inset;
  const placementX = placeLeft ? 'left' : 'right';
  const placementY = placeAbove ? 'above' : 'below';
  const x = placeLeft
    ? Math.max(inset, xCssPx - estimatedWidth - offset)
    : Math.min(widthCssPx - estimatedWidth - inset, xCssPx + offset);
  const y = placeAbove
    ? Math.max(inset, yCssPx - estimatedHeight - offset)
    : Math.min(heightCssPx - estimatedHeight - inset, yCssPx + offset);
  return {
    placementX,
    placementY,
    transform: `translate(${Math.round(Math.max(inset, x))}px, ${Math.round(
      Math.max(inset, y),
    )}px)`,
  };
}

function isScatterYAttribute(value: string): value is ScatterYAttribute {
  return SCATTER_Y_ATTRIBUTES.includes(value as ScatterYAttribute);
}

function getOpacityScaleForShortcut(
  key: string,
  code: string,
  currentScale: number,
): number | null {
  switch (key) {
    case ',':
    case 'comma':
    case '-':
    case 'subtract':
      return getPreviousOpacityScale(currentScale);
    case '.':
    case 'period':
    case '+':
    case '=':
    case 'add':
      return getNextOpacityScale(currentScale);
    case '0':
      return FAST_SCATTER_DEFAULT_OPACITY_SCALE;
    default:
      break;
  }

  switch (code) {
    case 'comma':
    case 'minus':
    case 'numpadsubtract':
      return getPreviousOpacityScale(currentScale);
    case 'period':
    case 'equal':
    case 'numpadadd':
      return getNextOpacityScale(currentScale);
    case 'digit0':
    case 'numpad0':
      return FAST_SCATTER_DEFAULT_OPACITY_SCALE;
    default:
      return null;
  }
}

function shouldIgnoreShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable || target.closest('[contenteditable="true"]') !== null) {
    return true;
  }

  return target.matches('button, input, select, textarea');
}

function formatDuration(value: number | null): string {
  return value === null ? 'pending' : `${value.toFixed(1)} ms`;
}

function formatDiagnosticNumber(value: number | undefined): string {
  return value === undefined ? 'pending' : value.toFixed(4);
}

function formatDiagnosticInteger(value: number | undefined): string {
  return value === undefined ? 'pending' : String(Math.round(value));
}

function formatGpuTimerState(supported: boolean | undefined): string {
  if (supported === undefined) {
    return 'pending';
  }

  return supported ? 'supported' : 'CPU fallback';
}

function formatMaybeNumber(value: number | undefined): string {
  return value === undefined ? 'pending' : value.toFixed(3);
}

function formatPointSizeScaleLabel(value: number): string {
  return `${formatPointSizeScaleParam(value)}x`;
}

function formatOpacityScaleLabel(value: number): string {
  return `${formatOpacityScaleParam(value)}x`;
}

function formatHeatmapBinSizeLabel(value: number): string {
  return `${formatHeatmapBinSizeSearchParam(value)} px`;
}

function formatHeatmapPaletteLabel(value: FastScatterHeatmapPalette): string {
  return value === 'mono' ? 'Mono' : value[0]!.toUpperCase() + value.slice(1);
}

function formatMaybeCount(value: number | undefined): string {
  return value === undefined ? 'pending' : formatCount(value);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatIdSample(sampleIds: readonly string[]): string {
  return sampleIds.length === 0 ? 'none' : sampleIds.join(', ');
}

function formatSelectionPath(
  metrics:
    | {
        computeMs: number;
        mode: string;
        observableMs: number;
        transferMs: number;
      }
    | null,
): string {
  if (metrics === null) {
    return 'pending';
  }

  return `${metrics.mode}: compute ${metrics.computeMs.toFixed(1)} ms, transfer ${metrics.transferMs.toFixed(1)} ms, observable ${metrics.observableMs.toFixed(1)} ms`;
}

function serializeFastScatterSelectionCallbackPreview(
  selection: FastScatterSelectionEvent | null,
): string {
  if (selection === null) {
    return JSON.stringify(
      {
        callback: 'selectionchange',
        filters: [],
        note: 'No committed selection callback yet.',
        selectedCount: 0,
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      callback: 'selectionchange',
      filters: selection.filters.map((filter) => ({
        parameterKey: filter.parameterKey,
        plotId: filter.plotId,
        pointCount: filter.points?.length ?? 0,
        ranges: {
          parameter: toPreviewRange(filter.ranges.parameter),
          x: toPreviewRange(filter.ranges.x),
          y: toPreviewRange(filter.ranges.y),
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
        yKey: filter.yKey,
      })),
      kind: selection.kind,
      selectedCount: selection.selectedCount,
      sourceIndices: {
        count: selection.sourceIndices.length,
        sample: Array.from(selection.sourceIndices.slice(0, 8)),
        type: 'Uint32Array',
      },
      tool: selection.tool,
    },
    null,
    2,
  );
}

function toPreviewRange(range: { max: number; min: number }): { max: number; min: number } {
  return {
    max: toPreviewNumber(range.max),
    min: toPreviewNumber(range.min),
  };
}

function toPreviewNumber(value: number): number {
  return Number.isFinite(value) ? Number(value.toPrecision(12)) : value;
}

function createInitialSelectedSourceIndices(searchParams: URLSearchParams): Uint32Array {
  if (!isDemoTestControlEnabled(searchParams, '__e2eScatterFastSelectedSourceIndices')) {
    return EMPTY_SELECTED_SOURCE_INDICES;
  }

  const rawSelection = searchParams.get('__e2eScatterFastSelectedSourceIndices');

  if (rawSelection === null || rawSelection.trim() === '') {
    return EMPTY_SELECTED_SOURCE_INDICES;
  }

  const parts = rawSelection.split(',');
  const sourceIndices = new Uint32Array(parts.length);

  for (let index = 0; index < parts.length; index += 1) {
    const sourceIndex = Number(parts[index]);

    if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0) {
      throw new Error(
        `Invalid __e2eScatterFastSelectedSourceIndices value at offset ${index}.`,
      );
    }

    sourceIndices[index] = sourceIndex;
  }

  return sourceIndices;
}

function createInitialHoverSourceIndex(searchParams: URLSearchParams): number | null {
  if (!isDemoTestControlEnabled(searchParams, '__e2eScatterFastHoverSourceIndex')) {
    return null;
  }

  const rawHover = searchParams.get('__e2eScatterFastHoverSourceIndex');

  if (rawHover === null || rawHover.trim() === '') {
    return null;
  }

  const sourceIndex = Number(rawHover);
  if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0) {
    throw new Error('Invalid __e2eScatterFastHoverSourceIndex value.');
  }

  return sourceIndex;
}

function isDemoTestControlEnabled(
  searchParams: URLSearchParams,
  key: string,
): boolean {
  return import.meta.env.DEV && searchParams.has(key);
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatRange(range: { min: number; max: number } | undefined): string {
  if (range === undefined) {
    return 'pending';
  }

  return `${formatNumber(range.min)} to ${formatNumber(range.max)}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function scheduleAfterFirstPaint(callback: () => void): () => void {
  let cancelled = false;
  let frameId = window.requestAnimationFrame(() => {
    frameId = 0;
    const idleWindow = window as Window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout?: number },
      ) => number;
    };

    if (typeof idleWindow.requestIdleCallback === 'function') {
      const idleId = idleWindow.requestIdleCallback(
        () => {
          if (!cancelled) {
            callback();
          }
        },
        { timeout: 5_000 },
      );

      frameId = -idleId;
      return;
    }

    frameId = window.requestAnimationFrame(() => {
      frameId = 0;
      if (!cancelled) {
        callback();
      }
    });
  });

  return () => {
    cancelled = true;
    if (frameId > 0) {
      window.cancelAnimationFrame(frameId);
    } else if (frameId < 0) {
      const idleWindow = window as Window & {
        cancelIdleCallback?: (handle: number) => void;
      };
      idleWindow.cancelIdleCallback?.(-frameId);
    }
  };
}
