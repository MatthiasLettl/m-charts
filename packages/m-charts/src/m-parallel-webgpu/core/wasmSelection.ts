import {
  normalizeParallelBrushIntervals,
  type ParallelBrushIntervals,
  type ParallelBrushSelectionResult,
  type ParallelBuffers,
} from '../../m-parallel/index.js';
import {
  M_CHARTS_AGGREGATION_WASM_BASE64,
} from '../../plot-engine-webgpu/core/aggregationWasmBinary.js';

const COLUMN_F32 = 1;
const COLUMN_F64 = 2;
const COLUMN_U8 = 3;
const COLUMN_U16 = 4;
const COLUMN_U32 = 5;
const MAX_WASM_SELECTION_RECORDS = 2_000_000;
let cachedModule: WebAssembly.Module | null = null;

interface ParallelSelectionWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  parallel_session_reset(pointCount: number, axisCount: number): void;
  parallel_column_reserve(
    axis: number,
    kind: number,
    byteLength: number,
  ): number;
  parallel_selection_begin(): void;
  parallel_selection_axis_begin(): void;
  parallel_selection_axis_range(
    axis: number,
    min: number,
    max: number,
  ): number;
  parallel_selection_axis_commit(): void;
  parallel_selection_finish(): number;
  parallel_source_indices_ptr(): number;
  parallel_source_indices_len(): number;
  parallel_session_resident_bytes(): number;
}

export class ParallelWebgpuWasmSelectionSession {
  private constructor(
    private readonly wasm: ParallelSelectionWasmExports,
    private readonly buffers: ParallelBuffers,
  ) {}

  static create(buffers: ParallelBuffers): ParallelWebgpuWasmSelectionSession | null {
    if (
      typeof WebAssembly === 'undefined' ||
      buffers.recordCount > MAX_WASM_SELECTION_RECORDS
    ) {
      return null;
    }
    try {
      const module = cachedModule ??= new WebAssembly.Module(decodeBase64(
        M_CHARTS_AGGREGATION_WASM_BASE64,
      ));
      const wasm = new WebAssembly.Instance(module).exports as ParallelSelectionWasmExports;
      validateExports(wasm);
      wasm.parallel_session_reset(buffers.recordCount, buffers.axisCount);
      for (let axisIndex = 0; axisIndex < buffers.axisCount; axisIndex += 1) {
        const axis = buffers.axisOrder[axisIndex]!;
        const values = buffers.rawValuesByAxis[axis]!;
        if (
          !(values instanceof Float32Array) &&
          !(values instanceof Float64Array) &&
          !(values instanceof Uint8Array) &&
          !(values instanceof Uint16Array) &&
          !(values instanceof Uint32Array)
        ) {
          return null;
        }
        const kind = values instanceof Float32Array
          ? COLUMN_F32
          : values instanceof Float64Array
            ? COLUMN_F64
            : values instanceof Uint8Array
              ? COLUMN_U8
              : values instanceof Uint16Array
                ? COLUMN_U16
                : COLUMN_U32;
        const pointer = wasm.parallel_column_reserve(
          axisIndex,
          kind,
          values.byteLength,
        );
        if (pointer === 0 && values.byteLength > 0) return null;
        new Uint8Array(wasm.memory.buffer, pointer, values.byteLength).set(
          new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
        );
      }
      return new ParallelWebgpuWasmSelectionSession(wasm, buffers);
    } catch {
      return null;
    }
  }

  select(brushIntervals: ParallelBrushIntervals): ParallelBrushSelectionResult {
    const activeBrushes = normalizeParallelBrushIntervals(
      brushIntervals,
      this.buffers.axisOrder,
    );
    this.wasm.parallel_selection_begin();
    const grouped = new Map<string, typeof activeBrushes[number][]>();
    for (const brush of activeBrushes) {
      const values = grouped.get(brush.parameter);
      if (values === undefined) grouped.set(brush.parameter, [brush]);
      else values.push(brush);
    }
    for (const [axis, brushes] of grouped) {
      const axisIndex = this.buffers.axisOrder.indexOf(axis);
      if (axisIndex < 0) continue;
      this.wasm.parallel_selection_axis_begin();
      for (const brush of brushes) {
        this.wasm.parallel_selection_axis_range(
          axisIndex,
          Math.min(brush.min, brush.max),
          Math.max(brush.min, brush.max),
        );
      }
      this.wasm.parallel_selection_axis_commit();
    }
    this.wasm.parallel_selection_finish();
    const length = this.wasm.parallel_source_indices_len();
    const pointer = this.wasm.parallel_source_indices_ptr();
    const sourceIndices = new Uint32Array(length);
    sourceIndices.set(
      new Uint32Array(this.wasm.memory.buffer, pointer, length),
    );
    return {
      activeBrushes,
      selectedCount: sourceIndices.length,
      sourceIndices,
    };
  }

  get residentBytes(): number {
    return this.wasm.parallel_session_resident_bytes();
  }
}

function validateExports(
  wasm: Partial<ParallelSelectionWasmExports>,
): asserts wasm is ParallelSelectionWasmExports {
  for (const name of [
    'memory',
    'parallel_session_reset',
    'parallel_column_reserve',
    'parallel_selection_begin',
    'parallel_selection_axis_begin',
    'parallel_selection_axis_range',
    'parallel_selection_axis_commit',
    'parallel_selection_finish',
    'parallel_source_indices_ptr',
    'parallel_source_indices_len',
    'parallel_session_resident_bytes',
  ] as const) {
    if (wasm[name] === undefined) {
      throw new Error(`Parallel selection WASM export ${name} is missing.`);
    }
  }
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  if (typeof globalThis.atob === 'function') {
    const decoded = globalThis.atob(value);
    const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  }
  const BufferConstructor = (
    globalThis as typeof globalThis & {
      Buffer?: {
        from(value: string, encoding: string): Uint8Array;
      };
    }
  ).Buffer;
  if (BufferConstructor === undefined) {
    throw new Error('No base64 decoder is available.');
  }
  const source = BufferConstructor.from(value, 'base64');
  const bytes = new Uint8Array(new ArrayBuffer(source.byteLength));
  bytes.set(source);
  return bytes;
}
