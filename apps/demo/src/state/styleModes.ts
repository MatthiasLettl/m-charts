export const STYLE_MODE_OPTIONS = [
  {
    benchmark: 'Record color, opacity, size, rotation, and shape buckets.',
    label: 'Dataset fields',
    mode: 'dataset',
    status: 'observed',
  },
  {
    benchmark: 'Single fill, size, and shape per subplot.',
    label: 'Uniform diagnostic',
    mode: 'uniform',
    status: 'observed',
  },
  {
    benchmark: 'Circle, rectangle, triangle, pin, and arrow series buckets.',
    label: 'Shape buckets',
    mode: 'shape-limitation',
    status: 'observed',
  },
] as const;

export type StyleMode = (typeof STYLE_MODE_OPTIONS)[number]['mode'];
export type StyleModeStatus = (typeof STYLE_MODE_OPTIONS)[number]['status'];

export interface StyleModeDescription {
  benchmark: string;
  label: string;
  mode: StyleMode;
  status: StyleModeStatus;
}

export function getStyleModeDescription(mode: StyleMode): StyleModeDescription {
  return STYLE_MODE_OPTIONS.find((option) => option.mode === mode) ?? STYLE_MODE_OPTIONS[0];
}
