export type HistogramParameterKey = string;
export type HistogramSubplotId = string;
export type HistogramTableKey = string;

export type HistogramNumericArray =
  | Float32Array
  | Float64Array
  | Uint8Array
  | Uint16Array
  | Uint32Array;
export type HistogramSourceIndexArray = Uint32Array;
export type HistogramColorArray = Uint8Array | Uint32Array;
export type HistogramColorFormat = 'rgba8' | 'rgba32';

export type HistogramParameterKind =
  | 'numeric'
  | 'datetime-ns'
  | 'categorical'
  | 'boolean';

export type HistogramDataMode = 'histogram' | 'bar';
export type HistogramBinSizeMode = 'continuous' | 'fixed-category';
export type HistogramBinSizeAdjustment = 'none' | 'increase' | 'decrease' | 'set';
export type HistogramContinuousBinResolutionStatus =
  | 'applied'
  | 'clamped'
  | 'defaulted'
  | 'warned';

export type HistogramSelectionKind = 'replace' | 'append';
export type HistogramSelectionTool = 'rectangle' | 'lasso' | 'programmatic';
export type HistogramSourceIndicesStatus = 'available' | 'pending' | 'unavailable';

export type HistogramViewportChangeReason =
  | 'initial'
  | 'reset'
  | 'wheel'
  | 'drag'
  | 'rectangle-zoom'
  | 'programmatic';

export type HistogramViewportChangePhase = 'preview' | 'commit';

export interface HistogramRange {
  readonly max: number;
  readonly min: number;
}

export interface HistogramSelectionSource {
  readonly datasetKey?: string;
  readonly fieldKey?: string;
  readonly tableKey?: string;
}

export interface HistogramCategorySpec {
  readonly encoded: number;
  readonly label: string;
  readonly order?: number;
  readonly value: boolean | number | string;
}

export interface HistogramParameterSpec {
  readonly categories?: readonly HistogramCategorySpec[];
  readonly datetimeOriginNs?: string;
  readonly domain?: HistogramRange;
  readonly key: HistogramParameterKey;
  readonly kind: HistogramParameterKind;
  readonly label: string;
  readonly source?: HistogramSelectionSource;
  readonly sourceTables?: readonly HistogramTableKey[];
  readonly unit?: string;
}

export interface HistogramSubplotSpec {
  readonly id: HistogramSubplotId;
  readonly label: string;
  readonly parameterKey: HistogramParameterKey;
}

export interface HistogramPlotSpec {
  readonly mode: HistogramDataMode;
  readonly parameters: readonly HistogramParameterSpec[];
  readonly subplots: readonly HistogramSubplotSpec[];
}

export interface HistogramSubplotViewport {
  readonly x: HistogramRange;
  readonly y: HistogramRange;
}

export interface HistogramViewport {
  readonly subplotById: Readonly<Record<HistogramSubplotId, HistogramSubplotViewport>>;
}

export type HistogramValueColumn =
  | HistogramNumericArray
  | readonly (bigint | boolean | number | string | null | undefined)[];

export interface HistogramDisplayField {
  readonly key: string;
  readonly label: string;
}

export interface HistogramRecordIdentity {
  readonly id: string;
  readonly sourceIndex: number;
  readonly table?: HistogramTableKey;
}

export interface HistogramColumns {
  readonly color?: HistogramColorArray;
  readonly colorFormat?: HistogramColorFormat;
  readonly displayFields?: readonly HistogramDisplayField[];
  readonly ids: readonly string[];
  readonly parameters?: readonly HistogramParameterSpec[];
  readonly recordIdentityBySourceIndex?: readonly HistogramRecordIdentity[];
  readonly sourceIndex?: HistogramSourceIndexArray;
  readonly tableBySourceIndex?: readonly HistogramTableKey[];
  readonly valuesByParameter: Readonly<
    Record<HistogramParameterKey, HistogramValueColumn>
  >;
}

export interface HistogramBinSizeState {
  readonly adjustment?: HistogramBinSizeAdjustment;
  readonly binSize: number;
  readonly mode: HistogramBinSizeMode;
  readonly parameterKey: HistogramParameterKey;
  readonly subplotId: HistogramSubplotId;
}

export interface HistogramContinuousBinResolution {
  readonly effectiveBinSize: number;
  readonly effectiveVisibleBinCount: number;
  readonly hardMaxVisibleBinCount: number;
  readonly minBinSize: number;
  readonly requestedBinSize: number | null;
  readonly requestedVisibleBinCount: number | null;
  readonly softMaxVisibleBinCount: number;
  readonly status: HistogramContinuousBinResolutionStatus;
  readonly visibleRange: HistogramRange;
}

export interface HistogramBinMembershipSpan {
  readonly count: number;
  readonly offset: number;
  readonly sourceIndicesAvailable: boolean;
}

export interface HistogramBinDescriptor {
  readonly category?: HistogramCategorySpec;
  readonly center: number;
  readonly index: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly max: number;
  readonly min: number;
  readonly parameterKey: HistogramParameterKey;
  readonly source?: string;
  readonly subplotId: HistogramSubplotId;
  readonly table?: HistogramTableKey;
}

export interface HistogramColorStackSegment {
  readonly color: number;
  readonly count: number;
  readonly endCount: number;
  readonly startCount: number;
}

export interface HistogramBin {
  readonly descriptor: HistogramBinDescriptor;
  readonly hovered?: boolean;
  readonly membership?: HistogramBinMembershipSpan;
  readonly selectedCount?: number;
  readonly stack: readonly HistogramColorStackSegment[];
  readonly totalCount: number;
}

export interface HistogramBarBinInput {
  readonly category?: HistogramCategorySpec;
  readonly categoryEncoded?: number;
  readonly categoryLabel?: string;
  readonly categoryValue?: boolean | number | string;
  readonly colorStack?: readonly Pick<HistogramColorStackSegment, 'color' | 'count'>[];
  readonly count?: number;
  readonly max?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly min?: number;
  readonly source?: string;
  readonly sourceIndexRange?: HistogramSourceIndexRange;
  readonly sourceIndices?: HistogramSourceIndexArray | readonly number[];
  readonly sourceMembership?: HistogramBinMembershipSpan;
  readonly table?: HistogramTableKey;
  readonly totalCount?: number;
}

export interface HistogramSourceIndexRange {
  readonly count: number;
  readonly start: number;
}

export interface HistogramBarSeries {
  readonly bins: readonly HistogramBarBinInput[];
  readonly label?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly parameter?: HistogramParameterSpec;
  readonly parameterKey: HistogramParameterKey;
  readonly parameterName?: string;
  readonly source?: string;
  readonly sourceIndices?: HistogramSourceIndexArray | readonly number[];
  readonly subplotId: HistogramSubplotId;
  readonly table?: HistogramTableKey;
}

export interface HistogramSubplotBins {
  readonly binCount: number;
  readonly bins: readonly HistogramBin[];
  readonly continuousBinResolution?: HistogramContinuousBinResolution;
  readonly dataMode: HistogramDataMode;
  readonly domain?: HistogramRange;
  readonly parameterKey: HistogramParameterKey;
  readonly sourceIndices?: HistogramSourceIndexArray;
  readonly sourceIndicesAvailable: boolean;
  readonly sourceIndicesState?: HistogramSourceIndicesStatus;
  readonly subplotId: HistogramSubplotId;
}

export interface HistogramAggregationBuildMetrics {
  readonly aggregateBuildMs?: number;
  readonly binCount: number;
  readonly colorSegmentCount: number;
  readonly excludedValueCount: number;
  readonly invalidValueCount: number;
  readonly missingValueCount: number;
  readonly outOfDomainValueCount: number;
  readonly sourceIndexCount: number;
  readonly totalCount: number;
}

export interface HistogramAggregationSet {
  readonly metrics: HistogramAggregationBuildMetrics;
  readonly mode: HistogramDataMode;
  readonly pointCount: number;
  readonly subplots: readonly HistogramSubplotBins[];
}

export interface HistogramCanvasPoint {
  readonly canvasX: number;
  readonly canvasY: number;
}

export interface HistogramBinRef {
  readonly bin: HistogramBinDescriptor;
  readonly count: number;
  readonly membership?: HistogramBinMembershipSpan;
  readonly sampleIds?: readonly string[];
  readonly source?: HistogramSelectionSource;
  readonly stack: readonly HistogramColorStackSegment[];
}

export interface HistogramHoverEvent {
  readonly bin: HistogramBinRef;
  readonly canvasPoint: HistogramCanvasPoint;
  readonly candidateCount: number;
  readonly durationMs: number;
  readonly pinned: boolean;
  readonly source: 'measure' | 'programmatic' | 'shift-hover';
}

export interface HistogramMeasurementReference extends HistogramBinRef {
  readonly canvasPoint?: HistogramCanvasPoint;
}

export interface HistogramMeasurementEvent {
  readonly current: HistogramMeasurementReference | null;
  readonly reference: HistogramMeasurementReference;
}

export interface HistogramSelectionEvent {
  readonly binDescriptors: readonly HistogramBinDescriptor[];
  readonly durationMs?: number;
  readonly filters: readonly HistogramSelectionFilter[];
  readonly kind: HistogramSelectionKind;
  readonly sampleIds?: readonly string[];
  readonly selectedBinCount: number;
  readonly selectedSourceCount: number;
  readonly sourceIndices: HistogramSourceIndexArray;
  readonly sourceIndicesAvailable: boolean;
  readonly sourceIndicesStatus?: HistogramSourceIndicesStatus;
  readonly subplotId?: HistogramSubplotId;
  readonly tool: HistogramSelectionTool;
  readonly viewport: HistogramViewport;
}

export interface HistogramSelectionFilter {
  readonly binDescriptors: readonly HistogramBinDescriptor[];
  readonly dimensions: readonly HistogramSelectionDimension[];
  readonly parameterKey: HistogramParameterKey;
  readonly points?: readonly { readonly x: number; readonly y: number }[];
  readonly ranges: {
    readonly value: HistogramRange;
    readonly x: HistogramRange;
    readonly y?: HistogramRange;
  };
  readonly shape: Extract<HistogramSelectionTool, 'lasso' | 'programmatic' | 'rectangle'>;
  readonly source?: HistogramSelectionSource;
  readonly subplotId: HistogramSubplotId;
}

export interface HistogramSelectionDimension {
  readonly axis: 'value';
  readonly parameterKey: HistogramParameterKey;
  readonly range: HistogramRange;
  readonly source?: HistogramSelectionSource;
  readonly valueType: HistogramParameterKind | 'unknown';
  readonly values?: readonly HistogramSelectionCategoryValue[];
}

export interface HistogramSelectionCategoryValue {
  readonly encoded: number;
  readonly label: string;
  readonly value: boolean | number | string;
}

export interface HistogramMetricsEvent {
  readonly aggregateBuildMs?: number;
  readonly at: number;
  readonly binCount?: number;
  readonly colorSegmentCount?: number;
  readonly detail?: string;
  readonly drawCalls?: number;
  readonly durationMs?: number;
  readonly gpuDurationMs?: number;
  readonly gpuTimerSupported?: boolean;
  readonly mode?: HistogramDataMode;
  readonly phase:
    | 'init'
    | 'aggregation'
    | 'bar-normalize'
    | 'buffer-upload'
    | 'render'
    | 'interaction'
    | 'selection'
    | 'hover'
    | 'measurement'
    | 'dispose';
  readonly pointCount?: number;
  readonly selectedBinCount?: number;
  readonly selectedSourceCount?: number;
  readonly stackSegmentCount?: number;
  readonly subplotCount?: number;
  readonly uploadBytes?: number;
  readonly visibleBinCount?: number;
}
