import type { FastScatterRenderingMode } from './alphaPolicy.js';
import type {
  FastScatterAggregateAxisRange,
  FastScatterAggregationMembershipSpan,
} from './aggregation.js';

export type FastScatterTypedNumericArray = Float32Array | Float64Array;

export type FastScatterColorArray = Uint8Array | Uint32Array;

export const FAST_SCATTER_VISUALIZATION_MODES = [
  'points',
  'bubble',
  'heatmap',
] as const;
export type FastScatterVisualizationMode =
  (typeof FAST_SCATTER_VISUALIZATION_MODES)[number];

export type FastScatterAggregationMode = Exclude<
  FastScatterVisualizationMode,
  'points'
>;

export type FastScatterHeatmapPalette = 'mono' | 'viridis' | 'magma' | 'turbo';

export type FastScatterInteractionMode =
  | 'zoom'
  | 'pan'
  | 'select'
  | 'lasso'
  | 'hover'
  | 'measure';

export type FastScatterAxisMode = 'x' | 'y' | 'xy';

export type FastScatterShapeCode = 0 | 1 | 2 | 3 | 4;

export type FastScatterSelectionKind = 'replace' | 'append';

export type FastScatterSelectionTool = 'rectangle' | 'lasso' | 'programmatic';

export type FastScatterViewportChangeReason =
  | 'initial'
  | 'reset'
  | 'wheel'
  | 'drag'
  | 'rectangle-zoom'
  | 'navigator'
  | 'programmatic';

export type FastScatterViewportChangePhase = 'preview' | 'commit';

export interface FastScatterRange {
  min: number;
  max: number;
}

export interface FastScatterSelectionSource {
  readonly datasetKey?: string;
  readonly fieldKey?: string;
  readonly tableKey?: string;
}

export interface FastScatterAggregationSubplotRequest {
  plotHeightPx: number;
  plotId: string;
  plotWidthPx: number;
  yKey: string;
  yRange: FastScatterRange;
}

export interface FastScatterAggregationRequestBase {
  hoverSourceIndex?: number | null;
  selectedSourceIndices?: Uint32Array;
  subplots: readonly FastScatterAggregationSubplotRequest[];
  xRange: FastScatterRange;
}

export interface FastScatterBubbleAggregationRequest
  extends FastScatterAggregationRequestBase {
  mode: 'bubble';
}

export interface FastScatterHeatmapAggregationRequest
  extends FastScatterAggregationRequestBase {
  heatBinPx: number;
  mode: 'heatmap';
}

export type FastScatterAggregationRequest =
  | FastScatterBubbleAggregationRequest
  | FastScatterHeatmapAggregationRequest;

export interface FastScatterAggregationBuildMetrics {
  aggregateBuildMs: number;
  resultBytes: number;
}

export interface FastScatterAggregationExecutionMetrics {
  aggregateBuildMs: number;
  mode: 'sync' | 'worker';
  observableMs: number;
  requestBytes: number;
  resultBytes: number;
  setupBytes: number;
  setupMs: number;
  transferBytes: number;
  transferMs: number;
}

export interface FastScatterBubbleSubplotAggregation {
  aggregateCount: number;
  centerX: Float64Array;
  centerY: Float64Array;
  counts: Uint32Array;
  hovered: Uint8Array;
  membershipCounts: Uint32Array;
  membershipOffsets: Uint32Array;
  plotId: string;
  representativeColor: Uint32Array;
  selectedCounts: Uint32Array;
  singletonCount: number;
  sourceIndices: Uint32Array;
  totalAggregateCount: number;
  yKey: string;
}

export interface FastScatterBubbleAggregationSet {
  kind: 'bubble';
  metrics: FastScatterAggregationBuildMetrics;
  pointCount: number;
  subplots: readonly FastScatterBubbleSubplotAggregation[];
  totalAggregateCount: number;
}

export interface FastScatterHeatmapCellLocation {
  cellIndex: number;
  xBin: number;
  yBin: number;
}

export interface FastScatterHeatmapSubplotAggregation {
  cellCount: number;
  counts: Uint32Array;
  heatBinPx: number;
  hovered: Uint8Array;
  membershipCounts: Uint32Array;
  membershipOffsets: Uint32Array;
  plotHeightPx: number;
  plotId: string;
  plotWidthPx: number;
  populatedCellCount: number;
  selectedCounts: Uint32Array;
  sourceIndices: Uint32Array;
  xBinCount: number;
  xBinSize: number;
  xRange: FastScatterRange;
  yBinCount: number;
  yBinSize: number;
  yKey: string;
  yRange: FastScatterRange;
}

export interface FastScatterHeatmapAggregationSet {
  kind: 'heatmap';
  metrics: FastScatterAggregationBuildMetrics;
  pointCount: number;
  subplots: readonly FastScatterHeatmapSubplotAggregation[];
  totalCellCount: number;
  totalPopulatedCellCount: number;
}

export type FastScatterAggregationSet =
  | FastScatterBubbleAggregationSet
  | FastScatterHeatmapAggregationSet;

export interface FastScatterAggregationExecutionResult {
  aggregation: FastScatterAggregationSet;
  metrics: FastScatterAggregationExecutionMetrics;
}

export interface FastScatterTheme {
  alphaScaleMultiplier?: number;
  backgroundColor: readonly [number, number, number, number];
  bubbleColor?: readonly [number, number, number, number];
  colorMixAmount?: number;
  colorMixColor?: readonly [number, number, number];
  defaultPointColor: readonly [number, number, number, number];
  selectedOverlayColor: readonly [number, number, number, number];
  subplotBackgroundColor: readonly [number, number, number, number];
}

export interface FastScatterViewport {
  x: FastScatterRange;
  yByPlot: Readonly<Record<string, FastScatterRange>>;
}

export interface FastScatterPointColumns {
  ids: readonly string[];
  x: FastScatterTypedNumericArray;
  xKey?: string;
  xOrder?: Uint32Array;
  y: Readonly<Record<string, FastScatterTypedNumericArray>>;
  color?: FastScatterColorArray;
  colorFormat?: 'rgba8' | 'rgba32';
  opacity?: Float32Array;
  size?: Float32Array;
  rotation?: Float32Array;
  rotationDegrees?: Float32Array;
  rotationRadians?: Float32Array;
  shape?: Uint8Array;
  recordIdentityBySourceIndex?: readonly FastScatterRecordIdentity[];
  sourceIndex?: Uint32Array;
  tableBySourceIndex?: readonly string[];
}

export interface FastScatterRecordIdentity {
  datasetKey?: string;
  id: string;
  sourceIndex: number;
  table: string;
  tableKey?: string;
}

export type FastScatterPointAxisKind =
  | 'numeric'
  | 'categorical'
  | 'boolean'
  | 'datetime-ns';

export type FastScatterPointAxisMetadata =
  | FastScatterNumericPointAxisMetadata
  | FastScatterCategoricalPointAxisMetadata
  | FastScatterDatetimeNsPointAxisMetadata;

export interface FastScatterPointAxisMetadataBase {
  columnKey?: string;
  domain?: FastScatterRange;
  parameterName?: string;
  source?: FastScatterSelectionSource;
  title?: string;
  unit?: string;
}

export interface FastScatterNumericPointAxisMetadata
  extends FastScatterPointAxisMetadataBase {
  kind: 'numeric';
}

export interface FastScatterCategoricalPointAxisMetadata
  extends FastScatterPointAxisMetadataBase {
  categories: readonly FastScatterSelectionCategoryValue[];
  kind: 'categorical' | 'boolean';
}

export interface FastScatterDatetimeNsPointAxisMetadata
  extends FastScatterPointAxisMetadataBase {
  kind: 'datetime-ns';
}

export interface FastScatterPlotSpec {
  xLabel: string;
  plots: readonly FastScatterSubplotSpec[];
}

export interface FastScatterSubplotSpec {
  id: string;
  label: string;
  yKey: string;
}

export interface FastScatterPointRef {
  sourceIndex: number;
  id: string;
  record?: FastScatterRecordIdentity;
  x: number;
  y: number;
  plotId: string;
  yKey: string;
}

export interface FastScatterCanvasPoint {
  canvasX: number;
  canvasY: number;
}

export interface FastScatterSelectionEvent {
  filters: readonly FastScatterSelectionFilter[];
  sourceIndices: Uint32Array;
  selectedCount: number;
  kind: FastScatterSelectionKind;
  tool: FastScatterSelectionTool;
  durationMs?: number;
  plotId?: string;
  sampleIds?: readonly string[];
  viewport: FastScatterViewport;
}

export interface FastScatterSelectionFilter {
  readonly dimensions: readonly FastScatterSelectionDimension[];
  readonly parameterKey: string;
  readonly plotId: string;
  readonly ranges: {
    readonly parameter: FastScatterRange;
    readonly x: FastScatterRange;
    readonly y: FastScatterRange;
  };
  readonly shape: Extract<FastScatterSelectionTool, 'lasso' | 'rectangle'>;
  readonly points?: readonly { readonly x: number; readonly y: number }[];
  readonly source?: FastScatterSelectionSource;
  readonly yKey: string;
}

export interface FastScatterSelectionDimension {
  readonly axis: 'x' | 'y';
  readonly parameterKey: string;
  readonly range: FastScatterRange;
  readonly source?: FastScatterSelectionSource;
  readonly valueType: FastScatterPointAxisKind | 'unknown';
  readonly values?: readonly FastScatterSelectionCategoryValue[];
}

export interface FastScatterSelectionCategoryValue {
  readonly encoded: number;
  readonly label: string;
  readonly value: boolean | number | string;
}

export interface FastScatterHoverEvent {
  aggregate?: {
    axis?: {
      readonly x: FastScatterAggregateAxisRange;
      readonly y: FastScatterAggregateAxisRange;
    };
    count: number;
    kind: 'bubble' | 'heatmap';
    membership?: FastScatterAggregationMembershipSpan;
    sampleIds?: readonly string[];
    visual?:
      | {
          aggregateIndex: number;
          kind: 'bubble';
          radiusCssPx: number;
        }
      | {
          cellIndex: number;
          kind: 'heatmap';
          xBin: number;
          yBin: number;
        };
    xLabel: string;
    yLabel: string;
  };
  point: FastScatterPointRef;
  canvasPoint: FastScatterCanvasPoint;
  candidateCount: number;
  distancePx: number;
  durationMs: number;
  pinned: boolean;
  source: 'measure' | 'programmatic' | 'shift-hover';
  sourcePointIndex: number;
}

export interface FastScatterMeasurementReference extends FastScatterPointRef {
  aggregate?: FastScatterHoverEvent['aggregate'];
  canvasPoint?: FastScatterCanvasPoint;
}

export interface FastScatterMeasurementEvent {
  current: FastScatterMeasurementReference | null;
  reference: FastScatterMeasurementReference;
}

export interface FastScatterMetricsEvent {
  phase:
    | 'init'
    | 'buffer-upload'
    | 'context-lost'
    | 'context-restored'
    | 'render'
    | 'interaction'
    | 'selection'
    | 'hover'
    | 'measurement'
    | 'dispose';
  at: number;
  durationMs?: number;
  pointCount?: number;
  visiblePointCount?: number;
  selectedPointCount?: number;
  subplotCount?: number;
  drawCalls?: number;
  aggregateDrawCalls?: number;
  aggregateCount?: number;
  cellCount?: number;
  populatedCellCount?: number;
  gpuDurationMs?: number;
  gpuTimerSupported?: boolean;
  displayMode?: FastScatterVisualizationMode;
  uploadBytes?: number;
  detail?: string;
}

export interface FastScatterEasterEggPlaybackOptions {
  color?: readonly [number, number, number, number];
  enterDurationMs?: number;
  exitDurationMs?: number;
  holdDurationMs?: number;
  pointSizePx?: number;
  staggerMs?: number;
  word?: string;
}

export interface FastScatterControllerOptions {
  columns: FastScatterPointColumns;
  focusedPlotId?: string | null;
  spec: FastScatterPlotSpec;
  viewport: FastScatterViewport;
  mode: FastScatterInteractionMode;
  axisMode: FastScatterAxisMode;
  renderingMode?: FastScatterRenderingMode;
  opacityScale?: number;
  pointSizeScale?: number;
  theme?: FastScatterTheme;
  visualizationMode?: FastScatterVisualizationMode;
  heatmapBinSizePx?: number;
  heatmapPalette?: FastScatterHeatmapPalette;
  aggregation?: FastScatterAggregationSet | null;
  selectedSourceIndices?: Uint32Array;
  hoverSourceIndex?: number | null;
  onViewportChange?: (
    viewport: FastScatterViewport,
    reason: FastScatterViewportChangeReason,
    phase: FastScatterViewportChangePhase,
  ) => void;
  onSelectionChange?: (selection: FastScatterSelectionEvent) => void;
  onHoverChange?: (hover: FastScatterHoverEvent | null) => void;
  onMeasurementChange?: (measurement: FastScatterMeasurementEvent | null) => void;
  onMetrics?: (metrics: FastScatterMetricsEvent) => void;
}

export interface FastScatterController {
  update(options: Partial<FastScatterControllerOptions>): void;
  resize(widthCssPx: number, heightCssPx: number, devicePixelRatio: number): void;
  render(): void;
  dispose(): void;
}
