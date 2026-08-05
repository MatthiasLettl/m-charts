import {
  normalizeParallelBrushIntervals,
  type ParallelActiveBrushInterval,
  type ParallelBrushIntervals,
  type ParallelBrushSelectionResult,
  type ParallelBuffers,
  type ParallelParameter,
} from '../../m-parallel/index.js';

export function selectParallelRecordsFromCandidateMask(
  buffers: ParallelBuffers,
  brushIntervals: ParallelBrushIntervals,
  candidateMask: Uint32Array,
): ParallelBrushSelectionResult {
  const activeBrushes = normalizeParallelBrushIntervals(
    brushIntervals,
    buffers.axisOrder,
  );
  const startedAt = performance.now();
  const candidates = countCandidateBits(candidateMask, buffers.recordCount);
  const sourceIndices = new Uint32Array(candidates);
  let selectedCount = 0;

  for (let wordIndex = 0; wordIndex < candidateMask.length; wordIndex += 1) {
    let bits = candidateMask[wordIndex]!;
    while (bits !== 0) {
      const lowestBit = (bits & -bits) >>> 0;
      const bitIndex = 31 - Math.clz32(lowestBit);
      const sourceIndex = wordIndex * 32 + bitIndex;
      if (
        sourceIndex < buffers.recordCount &&
        recordMatchesBrushes(buffers, sourceIndex, activeBrushes)
      ) {
        sourceIndices[selectedCount] = sourceIndex;
        selectedCount += 1;
      }
      bits = (bits & ~lowestBit) >>> 0;
    }
  }

  return {
    activeBrushes,
    selectedCount,
    sourceIndexCreationMs: performance.now() - startedAt,
    sourceIndices:
      selectedCount === sourceIndices.length
        ? sourceIndices
        : sourceIndices.slice(0, selectedCount),
  };
}

function countCandidateBits(mask: Uint32Array, recordCount: number): number {
  let count = 0;
  const wordCount = Math.min(mask.length, Math.ceil(recordCount / 32));
  for (let index = 0; index < wordCount; index += 1) {
    let value = mask[index]!;
    value -= (value >>> 1) & 0x5555_5555;
    value = (value & 0x3333_3333) + ((value >>> 2) & 0x3333_3333);
    count += (((value + (value >>> 4)) & 0x0f0f_0f0f) * 0x0101_0101) >>> 24;
  }
  if (recordCount % 32 !== 0 && wordCount > 0) {
    const validBits = recordCount % 32;
    const lastWord = mask[wordCount - 1]!;
    const invalidMask = (~((2 ** validBits) - 1)) >>> 0;
    let invalid = lastWord & invalidMask;
    invalid -= (invalid >>> 1) & 0x5555_5555;
    invalid = (invalid & 0x3333_3333) + ((invalid >>> 2) & 0x3333_3333);
    count -= (((invalid + (invalid >>> 4)) & 0x0f0f_0f0f) * 0x0101_0101) >>> 24;
  }
  return count;
}

function recordMatchesBrushes(
  buffers: ParallelBuffers,
  recordIndex: number,
  activeBrushes: readonly ParallelActiveBrushInterval[],
): boolean {
  let currentParameter: ParallelParameter | null = null;
  let currentAxisMatched = false;

  for (const brush of activeBrushes) {
    if (brush.parameter !== currentParameter) {
      if (currentParameter !== null && !currentAxisMatched) return false;
      currentParameter = brush.parameter;
      currentAxisMatched = false;
    }
    if (currentAxisMatched) continue;
    const value = buffers.rawValuesByAxis[brush.parameter][recordIndex];
    if (Number.isFinite(value) && value >= brush.min && value <= brush.max) {
      currentAxisMatched = true;
    }
  }

  return currentParameter === null || currentAxisMatched;
}
