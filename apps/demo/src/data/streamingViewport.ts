import type { StreamingViewportController } from 'm-charts/plot-engine';

export function getStreamingViewport(plot: object | null): StreamingViewportController<unknown> | null {
  return plot !== null && 'streaming' in plot
    ? plot.streaming as StreamingViewportController<unknown>
    : null;
}
