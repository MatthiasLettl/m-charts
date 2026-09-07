import { createCachedClientDataViewEvaluator } from './evaluator.js';
import type {
  ClientDataView,
  ClientDataViewChangeEvent,
  ClientDataViewChangeOperation,
  ClientDataViewChangeTarget,
  ClientDataViewListener,
  ClientDataViewState,
  CreateClientDataViewOptions,
} from './types.js';

type EventName = 'change' | 'filterchange' | 'stylechange' | 'transformationchange';

export function createClientDataView(options: CreateClientDataViewOptions): ClientDataView {
  let state = freezeState(createInitialState(options));
  const evaluate = createCachedClientDataViewEvaluator(options.dataset);
  const listeners = new Map<EventName, Set<ClientDataViewListener>>();
  let cachedEvaluation: ReturnType<typeof evaluate> | null = null;

  function commit(
    next: Omit<ClientDataViewState, 'revision'>,
    target: ClientDataViewChangeTarget,
    operation: ClientDataViewChangeOperation,
    targetId?: string,
    origin: 'import' | 'local' = 'local',
  ): void {
    const previousState = state;
    const nextState: ClientDataViewState = freezeState(cloneState({
      ...next,
      revision: previousState.revision + 1,
    }));
    // Validate and materialize once before publishing the state. The renderer's
    // change listener can then consume the same cached result without a second
    // full scan of a multi-million-row dataset.
    const nextEvaluation = evaluate(nextState);
    state = nextState;
    cachedEvaluation = nextEvaluation;
    const event: ClientDataViewChangeEvent = {
      operation,
      origin,
      previousState,
      state,
      target,
      ...(targetId === undefined ? {} : { targetId }),
    };
    publish(event);
  }

  function updateById<T extends { readonly id: string }>(
    values: readonly T[],
    id: string,
    replacement: T,
    label: string,
  ): readonly T[] {
    const index = values.findIndex((value) => value.id === id);
    if (index < 0) throw new TypeError(`Unknown client ${label} "${id}".`);
    const next = [...values];
    next[index] = { ...replacement, id };
    return next;
  }

  function removeById<T extends { readonly id: string }>(
    values: readonly T[],
    id: string,
    label: string,
  ): readonly T[] {
    if (!values.some((value) => value.id === id)) {
      throw new TypeError(`Unknown client ${label} "${id}".`);
    }
    return values.filter((value) => value.id !== id);
  }

  const pendingEvents: ClientDataViewChangeEvent[] = [];
  let publishing = false;
  function publish(event: ClientDataViewChangeEvent): void {
    pendingEvents.push(event);
    if (publishing) return;
    publishing = true;
    try {
      while (pendingEvents.length > 0) {
        const payload = pendingEvents.shift()!;
        const names: EventName[] = ['change'];
        if (payload.target !== 'state') names.push(`${payload.target}change`);
        // Snapshot subscriptions before notifying. Reentrant mutations are
        // delivered after every subscriber has seen the current revision.
        const subscribers = names.flatMap((name) => [...(listeners.get(name) ?? [])]);
        for (const listener of subscribers) {
          try {
            listener(payload);
          } catch (error) {
            try {
              if (options.onListenerError !== undefined) options.onListenerError(error, payload);
              else console.error('Client data-view listener failed after state committed.', error);
            } catch (reportingError) {
              console.error('Client data-view error handler failed.', reportingError);
            }
          }
        }
      }
    } finally {
      publishing = false;
    }
  }

  function reorderById<T extends { readonly id: string }>(
    values: readonly T[],
    ids: readonly string[],
    label: string,
  ): readonly T[] {
    if (ids.length !== values.length || new Set(ids).size !== ids.length) {
      throw new TypeError(`Client ${label} reorder must contain every ID exactly once.`);
    }
    const byId = new Map(values.map((value) => [value.id, value]));
    return ids.map((id) => {
      const value = byId.get(id);
      if (value === undefined) {
        throw new TypeError(`Unknown client ${label} "${id}" in reorder.`);
      }
      return value;
    });
  }

  return {
    dataset: options.dataset,
    addFilter(filter) {
      commit({ ...state, filters: [...state.filters, filter] }, 'filter', 'add', filter.id);
    },
    addStyle(style) {
      commit({ ...state, styles: [...state.styles, style] }, 'style', 'add', style.id);
    },
    addTransformation(transformation) {
      commit(
        { ...state, transformations: [...state.transformations, transformation] },
        'transformation',
        'add',
        transformation.id,
      );
    },
    evaluate() {
      cachedEvaluation ??= evaluate(state);
      return cachedEvaluation;
    },
    exportState: () => cloneState(state),
    getFilters: () => state.filters,
    getState: () => state,
    getStyles: () => state.styles,
    getTransformations: () => state.transformations,
    on(event, listener) {
      const eventListeners = listeners.get(event) ?? new Set<ClientDataViewListener>();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
      return () => eventListeners.delete(listener);
    },
    removeFilter(id) {
      commit(
        { ...state, filters: removeById(state.filters, id, 'filter') },
        'filter',
        'remove',
        id,
      );
    },
    removeStyle(id) {
      commit(
        { ...state, styles: removeById(state.styles, id, 'style') },
        'style',
        'remove',
        id,
      );
    },
    removeTransformation(id) {
      commit(
        {
          ...state,
          transformations: removeById(state.transformations, id, 'transformation'),
        },
        'transformation',
        'remove',
        id,
      );
    },
    reorderFilters(ids) {
      commit(
        { ...state, filters: reorderById(state.filters, ids, 'filter') },
        'filter',
        'reorder',
      );
    },
    reorderStyles(ids) {
      commit(
        { ...state, styles: reorderById(state.styles, ids, 'style') },
        'style',
        'reorder',
      );
    },
    reorderTransformations(ids) {
      commit(
        {
          ...state,
          transformations: reorderById(state.transformations, ids, 'transformation'),
        },
        'transformation',
        'reorder',
      );
    },
    replaceState(nextState) {
      const { revision: _revision, ...replacement } = cloneState(nextState);
      void _revision;
      commit(replacement, 'state', 'replace', undefined, 'import');
    },
    updateFilter(id, filter) {
      commit(
        { ...state, filters: updateById(state.filters, id, filter, 'filter') },
        'filter',
        'update',
        id,
      );
    },
    updateStyle(id, style) {
      commit(
        { ...state, styles: updateById(state.styles, id, style, 'style') },
        'style',
        'update',
        id,
      );
    },
    updateTransformation(id, transformation) {
      commit(
        {
          ...state,
          transformations: updateById(
            state.transformations,
            id,
            transformation,
            'transformation',
          ),
        },
        'transformation',
        'update',
        id,
      );
    },
  };
}

function createInitialState(options: CreateClientDataViewOptions): ClientDataViewState {
  return cloneState({
    datasetKey: options.state?.datasetKey ?? options.dataset.datasetKey,
    datasetVersion: options.state?.datasetVersion ?? options.dataset.datasetVersion,
    filters: options.state?.filters ?? [],
    revision: 0,
    sourceStyleMode: options.state?.sourceStyleMode ?? 'preserve',
    styles: options.state?.styles ?? [],
    transformations: options.state?.transformations ?? [],
    version: 1,
  });
}

function cloneState(state: ClientDataViewState): ClientDataViewState {
  return typeof structuredClone === 'function'
    ? structuredClone(state)
    : JSON.parse(JSON.stringify(state)) as ClientDataViewState;
}

// Configuration is small, detached JSON data; resident typed columns are never frozen.
function freezeState<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeState(child);
    Object.freeze(value);
  }
  return value;
}
