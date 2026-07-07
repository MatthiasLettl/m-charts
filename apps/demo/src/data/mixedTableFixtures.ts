import { SCATTER_SHAPES, SCATTER_STYLE_LIMITS, type ScatterShape } from './types.ts';

export type MixedTableAxisKind = 'numeric' | 'categorical' | 'boolean' | 'datetime-ns';

export type MixedTableColumnRole = 'id' | 'table' | 'axis' | 'style' | 'metadata';

export interface MixedTableCategory {
  value: string | number | boolean;
  label: string;
  order?: number;
}

export interface MixedTableAxisSource {
  readonly datasetKey?: string;
  readonly fieldKey?: string;
  readonly tableKey?: string;
}

export interface MixedTableAxisMetadata {
  key: string;
  kind: MixedTableAxisKind;
  label: string;
  role: 'x' | 'y' | 'dimension';
  categories?: readonly MixedTableCategory[];
  source?: MixedTableAxisSource;
  unit?: string;
}

export interface MixedTableStyleMetadata {
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
    unit: string;
  };
  shape: {
    attribute: 'shape';
    values: readonly ScatterShape[];
  };
  size: {
    attribute: 'size';
    max: number;
    min: number;
    unit: string;
  };
}

export interface MixedTableColumnMetadata {
  axis?: MixedTableAxisMetadata;
  key: string;
  label: string;
  role: MixedTableColumnRole;
}

export interface MixedTableRecord {
  accepted: boolean;
  color: string;
  id: string;
  opacity: number;
  phase: 'idle' | 'ramp' | 'steady' | 'cooldown';
  rotation: number;
  secondaryDrift?: number;
  secondarySignal?: number;
  shape: ScatterShape;
  signalValue: number;
  size: number;
  table: string;
  timestampNs: string;
  [key: string]: boolean | number | string | undefined;
}

export interface MixedTableFixtureTable {
  name: string;
  records: MixedTableRecord[];
}

export interface MixedTableFixtureMetadata {
  axes: readonly MixedTableAxisMetadata[];
  columns: readonly MixedTableColumnMetadata[];
  count: number;
  createdAt: string;
  seed: number;
  styles: MixedTableStyleMetadata;
  tableNames: readonly string[];
  tables: readonly {
    count: number;
    name: string;
  }[];
  version: 1;
}

export interface MixedTableFixture {
  metadata: MixedTableFixtureMetadata;
  tables: MixedTableFixtureTable[];
}

export const MIXED_TABLE_NAMES = [
  'benchmark-primary',
  'benchmark-secondary',
] as const;

export const MIXED_TABLE_AXES = [
  {
    key: 'timestampNs',
    kind: 'datetime-ns',
    label: 'Timestamp',
    role: 'x',
    source: {
      datasetKey: 'mixed-table-demo',
      fieldKey: 'timestampNs',
      tableKey: 'benchmark-records',
    },
    unit: 'UTC',
  },
  {
    key: 'signalValue',
    kind: 'numeric',
    label: 'Signal value',
    role: 'dimension',
    source: {
      datasetKey: 'mixed-table-demo',
      fieldKey: 'signalValue',
      tableKey: 'benchmark-records',
    },
    unit: 'a.u.',
  },
  {
    categories: [
      { label: 'Idle', order: 0, value: 'idle' },
      { label: 'Ramp', order: 1, value: 'ramp' },
      { label: 'Steady', order: 2, value: 'steady' },
      { label: 'Cooldown', order: 3, value: 'cooldown' },
    ],
    key: 'phase',
    kind: 'categorical',
    label: 'Process phase',
    role: 'dimension',
    source: {
      datasetKey: 'mixed-table-demo',
      fieldKey: 'phase',
      tableKey: 'benchmark-records',
    },
  },
  {
    categories: [
      { label: 'Rejected', order: 0, value: false },
      { label: 'Accepted', order: 1, value: true },
    ],
    key: 'accepted',
    kind: 'boolean',
    label: 'Acceptance',
    role: 'dimension',
    source: {
      datasetKey: 'mixed-table-demo',
      fieldKey: 'accepted',
      tableKey: 'benchmark-records',
    },
  },
  {
    key: 'secondarySignal',
    kind: 'numeric',
    label: 'Secondary signal',
    role: 'dimension',
    source: {
      datasetKey: 'mixed-table-demo',
      fieldKey: 'secondarySignal',
      tableKey: 'benchmark-secondary',
    },
    unit: 'a.u.',
  },
  {
    key: 'secondaryDrift',
    kind: 'numeric',
    label: 'Secondary drift',
    role: 'dimension',
    source: {
      datasetKey: 'mixed-table-demo',
      fieldKey: 'secondaryDrift',
      tableKey: 'benchmark-secondary',
    },
    unit: 'a.u.',
  },
] as const satisfies readonly MixedTableAxisMetadata[];

export const MIXED_TABLE_STYLE_METADATA: MixedTableStyleMetadata = {
  color: {
    attribute: 'color',
    format: '#RRGGBB',
  },
  opacity: {
    attribute: 'opacity',
    max: SCATTER_STYLE_LIMITS.opacity.max,
    min: SCATTER_STYLE_LIMITS.opacity.min,
  },
  rotation: {
    attribute: 'rotation',
    max: SCATTER_STYLE_LIMITS.rotation.max,
    min: SCATTER_STYLE_LIMITS.rotation.min,
    unit: SCATTER_STYLE_LIMITS.rotation.unit,
  },
  shape: {
    attribute: 'shape',
    values: SCATTER_SHAPES,
  },
  size: {
    attribute: 'size',
    max: SCATTER_STYLE_LIMITS.size.max,
    min: SCATTER_STYLE_LIMITS.size.min,
    unit: SCATTER_STYLE_LIMITS.size.unit,
  },
};

export const MIXED_TABLE_COLUMNS = [
  { key: 'id', label: 'Record ID', role: 'id' },
  { key: 'table', label: 'Table', role: 'table' },
  ...MIXED_TABLE_AXES.map((axis) => ({
    axis,
    key: axis.key,
    label: axis.label,
    role: 'axis' as const,
  })),
  { key: 'color', label: 'Color', role: 'style' },
  { key: 'opacity', label: 'Opacity', role: 'style' },
  { key: 'size', label: 'Size', role: 'style' },
  { key: 'rotation', label: 'Rotation', role: 'style' },
  { key: 'shape', label: 'Shape', role: 'style' },
] as const satisfies readonly MixedTableColumnMetadata[];
