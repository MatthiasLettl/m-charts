export type ParallelFastAxisKey = string;

export interface ParallelFastRange {
  max: number;
  min: number;
}

export interface ParallelFastSelectionSource {
  readonly datasetKey?: string;
  readonly fieldKey?: string;
  readonly tableKey?: string;
}

export interface ParallelFastAxisSpec {
  categories?: readonly ParallelFastCategorySpec[];
  kind?: ParallelFastAxisKind;
  key: ParallelFastAxisKey;
  label?: string;
  source?: ParallelFastSelectionSource;
  unit?: string;
}

export type ParallelFastAxisKind =
  | 'numeric'
  | 'categorical'
  | 'boolean'
  | 'datetime-ns';

export interface ParallelFastCategorySpec {
  label?: string;
  order?: number;
  value: boolean | number | string;
}

export interface ParallelFastPlotSpec {
  axes: readonly ParallelFastAxisSpec[];
}

export type ParallelFastNumericArray =
  | Float32Array
  | Float64Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array;
export type ParallelFastValueArray =
  | ParallelFastNumericArray
  | readonly (bigint | boolean | number | string | null | undefined)[];
export type ParallelFastColorArray =
  | Uint8Array
  | ParallelFastRgbaView
  | readonly (`#${string}` | string | null | undefined)[];
export interface ParallelFastRgbaView {
  readonly __parallelCompactRgbaView: true;
  readonly [index: number]: number;
  readonly length: number;
}
export type ParallelFastOpacityArray =
  | Float32Array
  | Float64Array
  | readonly (number | null | undefined)[];

export interface ParallelFastEncodedCategory {
  encoded: number;
  label: string;
  value: string;
}

export interface ParallelFastAxisMetadataBase {
  domain: ParallelFastRange;
  key: ParallelFastAxisKey;
  kind: ParallelFastAxisKind;
  label: string;
  source?: ParallelFastSelectionSource;
  unit?: string;
}

export interface ParallelFastNumericAxisMetadata
  extends ParallelFastAxisMetadataBase {
  kind: 'numeric';
}

export interface ParallelFastCategoricalAxisMetadata
  extends ParallelFastAxisMetadataBase {
  categories: readonly ParallelFastEncodedCategory[];
  kind: 'categorical' | 'boolean';
}

export interface ParallelFastDatetimeNsAxisMetadata
  extends ParallelFastAxisMetadataBase {
  datetimeOriginNs: string;
  datetimeOriginNsBigInt: bigint;
  epochNsValues: readonly (string | undefined)[];
  kind: 'datetime-ns';
}

export type ParallelFastAxisMetadata =
  | ParallelFastNumericAxisMetadata
  | ParallelFastCategoricalAxisMetadata
  | ParallelFastDatetimeNsAxisMetadata;

export interface ParallelFastColumns {
  axisOrder: readonly ParallelFastAxisKey[];
  axes?: readonly ParallelFastAxisSpec[];
  color?: ParallelFastColorArray;
  colorFormat?: 'rgba8' | 'hex';
  ids: readonly string[];
  opacity?: ParallelFastOpacityArray;
  preselectedSourceIndices?: Uint32Array;
  recordIdentityBySourceIndex?: readonly {
    id: string;
    sourceIndex: number;
    table: string;
  }[];
  tableBySourceIndex?: readonly string[];
  valuesByAxis: Readonly<Record<ParallelFastAxisKey, ParallelFastValueArray>>;
}
