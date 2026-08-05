import type {
  ParallelAxisViewports,
  ParallelBuffers,
  ParallelRawValuesByAxis,
} from '../../m-parallel/index.js';

export function filterParallelWebgpuRefinedSourceIndices(
  buffers: Pick<ParallelBuffers, 'axisOrder' | 'rawValuesByAxis'>,
  sourceIndices: Uint32Array,
  axisViewports: ParallelAxisViewports,
): Uint32Array<ArrayBuffer> {
  const activeAxes = buffers.axisOrder.flatMap((axis) => {
    const viewport = axisViewports[axis];
    if (viewport === undefined || viewport === null) return [];
    return [{
      max: Math.max(viewport.min, viewport.max),
      min: Math.min(viewport.min, viewport.max),
      readRaw: createRawValueReader(buffers.rawValuesByAxis[axis]!),
    }];
  });
  if (activeAxes.length === 0) return sourceIndices.slice();
  const filtered = new Uint32Array(sourceIndices.length);
  let count = 0;
  for (const sourceIndex of sourceIndices) {
    let inside = true;
    for (const axis of activeAxes) {
      const raw = axis.readRaw(sourceIndex);
      if (!Number.isFinite(raw) || raw < axis.min || raw > axis.max) {
        inside = false;
        break;
      }
    }
    if (inside) {
      filtered[count] = sourceIndex;
      count += 1;
    }
  }
  return filtered.slice(0, count);
}

export function packParallelWebgpuRefinedViewportValues(
  buffers: Pick<
    ParallelBuffers,
    'axisCount' | 'axisOrder' | 'domainsByAxis' | 'rawValuesByAxis'
  >,
  sourceIndices: Uint32Array,
  axisViewports: ParallelAxisViewports,
): Float32Array<ArrayBuffer> {
  const values = new Float32Array(sourceIndices.length * buffers.axisCount);
  const readers = buffers.axisOrder.map((axis) => {
    const readRaw = createRawValueReader(buffers.rawValuesByAxis[axis]!);
    const domain = buffers.domainsByAxis[axis]!;
    const viewport = axisViewports[axis];
    const min = viewport === undefined || viewport === null
      ? domain.min
      : Math.min(viewport.min, viewport.max);
    const max = viewport === undefined || viewport === null
      ? domain.max
      : Math.max(viewport.min, viewport.max);
    const span = max - min;
    return (sourceIndex: number) => {
      const raw = readRaw(sourceIndex);
      if (!Number.isFinite(raw)) return Number.NaN;
      return span === 0 ? 0.5 : (raw - min) / span;
    };
  });
  for (let outputIndex = 0; outputIndex < sourceIndices.length; outputIndex += 1) {
    const sourceIndex = sourceIndices[outputIndex]!;
    for (let axisIndex = 0; axisIndex < buffers.axisCount; axisIndex += 1) {
      values[outputIndex * buffers.axisCount + axisIndex] =
        readers[axisIndex]!(sourceIndex);
    }
  }
  return values;
}

function createRawValueReader(
  values: ParallelRawValuesByAxis[string],
): (sourceIndex: number) => number {
  const compactGetter = (
    values as typeof values & {
      __parallelCompactGetValue?: (index: number) => number;
    }
  ).__parallelCompactGetValue;
  return compactGetter === undefined
    ? (sourceIndex: number) => values[sourceIndex] ?? Number.NaN
    : compactGetter;
}
