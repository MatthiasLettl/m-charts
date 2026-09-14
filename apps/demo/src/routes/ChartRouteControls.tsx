import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  chartTarget,
  readRendererPreference,
  resolveDemoRenderer,
  saveRendererPreference,
  type ChartFamily,
  type RendererPreference,
} from '../state/chartNavigation.ts';

export function ChartRouteControls() {
  const location = useLocation();
  const match = /^\/m-(scatter|histogram|parallel)(-webgpu)?$/.exec(
    location.pathname,
  );
  const [switching, setSwitching] = useState(false);
  if (!match) return null;
  const family = match[1] as ChartFamily;
  const renderer = match[2] ? 'webgpu' : 'webgl2';
  const params = new URLSearchParams(location.search);
  const changeRenderer = async (value: RendererPreference) => {
    setSwitching(true);
    saveRendererPreference(value);
    const next = await resolveDemoRenderer(value);
    if (next === renderer) {
      setSwitching(false);
      return;
    }
    window.location.assign(chartTarget(family, next, location.search));
  };
  const changeData = (key: string, value: string) => {
    const next = new URLSearchParams(location.search);
    next.delete('routeNotice');
    if (value === 'single' || value === 'histogram') next.delete(key);
    else next.set(key, value);
    window.location.assign(`${location.pathname}?${next}`);
  };
  return (
    <div className="chart-route-controls">
      <label>
        Renderer
        <select
          aria-label="Renderer"
          disabled={switching}
          value={renderer}
          onChange={(event) =>
            void changeRenderer(event.target.value as RendererPreference)
          }
        >
          <option value="auto">Auto (best available)</option>
          <option value="webgpu">WebGPU</option>
          <option value="webgl2">WebGL2</option>
        </select>
      </label>
      <small>
        {switching
          ? 'Opening renderer…'
          : `Using ${renderer === 'webgpu' ? 'WebGPU' : 'WebGL2'}${readRendererPreference() === 'auto' ? ' · Auto' : ''}`}
      </small>
      {params.get('routeNotice') === 'stream-unavailable' && (
        <p role="status" className="compact-note">
          Streaming is available with WebGPU. Showing static data in WebGL2.
        </p>
      )}
      {renderer === 'webgl2' && (
        <>
          <label>
            Data mode
            <select
              aria-label="Data mode"
              value={params.get('tables') === 'multi' ? 'multi' : 'single'}
              disabled={params.get('histMode') === 'bar'}
              onChange={(event) => changeData('tables', event.target.value)}
            >
              <option value="single">Single table</option>
              <option value="multi">Multiple tables</option>
            </select>
          </label>
          {family === 'histogram' && (
            <label>
              Input mode
              <select
                aria-label="Input mode"
                value={params.get('histMode') === 'bar' ? 'bar' : 'histogram'}
                onChange={(event) => changeData('histMode', event.target.value)}
              >
                <option value="histogram">Raw records</option>
                <option value="bar">Pre-aggregated bars</option>
              </select>
            </label>
          )}
        </>
      )}
    </div>
  );
}
