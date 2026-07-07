import { FAST_SCATTER_SHAPE_CODES } from '../core/index.js';

export interface FastScatterGlyphVisibilitySignature {
  code: number;
  filledPixels: number;
  rowSignature: readonly number[];
}

export interface FastScatterCanvasPixelStats {
  differentFromFirst: number;
  height: number;
  sampled: number;
  width: number;
}

export interface FastScatterCanvasBandStats {
  bandIndex: number;
  differentFromPlotBackground: number;
  height: number;
  sampled: number;
  width: number;
}

const PLOT_BACKGROUND_RGB = [246, 249, 252] as const;

export function createFastScatterGlyphVisibilitySignatures(
  sampleSize = 17,
): FastScatterGlyphVisibilitySignature[] {
  return Object.values(FAST_SCATTER_SHAPE_CODES).map((code) =>
    createSignature(code, sampleSize),
  );
}

export function fastScatterGlyphSignaturesAreDistinct(
  signatures: readonly FastScatterGlyphVisibilitySignature[],
): boolean {
  const serialized = new Set(
    signatures.map((signature) => signature.rowSignature.join(',')),
  );

  return serialized.size === signatures.length;
}

export function analyzeFastScatterCanvasPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  maxSamples = 5000,
): FastScatterCanvasPixelStats {
  if (width <= 0 || height <= 0 || data.length === 0) {
    return { differentFromFirst: 0, height, sampled: 0, width };
  }

  const first = [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0] as const;
  const stride = Math.max(4, Math.floor((width * height) / maxSamples) * 4);
  let sampled = 0;
  let differentFromFirst = 0;

  for (let index = 0; index < data.length; index += stride) {
    sampled += 1;
    const difference =
      Math.abs((data[index] ?? 0) - first[0]) +
      Math.abs((data[index + 1] ?? 0) - first[1]) +
      Math.abs((data[index + 2] ?? 0) - first[2]) +
      Math.abs((data[index + 3] ?? 0) - first[3]);

    if (difference > 12) {
      differentFromFirst += 1;
    }
  }

  return { differentFromFirst, height, sampled, width };
}

export function analyzeFastScatterCanvasBands(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bandCount = 3,
): FastScatterCanvasBandStats[] {
  if (width <= 0 || height <= 0 || bandCount <= 0) {
    return [];
  }

  const bandHeight = Math.floor(height / bandCount);
  const stats: FastScatterCanvasBandStats[] = [];

  for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
    const yStart = Math.max(0, bandIndex * bandHeight);
    const currentBandHeight =
      bandIndex === bandCount - 1 ? height - yStart : Math.max(1, bandHeight);
    let sampled = 0;
    let differentFromPlotBackground = 0;

    for (let y = yStart; y < yStart + currentBandHeight; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        sampled += 1;
        const difference =
          Math.abs((data[index] ?? 255) - PLOT_BACKGROUND_RGB[0]) +
          Math.abs((data[index + 1] ?? 255) - PLOT_BACKGROUND_RGB[1]) +
          Math.abs((data[index + 2] ?? 255) - PLOT_BACKGROUND_RGB[2]);

        if (difference > 24) {
          differentFromPlotBackground += 1;
        }
      }
    }

    stats.push({
      bandIndex,
      differentFromPlotBackground,
      height: currentBandHeight,
      sampled,
      width,
    });
  }

  return stats;
}

function createSignature(
  code: number,
  sampleSize: number,
): FastScatterGlyphVisibilitySignature {
  const rowSignature: number[] = [];
  let filledPixels = 0;

  for (let row = 0; row < sampleSize; row += 1) {
    let rowPixels = 0;
    const y = toLocalCoordinate(row, sampleSize);

    for (let column = 0; column < sampleSize; column += 1) {
      const x = toLocalCoordinate(column, sampleSize);

      if (isGlyphPixelVisible(code, x, y)) {
        rowPixels += 1;
        filledPixels += 1;
      }
    }

    rowSignature.push(rowPixels);
  }

  return { code, filledPixels, rowSignature };
}

function isGlyphPixelVisible(code: number, x: number, y: number): boolean {
  if (code === FAST_SCATTER_SHAPE_CODES.circle) {
    return x * x + y * y <= 1;
  }

  if (code === FAST_SCATTER_SHAPE_CODES.triangle) {
    return y >= -1 && y <= 1 - Math.abs(x) * 2;
  }

  if (code === FAST_SCATTER_SHAPE_CODES.pin) {
    const headX = x;
    const headY = y - 0.22;
    const head = headX * headX + headY * headY <= 0.3844;
    const point = y >= -1 && y <= -0.18 && Math.abs(x) <= (y + 1) * 0.39;

    return head || point;
  }

  if (code === FAST_SCATTER_SHAPE_CODES.arrow) {
    const shaft = y >= -1 && y <= 0.2 && Math.abs(x) <= 0.28;
    const head = y >= 0 && y <= 1 && Math.abs(x) <= (1 - y) * 0.82;

    return shaft || head;
  }

  return true;
}

function toLocalCoordinate(index: number, sampleSize: number): number {
  return (index / (sampleSize - 1)) * 2 - 1;
}
