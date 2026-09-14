import type {
  ClientDataFilter,
  ClientDataPredicate,
  ClientDataSet,
  ClientDataViewState,
} from 'm-charts/client-data-view';
import {
  DIMENSIONS,
  type ExplorerFilters,
  type SensorReading,
  type ViewId,
} from './sensorModel.ts';

export const VIEW_IDS: ViewId[] = [
  'timeline',
  'scatter',
  'histogram',
  'parallel',
  'density',
];

export function sensorClientDataset(
  readings: readonly SensorReading[],
): ClientDataSet {
  return {
    datasetKey: 'thermal-chamber',
    datasetVersion: `rows-${readings.length}`,
    rowCount: readings.length,
    fields: Object.fromEntries(
      [
        'time',
        'sensor',
        'sourceIndex',
        ...DIMENSIONS.map((d) => d.key),
        'anomaly',
      ].map((key) => [
        key,
        {
          kind: 'numeric' as const,
          values: Float64Array.from(readings, (row) =>
            key === 'anomaly'
              ? Number(row.anomaly !== null)
              : row[key as Exclude<keyof SensorReading, 'id' | 'anomaly'>],
          ),
        },
      ]),
    ),
  };
}

/** Each chart keeps its own context; all other constraints still apply. */
export function sensorClientState(
  filters: ExplorerFilters,
  available: number,
  omit?: ViewId,
): ClientDataViewState {
  const constraints: ClientDataFilter[] = [
    {
      id: 'arrived',
      predicate: { op: 'lt', field: 'sourceIndex', value: available },
    },
    {
      id: 'chambers',
      predicate: { op: 'in', field: 'sensor', values: filters.sensors },
    },
  ];
  if (filters.anomalyOnly)
    constraints.push({
      id: 'anomalies',
      predicate: { op: 'eq', field: 'anomaly', value: 1 },
    });
  for (const view of VIEW_IDS) {
    if (view === omit) continue;
    const ranges = filters.views[view];
    if (ranges) {
      const args: ClientDataPredicate[] = Object.entries(ranges)
        .filter(([, intervals]) => intervals.length)
        .map(([field, intervals]) => ({
          op: 'or',
          args: intervals.map(({ min, max }) => ({
            op: 'between',
            field,
            min: Math.min(min, max),
            max: Math.max(min, max),
          })),
        }));
      constraints.push({ id: view, predicate: { op: 'and', args } });
    }
    const ids = filters.selections?.[view];
    if (ids)
      constraints.push({
        id: `${view}-ids`,
        predicate: { op: 'in', field: 'sourceIndex', values: Array.from(ids) },
      });
  }
  return {
    version: 2,
    revision: 0,
    filters: constraints,
    styles: [],
    transformations: [],
  };
}
