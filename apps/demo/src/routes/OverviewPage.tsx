import { useEffect, useState, type CSSProperties } from 'react';
import { chartTarget, readRendererPreference, resolveDemoRenderer, type DemoRenderer } from '../state/chartNavigation.ts';
import { Link, useLocation } from 'react-router-dom';
import { createThemeAwareTo } from '../state/themeMode.ts';
import { ThemeModeSwitch } from '../theme/ThemeModeSwitch.tsx';
import { useThemeMode } from '../theme/ThemeModeProvider.tsx';

export function OverviewPage() {
  const location = useLocation();
  const { themeMode } = useThemeMode();
  const [renderer, setRenderer] = useState<DemoRenderer>('webgpu');
  useEffect(() => {
    let active = true;
    void resolveDemoRenderer(readRendererPreference()).then((next) => {
      if (active) setRenderer(next);
    });
    return () => { active = false; };
  }, []);
  const themeSearch = themeMode === 'dark' ? '?theme=dark' : '';

  return (
    <main className="overview-shell" aria-labelledby="overview-title">
      <section className="overview-panel">
        <div className="overview-heading">
          <div>
            <p className="overview-kicker">m-charts demo app</p>
            <h1 id="overview-title">Interactive charts for large datasets.</h1>
          </div>
          <ThemeModeSwitch />
        </div>
        <div className="overview-intro">
          <p>
            Explore up to 25 million records with WebGPU, WebGL2, and Rust/WASM.
            Start with a complete application or dive into an individual chart.
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
        <section
          className="overview-showcases"
          aria-labelledby="showcases-title"
        >
          <div className="overview-section-heading">
            <h2 id="showcases-title">Charts in context</h2>
          </div>
          <Link
            className="overview-showcase"
            to={createThemeAwareTo(
              '/scientific-explorer',
              location.search,
              themeMode,
            )}
          >
            <div className="overview-lab-preview" aria-hidden="true">
              <span>THE LINKED LAB</span>
              <svg viewBox="0 0 440 130">
                <path d="M0 90 Q35 20 70 74 T140 70 T210 74 T280 68 T350 72 T440 65" />
                <path d="M0 100 Q35 35 70 84 T140 80 Q175 10 200 40 T250 84 T320 80 T390 80 T440 80" />
                <path d="M0 110 Q35 50 70 94 T140 94 T210 94 T280 94 Q350 85 440 22" />
                <rect x="175" y="5" width="75" height="120" />
              </svg>
              <div>
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            <div className="overview-showcase-copy">
              <span className="overview-showcase-badge">WEBGPU · WASM</span>
              <h3>Scientific data explorer</h3>
              <p>
                Select a signal. See the connections. Explore a million readings
                or watch them arrive live.
              </p>
              <span className="overview-showcase-meta">
                Linked charts · 1.2M readings · Live replay
              </span>
              <strong>
                Open dashboard <span aria-hidden="true">→</span>
              </strong>
            </div>
          </Link>
        </section>
        <div className="overview-section-heading">
          <h2>Explore the charts</h2>
          <p>Choose a chart. Explore data, rendering, and interactions inside.</p>
        </div>
        <div className="prototype-card-grid overview-reference-grid">
          <Link className="prototype-card overview-chart-link" aria-label="Open scatter" to={chartTarget('scatter', renderer, themeSearch)}>
            <ScatterPreview variant="fast" />
            <div className="prototype-card-body">
              <h3 className="prototype-card-title">Scatter</h3>
              <p className="prototype-card-copy">
                Points, bubbles, and density maps. Zoom, select, and inspect
                large datasets.
              </p>
              <div className="overview-capabilities"><span>WebGPU · WASM</span><span>WebGL2</span></div>
              <span className="overview-open">Open scatter <span aria-hidden="true">→</span></span>
            </div>
          </Link>
          <Link className="prototype-card overview-chart-link" aria-label="Open histogram" to={chartTarget('histogram', renderer, themeSearch)}>
            <HistogramPreview />
            <div className="prototype-card-body">
              <h3 className="prototype-card-title">Histogram</h3>
              <p className="prototype-card-copy">
                Distributions from raw records or aggregated bars. Every record
                counts.
              </p>
              <div className="overview-capabilities"><span>WebGPU · WASM</span><span>WebGL2</span></div>
              <span className="overview-open">Open histogram <span aria-hidden="true">→</span></span>
            </div>
          </Link>
          <Link className="prototype-card overview-chart-link" aria-label="Open parallel coordinates" to={chartTarget('parallel', renderer, themeSearch)}>
            <ParallelPreview variant="fast" />
            <div className="prototype-card-body">
              <h3 className="prototype-card-title">Parallel coordinates</h3>
              <p className="prototype-card-copy">
                Compare records across dimensions with axis brushing and exact
                selection.
              </p>
              <div className="overview-capabilities"><span>WebGPU · WASM</span><span>WebGL2</span></div>
              <span className="overview-open">Open parallel coordinates <span aria-hidden="true">→</span></span>
            </div>
          </Link>
        </div>
      </section>
    </main>
  );
}

function ScatterPreview({
  variant = 'native',
}: {
  variant?: 'fast' | 'native';
}) {
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
          style={
            {
              '--preview-x': `${8 + ((index * 17) % 86)}%`,
              '--preview-y': `${12 + ((index * 29) % 72)}%`,
              '--preview-size': `${3 + (index % 4)}px`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

function ParallelPreview({
  variant = 'native',
}: {
  variant?: 'fast' | 'native';
}) {
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
          <line
            className="preview-axis"
            key={x}
            x1={x}
            x2={x}
            y1="10"
            y2="70"
          />
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
