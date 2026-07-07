export type PlotMetricLevel = 'debug' | 'info' | 'warn' | 'error';

export interface PlotMetricEvent {
  durationMs?: number;
  level?: PlotMetricLevel;
  name: string;
  plotId?: string;
  timestampMs: number;
  value?: number;
}

export interface PlotMetricsEvents {
  metrics: PlotMetricEvent;
}

export function createMetricEvent(
  name: string,
  options: Omit<PlotMetricEvent, 'name' | 'timestampMs'> & { timestampMs?: number } = {},
): PlotMetricEvent {
  return {
    ...options,
    name,
    timestampMs: options.timestampMs ?? (globalThis.performance?.now() ?? Date.now()),
  };
}

