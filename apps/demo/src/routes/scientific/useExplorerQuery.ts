import { useEffect, useMemo, useRef, useState } from 'react';
import { createDemoAsyncEvaluator } from '../../state/demoClientView.ts';
import {
  sensorClientDataset,
  sensorClientState,
  VIEW_IDS,
} from './clientQuery.ts';
import {
  summarizeReadings,
  type ExplorerFilters,
  type SensorReading,
  type ViewId,
} from './sensorModel.ts';

export function useExplorerQuery(
  readings: SensorReading[],
  filters: ExplorerFilters,
  available: number,
  crossFilter: boolean,
  onEvent: (source: string, name: string, detail: string) => void,
) {
  const dataset = useMemo(() => sensorClientDataset(readings), [readings]);
  const request = useMemo(
    () => ({ filters, available, crossFilter, readings }),
    [filters, available, crossFilter, readings],
  );
  const [result, setResult] = useState(() => {
    const arrived =
      available === readings.length ? readings : readings.slice(0, available);
    return {
      matches: arrived,
      summary: summarizeReadings(arrived),
      contexts: Object.fromEntries(
        VIEW_IDS.map((id) => [id, arrived]),
      ) as Record<ViewId, SensorReading[]>,
      duration: null as number | null,
      revision: 0,
      filtered: false,
      request: null as typeof request | null,
    };
  });
  const [failure, setFailure] = useState<{
    request: typeof request;
    message: string;
  } | null>(null);
  const evaluatorRef = useRef<ReturnType<
    typeof createDemoAsyncEvaluator
  > | null>(null);
  useEffect(() => {
    const next = createDemoAsyncEvaluator();
    evaluatorRef.current = next;
    return () => next.dispose?.();
  }, []);
  useEffect(() => {
    const evaluator = evaluatorRef.current!;
    let active = true;
    void (async () => {
      const evaluation = await evaluator.evaluate(
        dataset,
        sensorClientState(filters, available),
      );
      if (!active) return;
      let duration = evaluation.metrics.durationMs;
      const matches = Array.from(
        evaluation.activeSourceIndices,
        (index) => readings[index],
      );
      const arrived =
        available === readings.length ? readings : readings.slice(0, available);
      const contexts = {} as Record<ViewId, SensorReading[]>;
      for (const id of VIEW_IDS) {
        if (crossFilter && (filters.views[id] || filters.selections?.[id])) {
          const context = await evaluator.evaluate(
            dataset,
            sensorClientState(filters, available, id),
          );
          if (!active) return;
          contexts[id] = Array.from(
            context.activeSourceIndices,
            (index) => readings[index],
          );
          duration += context.metrics.durationMs;
        } else contexts[id] = crossFilter ? matches : arrived;
      }
      onEvent(
        'Client data view',
        'evaluate',
        `${matches.length.toLocaleString('en')} matching IDs · ${duration.toFixed(2)} ms worker CPU · ${crossFilter ? 'per-chart contexts' : 'highlight'}`,
      );
      setResult((previous) => {
        for (const id of VIEW_IDS) {
          const before = previous.contexts[id];
          const next = contexts[id];
          if (
            next.length === before.length &&
            next.every((row, index) => row === before[index])
          )
            contexts[id] = before;
        }
        return {
          filtered:
            filters.sensors.length !== 3 ||
            filters.anomalyOnly ||
            VIEW_IDS.some(
              (id) => filters.views[id] || filters.selections?.[id],
            ),
          matches,
          summary: summarizeReadings(matches),
          contexts,
          duration,
          revision: previous.revision + 1,
          request,
        };
      });
    })().catch((reason: unknown) => {
      if (active) setFailure({ request, message: String(reason) });
    });
    return () => {
      active = false;
    };
  }, [available, crossFilter, dataset, filters, readings, request, onEvent]);
  const error = failure?.request === request ? failure.message : null;
  return { result, busy: result.request !== request && error === null, error };
}
