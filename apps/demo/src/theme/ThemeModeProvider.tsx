import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  parseThemeMode,
  writeThemeMode,
  type ThemeMode,
} from '../state/themeMode.ts';

interface ThemeModeContextValue {
  setThemeMode: (mode: ThemeMode) => void;
  themeMode: ThemeMode;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const themeMode = parseThemeMode(searchParams);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
  }, [themeMode]);

  const value = useMemo<ThemeModeContextValue>(
    () => ({
      setThemeMode: (mode) => {
        setSearchParams(writeThemeMode(searchParams, mode), { replace: true });
      },
      themeMode,
    }),
    [searchParams, setSearchParams, themeMode],
  );

  return (
    <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useThemeMode(): ThemeModeContextValue {
  const value = useContext(ThemeModeContext);

  if (value === null) {
    throw new Error('useThemeMode must be used within ThemeModeProvider.');
  }

  return value;
}
