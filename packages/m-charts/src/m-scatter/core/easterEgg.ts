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
