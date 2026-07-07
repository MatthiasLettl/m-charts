export const FAST_ROUTE_TABLES_PARAM = 'tables';
export const HISTOGRAM_BARS_DATASET_URL = '/data/histogram-bars-sample.json';
export const MIXED_TABLE_FIXTURE_URL = '/data/mixed-table-fixture.json';

export type FastRouteTableMode = 'single' | 'multi';

export function parseFastRouteTableMode(
  searchParams: URLSearchParams,
): FastRouteTableMode {
  return searchParams.get(FAST_ROUTE_TABLES_PARAM) === 'multi' ? 'multi' : 'single';
}

export function formatFastRouteTableMode(mode: FastRouteTableMode): string | null {
  return mode === 'multi' ? 'multi' : null;
}

export function isFastRouteMultiTableMode(mode: FastRouteTableMode): boolean {
  return mode === 'multi';
}
