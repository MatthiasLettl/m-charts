import { createEmitter, type TypedEmitter } from './emitter.js';

export interface StreamingViewportEvents<Bounds> {
  /** Full-data fit bounds, independent of the currently inspected viewport. */
  boundschange: { readonly bounds: Bounds; readonly reason: 'stream' };
  followingchange: { readonly following: boolean; readonly reason: 'command' | 'interaction' };
}

export interface StreamingViewportController<Bounds> {
  getBounds(): Bounds;
  getViewportFollowing(): boolean;
  /** Fits once and pauses following. */
  fitViewport(): void;
  /** Enabling immediately fits the latest bounds, then follows future growth. */
  setViewportFollowing(following: boolean): void;
  on: TypedEmitter<StreamingViewportEvents<Bounds>>['on'];
}

/** Renderer-independent mechanics; applications may supply their own interaction policy. */
export function createStreamingViewportController<Bounds>(options: {
  bounds: Bounds;
  following: boolean;
  apply: (bounds: Bounds, reason: 'stream' | 'fit') => void;
  equal: (left: Bounds, right: Bounds) => boolean;
}) {
  const emitter = createEmitter<StreamingViewportEvents<Bounds>>();
  let bounds = options.bounds;
  let following = options.following;
  let disposed = false;
  const setFollowing = (next: boolean, reason: 'command' | 'interaction') => {
    if (disposed || following === next) return;
    following = next;
    emitter.emit('followingchange', { following, reason });
  };
  const controller: StreamingViewportController<Bounds> = {
    getBounds: () => bounds,
    getViewportFollowing: () => following,
    fitViewport() {
      if (disposed) return;
      setFollowing(false, 'command');
      if (!disposed) options.apply(bounds, 'fit');
    },
    setViewportFollowing(next) {
      if (disposed) return;
      setFollowing(next, 'command');
      if (!disposed && next && following) options.apply(bounds, 'fit');
    },
    on: emitter.on,
  };
  return {
    controller,
    updateBounds(next: Bounds) {
      if (disposed || options.equal(bounds, next)) return;
      bounds = next;
      emitter.emit('boundschange', { bounds, reason: 'stream' });
      // A listener can pause following before the viewport is applied.
      if (!disposed && following) options.apply(bounds, 'stream');
    },
    pause() { setFollowing(false, 'interaction'); },
    dispose() { disposed = true; emitter.clear(); },
  };
}

/** Default optional policy: pause at the first external viewport preview/change. */
export function bindStreamingViewportInteractions(
  pause: () => void,
  subscribe: (listener: (event: { reason: string }) => void) => () => void,
): () => void {
  return subscribe(({ reason }) => {
    if (reason !== 'initial' && reason !== 'stream' && reason !== 'fit') pause();
  });
}
