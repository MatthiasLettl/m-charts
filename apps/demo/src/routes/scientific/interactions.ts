export type ExplorerTool = 'select' | 'zoom';
export const DEFAULT_SHORTCUTS = {
  select: 's',
  zoom: 'z',
  clear: 'Escape',
  reset: 'r',
};
export type ExplorerShortcuts = typeof DEFAULT_SHORTCUTS;
export const SHORTCUT_KEYS = ['s', 'z', 'c', 'r', 'Escape'] as const;
export function readExplorerInteractions() {
  const defaults = { shortcuts: { ...DEFAULT_SHORTCUTS }, wheelZoom: true };
  try {
    const value = JSON.parse(
      localStorage.getItem('m-charts.explorer.interactions') ?? 'null',
    );
    if (!value || typeof value.wheelZoom !== 'boolean') return defaults;
    const keys = Object.keys(DEFAULT_SHORTCUTS) as (keyof ExplorerShortcuts)[];
    if (
      !keys.every((key) => SHORTCUT_KEYS.includes(value.shortcuts?.[key])) ||
      new Set(keys.map((key) => value.shortcuts[key])).size !== keys.length
    )
      return defaults;
    return {
      shortcuts: value.shortcuts as ExplorerShortcuts,
      wheelZoom: value.wheelZoom as boolean,
    };
  } catch {
    return defaults;
  }
}
