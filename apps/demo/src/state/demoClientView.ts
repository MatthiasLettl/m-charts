import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { createClientDataViewWorkerEvaluator, type ClientDataAsyncEvaluator, type ClientDataView, type ClientDataField } from 'm-charts/client-data-view';

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

export function createDemoAsyncEvaluator(): ClientDataAsyncEvaluator {
  let evaluator: ClientDataAsyncEvaluator | undefined;
  return {
    evaluate(dataset, state) {
      evaluator ??= createClientDataViewWorkerEvaluator(new Worker(
        new URL('../../../../packages/m-charts/src/client-data-view/core/worker.ts', import.meta.url), { type: 'module' },
      ));
      return evaluator.evaluate(dataset, state);
    },
    dispose() { evaluator?.dispose?.(); evaluator = undefined; },
  };
}
const owners = new WeakMap<ClientDataView, number>();
export function useDisposeClientView(view: ClientDataView | null | undefined) {
  useEffect(() => {
    if (!view) return;
    owners.set(view, (owners.get(view) ?? 0) + 1);
    return () => {
      owners.set(view, (owners.get(view) ?? 1) - 1);
      // React StrictMode remounts effects synchronously; release only after all owners leave.
      queueMicrotask(() => { if (owners.get(view) === 0) view.dispose(); });
    };
  }, [view]);
}
