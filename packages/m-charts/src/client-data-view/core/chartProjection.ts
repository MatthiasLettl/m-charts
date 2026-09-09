import type { ClientDataViewEvaluation } from './types.js';

/** Shared color/opacity composition for row-based chart adapters. */
export function composeClientRowColors(
  evaluation: ClientDataViewEvaluation,
  preserve: boolean,
  sourceColor: ArrayLike<number> | undefined,
  packed: boolean,
  fallback: readonly number[],
  sourceOpacity?: Float32Array,
): Uint8Array | undefined {
  const { color, opacity } = evaluation.styles;
  if (color === undefined && opacity === undefined && !preserve) return undefined;
  if (color === undefined && opacity === undefined && sourceColor === undefined) return undefined;
  const output = new Uint8Array(evaluation.metrics.rowCount * 4);
  for (let row = 0; row < evaluation.metrics.rowCount; row += 1) {
    const offset = row * 4;
    const computedColor = color?.assigned[row] ? color.values[row]! : undefined;
    const sourcePacked = preserve && packed ? sourceColor?.[row] : undefined;
    const rgba = computedColor ?? sourcePacked;
    for (let channel = 0; channel < 4; channel += 1) {
      output[offset + channel] = rgba !== undefined
        ? (rgba >>> ((3 - channel) * 8)) & 255
        : preserve && sourceColor !== undefined && !packed
          ? sourceColor[offset + channel] ?? fallback[channel]!
          : fallback[channel]!;
    }
    // Parallel buffers already embed source opacity in alpha. A computed
    // opacity replaces that factor; a computed color retains source opacity.
    const oldOpacity = preserve ? sourceOpacity?.[row] ?? 1 : 1;
    if (opacity?.assigned[row]) {
      const alpha = computedColor !== undefined || !preserve || sourceColor === undefined
        ? output[offset + 3]!
        : oldOpacity > 0 ? Math.min(255, output[offset + 3]! / oldOpacity) : 255;
      output[offset + 3] = Math.round(alpha * opacity.values[row]!);
    } else if (computedColor !== undefined) {
      output[offset + 3] = Math.round(output[offset + 3]! * oldOpacity);
    }
  }
  return output;
}

export function clientRowIsActive(mask: Uint32Array | undefined, row: number): boolean {
  return mask === undefined || ((mask[row >>> 5] ?? 0) & (1 << (row & 31))) !== 0;
}
