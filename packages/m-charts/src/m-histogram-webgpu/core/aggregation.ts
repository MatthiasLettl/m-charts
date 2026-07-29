import {
  buildHistogramAggregation,
  prepareHistogramAggregationState,
  resolveHistogramContinuousBinSize,
  type HistogramAggregationBuildMetrics,
  type HistogramAggregationPreparedState,
  type HistogramAggregationRequest,
  type HistogramAggregationSet,
  type HistogramBin,
  type HistogramBinSizeState,
  type HistogramColumns,
  type HistogramParameterSpec,
  type HistogramPlotSpec,
  type HistogramPreparedContinuousPlan,
  type HistogramRange,
  type HistogramSubplotBins,
} from '../../m-histogram/core/index.js';
import type { HistogramAggregationProvider } from '../../m-histogram/engine/index.js';
import {
  M_CHARTS_AGGREGATION_WASM_BASE64,
} from '../../plot-engine-webgpu/core/aggregationWasmBinary.js';
import type {
  HistogramWebgpuAggregationBackend,
  HistogramWebgpuResolvedAggregationBackend,
} from './types.js';

const INVALID_RESULT = 0xffff_ffff;
const DEFAULT_PACKED_COLOR = 0xffff_ffff;
let cachedModule: WebAssembly.Module | null = null;

interface HistogramWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  histogram_session_reset(pointCount: number, columnCount: number): void;
  histogram_column_reserve(slot: number, kind: number, byteLength: number): number;
  histogram_column_prepare_index(
    slot: number,
    domainMin: number,
    domainMax: number,
  ): number;
  histogram_set_color(enabled: number): number;
  histogram_set_source_index(enabled: number): number;
  histogram_results_reset(): void;
  histogram_selection_reserve(length: number): number;
  histogram_set_selection(pointer: number, length: number): void;
  histogram_build(
    slot: number,
    domainMin: number,
    domainMax: number,
    binSize: number,
    globalIndexStart: number,
    totalBinCount: number,
    visibleBinCount: number,
    visibleMin: number,
    visibleMax: number,
    hoverSourceIndex: bigint,
    categorical: number,
    includeMembership: number,
  ): number;
  histogram_counts_ptr(index: number): number;
  histogram_counts_len(index: number): number;
  histogram_color_counts_ptr(index: number): number;
  histogram_color_counts_len(index: number): number;
  histogram_color_offsets_ptr(index: number): number;
  histogram_color_offsets_len(index: number): number;
  histogram_color_values_ptr(index: number): number;
  histogram_color_values_len(index: number): number;
  histogram_selected_counts_ptr(index: number): number;
  histogram_selected_counts_len(index: number): number;
  histogram_source_indices_ptr(index: number): number;
  histogram_source_indices_len(index: number): number;
  histogram_hovered_ptr(index: number): number;
  histogram_hovered_len(index: number): number;
  histogram_invalid_count(index: number): number;
  histogram_out_of_domain_count(index: number): number;
  histogram_total_count(index: number): number;
  histogram_visited_count(index: number): number;
  histogram_domain_min(index: number): number;
  histogram_domain_max(index: number): number;
}

export interface HistogramWebgpuAggregationDiagnostics {
  backend: HistogramWebgpuResolvedAggregationBackend;
  buildCount: number;
  fallbackReason?: string;
  indexedRowCount: number;
  lastBuildMs: number;
  lastReusedSubplotCount: number;
  lastVisitedRowCount: number;
  setupBytes: number;
  setupMs: number;
}

interface CachedWasmSubplot {
  readonly metrics: HistogramAggregationBuildMetrics;
  readonly parameterKey: string;
  readonly planKey: string;
  readonly subplot: HistogramSubplotBins;
}

export class HistogramWebgpuAggregationProvider implements HistogramAggregationProvider {
  private buildCount = 0;
  private columns: HistogramColumns | null = null;
  private fallbackReason: string | undefined;
  private indexedRowCount = 0;
  private lastBuildMs = 0;
  private lastHoverSourceIndex: number | null = null;
  private lastPlotSpec: HistogramAggregationRequest['plotSpec'] | null = null;
  private lastReusedSubplotCount = 0;
  private lastSelectedSourceIndices = new Uint32Array(0);
  private lastVisitedRowCount = 0;
  private parameterSlotByKey = new Map<string, number>();
  private resolvedBackend: HistogramWebgpuResolvedAggregationBackend;
  private setupBytes = 0;
  private setupMs = 0;
  private subplotCache = new Map<string, CachedWasmSubplot>();
  private wasm: HistogramWasmExports | null = null;
  private wasmPreparedState: HistogramAggregationPreparedState | null = null;

  constructor(private readonly requestedBackend: HistogramWebgpuAggregationBackend = 'auto') {
    this.resolvedBackend = requestedBackend === 'typescript' ? 'typescript' : 'rust-wasm';
  }

  prepare(
    columns: HistogramColumns,
    spec: Pick<HistogramPlotSpec, 'parameters'>,
  ): HistogramAggregationPreparedState {
    if (this.requestedBackend !== 'typescript') {
      const setup = this.setupWasm(columns, spec.parameters);
      if (setup !== null) return setup;
    }
    this.resolvedBackend = 'typescript';
    this.wasmPreparedState = null;
    return prepareHistogramAggregationState(columns, spec);
  }

  build(
    columns: HistogramColumns,
    request: HistogramAggregationRequest,
  ): HistogramAggregationSet {
    const startedAt = performance.now();
    this.lastReusedSubplotCount = 0;
    this.lastVisitedRowCount = 0;
    let result: HistogramAggregationSet | null = null;
    if (this.requestedBackend !== 'typescript') {
      result = this.buildWasm(columns, request);
    }
    if (result === null) {
      this.resolvedBackend = 'typescript';
      result = buildHistogramAggregation(columns, {
        ...request,
        preparedState:
          request.preparedState !== undefined &&
          request.preparedState !== this.wasmPreparedState
            ? request.preparedState
            : prepareHistogramAggregationState(columns, request.plotSpec),
      });
    } else {
      this.resolvedBackend = 'rust-wasm';
      this.fallbackReason = undefined;
    }
    this.buildCount += 1;
    this.lastBuildMs = performance.now() - startedAt;
    return {
      ...result,
      metrics: { ...result.metrics, aggregateBuildMs: this.lastBuildMs },
    };
  }

  dispose(): void {
    this.columns = null;
    this.lastPlotSpec = null;
    this.parameterSlotByKey.clear();
    this.subplotCache.clear();
    this.wasm = null;
    this.wasmPreparedState = null;
  }

  getDiagnostics(): HistogramWebgpuAggregationDiagnostics {
    return {
      backend: this.resolvedBackend,
      buildCount: this.buildCount,
      ...(this.fallbackReason === undefined ? {} : { fallbackReason: this.fallbackReason }),
      indexedRowCount: this.indexedRowCount,
      lastBuildMs: this.lastBuildMs,
      lastReusedSubplotCount: this.lastReusedSubplotCount,
      lastVisitedRowCount: this.lastVisitedRowCount,
      setupBytes: this.setupBytes,
      setupMs: this.setupMs,
    };
  }

  private setupWasm(
    columns: HistogramColumns,
    parameters: readonly HistogramParameterSpec[],
  ): HistogramAggregationPreparedState | null {
    const startedAt = performance.now();
    if (typeof WebAssembly === 'undefined' || columns.ids.length > 0xffff_ffff) {
      return this.fallback('WebAssembly is unavailable or the row count exceeds uint32.');
    }
    if (
      parameters.some((parameter) => {
        const column = columns.valuesByParameter[parameter.key];
        return parameter.domain === undefined ||
          !isWasmColumn(column, columns.ids.length) ||
          !isWasmParameter(parameter, column);
      })
    ) {
      return this.fallback(
        'Rust/WASM requires typed columns, explicit domains, and sequentially encoded unsigned-integer categories.',
      );
    }
    if (
      columns.color !== undefined &&
      (!(columns.color instanceof Uint32Array) ||
        columns.color.length !== columns.ids.length)
    ) {
      return this.fallback(
        'Rust/WASM color stacks require one packed rgba32 value per record.',
      );
    }
    try {
      const instance = new WebAssembly.Instance(getModule());
      const wasm = instance.exports as HistogramWasmExports;
      validateWasm(wasm);
      wasm.histogram_session_reset(columns.ids.length, parameters.length);
      this.parameterSlotByKey.clear();
      this.subplotCache.clear();
      this.lastHoverSourceIndex = null;
      this.lastPlotSpec = null;
      this.lastSelectedSourceIndices = new Uint32Array(0);
      let setupBytes = 0;
      let indexedRowCount = 0;
      for (let slot = 0; slot < parameters.length; slot += 1) {
        const parameter = parameters[slot]!;
        const column = columns.valuesByParameter[parameter.key] as WasmHistogramColumn;
        const pointer = wasm.histogram_column_reserve(
          slot,
          getWasmColumnKind(column),
          column.byteLength,
        );
        copyBytes(wasm.memory, pointer, column);
        setupBytes += column.byteLength;
        if (parameter.kind !== 'categorical' && parameter.kind !== 'boolean') {
          const domain = normalizeRange(parameter.domain!);
          const indexedRows = wasm.histogram_column_prepare_index(
            slot,
            domain.min,
            domain.max,
          );
          if (indexedRows === INVALID_RESULT) {
            throw new Error(`Rust/WASM could not index histogram parameter ${parameter.key}.`);
          }
          indexedRowCount += indexedRows;
          setupBytes += indexedRows * Uint32Array.BYTES_PER_ELEMENT;
        }
        this.parameterSlotByKey.set(parameter.key, slot);
      }
      if (columns.color !== undefined) {
        const pointer = wasm.histogram_set_color(1);
        copyBytes(wasm.memory, pointer, columns.color);
        setupBytes += columns.color.byteLength;
      }
      if (columns.sourceIndex !== undefined) {
        const pointer = wasm.histogram_set_source_index(1);
        copyBytes(wasm.memory, pointer, columns.sourceIndex);
        setupBytes += columns.sourceIndex.byteLength;
      }
      this.columns = columns;
      this.indexedRowCount = indexedRowCount;
      this.wasm = wasm;
      this.setupBytes = setupBytes;
      this.setupMs = performance.now() - startedAt;
      this.fallbackReason = undefined;
      this.wasmPreparedState = createLightweightPreparedState(parameters);
      return this.wasmPreparedState;
    } catch (error) {
      return this.fallback(
        error instanceof Error ? error.message : 'Rust/WASM setup failed.',
      );
    }
  }

  private buildWasm(
    columns: HistogramColumns,
    request: HistogramAggregationRequest,
  ): HistogramAggregationSet | null {
    if (
      columns.sourceIndex !== undefined &&
      hasSourceIndexOutsideRowRange(
        request.selectedSourceIndices,
        columns.ids.length,
      )
    ) {
      this.fallbackReason =
        'Selected source indices outside the row range require the exact TypeScript backend.';
      return null;
    }
    if (
      this.wasm === null || this.columns !== columns ||
      this.parameterSlotByKey.size !== request.plotSpec.parameters.length
    ) {
      if (this.setupWasm(columns, request.plotSpec.parameters) === null) return null;
    }
    const wasm = this.wasm!;
    const hoverSourceIndex = normalizeOptionalHover(request.hoverSourceIndex);
    const selectedSourceIndices = normalizeSelection(
      request.selectedSourceIndices,
      columns.ids.length,
    );
    const selectionChanged = !areUint32ArraysEqual(
      this.lastSelectedSourceIndices,
      selectedSourceIndices,
    );
    if (
      this.lastPlotSpec !== request.plotSpec ||
      this.lastHoverSourceIndex !== hoverSourceIndex ||
      selectionChanged
    ) {
      this.subplotCache.clear();
      this.lastPlotSpec = request.plotSpec;
      this.lastHoverSourceIndex = hoverSourceIndex;
      if (selectionChanged) {
        this.lastSelectedSourceIndices = selectedSourceIndices.slice();
      }
    }
    wasm.histogram_results_reset();
    if (selectionChanged) setSelection(wasm, selectedSourceIndices);
    const parameterByKey = new Map(
      request.plotSpec.parameters.map((parameter) => [parameter.key, parameter]),
    );
    const binSizeByKey = createBinSizeLookup(request.binSizes);
    const subplots: HistogramSubplotBins[] = [];
    let binCount = 0;
    let invalidValueCount = 0;
    let outOfDomainValueCount = 0;
    let totalCount = 0;
    let colorSegmentCount = 0;
    let reusedSubplotCount = 0;
    let visitedRowCount = 0;
    const includeMembership = request.includeMembership !== false;
    for (const subplot of request.plotSpec.subplots) {
      const parameter = parameterByKey.get(subplot.parameterKey);
      const slot = this.parameterSlotByKey.get(subplot.parameterKey);
      if (parameter?.domain === undefined || slot === undefined) return null;
      const plan = createWasmPlan(
        parameter,
        parameter.domain,
        request.viewport?.subplotById[subplot.id]?.x,
        binSizeByKey.get(`${subplot.id}\u0000${subplot.parameterKey}`) ?? null,
      );
      const planKey = createWasmPlanKey(plan);
      const cached = this.subplotCache.get(subplot.id);
      if (
        cached !== undefined &&
        cached.parameterKey === parameter.key &&
        cached.planKey === planKey &&
        (!includeMembership || cached.subplot.sourceIndicesAvailable)
      ) {
        subplots.push(cached.subplot);
        binCount += cached.metrics.binCount;
        colorSegmentCount += cached.metrics.colorSegmentCount;
        invalidValueCount += cached.metrics.invalidValueCount;
        outOfDomainValueCount += cached.metrics.outOfDomainValueCount;
        totalCount += cached.metrics.totalCount;
        reusedSubplotCount += 1;
        continue;
      }
      const index = wasm.histogram_build(
        slot,
        plan.domain.min,
        plan.domain.max,
        plan.binSize,
        plan.globalIndexStart,
        plan.totalBinCount,
        plan.binCount,
        plan.candidateMin,
        plan.candidateMax,
        normalizeHover(request.hoverSourceIndex),
        parameter.kind === 'categorical' || parameter.kind === 'boolean' ? 1 : 0,
        includeMembership ? 1 : 0,
      );
      if (index === INVALID_RESULT) return null;
      const counts = readU32(
        wasm.memory.buffer,
        wasm.histogram_counts_ptr(index),
        wasm.histogram_counts_len(index),
      );
      const selectedCounts = readU32(
        wasm.memory.buffer,
        wasm.histogram_selected_counts_ptr(index),
        wasm.histogram_selected_counts_len(index),
      );
      const hovered = readU8(
        wasm.memory.buffer,
        wasm.histogram_hovered_ptr(index),
        wasm.histogram_hovered_len(index),
      );
      const colorCounts = readU32(
        wasm.memory.buffer,
        wasm.histogram_color_counts_ptr(index),
        wasm.histogram_color_counts_len(index),
      );
      const colorOffsets = readU32(
        wasm.memory.buffer,
        wasm.histogram_color_offsets_ptr(index),
        wasm.histogram_color_offsets_len(index),
      );
      const colorValues = readU32(
        wasm.memory.buffer,
        wasm.histogram_color_values_ptr(index),
        wasm.histogram_color_values_len(index),
      );
      const sourceIndices = includeMembership
        ? readU32(
            wasm.memory.buffer,
            wasm.histogram_source_indices_ptr(index),
            wasm.histogram_source_indices_len(index),
          )
        : undefined;
      let offset = 0;
      const bins: HistogramBin[] = Array.from(counts, (count, localIndex) => {
        const min = plan.min + localIndex * plan.binSize;
        const max = localIndex === counts.length - 1
          ? plan.max
          : Math.min(plan.domain.max, min + plan.binSize);
        const colorStart = colorOffsets[localIndex] ?? 0;
        const colorEnd = colorOffsets[localIndex + 1] ?? colorStart;
        let stackStart = 0;
        const stack = Array.from(
          { length: Math.max(0, colorEnd - colorStart) },
          (_, colorIndex) => {
            const flatIndex = colorStart + colorIndex;
            const segmentCount = colorCounts[flatIndex] ?? 0;
            const segment = {
              color: colorValues[flatIndex] ?? DEFAULT_PACKED_COLOR,
              count: segmentCount,
              endCount: stackStart + segmentCount,
              startCount: stackStart,
            };
            stackStart += segmentCount;
            return segment;
          },
        );
        const bin: HistogramBin = {
          descriptor: {
            ...(plan.categories?.[plan.globalIndexStart + localIndex] === undefined
              ? {}
              : { category: plan.categories[plan.globalIndexStart + localIndex] }),
            center: (min + max) / 2,
            index: plan.globalIndexStart + localIndex,
            max,
            min,
            parameterKey: parameter.key,
            subplotId: subplot.id,
          },
          hovered: hovered[localIndex] === 1,
          membership: { count, offset, sourceIndicesAvailable: includeMembership },
          selectedCount: selectedCounts[localIndex] ?? 0,
          stack,
          totalCount: count,
        };
        offset += count;
        return bin;
      });
      const subplotInvalid = wasm.histogram_invalid_count(index);
      const subplotOutOfDomain = wasm.histogram_out_of_domain_count(index);
      const subplotTotal = wasm.histogram_total_count(index);
      const populatedMin = wasm.histogram_domain_min(index);
      const populatedMax = wasm.histogram_domain_max(index);
      const subplotColorSegmentCount = bins.reduce(
        (sum, bin) => sum + bin.stack.length,
        0,
      );
      const nextSubplot: HistogramSubplotBins = {
        binCount: bins.length,
        bins,
        continuousBinResolution: plan.resolution,
        dataMode: 'histogram',
        ...(parameter.kind === 'categorical' || parameter.kind === 'boolean' ||
        !Number.isFinite(populatedMin) || !Number.isFinite(populatedMax)
          ? {}
          : { domain: normalizeRange({ min: populatedMin, max: populatedMax }) }),
        parameterKey: parameter.key,
        sourceIndices,
        sourceIndicesAvailable: includeMembership,
        sourceIndicesState: includeMembership ? 'available' : 'pending',
        subplotId: subplot.id,
      };
      const metrics: HistogramAggregationBuildMetrics = {
        binCount: bins.length,
        colorSegmentCount: subplotColorSegmentCount,
        excludedValueCount: subplotInvalid + subplotOutOfDomain,
        invalidValueCount: subplotInvalid,
        missingValueCount: 0,
        outOfDomainValueCount: subplotOutOfDomain,
        sourceIndexCount: subplotTotal,
        totalCount: subplotTotal,
      };
      this.subplotCache.set(subplot.id, {
        metrics,
        parameterKey: parameter.key,
        planKey,
        subplot: nextSubplot,
      });
      binCount += metrics.binCount;
      colorSegmentCount += metrics.colorSegmentCount;
      invalidValueCount += metrics.invalidValueCount;
      outOfDomainValueCount += metrics.outOfDomainValueCount;
      totalCount += metrics.totalCount;
      visitedRowCount += wasm.histogram_visited_count(index);
      subplots.push(nextSubplot);
    }
    this.lastReusedSubplotCount = reusedSubplotCount;
    this.lastVisitedRowCount = visitedRowCount;
    return {
      metrics: {
        binCount,
        colorSegmentCount,
        excludedValueCount: invalidValueCount + outOfDomainValueCount,
        invalidValueCount,
        missingValueCount: 0,
        outOfDomainValueCount,
        sourceIndexCount: totalCount,
        totalCount,
      },
      mode: 'histogram',
      pointCount: columns.ids.length,
      subplots,
    };
  }

  private fallback(reason: string): null {
    this.fallbackReason = reason;
    this.indexedRowCount = 0;
    this.lastHoverSourceIndex = null;
    this.lastPlotSpec = null;
    this.lastSelectedSourceIndices = new Uint32Array(0);
    this.resolvedBackend = 'typescript';
    this.wasm = null;
    this.wasmPreparedState = null;
    this.subplotCache.clear();
    return null;
  }
}

function createWasmPlan(
  parameter: HistogramParameterSpec,
  rawDomain: HistogramRange,
  rawVisibleRange: HistogramRange | undefined,
  requestedBinSize: number | null,
) {
  if (parameter.kind === 'categorical' || parameter.kind === 'boolean') {
    const categories = [...(parameter.categories ?? [])].sort(
      (first, second) =>
        (first.order ?? first.encoded) - (second.order ?? second.encoded),
    );
    const domain = { min: -0.5, max: categories.length - 0.5 };
    return {
      binCount: categories.length,
      binSize: 1,
      candidateMax: domain.max,
      candidateMin: domain.min,
      categories,
      domain,
      globalIndexStart: 0,
      max: domain.max,
      min: domain.min,
      resolution: undefined,
      totalBinCount: categories.length,
    };
  }
  const domain = normalizeRange(rawDomain);
  const visibleRange = normalizeRange({
    min: Math.max(domain.min, rawVisibleRange?.min ?? domain.min),
    max: Math.min(domain.max, rawVisibleRange?.max ?? domain.max),
  });
  const resolution = resolveHistogramContinuousBinSize({
    parameter,
    requestedBinSize,
    visibleRange,
  });
  const binSize = resolution.effectiveBinSize;
  const totalBinCount = Math.max(1, Math.ceil((domain.max - domain.min) / binSize));
  const globalIndexStart = Math.max(
    0,
    Math.min(
      totalBinCount - 1,
      Math.floor((visibleRange.min - domain.min) / binSize),
    ),
  );
  const globalIndexEnd = Math.max(
    globalIndexStart,
    Math.min(
      totalBinCount - 1,
      Math.ceil((visibleRange.max - domain.min) / binSize) - 1,
    ),
  );
  return {
    binCount: globalIndexEnd - globalIndexStart + 1,
    binSize,
    candidateMax: resolution.visibleRange.max,
    candidateMin: resolution.visibleRange.min,
    domain,
    globalIndexStart,
    max: globalIndexEnd === totalBinCount - 1
      ? domain.max
      : Math.min(domain.max, domain.min + (globalIndexEnd + 1) * binSize),
    min: domain.min + globalIndexStart * binSize,
    resolution,
    totalBinCount,
  };
}

function createWasmPlanKey(plan: ReturnType<typeof createWasmPlan>): string {
  return [
    plan.domain.min,
    plan.domain.max,
    plan.binSize,
    plan.globalIndexStart,
    plan.totalBinCount,
    plan.binCount,
    plan.candidateMin,
    plan.candidateMax,
    plan.min,
    plan.max,
    plan.categories === undefined ? 'continuous' : 'category',
  ].join('\u0000');
}

type WasmHistogramColumn =
  | Float32Array
  | Float64Array
  | Uint8Array
  | Uint16Array
  | Uint32Array;

function isWasmParameter(
  parameter: HistogramParameterSpec,
  column: WasmHistogramColumn,
): boolean {
  if (parameter.kind === 'numeric' || parameter.kind === 'datetime-ns') return true;
  if (
    !(column instanceof Uint8Array) &&
    !(column instanceof Uint16Array) &&
    !(column instanceof Uint32Array)
  ) return false;
  const categories = [...(parameter.categories ?? [])].sort(
    (first, second) =>
      (first.order ?? first.encoded) - (second.order ?? second.encoded),
  );
  return categories.length > 0 &&
    categories.every((category, index) => category.encoded === index);
}

function getWasmColumnKind(column: WasmHistogramColumn): number {
  if (column instanceof Float32Array) return 1;
  if (column instanceof Float64Array) return 2;
  if (column instanceof Uint8Array) return 3;
  if (column instanceof Uint16Array) return 4;
  return 5;
}

function createLightweightPreparedState(
  parameters: readonly HistogramParameterSpec[],
): HistogramAggregationPreparedState {
  return {
    parameterPlanByKey: new Map(parameters.map((parameter) => [
      parameter.key,
      {
        domain: {
          excludedValueCount: 0,
          invalidValueCount: 0,
          missingValueCount: 0,
          outOfDomainValueCount: 0,
          range: normalizeRange(parameter.domain!),
        },
        kind: 'continuous',
        parameter,
        rowIndicesBySortedValue: new Uint32Array(0),
        sortedValues: new Float64Array(0),
      } satisfies HistogramPreparedContinuousPlan,
    ])),
  };
}

function createBinSizeLookup(
  binSizes?: readonly HistogramBinSizeState[],
): ReadonlyMap<string, number> {
  return new Map(
    (binSizes ?? []).map((state) => [
      `${state.subplotId}\u0000${state.parameterKey}`,
      state.binSize,
    ]),
  );
}

function setSelection(
  wasm: HistogramWasmExports,
  array: Uint32Array,
): void {
  const pointer = wasm.histogram_selection_reserve(array.length);
  if (array.length > 0) copyBytes(wasm.memory, pointer, array);
  wasm.histogram_set_selection(pointer, array.length);
}

function normalizeSelection(
  values: HistogramAggregationRequest['selectedSourceIndices'],
  rowCount: number,
): Uint32Array {
  if (values === undefined) return new Uint32Array(0);
  if (
    values instanceof Uint32Array &&
    values.every((value) => value < rowCount)
  ) {
    return values;
  }
  const normalized: number[] = [];
  for (const value of values) {
    if (Number.isSafeInteger(value) && value >= 0 && value < rowCount) {
      normalized.push(value);
    }
  }
  return new Uint32Array(normalized);
}

function areUint32ArraysEqual(left: Uint32Array, right: Uint32Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function getModule(): WebAssembly.Module {
  if (cachedModule !== null) return cachedModule;
  const binary = decodeBase64(M_CHARTS_AGGREGATION_WASM_BASE64);
  cachedModule = new WebAssembly.Module(binary.slice().buffer as ArrayBuffer);
  return cachedModule;
}

function decodeBase64(value: string): Uint8Array {
  if (typeof globalThis.atob === 'function') {
    const decoded = globalThis.atob(value);
    const result = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      result[index] = decoded.charCodeAt(index);
    }
    return result;
  }
  const buffer = (globalThis as typeof globalThis & {
    Buffer?: { from(value: string, encoding: string): Uint8Array };
  }).Buffer;
  if (buffer !== undefined) return new Uint8Array(buffer.from(value, 'base64'));
  throw new Error('No base64 decoder is available.');
}

function validateWasm(wasm: HistogramWasmExports): void {
  if (
    !(wasm.memory instanceof WebAssembly.Memory) ||
    typeof wasm.histogram_build !== 'function' ||
    typeof wasm.histogram_column_prepare_index !== 'function' ||
    typeof wasm.histogram_results_reset !== 'function' ||
    typeof wasm.histogram_source_indices_ptr !== 'function' ||
    typeof wasm.histogram_visited_count !== 'function'
  ) throw new Error('The embedded histogram WASM exports are invalid.');
}

function copyBytes(
  memory: WebAssembly.Memory,
  pointer: number,
  value: ArrayBufferView,
): void {
  new Uint8Array(memory.buffer, pointer, value.byteLength).set(
    new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
  );
}

function readU32(buffer: ArrayBuffer, pointer: number, length: number): Uint32Array {
  return new Uint32Array(buffer, pointer, length).slice();
}

function readU8(buffer: ArrayBuffer, pointer: number, length: number): Uint8Array {
  return new Uint8Array(buffer, pointer, length).slice();
}

function isWasmColumn(
  column: HistogramColumns['valuesByParameter'][string] | undefined,
  length: number,
): column is WasmHistogramColumn {
  return (
    (column instanceof Float32Array ||
      column instanceof Float64Array ||
      column instanceof Uint8Array ||
      column instanceof Uint16Array ||
      column instanceof Uint32Array) &&
    column.length === length
  );
}

function normalizeRange(range: HistogramRange): HistogramRange {
  const min = Number.isFinite(range.min) ? range.min : 0;
  const max = Number.isFinite(range.max) ? range.max : min + 1;
  if (max > min) return { max, min };
  return { min, max: min + 1 };
}

function normalizeHover(value?: number | null): bigint {
  const normalized = normalizeOptionalHover(value);
  return normalized === null ? -1n : BigInt(normalized);
}

function normalizeOptionalHover(value?: number | null): number | null {
  return value === undefined || value === null || !Number.isSafeInteger(value) || value < 0
    ? null
    : value;
}

function hasSourceIndexOutsideRowRange(
  values: HistogramAggregationRequest['selectedSourceIndices'],
  rowCount: number,
): boolean {
  if (values === undefined) return false;
  for (const value of values) {
    if (Number.isFinite(value) && value >= rowCount) return true;
  }
  return false;
}
