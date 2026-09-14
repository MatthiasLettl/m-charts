export type DemoRenderer = 'webgpu' | 'webgl2';
export type RendererPreference = DemoRenderer | 'auto';
export type ChartFamily = 'scatter' | 'histogram' | 'parallel';
const preferenceKey = 'm-charts.demo.renderer';

export function readRendererPreference(): RendererPreference {
  try {
    const value = localStorage.getItem(preferenceKey);
    return value === 'webgpu' || value === 'webgl2' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveRendererPreference(value: RendererPreference) {
  try {
    localStorage.setItem(preferenceKey, value);
  } catch {
    /* Storage is optional. */
  }
}

let automaticRenderer: Promise<DemoRenderer> | undefined;
export function resolveDemoRenderer(
  preference: RendererPreference,
): Promise<DemoRenderer> {
  if (preference !== 'auto') return Promise.resolve(preference);
  return (automaticRenderer ??= (async () => {
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) return 'webgl2';
      const device = await adapter.requestDevice();
      device.destroy();
      return 'webgpu';
    } catch {
      return 'webgl2';
    }
  })());
}

/** Backend changes navigate existing routes; carry only portable demo settings. */
export function chartTarget(
  family: ChartFamily,
  renderer: DemoRenderer,
  search = '',
): string {
  const previous = new URLSearchParams(search);
  const params = new URLSearchParams();
  for (const key of ['theme', 'tables', 'histMode', 'mode', 'axis']) {
    const value = previous.get(key);
    if (value !== null && (key !== 'histMode' || family === 'histogram'))
      params.set(key, value);
  }
  if (renderer === 'webgpu') {
    params.set('points', previous.get('points') ?? '1000000');
    if (previous.has('webgpuData'))
      params.set('webgpuData', previous.get('webgpuData')!);
  } else if (previous.get('webgpuData')?.startsWith('stream-')) {
    params.set('routeNotice', 'stream-unavailable');
  }
  return `/m-${family}${renderer === 'webgpu' ? '-webgpu' : ''}${params.size ? `?${params}` : ''}`;
}
