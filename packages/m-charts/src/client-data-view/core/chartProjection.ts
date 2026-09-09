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
  const uniform = uniformClientColor(evaluation, preserve, sourceColor, fallback, sourceOpacity);
  if (uniform !== undefined) {
    const output = new Uint8Array(evaluation.metrics.rowCount * 4);
    // RGBA bytes in native little-endian typed-array storage.
    new Uint32Array(output.buffer).fill(((uniform >>> 24) | ((uniform >>> 8) & 0xff00) | ((uniform << 8) & 0xff0000) | (uniform << 24)) >>> 0);
    return output;
  }
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


/** Fast uniform composition without per-row RGBA expansion. */
export function uniformClientColor(
  evaluation: ClientDataViewEvaluation, preserve: boolean,
  sourceColor: ArrayLike<number> | undefined, fallback: readonly number[],
  sourceOpacity?: Float32Array,
): number | undefined {
  const { color, opacity } = evaluation.styles;
  if ((color !== undefined && color.constant === undefined) || (opacity !== undefined && opacity.constant === undefined)) return undefined;
  if (preserve && (sourceColor !== undefined || sourceOpacity !== undefined && sourceOpacity.length > 0)) return undefined;
  const rgba = color?.constant ?? ((fallback[0]! << 24) | (fallback[1]! << 16) | (fallback[2]! << 8) | fallback[3]!) >>> 0;
  return ((rgba & 0xffffff00) | Math.round((rgba & 255) * (opacity?.constant ?? 1))) >>> 0;
}
