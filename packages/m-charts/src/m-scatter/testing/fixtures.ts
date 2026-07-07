import {
  createFastScatterBuffers,
  FAST_SCATTER_SHAPE_CODES,
  type FastScatterBufferBuildResult,
  type FastScatterPlotSpec,
  type FastScatterViewport,
} from '../core/index.js';

export interface FastScatterGlyphFixture {
  columns: FastScatterBufferBuildResult;
  spec: FastScatterPlotSpec;
  viewport: FastScatterViewport;
}

export function createFastScatterGlyphFixture(): FastScatterGlyphFixture {
  const columns = createFastScatterBuffers(
    [
      makeGlyphRecord('circle', 0),
      makeGlyphRecord('rectangle', 1),
      makeGlyphRecord('triangle', 2, {
        color: '#ff0000',
        opacity: 0.5,
        rotation: 90,
        size: 20,
      }),
      makeGlyphRecord('pin', 3, {
        color: '#0080ff',
        opacity: 0.75,
        rotation: 45,
        size: 22,
      }),
      makeGlyphRecord('arrow', 4, {
        color: '#7c3aed',
        opacity: 1,
        rotation: 0,
        size: 24,
      }),
    ],
    {
      yAccessors: {
        y: (record) => record.y,
      },
    },
  );

  return {
    columns,
    spec: {
      plots: [{ id: 'glyphs', label: 'Glyphs', yKey: 'y' }],
      xLabel: 'x',
    },
    viewport: {
      x: { max: 4.5, min: -0.5 },
      yByPlot: {
        glyphs: { max: 4.5, min: -0.5 },
      },
    },
  };
}

function makeGlyphRecord(
  shape: keyof typeof FAST_SCATTER_SHAPE_CODES,
  value: number,
  style: Partial<{
    color: string;
    opacity: number;
    rotation: number;
    size: number;
  }> = {},
) {
  return {
    color: style.color ?? '#000000',
    id: shape,
    opacity: style.opacity ?? 1,
    rotation: style.rotation ?? 0,
    shape,
    size: style.size ?? 18,
    x: value,
    y: value,
  };
}
