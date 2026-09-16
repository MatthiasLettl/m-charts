import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { createClientDataViewWorkerEvaluator, type ClientDataAsyncEvaluator, type ClientDataView, type ClientDataField } from 'm-charts/client-data-view';

export function demoClientFields(count: number, sourceIndices?: Uint32Array): Record<string, ClientDataField> {
  const rows = sourceIndices ?? new Uint32Array(count);
  const group = new Uint8Array(count);
  const reference = new Uint8Array(count);
  for (let row = 0; row < count; row++) {
    if (sourceIndices === undefined) rows[row] = row;
    group[row] = row % 5;
    reference[row] = row % 17 === 0 ? 1 : 0;
  }
  return {
    sourceRow: { kind: 'numeric', values: rows },
    group: { kind: 'categorical', values: group },
    isReferenceMember: { kind: 'boolean', values: reference },
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
