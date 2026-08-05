import type {
  ParallelBuffers,
  ParallelFastAxisMetadata,
} from '../../m-parallel/index.js';

const REPRESENTATIVE_BLOCK_SIZE = 4_096;
const REPRESENTATIVE_CATEGORY_LIMIT = 16;

type RepresentativeBuffers = Pick<
  ParallelBuffers,
  | 'axisMetadataByAxis'
  | 'axisOrder'
  | 'rawValuesByAxis'
  | 'recordCount'
>;

export interface ParallelRepresentativeAccumulatorAxis {
  categories?: readonly number[];
}

/** Incremental equivalent of the representative scan used by streamed decoders. */
export class ParallelRepresentativeAccumulator {
  private readonly categoryFirstIndices: Map<number, number>[];
  private readonly categoryTargets: readonly (readonly number[])[];
  private readonly globalMaxIndices: Int32Array;
  private readonly globalMaxValues: Float64Array;
  private readonly globalMinIndices: Int32Array;
  private readonly globalMinValues: Float64Array;
  private readonly localCandidates: number[] = [];
  private readonly localCategoryFirst: (Map<number, number> | null)[];
  private readonly localCategoryOverflow: boolean[];
  private readonly localMaxIndices: Int32Array;
  private readonly localMaxValues: Float64Array;
  private readonly localMinIndices: Int32Array;
  private readonly localMinValues: Float64Array;

  constructor(
    private readonly axes: readonly ParallelRepresentativeAccumulatorAxis[],
    private readonly recordCount: number,
    private readonly requestedLimit: number,
  ) {
    this.categoryTargets = createAccumulatorCategoryTargets(
      axes,
      normalizeRepresentativeLimit(requestedLimit, recordCount),
    );
    this.categoryFirstIndices = this.categoryTargets.map((values) =>
      new Map(values.map((value) => [value, -1])),
    );
    this.globalMinIndices = new Int32Array(axes.length);
    this.globalMaxIndices = new Int32Array(axes.length);
    this.globalMinValues = new Float64Array(axes.length);
    this.globalMaxValues = new Float64Array(axes.length);
    this.localMinIndices = new Int32Array(axes.length);
    this.localMaxIndices = new Int32Array(axes.length);
    this.localMinValues = new Float64Array(axes.length);
    this.localMaxValues = new Float64Array(axes.length);
    this.localCategoryFirst = axes.map((axis) =>
      axis.categories === undefined ? null : new Map<number, number>(),
    );
    this.localCategoryOverflow = axes.map(() => false);
    this.globalMinIndices.fill(-1);
    this.globalMaxIndices.fill(-1);
    this.globalMinValues.fill(Number.POSITIVE_INFINITY);
    this.globalMaxValues.fill(Number.NEGATIVE_INFINITY);
    this.resetLocalBlock();
  }

  add(sourceIndex: number, values: readonly number[]): void {
    if (sourceIndex > 0 && sourceIndex % REPRESENTATIVE_BLOCK_SIZE === 0) {
      this.flushLocalBlock();
      this.resetLocalBlock();
    }
    for (let axisIndex = 0; axisIndex < this.axes.length; axisIndex += 1) {
      const value = values[axisIndex] ?? Number.NaN;
      if (!Number.isFinite(value)) continue;
      if (value < this.localMinValues[axisIndex]!) {
        this.localMinValues[axisIndex] = value;
        this.localMinIndices[axisIndex] = sourceIndex;
      }
      if (value > this.localMaxValues[axisIndex]!) {
        this.localMaxValues[axisIndex] = value;
        this.localMaxIndices[axisIndex] = sourceIndex;
      }
      if (value < this.globalMinValues[axisIndex]!) {
        this.globalMinValues[axisIndex] = value;
        this.globalMinIndices[axisIndex] = sourceIndex;
      }
      if (value > this.globalMaxValues[axisIndex]!) {
        this.globalMaxValues[axisIndex] = value;
        this.globalMaxIndices[axisIndex] = sourceIndex;
      }
      const targetFirst = this.categoryFirstIndices[axisIndex];
      if (targetFirst?.get(value) === -1) targetFirst.set(value, sourceIndex);
      const localCategories = this.localCategoryFirst[axisIndex];
      if (
        localCategories !== null &&
        this.localCategoryOverflow[axisIndex] !== true &&
        !localCategories.has(value)
      ) {
        localCategories.set(value, sourceIndex);
        if (localCategories.size > REPRESENTATIVE_CATEGORY_LIMIT) {
          this.localCategoryOverflow[axisIndex] = true;
          localCategories.clear();
        }
      }
    }
  }

  finish(): Uint32Array<ArrayBuffer> {
    const limit = normalizeRepresentativeLimit(this.requestedLimit, this.recordCount);
    if (limit === 0) return new Uint32Array(0);
    if (limit === this.recordCount) {
      return Uint32Array.from({ length: this.recordCount }, (_, index) => index);
    }
    this.flushLocalBlock();
    const selected: number[] = [];
    const selectedSet = new Set<number>();
    const add = (sourceIndex: number) => {
      if (
        selected.length < limit && sourceIndex >= 0 &&
        sourceIndex < this.recordCount && !selectedSet.has(sourceIndex)
      ) {
        selectedSet.add(sourceIndex);
        selected.push(sourceIndex);
      }
    };
    for (let axisIndex = 0; axisIndex < this.axes.length; axisIndex += 1) {
      add(this.globalMinIndices[axisIndex]!);
      add(this.globalMaxIndices[axisIndex]!);
    }
    for (let categoryIndex = 0; selected.length < limit; categoryIndex += 1) {
      let foundCategory = false;
      for (let axisIndex = 0; axisIndex < this.axes.length; axisIndex += 1) {
        const value = this.categoryTargets[axisIndex]?.[categoryIndex];
        if (value === undefined) continue;
        foundCategory = true;
        add(this.categoryFirstIndices[axisIndex]?.get(value) ?? -1);
      }
      if (!foundCategory) break;
    }
    const uniqueLocalCandidates = sortUniqueSourceIndices(this.localCandidates);
    addBucketedCandidates(
      uniqueLocalCandidates,
      limit - selected.length,
      selectedSet,
      add,
      0x51ed_270b,
    );
    addBucketedSourceRange(
      this.recordCount,
      limit - selected.length,
      selectedSet,
      add,
    );
    selected.sort((left, right) => left - right);
    return Uint32Array.from(selected);
  }

  private flushLocalBlock(): void {
    for (let axisIndex = 0; axisIndex < this.axes.length; axisIndex += 1) {
      const localCategories = this.localCategoryFirst[axisIndex];
      if (localCategories !== null && this.localCategoryOverflow[axisIndex] !== true) {
        this.localCandidates.push(...localCategories.values());
      } else {
        const minIndex = this.localMinIndices[axisIndex]!;
        const maxIndex = this.localMaxIndices[axisIndex]!;
        if (minIndex >= 0) this.localCandidates.push(minIndex);
        if (maxIndex >= 0 && maxIndex !== minIndex) this.localCandidates.push(maxIndex);
      }
    }
  }

  private resetLocalBlock(): void {
    this.localMinIndices.fill(-1);
    this.localMaxIndices.fill(-1);
    this.localMinValues.fill(Number.POSITIVE_INFINITY);
    this.localMaxValues.fill(Number.NEGATIVE_INFINITY);
    for (let axisIndex = 0; axisIndex < this.axes.length; axisIndex += 1) {
      this.localCategoryFirst[axisIndex]?.clear();
      this.localCategoryOverflow[axisIndex] = false;
    }
  }
}

/**
 * Builds a deterministic, bounded exact-line sample for the WebGPU density
 * renderer. Global extrema and categorical coverage take priority. Local
 * block representatives preserve sparse structure, and a hashed bucket sample
 * fills any remaining capacity without always choosing the first source row.
 */
export async function createParallelRepresentativeSourceIndices(
  buffers: RepresentativeBuffers,
  requestedLimit: number,
): Promise<Uint32Array<ArrayBuffer>> {
  const limit = normalizeRepresentativeLimit(requestedLimit, buffers.recordCount);
  if (limit === 0) return new Uint32Array(0);
  if (limit === buffers.recordCount) {
    return Uint32Array.from({ length: buffers.recordCount }, (_, index) => index);
  }

  const accumulator = new ParallelRepresentativeAccumulator(
    buffers.axisOrder.map((axis) => {
      const metadata = buffers.axisMetadataByAxis?.[axis];
      return isCategoricalAxis(metadata)
        ? { categories: metadata.categories.map(({ encoded }) => encoded) }
        : {};
    }),
    buffers.recordCount,
    limit,
  );
  const row = new Array<number>(buffers.axisOrder.length);
  for (let sourceIndex = 0; sourceIndex < buffers.recordCount; sourceIndex += 1) {
    for (let axisIndex = 0; axisIndex < buffers.axisOrder.length; axisIndex += 1) {
      row[axisIndex] = buffers.rawValuesByAxis[buffers.axisOrder[axisIndex]!]?.[
        sourceIndex
      ] ?? Number.NaN;
    }
    accumulator.add(sourceIndex, row);
    if (sourceIndex > 0 && sourceIndex % (REPRESENTATIVE_BLOCK_SIZE * 64) === 0) {
      await yieldToHost();
    }
  }
  return accumulator.finish();
}

function createAccumulatorCategoryTargets(
  axes: readonly ParallelRepresentativeAccumulatorAxis[],
  limit: number,
): readonly (readonly number[])[] {
  const result = axes.map(() => [] as number[]);
  let remaining = limit;
  for (let categoryIndex = 0; remaining > 0; categoryIndex += 1) {
    let foundCategory = false;
    for (let axisIndex = 0; axisIndex < axes.length; axisIndex += 1) {
      const value = axes[axisIndex]?.categories?.[categoryIndex];
      if (value === undefined) continue;
      foundCategory = true;
      result[axisIndex]!.push(value);
      remaining -= 1;
      if (remaining === 0) break;
    }
    if (!foundCategory) break;
  }
  return result;
}

function isCategoricalAxis(
  metadata: ParallelFastAxisMetadata | undefined,
): metadata is Extract<ParallelFastAxisMetadata, { kind: 'boolean' | 'categorical' }> {
  return metadata?.kind === 'categorical' || metadata?.kind === 'boolean';
}

function normalizeRepresentativeLimit(limit: number, recordCount: number): number {
  if (!Number.isFinite(limit)) return recordCount;
  return Math.min(recordCount, Math.max(0, Math.floor(limit)));
}

function sortUniqueSourceIndices(values: number[]): readonly number[] {
  values.sort((left, right) => left - right);
  let writeIndex = 0;
  for (const value of values) {
    if (writeIndex > 0 && values[writeIndex - 1] === value) continue;
    values[writeIndex] = value;
    writeIndex += 1;
  }
  values.length = writeIndex;
  return values;
}

function addBucketedCandidates(
  candidates: readonly number[],
  budget: number,
  selected: ReadonlySet<number>,
  add: (sourceIndex: number) => void,
  salt: number,
): void {
  if (budget <= 0 || candidates.length === 0) return;
  const bucketCount = Math.min(budget, candidates.length);
  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const start = Math.floor((bucketIndex * candidates.length) / bucketCount);
    const end = Math.floor(((bucketIndex + 1) * candidates.length) / bucketCount);
    const length = Math.max(1, end - start);
    const offset = mixRepresentativeBucket(bucketIndex, salt) % length;
    for (let attempt = 0; attempt < length; attempt += 1) {
      const sourceIndex = candidates[start + ((offset + attempt) % length)]!;
      if (selected.has(sourceIndex)) continue;
      add(sourceIndex);
      break;
    }
  }
}

function addBucketedSourceRange(
  recordCount: number,
  budget: number,
  selected: ReadonlySet<number>,
  add: (sourceIndex: number) => void,
): void {
  if (budget <= 0 || recordCount === 0) return;
  const bucketCount = Math.min(budget, recordCount);
  let addedCount = 0;
  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const start = Math.floor((bucketIndex * recordCount) / bucketCount);
    const end = Math.floor(((bucketIndex + 1) * recordCount) / bucketCount);
    const length = Math.max(1, end - start);
    const offset = mixRepresentativeBucket(bucketIndex, 0xa511_e9b3) % length;
    for (let attempt = 0; attempt < length; attempt += 1) {
      const sourceIndex = start + ((offset + attempt) % length);
      if (selected.has(sourceIndex)) continue;
      add(sourceIndex);
      addedCount += 1;
      break;
    }
  }
  const fallbackStart = mixRepresentativeBucket(recordCount, 0x63d8_35ad) % recordCount;
  for (
    let attempt = 0;
    addedCount < budget && attempt < recordCount;
    attempt += 1
  ) {
    const sourceIndex = (fallbackStart + attempt) % recordCount;
    if (selected.has(sourceIndex)) continue;
    add(sourceIndex);
    addedCount += 1;
  }
}

function mixRepresentativeBucket(bucketIndex: number, salt: number): number {
  let value = (Math.imul(bucketIndex, 747_796_405) + salt) >>> 0;
  value = Math.imul(
    ((value >>> ((value >>> 28) + 4)) ^ value) >>> 0,
    277_803_737,
  ) >>> 0;
  return ((value >>> 22) ^ value) >>> 0;
}

async function yieldToHost(): Promise<void> {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}
