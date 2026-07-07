import type { ThemeMode } from '../state/themeMode.ts';

export type RgbaTuple = readonly [number, number, number, number];

export interface PlotTheme {
  axisLabelHex: string;
  axisLineRgba: RgbaTuple;
  axisTitleHex: string;
  backgroundRgba: RgbaTuple;
  bubbleRgba8: readonly [number, number, number, number];
  defaultPointRgba8: readonly [number, number, number, number];
  gridBoundaryRgba: RgbaTuple;
  gridMajorRgba: RgbaTuple;
  gridMinorRgba: RgbaTuple;
  lineRgba: RgbaTuple;
  navigatorBackgroundRgba: RgbaTuple;
  navigatorBorderRgba: RgbaTuple;
  navigatorDefocusRgba: RgbaTuple;
  navigatorHandleRgba: RgbaTuple;
  navigatorKnobRgba: RgbaTuple;
  parallelNormalRgba: RgbaTuple;
  parallelUnselectedRgba: RgbaTuple;
  preselectedRgba: RgbaTuple;
  scatterSeriesHex: {
    a: string;
    b: string;
    c: string;
  };
  selectedHex: string;
  selectedRgba: RgbaTuple;
  seriesBackgroundRgba: RgbaTuple;
  subplotBackgroundRgba: RgbaTuple;
  zeroLineRgba: RgbaTuple;
}

const FAST_ROUTE_DARK_THEME = {
  backgroundRgba: [7, 3, 4, 255] as const,
  bubbleRgba8: [255, 255, 255, 220] as const,
  defaultPointRgba8: [255, 242, 236, 255] as const,
  lineRgba: [255, 92, 70, 54] as const,
  preselectedRgba: [255, 191, 92, 222] as const,
  selectedRgba: [255, 112, 94, 236] as const,
  subplotBackgroundRgba: [17, 6, 8, 255] as const,
} as const;

export const LIGHT_PLOT_THEME: PlotTheme = {
  axisLabelHex: '#475467',
  axisLineRgba: [102, 112, 133, 120],
  axisTitleHex: '#344054',
  backgroundRgba: [255, 255, 255, 255],
  bubbleRgba8: [0, 0, 0, 220],
  defaultPointRgba8: [0, 0, 0, 255],
  gridBoundaryRgba: [52, 64, 84, 34],
  gridMajorRgba: [52, 64, 84, 54],
  gridMinorRgba: [52, 64, 84, 24],
  lineRgba: [25, 95, 170, 28],
  navigatorBackgroundRgba: [248, 250, 252, 255],
  navigatorBorderRgba: [184, 193, 206, 150],
  navigatorDefocusRgba: [52, 64, 84, 42],
  navigatorHandleRgba: [31, 94, 255, 210],
  navigatorKnobRgba: [255, 255, 255, 220],
  parallelNormalRgba: [34, 94, 168, 18],
  parallelUnselectedRgba: [107, 114, 128, 10],
  preselectedRgba: [234, 179, 8, 178],
  scatterSeriesHex: {
    a: '#1f5eff',
    b: '#0f766e',
    c: '#b42318',
  },
  selectedHex: '#e11d48',
  selectedRgba: [224, 77, 62, 178],
  seriesBackgroundRgba: [251, 253, 255, 255],
  subplotBackgroundRgba: [246, 249, 253, 255],
  zeroLineRgba: [17, 24, 39, 132],
};

export const DARK_PLOT_THEME: PlotTheme = {
  axisLabelHex: '#cbd5e1',
  axisLineRgba: [148, 163, 184, 150],
  axisTitleHex: '#e2e8f0',
  backgroundRgba: [12, 18, 32, 255],
  bubbleRgba8: [125, 211, 252, 225],
  defaultPointRgba8: [226, 232, 240, 255],
  gridBoundaryRgba: [148, 163, 184, 48],
  gridMajorRgba: [148, 163, 184, 66],
  gridMinorRgba: [148, 163, 184, 30],
  lineRgba: [96, 165, 250, 42],
  navigatorBackgroundRgba: [17, 24, 39, 255],
  navigatorBorderRgba: [100, 116, 139, 170],
  navigatorDefocusRgba: [2, 6, 23, 92],
  navigatorHandleRgba: [125, 211, 252, 230],
  navigatorKnobRgba: [30, 41, 59, 235],
  parallelNormalRgba: [96, 165, 250, 28],
  parallelUnselectedRgba: [148, 163, 184, 18],
  preselectedRgba: [250, 204, 21, 210],
  scatterSeriesHex: {
    a: '#7dd3fc',
    b: '#5eead4',
    c: '#fda4af',
  },
  selectedHex: '#fb7185',
  selectedRgba: [251, 113, 133, 220],
  seriesBackgroundRgba: [15, 23, 42, 255],
  subplotBackgroundRgba: [17, 24, 39, 255],
  zeroLineRgba: [226, 232, 240, 150],
};

export function getPlotTheme(themeMode: ThemeMode): PlotTheme {
  return themeMode === 'dark' ? DARK_PLOT_THEME : LIGHT_PLOT_THEME;
}

export function rgbaToUnitTuple(rgba: RgbaTuple): readonly [number, number, number, number] {
  return [rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3] / 255];
}

function getFastRoutePlotTheme(themeMode: ThemeMode): Pick<
  PlotTheme,
  | 'backgroundRgba'
  | 'bubbleRgba8'
  | 'defaultPointRgba8'
  | 'lineRgba'
  | 'preselectedRgba'
  | 'subplotBackgroundRgba'
> {
  return themeMode === 'dark'
    ? FAST_ROUTE_DARK_THEME
    : getPlotTheme(themeMode);
}

export function getCommittedSelectionOverlayColor(
  themeMode: ThemeMode,
): readonly [number, number, number, number] {
  // This is the canonical visible committed-selection color for custom plots.
  // The source token is still named preselectedRgba because scatter established
  // the yellow/orange overlay before the cross-plot theme semantics were named.
  return rgbaToUnitTuple(getFastRoutePlotTheme(themeMode).preselectedRgba);
}

export function getFastScatterTheme(themeMode: ThemeMode): {
  alphaScaleMultiplier?: number;
  backgroundColor: readonly [number, number, number, number];
  bubbleColor: readonly [number, number, number, number];
  colorMixAmount?: number;
  colorMixColor?: readonly [number, number, number];
  defaultPointColor: readonly [number, number, number, number];
  selectedOverlayColor: readonly [number, number, number, number];
  subplotBackgroundColor: readonly [number, number, number, number];
} {
  const plotTheme = getFastRoutePlotTheme(themeMode);

  return {
    ...(themeMode === 'dark'
      ? {
          alphaScaleMultiplier: 2.65,
          colorMixAmount: 0.36,
          colorMixColor: [255, 170, 150] as const,
        }
      : {}),
    backgroundColor: rgbaToUnitTuple(plotTheme.backgroundRgba),
    bubbleColor: plotTheme.bubbleRgba8,
    defaultPointColor: plotTheme.defaultPointRgba8,
    selectedOverlayColor: getCommittedSelectionOverlayColor(themeMode),
    subplotBackgroundColor: rgbaToUnitTuple(plotTheme.subplotBackgroundRgba),
  };
}

export function getParallelFastTheme(themeMode: ThemeMode): {
  backgroundColor: readonly [number, number, number, number];
  lineColor: readonly [number, number, number, number];
  preselectedColor: readonly [number, number, number, number];
  selectedColor: readonly [number, number, number, number];
} {
  const plotTheme = getFastRoutePlotTheme(themeMode);

  return {
    backgroundColor: rgbaToUnitTuple(plotTheme.backgroundRgba),
    lineColor: rgbaToUnitTuple(plotTheme.lineRgba),
    preselectedColor: rgbaToUnitTuple(plotTheme.preselectedRgba),
    selectedColor: getCommittedSelectionOverlayColor(themeMode),
  };
}
