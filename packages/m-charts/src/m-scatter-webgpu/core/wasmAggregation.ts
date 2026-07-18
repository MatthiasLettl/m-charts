import {
  getFastScatterAggregationByteLength,
  type FastScatterAggregationRequest,
  type FastScatterAggregationSet,
  type FastScatterBubbleAggregationSet,
  type FastScatterBubbleSubplotAggregation,
  type FastScatterHeatmapAggregationSet,
  type FastScatterHeatmapSubplotAggregation,
  type FastScatterPointColumns,
  type FastScatterPlotSpec,
  type FastScatterTypedNumericArray,
} from '../../m-scatter/core/index.js';
import { FAST_SCATTER_WEBGPU_MAX_BUBBLE_AGGREGATES_PER_SUBPLOT } from './aggregation.js';
import {
  FAST_SCATTER_AGGREGATION_WASM_BASE64,
  FAST_SCATTER_AGGREGATION_WASM_SHA256,
} from './aggregationWasmBinary.js';

const COLUMN_F32 = 1;
const COLUMN_F64 = 2;
const COLUMN_U8 = 3;
const COLUMN_U16 = 4;
const COLUMN_U32 = 5;
const COLUMN_GENERATED_OVERLAP_X = 6;
const INVALID_RESULT = 0xffff_ffff;
let cachedWasmModule: WebAssembly.Module | null = null;
let cachedWasmBinaryBytes = 0;

interface FastScatterAggregationWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  session_reset(pointCount: number, yCount: number): void;
  session_column_reserve(slot: number, kind: number, byteLength: number): number;
  session_set_x_order(enabled: number): number;
  session_set_source_index(enabled: number): number;
  session_validate(): number;
  session_selection_reserve(length: number): number;
  session_set_selection(pointer: number, length: number): void;
  session_selection_release(pointer: number, length: number): void;
  session_resident_bytes(): number;
  heatmap_results_clear(): void;
  heatmap_build(
    ySlot: number,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
    plotWidth: number,
    plotHeight: number,
    heatBinPx: number,
    hoverSourceIndex: bigint,
  ): number;
  heat_counts_ptr(index: number): number;
  heat_counts_len(index: number): number;
  heat_hovered_ptr(index: number): number;
  heat_hovered_len(index: number): number;
  heat_membership_counts_ptr(index: number): number;
  heat_membership_counts_len(index: number): number;
  heat_membership_offsets_ptr(index: number): number;
  heat_membership_offsets_len(index: number): number;
  heat_selected_counts_ptr(index: number): number;
  heat_selected_counts_len(index: number): number;
  heat_source_indices_ptr(index: number): number;
  heat_source_indices_len(index: number): number;
  heat_populated_count(index: number): number;
  heat_x_bin_count(index: number): number;
  heat_y_bin_count(index: number): number;
  bubble_results_clear(): void;
  bubble_build(
    ySlot: number,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
    maxAggregates: number,
    hoverSourceIndex: bigint,
  ): number;
  bubble_center_x_ptr(index: number): number;
  bubble_center_x_len(index: number): number;
  bubble_center_y_ptr(index: number): number;
  bubble_center_y_len(index: number): number;
  bubble_counts_ptr(index: number): number;
  bubble_counts_len(index: number): number;
  bubble_hovered_ptr(index: number): number;
  bubble_hovered_len(index: number): number;
  bubble_membership_counts_ptr(index: number): number;
  bubble_membership_counts_len(index: number): number;
  bubble_membership_offsets_ptr(index: number): number;
  bubble_membership_offsets_len(index: number): number;
  bubble_selected_counts_ptr(index: number): number;
  bubble_selected_counts_len(index: number): number;
  bubble_source_indices_ptr(index: number): number;
  bubble_source_indices_len(index: number): number;
  bubble_singleton_count(index: number): number;
  bubble_total_aggregate_count(index: number): number;
}

export interface FastScatterWebgpuWasmAggregationDiagnostics {
  activeBytes: number;
  backend: 'rust-wasm';
  binaryBytes: number;
  binarySha256: string;
  buildCount: number;
  lastBuildMs: number;
  residentBytes: number;
  setupBytes: number;
  setupMs: number;
  zeroCopyBuilds: true;
}

export class FastScatterWebgpuWasmAggregationSession {
  private buildCount = 0;
  private lastBuildMs = 0;

  private constructor(
    private readonly wasm: FastScatterAggregationWasmExports,
    private readonly ySlotByKey: ReadonlyMap<string, number>,
    private readonly pointCount: number,
    private readonly setupBytes: number,
    private readonly setupMs: number,
    private readonly binaryBytes: number,
  ) {}

  static create(
    columns: Pick<FastScatterPointColumns, 'sourceIndex' | 'x' | 'xOrder' | 'y'>,
    spec: FastScatterPlotSpec,
    xSorted: boolean,
  ): FastScatterWebgpuWasmAggregationSession | null {
    if (
      typeof WebAssembly === 'undefined' || !xSorted ||
      columns.x.length > 0xffff_ffff
    ) return null;
    const uniqueYKeys = [...new Set(spec.plots.map((plot) => plot.yKey))];
    const yColumns = uniqueYKeys.map((key) => columns.y[key]);
    if (
      yColumns.some((column) => column === undefined || column.length !== columns.x.length) ||
      (columns.xOrder !== undefined && columns.xOrder.length !== columns.x.length) ||
      (columns.sourceIndex !== undefined && columns.sourceIndex.length !== columns.x.length)
    ) return null;
    const startedAt = performance.now();
    try {
      const module = getWasmModule();
      const instance = new WebAssembly.Instance(module);
      const wasm = instance.exports as FastScatterAggregationWasmExports;
      validateExports(wasm);
      wasm.session_reset(columns.x.length, uniqueYKeys.length);
      let setupBytes = copyColumn(wasm, 0, columns.x);
      for (let index = 0; index < yColumns.length; index += 1) {
        setupBytes += copyColumn(wasm, index + 1, yColumns[index]!);
      }
      if (columns.xOrder !== undefined) {
        const pointer = wasm.session_set_x_order(1);
        copyU32IntoMemory(wasm.memory, pointer, columns.xOrder);
        setupBytes += columns.xOrder.byteLength;
      }
      if (columns.sourceIndex !== undefined) {
        const pointer = wasm.session_set_source_index(1);
        copyU32IntoMemory(wasm.memory, pointer, columns.sourceIndex);
        setupBytes += columns.sourceIndex.byteLength;
      }
      if (wasm.session_validate() !== 1) return null;
      return new FastScatterWebgpuWasmAggregationSession(
        wasm,
        new Map(uniqueYKeys.map((key, index) => [key, index])),
        columns.x.length,
        setupBytes,
        performance.now() - startedAt,
        cachedWasmBinaryBytes,
      );
    } catch {
      return null;
    }
  }

  build(request: FastScatterAggregationRequest): FastScatterAggregationSet | null {
    const startedAt = performance.now();
    this.setSelection(request.selectedSourceIndices);
    const aggregation = request.mode === 'heatmap'
      ? this.buildHeatmap(request)
      : this.buildBubble(request);
    if (aggregation === null) return null;
    this.buildCount += 1;
    this.lastBuildMs = performance.now() - startedAt;
    aggregation.metrics.aggregateBuildMs = this.lastBuildMs;
    aggregation.metrics.resultBytes = getFastScatterAggregationByteLength(aggregation);
    return aggregation;
  }

  getDiagnostics(): FastScatterWebgpuWasmAggregationDiagnostics {
    return {
      backend: 'rust-wasm',
      activeBytes: this.wasm.session_resident_bytes(),
      binaryBytes: this.binaryBytes,
      binarySha256: FAST_SCATTER_AGGREGATION_WASM_SHA256,
      buildCount: this.buildCount,
      lastBuildMs: this.lastBuildMs,
      residentBytes: this.wasm.memory.buffer.byteLength,
      setupBytes: this.setupBytes,
      setupMs: this.setupMs,
      zeroCopyBuilds: true,
    };
  }

  private buildHeatmap(
    request: Extract<FastScatterAggregationRequest, { mode: 'heatmap' }>,
  ): FastScatterHeatmapAggregationSet | null {
    this.wasm.heatmap_results_clear();
    const resultIndices: number[] = [];
    for (const subplot of request.subplots) {
      const ySlot = this.ySlotByKey.get(subplot.yKey);
      if (ySlot === undefined) return null;
      const resultIndex = this.wasm.heatmap_build(
        ySlot,
        request.xRange.min,
        request.xRange.max,
        subplot.yRange.min,
        subplot.yRange.max,
        subplot.plotWidthPx,
        subplot.plotHeightPx,
        request.heatBinPx,
        normalizeHover(request.hoverSourceIndex),
      );
      if (resultIndex === INVALID_RESULT) return null;
      resultIndices.push(resultIndex);
    }
    const memory = this.wasm.memory.buffer;
    const subplots: FastScatterHeatmapSubplotAggregation[] = request.subplots.map(
      (subplot, index) => {
        const resultIndex = resultIndices[index]!;
        const xBinCount = this.wasm.heat_x_bin_count(resultIndex);
        const yBinCount = this.wasm.heat_y_bin_count(resultIndex);
        const xRange = normalizeRange(request.xRange);
        const yRange = normalizeRange(subplot.yRange);
        return {
          cellCount: xBinCount * yBinCount,
          counts: readU32(memory, this.wasm.heat_counts_ptr(resultIndex), this.wasm.heat_counts_len(resultIndex)),
          heatBinPx: normalizeHeatBinPx(request.heatBinPx),
          hovered: readU8(memory, this.wasm.heat_hovered_ptr(resultIndex), this.wasm.heat_hovered_len(resultIndex)),
          membershipCounts: readU32(memory, this.wasm.heat_membership_counts_ptr(resultIndex), this.wasm.heat_membership_counts_len(resultIndex)),
          membershipOffsets: readU32(memory, this.wasm.heat_membership_offsets_ptr(resultIndex), this.wasm.heat_membership_offsets_len(resultIndex)),
          plotHeightPx: normalizePlotSize(subplot.plotHeightPx),
          plotId: subplot.plotId,
          plotWidthPx: normalizePlotSize(subplot.plotWidthPx),
          populatedCellCount: this.wasm.heat_populated_count(resultIndex),
          selectedCounts: readU32(memory, this.wasm.heat_selected_counts_ptr(resultIndex), this.wasm.heat_selected_counts_len(resultIndex)),
          sourceIndices: readU32(memory, this.wasm.heat_source_indices_ptr(resultIndex), this.wasm.heat_source_indices_len(resultIndex)),
          xBinCount,
          xBinSize: (xRange.max - xRange.min) / xBinCount,
          xRange,
          yBinCount,
          yBinSize: (yRange.max - yRange.min) / yBinCount,
          yKey: subplot.yKey,
          yRange,
        };
      },
    );
    return {
      kind: 'heatmap',
      metrics: { aggregateBuildMs: 0, resultBytes: 0 },
      pointCount: this.pointCount,
      subplots,
      totalCellCount: subplots.reduce((total, subplot) => total + subplot.cellCount, 0),
      totalPopulatedCellCount: subplots.reduce(
        (total, subplot) => total + subplot.populatedCellCount,
        0,
      ),
    };
  }

  private buildBubble(
    request: Extract<FastScatterAggregationRequest, { mode: 'bubble' }>,
  ): FastScatterBubbleAggregationSet | null {
    this.wasm.bubble_results_clear();
    const resultIndices: number[] = [];
    for (const subplot of request.subplots) {
      const ySlot = this.ySlotByKey.get(subplot.yKey);
      if (ySlot === undefined) return null;
      const resultIndex = this.wasm.bubble_build(
        ySlot,
        request.xRange.min,
        request.xRange.max,
        subplot.yRange.min,
        subplot.yRange.max,
        FAST_SCATTER_WEBGPU_MAX_BUBBLE_AGGREGATES_PER_SUBPLOT,
        normalizeHover(request.hoverSourceIndex),
      );
      if (resultIndex === INVALID_RESULT) return null;
      resultIndices.push(resultIndex);
    }
    const memory = this.wasm.memory.buffer;
    const subplots: FastScatterBubbleSubplotAggregation[] = request.subplots.map(
      (subplot, index) => {
        const resultIndex = resultIndices[index]!;
        const aggregateCount = this.wasm.bubble_counts_len(resultIndex);
        const representativeColor = new Uint32Array(aggregateCount);
        representativeColor.fill(0xffff_ffff);
        return {
          aggregateCount,
          centerX: readF64(memory, this.wasm.bubble_center_x_ptr(resultIndex), this.wasm.bubble_center_x_len(resultIndex)),
          centerY: readF64(memory, this.wasm.bubble_center_y_ptr(resultIndex), this.wasm.bubble_center_y_len(resultIndex)),
          counts: readU32(memory, this.wasm.bubble_counts_ptr(resultIndex), aggregateCount),
          hovered: readU8(memory, this.wasm.bubble_hovered_ptr(resultIndex), this.wasm.bubble_hovered_len(resultIndex)),
          membershipCounts: readU32(memory, this.wasm.bubble_membership_counts_ptr(resultIndex), this.wasm.bubble_membership_counts_len(resultIndex)),
          membershipOffsets: readU32(memory, this.wasm.bubble_membership_offsets_ptr(resultIndex), this.wasm.bubble_membership_offsets_len(resultIndex)),
          plotId: subplot.plotId,
          representativeColor,
          selectedCounts: readU32(memory, this.wasm.bubble_selected_counts_ptr(resultIndex), this.wasm.bubble_selected_counts_len(resultIndex)),
          singletonCount: this.wasm.bubble_singleton_count(resultIndex),
          sourceIndices: readU32(memory, this.wasm.bubble_source_indices_ptr(resultIndex), this.wasm.bubble_source_indices_len(resultIndex)),
          totalAggregateCount: this.wasm.bubble_total_aggregate_count(resultIndex),
          yKey: subplot.yKey,
        };
      },
    );
    return {
      kind: 'bubble',
      metrics: { aggregateBuildMs: 0, resultBytes: 0 },
      pointCount: this.pointCount,
      subplots,
      totalAggregateCount: subplots.reduce(
        (total, subplot) => total + subplot.totalAggregateCount,
        0,
      ),
    };
  }

  private setSelection(selection: Uint32Array | undefined): void {
    if (selection === undefined || selection.length === 0) {
      this.wasm.session_set_selection(0, 0);
      return;
    }
    const pointer = this.wasm.session_selection_reserve(selection.length);
    copyU32IntoMemory(this.wasm.memory, pointer, selection);
    this.wasm.session_set_selection(pointer, selection.length);
    this.wasm.session_selection_release(pointer, selection.length);
  }
}

function copyColumn(
  wasm: FastScatterAggregationWasmExports,
  slot: number,
  values: FastScatterTypedNumericArray,
): number {
  const generated = (values as FastScatterTypedNumericArray & {
    generatedOverlapIndex?: boolean;
  }).generatedOverlapIndex === true;
  const kind = generated ? COLUMN_GENERATED_OVERLAP_X : getColumnKind(values);
  const byteLength = generated ? 0 : values.byteLength;
  const pointer = wasm.session_column_reserve(slot, kind, byteLength);
  if (!generated && byteLength > 0) {
    const source = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
    new Uint8Array(wasm.memory.buffer, pointer, byteLength).set(source);
  }
  return byteLength;
}

function getColumnKind(values: FastScatterTypedNumericArray): number {
  if (values instanceof Float32Array) return COLUMN_F32;
  if (values instanceof Float64Array) return COLUMN_F64;
  if (values instanceof Uint8Array) return COLUMN_U8;
  if (values instanceof Uint16Array) return COLUMN_U16;
  return COLUMN_U32;
}

function copyU32IntoMemory(
  memory: WebAssembly.Memory,
  pointer: number,
  values: Uint32Array,
): void {
  new Uint32Array(memory.buffer, pointer, values.length).set(values);
}

function readU8(memory: ArrayBuffer, pointer: number, length: number): Uint8Array {
  return new Uint8Array(memory, pointer, length);
}

function readU32(memory: ArrayBuffer, pointer: number, length: number): Uint32Array {
  return new Uint32Array(memory, pointer, length);
}

function readF64(memory: ArrayBuffer, pointer: number, length: number): Float64Array {
  return new Float64Array(memory, pointer, length);
}

function normalizeRange(range: { min: number; max: number }) {
  return { max: Math.max(range.min, range.max), min: Math.min(range.min, range.max) };
}

function normalizeHeatBinPx(value: number): number {
  return Number.isFinite(value) ? Math.min(128, Math.max(2, value)) : 18;
}

function normalizePlotSize(value: number): number {
  return Number.isFinite(value) ? Math.max(1, value) : 1;
}

function normalizeHover(value: number | null | undefined): bigint {
  return value !== null && value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? BigInt(value)
    : -1n;
}

function decodeWasmBase64(value: string): Uint8Array<ArrayBuffer> {
  const decoded = globalThis.atob(value);
  const result = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index += 1) {
    result[index] = decoded.charCodeAt(index);
  }
  return result;
}

function getWasmModule(): WebAssembly.Module {
  if (cachedWasmModule !== null) return cachedWasmModule;
  const binary = decodeWasmBase64(FAST_SCATTER_AGGREGATION_WASM_BASE64);
  cachedWasmBinaryBytes = binary.byteLength;
  cachedWasmModule = new WebAssembly.Module(binary);
  return cachedWasmModule;
}

function validateExports(
  value: WebAssembly.Exports,
): asserts value is FastScatterAggregationWasmExports {
  if (!(value.memory instanceof WebAssembly.Memory) || typeof value.session_reset !== 'function') {
    throw new Error('m-scatter WebGPU aggregation WASM exports are invalid.');
  }
}
