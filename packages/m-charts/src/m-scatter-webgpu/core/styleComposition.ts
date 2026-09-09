import type { FastScatterClientViewEvaluation } from '../../m-scatter/core/index.js';

const STYLE_COLOR_MASK = 0x0000_ffff;
const STYLE_OPACITY_MASK = 0x000f_0000;
const STYLE_SHAPE_MASK = 0x0070_0000;
const STYLE_ROTATION_MASK = 0x1f80_0000;
const STYLE_SIZE_MASK = 0xe000_0000;

export function createFastScatterWebgpuClientStyleMask(
  styles: FastScatterClientViewEvaluation['styles'],
  pointIndex: number,
): number {
  let mask = 0;
  if ((styles.color?.assigned[pointIndex] ?? 0) !== 0) mask |= STYLE_COLOR_MASK;
  if ((styles.opacity?.assigned[pointIndex] ?? 0) !== 0) mask |= STYLE_OPACITY_MASK;
  if ((styles.shape?.assigned[pointIndex] ?? 0) !== 0) mask |= STYLE_SHAPE_MASK;
  if ((styles.rotation?.assigned[pointIndex] ?? 0) !== 0) mask |= STYLE_ROTATION_MASK;
  if ((styles.size?.assigned[pointIndex] ?? 0) !== 0) mask |= STYLE_SIZE_MASK;
  return mask >>> 0;
}

export function composeFastScatterWebgpuStyleWord(
  sourceStyle: number,
  overrideStyle: number,
  overrideMask: number,
): number {
  return ((sourceStyle & ~overrideMask) | (overrideStyle & overrideMask)) >>> 0;
}
