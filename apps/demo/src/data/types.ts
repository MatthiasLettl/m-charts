export const SCATTER_Y_ATTRIBUTES = ['a', 'b', 'c'] as const;

export const SCATTER_CATEGORIES = [
  'core',
  'north',
  'south',
  'anomaly',
] as const;

export const SCATTER_STYLE_GROUPS = [
  'default',
  'accent',
  'muted',
  'highlight',
  'low-opacity',
  'large',
] as const;

export const SCATTER_SHAPES = ['circle', 'rectangle', 'triangle', 'pin', 'arrow'] as const;

export const PARALLEL_PARAMETERS = [
  'throughput',
  'latency',
  'errorRate',
  'cpuLoad',
  'memoryUsage',
] as const;

export const SCATTER_STYLE_LIMITS = {
  opacity: {
    max: 1,
    min: 0,
  },
  rotation: {
    max: 360,
    min: 0,
    unit: 'degrees',
  },
  size: {
    max: 24,
    min: 0,
    unit: 'point-size',
  },
} as const;

export type ScatterYAttribute = (typeof SCATTER_Y_ATTRIBUTES)[number];
export type ScatterCategory = (typeof SCATTER_CATEGORIES)[number];
export type ScatterStyleGroup = (typeof SCATTER_STYLE_GROUPS)[number];
export type ScatterShape = (typeof SCATTER_SHAPES)[number];
export type ParallelParameter = string;

export interface ScatterRecord {
  id: string;
  x: number;
  a: number;
  b: number;
  c: number;
  category: ScatterCategory;
  styleGroup: ScatterStyleGroup;
  color: string;
  opacity: number;
  rotation: number | null;
  size: number;
  shape: ScatterShape;
}

export interface ScatterDatasetMetadata {
  count: number;
  seed: number;
  createdAt: string;
  attributes: {
    id: 'id';
    x: 'x';
    y: readonly ScatterYAttribute[];
    category: 'category';
    styleGroup: 'styleGroup';
    color: 'color';
    opacity: 'opacity';
    rotation: 'rotation';
    size: 'size';
    shape: 'shape';
  };
  categories: readonly ScatterCategory[];
  styleGroups: readonly ScatterStyleGroup[];
  styles: {
    color: {
      attribute: 'color';
      format: '#RRGGBB';
    };
    opacity: {
      attribute: 'opacity';
      max: number;
      min: number;
    };
    rotation: {
      attribute: 'rotation';
      max: number;
      min: number;
      nullable: true;
      unit: string;
    };
    size: {
      attribute: 'size';
      max: number;
      min: number;
      unit: string;
    };
    shape: {
      attribute: 'shape';
      values: readonly ScatterShape[];
    };
  };
}

export interface ScatterDataset {
  metadata: ScatterDatasetMetadata;
  records: ScatterRecord[];
}

export type ParallelRecord = {
  id: string;
  selected?: boolean;
} & Record<string, boolean | number | string | undefined>;

export interface ParallelDatasetMetadata {
  count: number;
  seed: number;
  createdAt: string;
  attributes: {
    id: 'id';
    parameters: readonly ParallelParameter[];
  };
}

export interface ParallelDataset {
  metadata: ParallelDatasetMetadata;
  records: ParallelRecord[];
}
