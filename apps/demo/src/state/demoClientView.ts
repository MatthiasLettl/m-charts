import { useCallback, useSyncExternalStore } from 'react';
import type { ClientDataView, ClientDataField } from 'm-charts/client-data-view';

export function demoClientFields(count: number, sourceIndices?: Uint32Array): Record<string, ClientDataField> {
  return {
    sourceRow: { kind: 'numeric', values: sourceIndices ?? Uint32Array.from({ length: count }, (_, i) => i) },
    group: { kind: 'categorical', values: Uint8Array.from({ length: count }, (_, i) => i % 5) },
    isReferenceMember: { kind: 'boolean', values: Uint8Array.from({ length: count }, (_, i) => i % 17 === 0 ? 1 : 0) },
  };
}
export function useClientViewState(view: ClientDataView | undefined) {
  const subscribe = useCallback((callback: () => void) => view?.on('change', callback) ?? (() => {}), [view]);
  const snapshot = useCallback(() => view?.getState() ?? null, [view]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
