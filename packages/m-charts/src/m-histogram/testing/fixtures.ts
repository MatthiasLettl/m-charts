import type {
  HistogramBarSeries,
  HistogramColumns,
  HistogramPlotSpec,
  HistogramViewport,
} from '../core/index.js';

export const HISTOGRAM_TEST_PLOT_SPEC = {
  mode: 'histogram',
  parameters: [
    {
      domain: { max: 40, min: 10 },
      key: 'temperature',
      kind: 'numeric',
      label: 'Temperature',
      unit: 'C',
    },
    {
      categories: [
        { encoded: 0, label: 'Off', value: false },
        { encoded: 1, label: 'On', value: true },
      ],
      domain: { max: 1, min: 0 },
      key: 'active',
      kind: 'boolean',
      label: 'Active',
    },
  ],
  subplots: [
    {
      id: 'temperature',
      label: 'Temperature',
      parameterKey: 'temperature',
    },
    {
      id: 'active',
      label: 'Active',
      parameterKey: 'active',
    },
  ],
} as const satisfies HistogramPlotSpec;

export const HISTOGRAM_TEST_COLUMNS: HistogramColumns = {
  color: new Uint32Array([0xff3366ff, 0xff3366ff, 0x22aa66ff, 0x22aa66ff]),
  colorFormat: 'rgba32',
  ids: ['row-0', 'row-1', 'row-2', 'row-3'],
  sourceIndex: new Uint32Array([0, 1, 2, 3]),
  valuesByParameter: {
    active: [true, false, true, true],
    temperature: new Float64Array([12, 18, 25, 31]),
  },
};

export const HISTOGRAM_TEST_VIEWPORT: HistogramViewport = {
  subplotById: {
    active: {
      x: { max: 1, min: 0 },
      y: { max: 4, min: 0 },
    },
    temperature: {
      x: { max: 40, min: 10 },
      y: { max: 4, min: 0 },
    },
  },
};

export const HISTOGRAM_TEST_BAR_SERIES: readonly HistogramBarSeries[] = [
  {
    bins: [
      {
        colorStack: [
          { color: 0xff3366ff, count: 2 },
          { color: 0x22aa66ff, count: 1 },
        ],
        count: 3,
        max: 20,
        min: 10,
        sourceIndices: new Uint32Array([0, 1, 2]),
      },
      {
        count: 1,
        max: 30,
        min: 20,
      },
    ],
    parameterKey: 'temperature',
    subplotId: 'temperature',
  },
];
