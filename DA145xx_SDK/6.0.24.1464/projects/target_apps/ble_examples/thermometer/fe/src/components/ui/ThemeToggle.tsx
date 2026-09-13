import { Moon, Sun } from 'lucide-react';
import { resolvedIsDark, useThemeStore } from '../../state/themeStore';

/** Sun/moon toggle, always present in the nav (spec §4 "NavBar"). Cycles
 *  light/dark explicitly — starts from whatever the OS preference resolved
 *  to on first use. */
export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const cycleTheme = useThemeStore((s) => s.cycleTheme);
  const isDark = resolvedIsDark(theme);

  return (
    <button
      type="button"
      onClick={cycleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex size-touch shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-sand-100 dark:hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-focus transition-colors duration-fast ease-standard"
    >
      {isDark ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
    </button>
  );
}
