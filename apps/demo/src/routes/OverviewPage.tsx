import type { CSSProperties } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createThemeAwareTo } from '../state/themeMode.ts';
import { ThemeModeSwitch } from '../theme/ThemeModeSwitch.tsx';
import { useThemeMode } from '../theme/ThemeModeProvider.tsx';

export function OverviewPage() {
  const location = useLocation();
  const { themeMode } = useThemeMode();
  const mScatterTarget = createThemeAwareTo(
    '/m-scatter',
    location.search,
    themeMode,
  );
  const mScatterMultiTarget = createThemeAwareTo(
    '/m-scatter',
    appendSearchParam(location.search, 'tables', 'multi'),
    themeMode,
    { preserveKeys: ['tables'] },
  );
  const mParallelTarget = createThemeAwareTo(
    '/m-parallel',
    location.search,
    themeMode,
  );
  const mParallelMultiTarget = createThemeAwareTo(
    '/m-parallel',
    appendSearchParam(location.search, 'tables', 'multi'),
    themeMode,
    { preserveKeys: ['tables'] },
  );
  const mHistogramTarget = createThemeAwareTo(
    '/m-histogram',
    location.search,
    themeMode,
  );
  const mHistogramMultiTarget = createThemeAwareTo(
    '/m-histogram',
    appendSearchParam(location.search, 'tables', 'multi'),
    themeMode,
    { preserveKeys: ['tables'] },
  );
  const mHistogramBarTarget = createThemeAwareTo(
    '/m-histogram',
    appendSearchParam(location.search, 'histMode', 'bar'),
    themeMode,
    { preserveKeys: ['histMode'] },
  );

  return (
    <main className="overview-shell" aria-labelledby="overview-title">
      <section className="overview-panel">
        <div className="overview-heading">
          <div>
            <p className="overview-kicker">m-charts demo app</p>
            <h1 id="overview-title">
              WebGL2 charts for fast, interactive exploration of large datasets.
            </h1>
          </div>
          <ThemeModeSwitch />
        </div>
        <div className="overview-intro">
          <p>
            m-charts is a WebGL2 charting library built for high-performance
            data exploration in the browser. This demo showcases million-point
            scatter plots, histograms, and parallel-coordinate views with
            responsive zoom, pan, brushing, selection, measurement, and
            inspection workflows.
          </p>
          <p>
            The library is open source under the MIT license. Repository:{' '}
            <a
              href="https://github.com/MatthiasLettl/m-charts"
              rel="noreferrer"
              target="_blank"
            >
              MatthiasLettl/m-charts
            </a>
            .
          </p>
        </div>
        <div className="prototype-card-grid">
          <article
            className="prototype-card"
          >
            <ScatterPreview variant="fast" />
            <span className="prototype-card-body">
              <span className="prototype-card-title">m-scatter</span>
              <span className="prototype-card-copy">
                Explore million-point scatter plots with zoom, pan, lasso,
                measurement, point, bubble, and heat-map views.
              </span>
              <span className="prototype-card-actions">
                <Link to={mScatterTarget}>One table</Link>
                <Link to={mScatterMultiTarget}>Multiple tables</Link>
              </span>
            </span>
          </article>
          <article
            className="prototype-card"
          >
            <ParallelPreview variant="fast" />
            <span className="prototype-card-body">
              <span className="prototype-card-title">m-parallel</span>
              <span className="prototype-card-copy">
                Compare many records across axes with brushing, hover
                inspection, selection export, and adjustable line density.
              </span>
              <span className="prototype-card-actions">
                <Link to={mParallelTarget}>One table</Link>
                <Link to={mParallelMultiTarget}>Multiple tables</Link>
              </span>
            </span>
          </article>
          <article
            className="prototype-card"
          >
            <HistogramPreview />
            <span className="prototype-card-body">
              <span className="prototype-card-title">m-histogram</span>
              <span className="prototype-card-copy">
                Inspect distributions from raw records, multiple tables, or
                pre-aggregated bars with selection and bin-size controls.
              </span>
              <span className="prototype-card-actions">
                <Link to={mHistogramTarget}>One table</Link>
                <Link to={mHistogramMultiTarget}>Multiple tables</Link>
                <Link to={mHistogramBarTarget}>Pre-aggregated bars</Link>
              </span>
            </span>
          </article>
        </div>
      </section>
    </main>
  );
}

function appendSearchParam(search: string, key: string, value: string): string {
  const params = new URLSearchParams(search);
  params.set(key, value);
  const serialized = params.toString();
  return serialized === '' ? '' : `?${serialized}`;
}

function ScatterPreview({ variant = 'native' }: { variant?: 'fast' | 'native' }) {
  return (
    <span
      className="preview preview-scatter"
      data-variant={variant}
      aria-hidden="true"
    >
      {Array.from({ length: 42 }, (_, index) => (
        <span
          className="preview-point"
          key={index}
          style={{
            '--preview-x': `${8 + ((index * 17) % 86)}%`,
            '--preview-y': `${12 + ((index * 29) % 72)}%`,
            '--preview-size': `${3 + (index % 4)}px`,
          } as CSSProperties}
        />
      ))}
    </span>
  );
}

function ParallelPreview({ variant = 'native' }: { variant?: 'fast' | 'native' }) {
  const paths = [
    '8,56 28,24 48,42 68,18 92,35',
    '8,22 28,48 48,26 68,52 92,16',
    '8,38 28,34 48,58 68,30 92,50',
    '8,66 28,56 48,32 68,62 92,28',
    '8,30 28,18 48,50 68,40 92,64',
  ];

  return (
    <span
      className="preview preview-parallel"
      data-variant={variant}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 80" role="img">
        {[8, 28, 48, 68, 92].map((x) => (
          <line className="preview-axis" key={x} x1={x} x2={x} y1="10" y2="70" />
        ))}
        {paths.map((points) => (
          <polyline className="preview-line" key={points} points={points} />
        ))}
      </svg>
    </span>
  );
}

function HistogramPreview() {
  const bars = [34, 52, 73, 60, 88, 66, 42, 25, 46, 70, 58, 31];

  return (
    <span className="preview preview-histogram" aria-hidden="true">
      <span className="preview-histogram-bars">
        {bars.map((height, index) => (
          <span
            className="preview-histogram-bar"
            key={`${index}-${height}`}
            style={{ '--preview-height': `${height}%` } as CSSProperties}
          />
        ))}
      </span>
    </span>
  );
}
