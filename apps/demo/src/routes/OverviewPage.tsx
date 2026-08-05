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
  const mScatterWebgpuTarget = createThemeAwareTo(
    '/m-scatter-webgpu',
    appendSearchParam(location.search, 'points', '1000000'),
    themeMode,
    { preserveKeys: ['points'] },
  );
  const mScatterWebgpuMultiTarget = createThemeAwareTo(
    '/m-scatter-webgpu',
    appendSearchParams(location.search, {
      points: '1000000',
      tables: 'multi',
    }),
    themeMode,
    { preserveKeys: ['points', 'tables'] },
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
  const mParallelWebgpuTarget = createThemeAwareTo(
    '/m-parallel-webgpu',
    appendSearchParam(location.search, 'points', '1000000'),
    themeMode,
    { preserveKeys: ['points'] },
  );
  const mParallelWebgpuMultiTarget = createThemeAwareTo(
    '/m-parallel-webgpu',
    appendSearchParams(location.search, {
      points: '1000000',
      tables: 'multi',
    }),
    themeMode,
    { preserveKeys: ['points', 'tables'] },
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
  const mHistogramWebgpuTarget = createThemeAwareTo(
    '/m-histogram-webgpu',
    appendSearchParam(location.search, 'points', '1000000'),
    themeMode,
    { preserveKeys: ['points'] },
  );
  const mHistogramWebgpuMultiTarget = createThemeAwareTo(
    '/m-histogram-webgpu',
    appendSearchParams(location.search, { points: '1000000', tables: 'multi' }),
    themeMode,
    { preserveKeys: ['points', 'tables'] },
  );
  const mHistogramWebgpuBarTarget = createThemeAwareTo(
    '/m-histogram-webgpu',
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
              WebGL2 and WebGPU charts for fast, interactive exploration of large datasets.
            </h1>
          </div>
          <ThemeModeSwitch />
        </div>
        <div className="overview-intro">
          <p>
            m-charts combines WebGL2 and WebGPU rendering with Rust/WASM
            aggregation for high-performance data exploration in the browser.
            This demo covers scatter plots, histograms, and parallel coordinates
            across datasets of up to 25 million records, with responsive zoom,
            pan, brushing, selection, measurement, and inspection.
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
              <span className="prototype-card-title">m-scatter WebGL2</span>
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
          <article className="prototype-card">
            <ScatterPreview variant="fast" />
            <span className="prototype-card-body">
              <span className="prototype-card-title">m-scatter WebGPU</span>
              <span className="prototype-card-copy">
                Explore up to 25 million points with WebGL2-compatible
                interactions. Dense views render up to one million
                representatives per subplot, while selection stays exact and
                zoom restores full detail.
              </span>
              <span className="prototype-card-actions">
                <Link to={mScatterWebgpuTarget}>One table</Link>
                <Link to={mScatterWebgpuMultiTarget}>Multiple tables</Link>
              </span>
            </span>
          </article>
          <article
            className="prototype-card"
          >
            <HistogramPreview />
            <span className="prototype-card-body">
              <span className="prototype-card-title">m-histogram WebGL2</span>
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
          <article className="prototype-card">
            <HistogramPreview />
            <span className="prototype-card-body">
              <span className="prototype-card-title">m-histogram WebGPU</span>
              <span className="prototype-card-copy">
                Explore distributions across up to 25 million records with
                WebGL2-compatible interactions. Rust/WASM aggregates every
                record by default, while WebGPU renders every resulting bin
                without sampling.
              </span>
              <span className="prototype-card-actions">
                <Link to={mHistogramWebgpuTarget}>One table</Link>
                <Link to={mHistogramWebgpuMultiTarget}>Multiple tables</Link>
                <Link to={mHistogramWebgpuBarTarget}>Pre-aggregated bars</Link>
              </span>
            </span>
          </article>
          <article
            className="prototype-card"
          >
            <ParallelPreview variant="fast" />
            <span className="prototype-card-body">
              <span className="prototype-card-title">m-parallel WebGL2</span>
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
          <article className="prototype-card">
            <ParallelPreview variant="fast" />
            <span className="prototype-card-body">
              <span className="prototype-card-title">m-parallel WebGPU</span>
              <span className="prototype-card-copy">
                Explore up to 25 million rows with WebGL2-compatible
                interactions. WebGPU computes pairwise density over every
                record, while Rust/WASM-backed selection stays exact and axis
                zoom restores raw-detail lines.
              </span>
              <span className="prototype-card-actions">
                <Link to={mParallelWebgpuTarget}>One table</Link>
                <Link to={mParallelWebgpuMultiTarget}>Multiple tables</Link>
              </span>
            </span>
          </article>
        </div>
      </section>
    </main>
  );
}

function appendSearchParam(search: string, key: string, value: string): string {
  return appendSearchParams(search, { [key]: value });
}

function appendSearchParams(
  search: string,
  values: Readonly<Record<string, string>>,
): string {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(values)) {
    params.set(key, value);
  }
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
