import type { FastScatterWebgpuAggregationBackend } from 'm-charts/m-scatter-webgpu';

export const FAST_SCATTER_WEBGPU_AGGREGATION_BACKEND_PARAM = 'aggregationBackend';

export function parseFastScatterWebgpuAggregationBackend(
  params: URLSearchParams,
): FastScatterWebgpuAggregationBackend {
  const value = params.get(FAST_SCATTER_WEBGPU_AGGREGATION_BACKEND_PARAM);
  return value === 'rust-wasm' || value === 'typescript' ? value : 'auto';
}
