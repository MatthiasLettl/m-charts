import { useThemeMode } from './ThemeModeProvider.tsx';

export function ThemeModeSwitch() {
  const { setThemeMode, themeMode } = useThemeMode();
  const nextMode = themeMode === 'dark' ? 'light' : 'dark';

  return (
    <button
      aria-label={`Switch to ${nextMode} mode`}
      aria-pressed={themeMode === 'dark'}
      className="theme-mode-switch"
      data-testid="theme-mode-switch"
      onClick={() => setThemeMode(nextMode)}
      type="button"
    >
      {themeMode === 'dark' ? 'Dark' : 'Light'}
    </button>
  );
}
