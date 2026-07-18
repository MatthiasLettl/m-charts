import type { FastScatterEasterEggPlaybackOptions } from './types.js';

export interface FastScatterEasterEggPoint {
  charIndex: number;
  x: number;
  y: number;
}

export interface FastScatterEasterEggPointLayout {
  charCount: number;
  points: readonly FastScatterEasterEggPoint[];
}

export interface FastScatterEasterEggRange {
  max: number;
  min: number;
}

export interface FastScatterEasterEggPlayback {
  layout: FastScatterEasterEggPointLayout;
  options: Required<Pick<
    FastScatterEasterEggPlaybackOptions,
    'enterDurationMs' | 'exitDurationMs' | 'holdDurationMs' | 'pointSizePx' | 'staggerMs' | 'word'
  >> & {
    color?: readonly [number, number, number, number];
  };
  startedAt: number;
}

export const FAST_SCATTER_EASTER_EGG_RAINBOW_RGBA8: readonly (
  readonly [number, number, number, number]
)[] = [
  [229, 57, 53, 240],
  [251, 140, 0, 240],
  [245, 181, 0, 240],
  [67, 160, 71, 240],
  [3, 169, 244, 240],
  [126, 87, 194, 240],
];

const FUTURE_GLYPHS: Readonly<Record<string, readonly string[]>> = {
  F: [
    '11111',
    '10000',
    '10000',
    '11110',
    '10000',
    '10000',
    '10000',
  ],
  e: [
    '00000',
    '01110',
    '10001',
    '11111',
    '10000',
    '10001',
    '01110',
  ],
  r: [
    '00000',
    '10110',
    '11001',
    '10000',
    '10000',
    '10000',
    '10000',
  ],
  t: [
    '01000',
    '01000',
    '11110',
    '01000',
    '01000',
    '01001',
    '00110',
  ],
  u: [
    '00000',
    '10001',
    '10001',
    '10001',
    '10001',
    '10011',
    '01101',
  ],
};

const DEFAULT_WORD = 'Future';
const DEFAULT_ENTER_MS = 720;
const DEFAULT_HOLD_MS = 3000;
const DEFAULT_EXIT_MS = 720;
const DEFAULT_STAGGER_MS = 130;
const DEFAULT_POINT_SIZE_PX = 5;
const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const GLYPH_GAP = 1;
const CELL_DOT_ROWS = 2;
const CELL_DOT_COLUMNS = 2;

export function createFastScatterEasterEggPointLayout(
  word = DEFAULT_WORD,
): FastScatterEasterEggPointLayout {
  const normalizedWord = normalizeEasterEggWord(word);
  const points: FastScatterEasterEggPoint[] = [];
  const totalColumns =
    normalizedWord.length * GLYPH_WIDTH +
    Math.max(0, normalizedWord.length - 1) * GLYPH_GAP;
  const totalRows = GLYPH_HEIGHT;

  let columnOffset = 0;
  for (let charIndex = 0; charIndex < normalizedWord.length; charIndex += 1) {
    const glyph = FUTURE_GLYPHS[normalizedWord[charIndex]!] ?? FUTURE_GLYPHS.F;
    for (let row = 0; row < glyph.length; row += 1) {
      const line = glyph[row] ?? '';
      for (let column = 0; column < GLYPH_WIDTH; column += 1) {
        if (line[column] !== '1') {
          continue;
        }
        for (let dotRow = 0; dotRow < CELL_DOT_ROWS; dotRow += 1) {
          for (let dotColumn = 0; dotColumn < CELL_DOT_COLUMNS; dotColumn += 1) {
            points.push({
              charIndex,
              x:
                (columnOffset + column + (dotColumn + 0.5) / CELL_DOT_COLUMNS) /
                totalColumns,
              y: 1 - (row + (dotRow + 0.5) / CELL_DOT_ROWS) / totalRows,
            });
          }
        }
      }
    }
    columnOffset += GLYPH_WIDTH + GLYPH_GAP;
  }

  return {
    charCount: normalizedWord.length,
    points,
  };
}

export function createFastScatterEasterEggPlayback(
  options: FastScatterEasterEggPlaybackOptions = {},
  startedAt = performance.now(),
): FastScatterEasterEggPlayback {
  const normalizedOptions = normalizeFastScatterEasterEggPlaybackOptions(options);
  return {
    layout: createFastScatterEasterEggPointLayout(normalizedOptions.word),
    options: normalizedOptions,
    startedAt,
  };
}

export function getFastScatterEasterEggTotalDurationMs(
  playback: FastScatterEasterEggPlayback,
): number {
  const staggerSequenceMs = Math.max(0, playback.layout.charCount - 1) *
    playback.options.staggerMs;
  return (
    getFastScatterEasterEggEnterSequenceDurationMs(playback) +
    playback.options.holdDurationMs +
    staggerSequenceMs +
    playback.options.exitDurationMs
  );
}

export function updateFastScatterEasterEggPositions(
  playback: FastScatterEasterEggPlayback,
  elapsedMs: number,
  currentX: Float32Array,
  currentY: Float32Array,
): void {
  const options = playback.options;
  const wordMinX = 0.14;
  const wordMaxX = 0.92;
  const wordMinY = 0.2;
  const wordMaxY = 0.8;
  const startX = -0.3;
  const endX = 1.3;
  const exitStartMs =
    getFastScatterEasterEggEnterSequenceDurationMs(playback) + options.holdDurationMs;

  for (let index = 0; index < playback.layout.points.length; index += 1) {
    const point = playback.layout.points[index]!;
    const targetX = wordMinX + point.x * (wordMaxX - wordMinX);
    const targetY = wordMinY + point.y * (wordMaxY - wordMinY);
    const charDelay = point.charIndex * options.staggerMs;
    const enterT = easeOutCubic(
      clampUnitFraction((elapsedMs - charDelay) / options.enterDurationMs),
    );
    const exitT = easeInCubic(
      clampUnitFraction((elapsedMs - exitStartMs - charDelay) / options.exitDurationMs),
    );
    const wave =
      Math.sin((index * 12.9898 + elapsedMs * 0.009) % (Math.PI * 2)) *
      0.018 *
      (1 - enterT);

    if (elapsedMs < exitStartMs + charDelay) {
      currentX[index] = startX + (targetX - startX) * enterT;
      currentY[index] = targetY + wave;
    } else {
      currentX[index] = targetX + (endX - targetX) * exitT;
      currentY[index] = targetY;
    }
  }
}

export function createFastScatterEasterEggColorArray(
  layout: FastScatterEasterEggPointLayout,
  color?: readonly [number, number, number, number],
): Uint8Array {
  const colors = new Uint8Array(layout.points.length * 4);

  for (let index = 0; index < layout.points.length; index += 1) {
    const point = layout.points[index]!;
    const pointColor =
      color ??
      FAST_SCATTER_EASTER_EGG_RAINBOW_RGBA8[
        point.charIndex % FAST_SCATTER_EASTER_EGG_RAINBOW_RGBA8.length
      ]!;
    colors.set(pointColor, index * 4);
  }

  return colors;
}

export function projectFastScatterEasterEggPosition(
  normalizedX: number,
  normalizedY: number,
  xRange: FastScatterEasterEggRange,
  yRange: FastScatterEasterEggRange,
): { x: number; y: number } {
  return {
    x: projectFastScatterEasterEggAxisValue(normalizedX, xRange),
    y: projectFastScatterEasterEggAxisValue(normalizedY, yRange),
  };
}

function projectFastScatterEasterEggAxisValue(
  normalizedValue: number,
  range: FastScatterEasterEggRange,
): number {
  const span = Number.isFinite(range.max - range.min) && range.max !== range.min
    ? range.max - range.min
    : 1;
  return range.min + normalizedValue * span;
}

function normalizeEasterEggWord(word: string): string {
  return word === DEFAULT_WORD ? DEFAULT_WORD : DEFAULT_WORD;
}

function normalizeFastScatterEasterEggPlaybackOptions(
  options: FastScatterEasterEggPlaybackOptions,
): FastScatterEasterEggPlayback['options'] {
  const color = options.color;
  return {
    color: color === undefined
      ? undefined
      : [
          normalizeRgba8Channel(color[0]),
          normalizeRgba8Channel(color[1]),
          normalizeRgba8Channel(color[2]),
          normalizeRgba8Channel(color[3]),
        ],
    enterDurationMs: normalizePositiveNumber(options.enterDurationMs, DEFAULT_ENTER_MS),
    exitDurationMs: normalizePositiveNumber(options.exitDurationMs, DEFAULT_EXIT_MS),
    holdDurationMs: normalizeNonNegativeNumber(options.holdDurationMs, DEFAULT_HOLD_MS),
    pointSizePx: normalizePositiveNumber(options.pointSizePx, DEFAULT_POINT_SIZE_PX),
    staggerMs: normalizeNonNegativeNumber(options.staggerMs, DEFAULT_STAGGER_MS),
    word: DEFAULT_WORD,
  };
}

function getFastScatterEasterEggEnterSequenceDurationMs(
  playback: FastScatterEasterEggPlayback,
): number {
  return (
    Math.max(0, playback.layout.charCount - 1) * playback.options.staggerMs +
    playback.options.enterDurationMs
  );
}

function normalizeRgba8Channel(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value))) : 255;
}

function normalizeNonNegativeNumber(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) || value < 0 ? fallback : value;
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) || value <= 0 ? fallback : value;
}

function clampUnitFraction(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function easeInCubic(value: number): number {
  return value * value * value;
}
