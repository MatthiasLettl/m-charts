import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ThemeModeSwitch } from '../theme/ThemeModeSwitch.tsx';
import { useThemeMode } from '../theme/ThemeModeProvider.tsx';
import { createThemeAwareTo } from '../state/themeMode.ts';
import { ExplorerIcon } from './scientific/ExplorerIcon.tsx';
import { ExplorerChart } from './scientific/ExplorerChart.tsx';
import {
  initialFilters,
  describeRanges,
  SENSOR_COLORS,
  SENSOR_NAMES,
  DIMENSIONS,
  VIEW_LABELS,
  type Dimension,
  type ExplorerFilters,
  type Ranges,
  type ViewId,
} from './scientific/sensorModel.ts';
import {
  loadSensorDataset,
  type SensorDataset,
} from './scientific/sensorStore.ts';
import { useExplorerQuery } from './scientific/useExplorerQuery.ts';
import './scientific/scientific.css';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_KEYS,
  readExplorerInteractions,
  type ExplorerShortcuts,
} from './scientific/interactions.ts';

const number = new Intl.NumberFormat('en');
interface ExplorerEvent {
  id: number;
  source: string;
  name: string;
  detail: string;
  time: string;
}
const CHARTS: {
  id: ViewId;
  title: string;
  axes: Dimension[];
  tag: string;
}[] = [
  {
    id: 'timeline',
    title: 'Experiment timeline',
    axes: ['time'],
    tag: '01 / Time series',
  },
  {
    id: 'scatter',
    title: 'Temperature & pressure',
    axes: ['temperature', 'pressure'],
    tag: '02 / Scatter',
  },
  {
    id: 'histogram',
    title: 'Temperature distribution',
    axes: ['temperature'],
    tag: '03 / Histogram',
  },
  {
    id: 'parallel',
    title: 'Sensor fingerprint',
    axes: DIMENSIONS.map((d) => d.key),
    tag: '04 / Parallel coordinates',
  },
  {
    id: 'density',
    title: 'Vibration & pressure',
    axes: ['vibration', 'pressure'],
    tag: '05 / Density heatmap',
  },
];

type Experience = 'explore' | 'large' | 'live';

export function ScientificExplorerRoute() {
  const [experience, setExperience] = useState<Experience>('explore');
  const [dataset, setDataset] = useState<SensorDataset | null>(null);
  const [generation, setGeneration] = useState(0);
  const [size, setSize] = useState(12000);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const accept = (value: SensorDataset) => {
      if (active) setDataset(value);
    };
    let worker: Worker | undefined;
    if (size === 12000) void loadSensorDataset(generation > 0).then(accept);
    else {
      worker = new Worker(
        new URL('./scientific/sensorGenerator.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.onmessage = ({ data }) => {
        if (data.error) {
          if (active) setLoadError(data.error);
        } else
          accept({
            readings: data.readings,
            createdAt: Date.now(),
            source: 'generated',
            storage: 'memory',
          });
        worker?.terminate();
      };
      worker.onerror = () => {
        if (active)
          setLoadError(
            'Could not prepare this dataset. Try a smaller experiment.',
          );
      };
      worker.postMessage(size);
    }
    return () => {
      active = false;
      worker?.terminate();
    };
  }, [generation, size]);
  if (!dataset)
    return (
      <main className="sci-shell">
        <div className="sci-data-loading" role="status">
          <h1>Scientific data explorer</h1>
          <p>
            {loadError ??
              `Preparing ${number.format(size)} readings on this device…`}
          </p>
          {(loadError || size !== 12000) && (
            <button
              className="sci-button"
              onClick={() => {
                setLoadError(null);
                setSize(12000);
                setExperience('explore');
              }}
            >
              Use 12,000 readings
            </button>
          )}
        </div>
      </main>
    );
  return (
    <ScientificExplorerDashboard
      key={`${size}-${generation}-${experience}`}
      experience={experience}
      onExperience={(next) => {
        if (next === experience) return;
        const nextSize = next === 'large' ? 1200000 : 12000;
        setExperience(next);
        if (nextSize !== size) {
          setDataset(null);
          setSize(nextSize);
          setLoadError(null);
        }
      }}
      dataset={dataset}
      size={size}
      onSize={(next) => {
        setLoadError(null);
        setDataset(null);
        setSize(next);
      }}
      onRegenerate={() => {
        setDataset(null);
        setGeneration((value) => value + 1);
      }}
    />
  );
}

function ScientificExplorerDashboard({
  dataset,
  size,
  onSize,
  onRegenerate,
  experience,
  onExperience,
}: {
  experience: Experience;
  onExperience: (experience: Experience) => void;
  dataset: SensorDataset;
  size: number;
  onSize: (size: number) => void;
  onRegenerate: () => void;
}) {
  const { themeMode } = useThemeMode();
  const location = useLocation();
  const readings = dataset.readings;
  const [filters, setFilters] = useState(initialFilters);
  const [crossFilter, setCrossFilter] = useState(false);
  const startingAvailable =
    experience === 'live'
      ? Math.max(300, Math.floor(readings.length / 10 / 3) * 3)
      : readings.length;
  const [available, setAvailable] = useState(startingAvailable);
  const [comparison, setComparison] = useState<ViewId>('scatter');
  const [distribution, setDistribution] = useState<ViewId>('histogram');
  const [chartMenu, setChartMenu] = useState<ViewId | null>(null);
  const visibleCharts = ['timeline', comparison, distribution].map(
    (id) => CHARTS.find((chart) => chart.id === id)!,
  );
  const [streaming, setStreaming] = useState(experience === 'live');
  const [replayCycle, setReplayCycle] = useState(1);
  const [interactions, setInteractions] = useState(readExplorerInteractions);
  useEffect(() => {
    try {
      localStorage.setItem(
        'm-charts.explorer.interactions',
        JSON.stringify(interactions),
      );
    } catch {
      /* Optional preference storage. */
    }
  }, [interactions]);
  const [streamRate, setStreamRate] = useState(0);
  const lastBatch = useRef(0);
  useEffect(() => {
    lastBatch.current = performance.now();
  }, []);
  const [events, setEvents] = useState<ExplorerEvent[]>([]);
  const log = useCallback((source: string, name: string, detail: string) => {
    setEvents((previous) =>
      [
        {
          id: (previous[0]?.id ?? 0) + 1,
          source,
          name,
          detail,
          time: new Date().toLocaleTimeString('en-GB'),
        },
        ...previous,
      ].slice(0, 24),
    );
  }, []);
  const { result, busy, error } = useExplorerQuery(
    readings,
    filters,
    available,
    crossFilter,
    log,
  );
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [expanded, setExpanded] = useState<ViewId | null>(null);
  const [zoomReset, setZoomReset] = useState<Partial<Record<ViewId, number>>>(
    {},
  );
  const [resetVersion, setResetVersion] = useState(0);
  const [panel, setPanel] = useState<
    'help' | 'records' | 'data' | 'options' | ViewId | null
  >(null);
  const [tool, setTool] = useState<'zoom' | 'select'>('select');
  const [metrics, setMetrics] = useState<Partial<Record<ViewId, number>>>({});
  useEffect(() => {
    if (!chartMenu || panel) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        !event.target.closest('.sci-card-actions')
      )
        setChartMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChartMenu(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [chartMenu, panel]);
  const selected = useMemo(
    () => Uint32Array.from(result.matches, (row) => row.sourceIndex),
    [result.matches],
  );
  const activeViews = [
    ...new Set([
      ...Object.keys(filters.views).filter(
        (key) => filters.views[key as ViewId],
      ),
      ...Object.keys(filters.selections ?? {}).filter(
        (key) => filters.selections?.[key as ViewId],
      ),
    ]),
  ] as ViewId[];
  const filtered =
    activeViews.length > 0 ||
    filters.sensors.length !== 3 ||
    filters.anomalyOnly;
  useEffect(() => {
    if (!streaming || busy) return;
    const timer = setTimeout(() => {
      if (available >= readings.length) {
        setAvailable(startingAvailable);
        setReplayCycle((cycle) => cycle + 1);
        lastBatch.current = performance.now();
        setStreamRate(0);
        log(
          'Local replay',
          'stream.loop',
          'Replay restarted; selection and zoom retained',
        );
        return;
      }
      const next = Math.min(
        readings.length,
        available + Math.max(300, Math.floor(readings.length / 40 / 3) * 3),
      );
      const now = performance.now();
      setStreamRate(
        Math.round(
          ((next - available) * 1000) / Math.max(1, now - lastBatch.current),
        ),
      );
      lastBatch.current = now;
      setAvailable(next);
      log(
        'Local replay',
        'data.append',
        `${number.format(next - available)} arrived · ${number.format(next)} total`,
      );
    }, 750);
    return () => clearTimeout(timer);
  }, [available, busy, log, readings.length, startingAvailable, streaming]);
  const toggleStream = () => {
    if (streaming) {
      setStreaming(false);
      log(
        'Local replay',
        'stream.pause',
        `${number.format(available)} readings retained`,
      );
    } else {
      if (available === readings.length)
        setAvailable(Math.max(300, Math.floor(readings.length / 10 / 3) * 3));
      lastBatch.current = performance.now();
      setStreamRate(0);
      setStreaming(true);
      log(
        'Local replay',
        'stream.play',
        'Replay local batches; preserve filters and viewports',
      );
    }
  };
  const latestInteraction = events.find(
    (event) =>
      ![
        'plot.update',
        'evaluate',
        'viewportchange',
        'axisviewportchange',
        'viewport.reset',
      ].includes(event.name),
  );
  const onBrush = useCallback(
    (view: ViewId, ranges: Ranges, event: string) => {
      // A click is inspection, not a zero-area filter that empties every view.
      if (
        event === 'brushcommit' &&
        Object.values(ranges).some((intervals) =>
          intervals?.some((range) => range.min === range.max),
        )
      )
        return;
      setFilters((previous) => ({
        ...previous,
        selections: { ...previous.selections, [view]: undefined },
        views: {
          ...previous.views,
          [view]: Object.keys(ranges).length ? ranges : undefined,
        },
      }));
      log(VIEW_LABELS[view], event, describeRanges(ranges));
    },
    [log, setFilters],
  );
  const onSelection = useCallback(
    (view: ViewId, indices: Uint32Array | null) => {
      setFilters((previous) => {
        const selections = { ...previous.selections };
        const views = { ...previous.views };
        delete views[view];
        if (indices === null) delete selections[view];
        else selections[view] = new Set(indices);
        return { ...previous, views, selections };
      });
      log(
        VIEW_LABELS[view],
        'selectionchange',
        indices === null
          ? 'Selection cleared'
          : `${number.format(indices.length)} record IDs → shared cohort`,
      );
    },
    [log, setFilters],
  );
  const onMetrics = useCallback((view: ViewId, duration: number) => {
    setMetrics((previous) =>
      previous[view] === duration
        ? previous
        : { ...previous, [view]: duration },
    );
  }, []);
  const removeFilter = (view: ViewId) => {
    setFilters((previous) => {
      const views = { ...previous.views };
      delete views[view];
      const selections = { ...previous.selections };
      delete selections[view];
      return { ...previous, views, selections };
    });
    log(VIEW_LABELS[view], 'filter.clear', 'Removed this view’s constraint.');
  };
  const reset = () => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    setFilters(initialFilters());
    setCrossFilter(false);
    setStreaming(false);
    setAvailable(startingAvailable);
    setStreamRate(0);
    setReplayCycle(1);
    setComparison('scatter');
    setDistribution('histogram');
    setExpanded(null);
    setChartMenu(null);
    setInspectorOpen(false);
    setPanel(null);
    setTool('select');
    setEvents([]);
    setResetVersion((version) => version + 1);
    log(
      'Application',
      'filters.reset',
      'Starting data, charts, filters and viewports restored; replay paused.',
    );
  };
  const clearSelection = () => {
    setFilters(initialFilters());
    setCrossFilter(false);
    log(
      'Application',
      'selection.clear',
      'All selections cleared; views retained',
    );
  };
  const resetViews = () => {
    setZoomReset((previous) =>
      Object.fromEntries(CHARTS.map(({ id }) => [id, (previous[id] ?? 0) + 1])),
    );
  };
  const preset = (kind: 'heat' | 'drift') => {
    const next: ExplorerFilters = {
      sensors: [kind === 'heat' ? 1 : 2],
      anomalyOnly: false,
      views: {
        timeline: {
          time: [
            kind === 'heat' ? { min: 48, max: 66 } : { min: 88, max: 120 },
          ],
        },
      },
    };
    setFilters(next);
    log(
      'Application',
      'scenario.apply',
      kind === 'heat'
        ? 'Chamber B · heat excursion · 48–66 min'
        : 'Chamber C · pressure drift · 88–120 min',
    );
  };

  return (
    <main
      className={`sci-shell ${inspectorOpen ? 'sci-with-inspector' : ''}`}
      onKeyDownCapture={(event) => {
        if (
          event.repeat ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          panel ||
          !(event.target instanceof Element) ||
          !event.target.closest('.sci-chart-host')
        )
          return;
        const key = event.key === 'Escape' ? 'Escape' : event.key.toLowerCase();
        const action = (
          Object.keys(interactions.shortcuts) as (keyof ExplorerShortcuts)[]
        ).find((name) => interactions.shortcuts[name] === key);
        if (!action) {
          // A remapped clear shortcut must not also trigger the engine's Escape binding.
          if (key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (action === 'select' || action === 'zoom') setTool(action);
        else if (action === 'clear') clearSelection();
        else resetViews();
      }}
    >
      <header className="sci-topbar">
        <nav aria-label="Showcase navigation">
          <Link
            to={createThemeAwareTo('/', location.search, themeMode)}
            className="sci-brand"
            aria-label="m-charts / Showcases"
            title="Back to showcases"
          >
            <span className="sci-mark" aria-hidden="true">
              m
            </span>
            <span className="sci-back-label">Showcases</span>
          </Link>
        </nav>
        <h1 title="Thermal chamber study · WebGPU · Rust/WASM">
          Scientific data explorer
        </h1>
        <div className="sci-heading-actions">
          <button
            className="sci-text-button sci-icon-button"
            aria-label="Help"
            title="How to explore"
            onClick={() => setPanel('help')}
          >
            <ExplorerIcon name="help" />
          </button>
          <button
            className="sci-text-button"
            aria-expanded={inspectorOpen}
            onClick={() => setInspectorOpen((value) => !value)}
          >
            For developers
          </button>
          <button
            className="sci-text-button sci-icon-button"
            onClick={reset}
            aria-label="Reset all"
            title="Restore starting data, charts and filters; pause replay"
          >
            <ExplorerIcon name="reset" />
          </button>
          <ThemeModeSwitch />
        </div>
      </header>

      <div className="sci-experience-bar">
        <div className="sci-tools sci-experiences" aria-label="Demo experience">
          {(['explore', 'large', 'live'] as const).map((mode) => (
            <button
              key={mode}
              aria-pressed={experience === mode}
              onClick={() => onExperience(mode)}
            >
              {mode === 'explore'
                ? 'Explore'
                : mode === 'large'
                  ? 'Large dataset'
                  : 'Live data'}
            </button>
          ))}
        </div>
        {experience === 'large' && (
          <select
            aria-label="Experiment size"
            value={size}
            onChange={(event) => onSize(Number(event.target.value))}
          >
            <option value={120000}>120,000 readings</option>
            <option value={1200000}>1,200,000 readings</option>
          </select>
        )}
        {experience === 'live' && (
          <>
            <button
              className="sci-button sci-button-primary"
              aria-label={streaming ? 'Pause replay' : 'Resume replay'}
              onClick={toggleStream}
            >
              <ExplorerIcon name={streaming ? 'pause' : 'play'} />
              {streaming ? 'Pause' : 'Resume'}
            </button>
            <span role="status" data-testid="stream-status">
              {number.format(available)} / {number.format(readings.length)}{' '}
              arrived ·{' '}
              {streaming
                ? `${number.format(streamRate)} rows/s · Loop ${replayCycle}`
                : 'Paused'}
            </span>
          </>
        )}
        <fieldset className="sci-sensors">
          <legend className="sci-sr-only">Included chambers</legend>
          {SENSOR_NAMES.map((name, sensor) => (
            <label
              key={name}
              style={
                { '--sensor-color': SENSOR_COLORS[sensor] } as CSSProperties
              }
            >
              <input
                type="checkbox"
                checked={filters.sensors.includes(sensor)}
                onChange={() => {
                  setFilters((previous) => ({
                    ...previous,
                    sensors: previous.sensors.includes(sensor)
                      ? previous.sensors.filter((s) => s !== sensor)
                      : [...previous.sensors, sensor],
                  }));
                  log('Application', 'chamber.toggle', name);
                }}
              />
              <span aria-hidden="true" className="sci-sensor-symbol">
                {['●', '■', '▲'][sensor]}
              </span>
              <span>{name}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <section className="sci-filterbar" aria-label="Linked filters">
        <div className="sci-filter-heading">
          <div className="sci-tools" aria-label="Left mouse drag">
            <button
              aria-label="Select"
              aria-pressed={tool === 'select'}
              onClick={() => setTool('select')}
            >
              <ExplorerIcon name="select" /> Select
            </button>
            <button
              aria-label="Zoom"
              aria-pressed={tool === 'zoom'}
              onClick={() => setTool('zoom')}
            >
              <ExplorerIcon name="zoom" /> Zoom
            </button>
          </div>
          <span className="sci-filter-explanation">
            {tool === 'zoom'
              ? 'Drag to zoom'
              : crossFilter
                ? 'Drag to filter linked charts'
                : 'Drag to highlight across charts'}
          </span>
        </div>
        <div className="sci-filter-actions">
          <button
            className={`sci-button ${crossFilter ? 'sci-button-primary' : ''}`}
            disabled={!filtered && !crossFilter}
            aria-pressed={crossFilter}
            onClick={() => setCrossFilter((value) => !value)}
          >
            {crossFilter ? 'Show all context' : 'Filter to selection'}
          </button>
          <button
            className="sci-button"
            disabled={!filtered}
            onClick={clearSelection}
          >
            Clear selection
          </button>
          <button className="sci-button" onClick={resetViews}>
            <ExplorerIcon name="reset" /> Reset view
          </button>
          <button
            className="sci-text-button sci-icon-button"
            aria-label="Interactions"
            title="Interaction settings and shortcuts"
            onClick={() => setPanel('options')}
          >
            <ExplorerIcon name="settings" />
          </button>
        </div>
        {filtered && (
          <div className="sci-filter-chips">
            {filters.sensors.length !== 3 && (
              <button
                onClick={() =>
                  setFilters((previous) => ({
                    ...previous,
                    sensors: [0, 1, 2],
                  }))
                }
              >
                Chambers: {filters.sensors.length} of 3{' '}
                <span aria-hidden="true">×</span>
                <span className="sci-sr-only"> Clear chamber filter</span>
              </button>
            )}
            {filters.anomalyOnly && (
              <button
                onClick={() =>
                  setFilters((previous) => ({
                    ...previous,
                    anomalyOnly: false,
                  }))
                }
              >
                Anomalies only <span aria-hidden="true">×</span>
                <span className="sci-sr-only"> Clear anomaly filter</span>
              </button>
            )}
            {activeViews.map((view) => (
              <button
                key={view}
                title={describeRanges(filters.views[view] ?? {})}
                onClick={() => removeFilter(view)}
              >
                {VIEW_LABELS[view]}:{' '}
                {filters.views[view]
                  ? describeRanges(filters.views[view]!)
                  : `${number.format(filters.selections?.[view]?.size ?? 0)} IDs`}{' '}
                <span aria-hidden="true">×</span>
                <span className="sci-sr-only"> Clear filter</span>
              </button>
            ))}
            <span>
              {crossFilter ? 'Showing matches' : 'Amber = selected readings'}
            </span>
          </div>
        )}
      </section>

      <div
        className="sci-query-status"
        role="status"
        data-testid="query-status"
        data-busy={busy}
      >
        {error ?? (busy ? 'Updating linked views…' : '')}
      </div>
      {result.summary.count === 0 && (
        <div className="sci-empty" role="status">
          <strong>No readings match this combination.</strong> Remove a filter
          or{' '}
          <button type="button" onClick={reset}>
            reset the experiment
          </button>
          .
        </div>
      )}

      {inspectorOpen && (
        <aside className="sci-event-dock" aria-label="Event inspector">
          <div className="sci-dock-heading">
            <strong>
              Event inspector <span>LIVE</span>
            </strong>
            <button
              className="sci-text-button sci-icon-button"
              aria-label="Close inspector"
              title="Close inspector"
              onClick={() => setInspectorOpen(false)}
            >
              <ExplorerIcon name="close" />
            </button>
          </div>
          <section
            className="sci-inspector"
            id="event-inspector"
            aria-labelledby="inspector-title"
          >
            <div className="sci-card-header">
              <div>
                <span className="sci-card-tag">INVERSION OF CONTROL</span>
                <h2 id="inspector-title">
                  Charts emit. The application decides.
                </h2>
                <p>
                  Interact with any chart while this panel is open. Chart events
                  feed client-data-view predicates in a worker; the app
                  publishes matching IDs and filtered data to the plots.
                </p>
              </div>
            </div>
            <div className="sci-event-flow">
              <span>
                01{' '}
                <strong>
                  {latestInteraction?.name ?? 'Select a chart region'}
                </strong>
                <small>
                  {latestInteraction
                    ? `${latestInteraction.source} · ${latestInteraction.detail}`
                    : 'Watch an interaction travel through the application.'}
                </small>
              </span>
              <span>
                02 <strong>client-data-view</strong>
                <small>
                  {busy
                    ? 'Evaluating predicates…'
                    : `${number.format(result.summary.count)} matching record IDs`}
                </small>
              </span>
              <span>
                03 <strong>plot.update</strong>
                <small>
                  {crossFilter
                    ? 'Filtered chart contexts + shared selection'
                    : 'Shared selection → visible linked views'}
                </small>
              </span>
            </div>
            <div className="sci-diagnostics">
              <span>
                Worker filter evaluations{' '}
                <strong data-testid="filter-duration">
                  {result.duration === null
                    ? '—'
                    : `${result.duration.toFixed(2)} ms`}
                </strong>
              </span>
              {visibleCharts.map((chart) => (
                <span key={chart.id}>
                  {chart.tag.split(' / ')[1]} render{' '}
                  <strong>{metrics[chart.id]?.toFixed(2) ?? '—'} ms</strong>
                </span>
              ))}
            </div>
            <p className="sci-diagnostics-note">
              Measured CPU durations for the latest operation, not GPU frame
              time or an end-to-end benchmark. {number.format(available)}{' '}
              arrived rows; filtered views show their own context counts.
            </p>
            <details className="sci-api-example">
              <summary>How the app connects the charts</summary>
              <pre>
                <code>{`plot.on('brushcommit', event => {
  // Translate the event into app-owned filters.
  updateFilters(event);
});
// Evaluate filters in a worker, then publish:
plot.update({ columns, selectedSourceIndices });`}</code>
              </pre>
            </details>
            <div className="sci-developer-links">
              <button
                className="sci-data-status"
                data-testid="experiment-storage"
                data-storage={dataset.storage}
                data-source={dataset.source}
                onClick={() => setPanel('data')}
              >
                {dataset.storage === 'memory'
                  ? 'Local · in memory'
                  : dataset.source === 'restored'
                    ? 'Loaded from this device'
                    : 'Generated & saved locally'}
              </button>
              <button
                className="sci-text-button"
                onClick={() => setPanel('records')}
              >
                Readings
              </button>
            </div>
            <ol className="sci-event-list" aria-label="Recent events">
              {events.map((event) => (
                <li key={event.id}>
                  <span title={event.time}>
                    #{event.id.toString().padStart(2, '0')}
                  </span>
                  <details>
                    <summary>
                      <code>{event.name}</code> <strong>{event.source}</strong>
                    </summary>
                    <p>{event.detail}</p>
                  </details>
                </li>
              ))}
            </ol>
            {!events.length && (
              <p className="sci-event-empty">
                Select a chart region or change a filter to see the event flow
                here.
              </p>
            )}
          </section>
        </aside>
      )}

      <div className={`sci-grid ${expanded ? 'sci-grid-expanded' : ''}`}>
        {visibleCharts.map((chart) => (
          <section
            key={chart.id}
            className={`sci-card sci-card-${chart.id} ${expanded === chart.id ? 'sci-expanded' : ''}`}
            aria-labelledby={`title-${chart.id}`}
          >
            <div className="sci-card-header">
              <div>
                <span className="sci-card-tag">
                  {chart.tag.split(' / ')[1]}
                </span>
                <h2 id={`title-${chart.id}`}>{chart.title}</h2>
              </div>
              <div className="sci-card-actions">
                {chart.id !== 'timeline' && (
                  <div
                    className="sci-tools sci-chart-types"
                    aria-label={
                      chart.id === comparison
                        ? 'Comparison chart'
                        : 'Distribution chart'
                    }
                  >
                    {(chart.id === comparison
                      ? ['scatter', 'parallel']
                      : ['histogram', 'density']
                    ).map((id) => (
                      <button
                        key={id}
                        aria-pressed={chart.id === id}
                        onClick={() => {
                          if (chart.id === id) return;
                          removeFilter(chart.id);
                          setChartMenu(null);
                          setExpanded(null);
                          if (chart.id === comparison)
                            setComparison(id as ViewId);
                          else setDistribution(id as ViewId);
                        }}
                      >
                        {id === 'parallel'
                          ? 'Parallel'
                          : id === 'density'
                            ? 'Density'
                            : id === 'histogram'
                              ? 'Histogram'
                              : 'Scatter'}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  className="sci-text-button sci-icon-button"
                  title="Chart options"
                  aria-label={`${chart.title} options`}
                  aria-expanded={chartMenu === chart.id}
                  onClick={() =>
                    setChartMenu(chartMenu === chart.id ? null : chart.id)
                  }
                >
                  <ExplorerIcon name="more" />
                </button>
                {chartMenu === chart.id && (
                  <div className="sci-chart-menu">
                    <button
                      className="sci-text-button"
                      aria-label={`Reset ${chart.title} zoom`}
                      onClick={() =>
                        setZoomReset((previous) => ({
                          ...previous,
                          [chart.id]: (previous[chart.id] ?? 0) + 1,
                        }))
                      }
                    >
                      Reset zoom
                    </button>
                    <Link
                      className="sci-text-button"
                      to={createThemeAwareTo(
                        chart.id === 'parallel'
                          ? '/m-parallel-webgpu'
                          : chart.id === 'histogram'
                            ? '/m-histogram-webgpu'
                            : '/m-scatter-webgpu',
                        location.search,
                        themeMode,
                      )}
                    >
                      Open full chart <ExplorerIcon name="arrow" />
                    </Link>
                    <button
                      className="sci-text-button"
                      aria-label={`Set ${VIEW_LABELS[chart.id]} ranges`}
                      onClick={() => setPanel(chart.id)}
                    >
                      Range
                    </button>
                    {(filters.views[chart.id] ||
                      filters.selections?.[chart.id]) && (
                      <button
                        className="sci-text-button"
                        aria-label={`Clear ${VIEW_LABELS[chart.id]} filter`}
                        onClick={() => removeFilter(chart.id)}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}
                <button
                  className="sci-text-button sci-icon-button sci-expand"
                  title={
                    expanded === chart.id ? 'Collapse chart' : 'Expand chart'
                  }
                  aria-label={`${expanded === chart.id ? 'Collapse' : 'Expand'} ${chart.title}`}
                  onClick={() => {
                    setChartMenu(null);
                    setExpanded(expanded === chart.id ? null : chart.id);
                  }}
                >
                  <ExplorerIcon
                    name={expanded === chart.id ? 'collapse' : 'expand'}
                  />
                </button>
              </div>
            </div>
            <ExplorerChart
              key={chart.id}
              kind={chart.id}
              tool={tool}
              wheelZoom={interactions.wheelZoom}
              suspended={
                panel !== null || (expanded !== null && expanded !== chart.id)
              }
              settingsReset={resetVersion}
              zoomReset={resetVersion + (zoomReset[chart.id] ?? 0)}
              onEvent={log}
              ownSelection={filters.selections?.[chart.id]}
              onSelection={onSelection}
              readings={result.contexts[chart.id]}
              selected={selected}
              filtered={result.filtered}
              ranges={filters.views[chart.id]}
              onBrush={onBrush}
              onMetrics={onMetrics}
            />
            <div className="sci-card-footer">
              <span>
                {chart.id === 'density'
                  ? 'Cell color = reading density'
                  : chart.id === 'parallel'
                    ? 'Each line is one reading'
                    : chart.id === 'histogram'
                      ? 'All readings counted in each bin'
                      : chart.id === 'scatter'
                        ? 'Shape & color = chamber · size = vibration'
                        : 'Color = chamber'}
                {chart.id === 'density' && (
                  <i
                    className="sci-density-scale"
                    aria-label="Viridis scale from low to high density"
                  />
                )}
              </span>
              <span>
                {number.format(result.contexts[chart.id].length)} shown
              </span>
            </div>
          </section>
        ))}
      </div>

      {panel === 'options' && (
        <ExplorerDialog title="Interactions" onClose={() => setPanel(null)}>
          <p className="sci-dialog-intro">
            Select highlights linked readings. Filter to selection narrows the
            other views. Hover always shows details.
          </p>
          <div className="sci-options-form">
            <label>
              <input
                type="checkbox"
                checked={interactions.wheelZoom}
                onChange={(event) =>
                  setInteractions((previous) => ({
                    ...previous,
                    wheelZoom: event.target.checked,
                  }))
                }
              />
              Mouse wheel shortcuts
            </label>
            <label>
              <input
                type="checkbox"
                checked={filters.anomalyOnly}
                onChange={(event) =>
                  setFilters((previous) => ({
                    ...previous,
                    anomalyOnly: event.target.checked,
                  }))
                }
              />
              Anomalies only
            </label>
          </div>
          <h3>Keyboard shortcuts</h3>
          <p className="sci-dialog-intro">
            Active when a chart has focus. Click a chart or use Tab to focus it.
          </p>
          <div className="sci-shortcut-settings">
            {(
              Object.keys(DEFAULT_SHORTCUTS) as (keyof ExplorerShortcuts)[]
            ).map((action) => (
              <label key={action}>
                {
                  {
                    select: 'Select mode',
                    zoom: 'Zoom mode',
                    clear: 'Clear selection',
                    reset: 'Reset view',
                  }[action]
                }
                <select
                  aria-label={`${action} shortcut`}
                  value={interactions.shortcuts[action]}
                  onChange={(event) =>
                    setInteractions((previous) => ({
                      ...previous,
                      shortcuts: {
                        ...previous.shortcuts,
                        [action]: event.target.value,
                      },
                    }))
                  }
                >
                  {SHORTCUT_KEYS.map((key) => (
                    <option
                      key={key}
                      value={key}
                      disabled={Object.entries(interactions.shortcuts).some(
                        ([name, value]) => name !== action && value === key,
                      )}
                    >
                      {key === 'Escape' ? 'Esc' : key.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <details className="sci-gesture-help">
            <summary>More mouse & keyboard gestures</summary>
            <dl className="sci-cheatsheet">
              <div>
                <dt>Left drag</dt>
                <dd>
                  Select a region or zoom, according to the toolbar. On parallel
                  coordinates, drag along an axis.
                </dd>
              </div>
              <div>
                <dt>Middle drag</dt>
                <dd>Pan the chart; on parallel coordinates, pan an axis.</dd>
              </div>
              <div>
                <dt>Right drag</dt>
                <dd>
                  Rectangle selection in point and histogram views. Hold Space
                  for a freehand lasso; Ctrl adds to the selection. Shift +
                  right drag measures.
                </dd>
              </div>
              <div>
                <dt>Mouse wheel</dt>
                <dd>
                  In point and histogram views: Alt + scroll zooms X, Shift +
                  scroll zooms Y, Ctrl + scroll zooms both. Plain scroll adjusts
                  point size or bin size.
                </dd>
              </div>
              <div>
                <dt>Q</dt>
                <dd>Undo zoom in point, density, and histogram views.</dd>
              </div>
            </dl>
          </details>
          <button
            className="sci-button"
            onClick={() => {
              setInteractions({
                shortcuts: { ...DEFAULT_SHORTCUTS },
                wheelZoom: true,
              });
              setTool('select');
            }}
          >
            Reset interaction defaults
          </button>
        </ExplorerDialog>
      )}
      {panel === 'data' && (
        <ExplorerDialog title="Experiment data" onClose={() => setPanel(null)}>
          <p>
            The {number.format(readings.length)} synthetic readings are
            generated on your device. Every plot uses the same experiment; no
            dataset is downloaded or generated on a server.
          </p>
          <p role="status">
            {dataset.storage === 'indexeddb'
              ? 'Saved in this browser’s IndexedDB and reused on your next visit.'
              : size > 12000
                ? 'Larger experiments stay in memory to keep browser storage small.'
                : 'Browser storage is unavailable or full. The experiment works in memory and will be generated again on your next visit.'}
          </p>
          <p>
            Saved data stays in this browser, for this site. Clearing site data
            removes it. This saves the experiment readings, not your current
            filters or zoom.
          </p>
          <p>
            Regeneration recreates the same reproducible experiment and resets
            the current view.
          </p>
          <button className="sci-button" onClick={onRegenerate}>
            Regenerate on this device
          </button>
        </ExplorerDialog>
      )}
      {panel === 'records' && (
        <ExplorerDialog
          title="Matching readings"
          onClose={() => setPanel(null)}
        >
          <section
            className="sci-records sci-card"
            aria-labelledby="matching-readings-title"
          >
            <div className="sci-card-header">
              <div>
                <span className="sci-card-tag">THE SHARED COHORT</span>
                <h2 id="matching-readings-title">
                  The readings behind the selection
                </h2>
                <p>Every view resolves to the same experiment record IDs.</p>
              </div>
              <span className="sci-record-count">
                First {Math.min(6, result.summary.count)} of{' '}
                {number.format(result.summary.count)}
              </span>
            </div>
            <div className="sci-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Reading ID</th>
                    <th>Chamber</th>
                    <th>Time / min</th>
                    <th>Temp / °C</th>
                    <th>Pressure / kPa</th>
                    <th>Vibration / mm/s</th>
                    <th>Observation</th>
                  </tr>
                </thead>
                <tbody>
                  {result.matches.slice(0, 6).map((row) => (
                    <tr key={row.id}>
                      <td>
                        <code>{row.id}</code>
                      </td>
                      <td>
                        <span
                          className="sci-table-dot"
                          style={{ background: SENSOR_COLORS[row.sensor] }}
                        />
                        {SENSOR_NAMES[row.sensor]}
                      </td>
                      <td>{row.time.toFixed(1)}</td>
                      <td>{row.temperature.toFixed(1)}</td>
                      <td>{row.pressure.toFixed(1)}</td>
                      <td>{row.vibration.toFixed(2)}</td>
                      <td>
                        <span
                          className={`sci-observation ${row.anomaly ? 'is-anomaly' : ''}`}
                        >
                          {row.anomaly === 'heat'
                            ? 'Heat excursion'
                            : row.anomaly === 'drift'
                              ? 'Pressure drift'
                              : 'Normal cycle'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!result.summary.count && (
                <p className="sci-table-empty">
                  No matching records. Your filters remain available above.
                </p>
              )}
            </div>
          </section>
        </ExplorerDialog>
      )}
      {panel === 'help' && (
        <ExplorerDialog title="How to explore" onClose={() => setPanel(null)}>
          <p className="sci-dialog-intro">
            Explore a synthetic experiment across three connected charts. Try a
            heat spike below, or make your own selection.
          </p>
          <dl className="sci-cheatsheet">
            <div>
              <dt>Drag to select</dt>
              <dd>
                Drag a region to highlight the same readings across charts.
                Choose Filter to selection to narrow the other views. Clear
                selection restores all readings.
              </dd>
            </div>
            <div>
              <dt>Hover for details</dt>
              <dd>Move over a point, bar, cell or line to inspect it.</dd>
            </div>
            <div>
              <dt>Explore further</dt>
              <dd>
                Switch the lower charts to try parallel coordinates or a density
                heatmap. Use the expand button for a larger chart and the
                options menu for precise ranges. Select or Zoom sets the
                left-drag action. Interactions contains shortcuts and
                preferences.
              </dd>
            </div>
            <div>
              <dt>Start again</dt>
              <dd>
                Remove a filter chip to undo it. Reset all restores the starting
                data, chart choices, filters and zoom, and pauses live replay.
                Your current experience and theme stay selected.
              </dd>
            </div>
            <div>
              <dt>See what powers it</dt>
              <dd>
                Large dataset shows up to 1.2 million readings. Live data
                replays arriving batches. For developers reveals the event flow,
                worker timings and API example while you interact.
              </dd>
            </div>
          </dl>
          <div className="sci-scenarios">
            <span>Start with a signal</span>
            <button
              onClick={() => {
                preset('heat');
                setPanel(null);
              }}
            >
              Heat excursion 48–66 min <ExplorerIcon name="arrow" />
            </button>
            <button
              onClick={() => {
                preset('drift');
                setPanel(null);
              }}
            >
              Pressure drift 88–120 min <ExplorerIcon name="arrow" />
            </button>
          </div>
        </ExplorerDialog>
      )}
      {CHARTS.filter((chart) => chart.id === panel).map((chart) => (
        <ExplorerDialog
          key={chart.id}
          title={`${chart.title} · precise ranges`}
          onClose={() => setPanel(null)}
        >
          <p className="sci-dialog-intro">
            Set bounds to filter every view. Filters from different charts
            intersect.
          </p>
          <RangeControls
            axes={chart.axes}
            ranges={filters.views[chart.id]}
            onApply={(ranges) => {
              onBrush(chart.id, ranges, 'range.apply');
              setPanel(null);
            }}
          />
        </ExplorerDialog>
      ))}

      <footer className="sci-footer">
        <section
          className="sci-status-summary"
          aria-label="Filtered experiment statistics"
          aria-live="polite"
        >
          <span>
            <strong data-testid="matching-count">
              {number.format(result.summary.count)}
            </strong>{' '}
            {filtered ? 'selected' : 'readings'}
            <span className="sci-context-status">
              {' '}
              ·{' '}
              {filtered
                ? crossFilter
                  ? 'filtered views'
                  : 'full context'
                : 'linked charts'}
            </span>
          </span>
          <span
            className="sci-performance"
            title="Client-side query CPU time, excluding rendering"
          >
            {result.duration === null ? '—' : result.duration.toFixed(1)} ms{' '}
            <span className="sci-cpu-label">query</span>
          </span>
        </section>
        {experience !== 'live' ? (
          <div className="sci-footer-actions">
            <span>Try a signal</span>
            <button onClick={() => preset('heat')}>
              Heat spike <ExplorerIcon name="arrow" />
            </button>
            <button onClick={() => preset('drift')}>
              Pressure drift <ExplorerIcon name="arrow" />
            </button>
          </div>
        ) : (
          <span>Local replay loops automatically · pause to explore.</span>
        )}
      </footer>
    </main>
  );
}

function RangeControls({
  axes,
  ranges,
  onApply,
}: {
  axes: Dimension[];
  ranges?: Ranges;
  onApply: (ranges: Ranges) => void;
}) {
  return (
    <form
      className="sci-range-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const next: Ranges = {};
        axes.forEach((axis) => {
          const min = Number(data.get(`${axis}-min`));
          const max = Number(data.get(`${axis}-max`));
          next[axis] = [{ min: Math.min(min, max), max: Math.max(min, max) }];
        });
        // Keep keyboard focus on the persistent disclosure when the form resets.
        event.currentTarget
          .closest('details')
          ?.querySelector('summary')
          ?.focus();
        onApply(next);
      }}
    >
      {axes.map((axis) => {
        const dimension =
          axis === 'time'
            ? { label: 'Time', unit: 'min', min: 0, max: 120 }
            : DIMENSIONS.find((d) => d.key === axis)!;
        return (
          <fieldset key={axis}>
            <legend>
              {dimension.label} · {dimension.unit}
            </legend>
            <RangeLabel label="From">
              <input
                type="number"
                name={`${axis}-min`}
                aria-label={`${dimension.label} minimum`}
                required
                step="any"
                min={dimension.min}
                max={dimension.max}
                defaultValue={ranges?.[axis]?.[0]?.min ?? dimension.min}
              />
            </RangeLabel>
            <RangeLabel label="To">
              <input
                type="number"
                name={`${axis}-max`}
                aria-label={`${dimension.label} maximum`}
                required
                step="any"
                min={dimension.min}
                max={dimension.max}
                defaultValue={ranges?.[axis]?.[0]?.max ?? dimension.max}
              />
            </RangeLabel>
          </fieldset>
        );
      })}
      <button className="sci-button sci-button-primary" type="submit">
        Apply range
      </button>
    </form>
  );
}
function RangeLabel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}

function ExplorerDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      trigger?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="sci-dialog"
      aria-label={title}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sci-dialog-body">
        <header className="sci-dialog-header">
          <h2>{title}</h2>
          <button
            className="sci-button"
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            Close <ExplorerIcon name="close" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
