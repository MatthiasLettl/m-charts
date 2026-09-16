import { useCallback, useSyncExternalStore } from 'react';
import type { StreamingViewportController } from 'm-charts/plot-engine';

export function StreamingViewportControls({ controller }: {
  controller: StreamingViewportController<unknown> | null;
}) {
  const subscribe = useCallback((notify: () => void) => {
    if (controller === null) return () => {};
    const stopFollowing = controller.on('followingchange', notify);
    const stopBounds = controller.on('boundschange', notify);
    return () => { stopFollowing(); stopBounds(); };
  }, [controller]);
  const read = useCallback(() => JSON.stringify({
    following: controller?.getViewportFollowing() ?? false,
    bounds: controller?.getBounds(),
  }), [controller]);
  const snapshot = JSON.parse(useSyncExternalStore(subscribe, read)) as { following: boolean; bounds?: unknown };
  if (controller === null) return null;
  return <div data-testid="streaming-viewport-controls" data-following={snapshot.following}
    data-bounds={JSON.stringify(snapshot.bounds)}>
    <p role="status">{snapshot.following ? 'Following data' : 'Viewport paused'}</p>
    <div className="route-focus-controls">
      <button className="secondary-link" type="button" onClick={() => controller.fitViewport()}>Fit once</button>
      <button className="secondary-link" type="button"
        onClick={() => controller.setViewportFollowing(!controller.getViewportFollowing())}>
        {snapshot.following ? 'Pause following' : 'Resume following'}
      </button>
    </div>
  </div>;
}
