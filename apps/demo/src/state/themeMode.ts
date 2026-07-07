export const THEME_MODE_OPTIONS = ['light', 'dark'] as const;

export type ThemeMode = (typeof THEME_MODE_OPTIONS)[number];

export const DEFAULT_THEME_MODE: ThemeMode = 'light';
export const THEME_PARAM_NAME = 'theme';
const SCATTER_ROUTE_SEARCH_KEYS = [
  'mode',
  'axis',
  'xMin',
  'xMax',
  'aMin',
  'aMax',
  'bMin',
  'bMax',
  'cMin',
  'cMax',
] as const;

interface CreateThemeAwareToOptions {
  preserveKeys?: readonly string[];
}

export function parseThemeMode(params: URLSearchParams): ThemeMode {
  const value = params.get(THEME_PARAM_NAME);

  return isThemeMode(value) ? value : DEFAULT_THEME_MODE;
}

export function writeThemeMode(
  params: URLSearchParams,
  mode: ThemeMode,
): URLSearchParams {
  const nextParams = new URLSearchParams(params);

  if (mode === DEFAULT_THEME_MODE) {
    nextParams.delete(THEME_PARAM_NAME);
  } else {
    nextParams.set(THEME_PARAM_NAME, mode);
  }

  return nextParams;
}

export function createThemeAwareTo(
  path: string,
  currentSearch: string | URLSearchParams,
  mode: ThemeMode,
  options: CreateThemeAwareToOptions = {},
): string {
  const currentParams =
    typeof currentSearch === 'string'
      ? new URLSearchParams(currentSearch)
      : new URLSearchParams(currentSearch);
  const params = new URLSearchParams();
  const preserveKeys = new Set<string>([
    ...getDefaultSearchKeys(path),
    ...(options.preserveKeys ?? []),
  ]);

  for (const key of preserveKeys) {
    const values = currentParams.getAll(key);

    for (const value of values) {
      params.append(key, value);
    }
  }

  const search = writeThemeMode(params, mode).toString();

  return search === '' ? path : `${path}?${search}`;
}

export function isThemeMode(value: string | null): value is ThemeMode {
  return THEME_MODE_OPTIONS.includes(value as ThemeMode);
}

function getDefaultSearchKeys(path: string): readonly string[] {
  if (path === '/m-scatter') {
    return SCATTER_ROUTE_SEARCH_KEYS;
  }

  return [];
}
