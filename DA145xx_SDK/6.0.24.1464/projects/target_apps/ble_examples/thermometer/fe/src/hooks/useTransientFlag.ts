import { useEffect, useState } from 'react';

/**
 * How long a "✓ done" confirmation stays on screen. Long enough that the e2e
 * suite's "Claimed ✓" assertion (5 s budget) is never racing it, short enough
 * that it reads as feedback on an action rather than persistent state.
 */
export const CONFIRMATION_MS = 8000;

/**
 * Turns a latched success flag into one that expires (review FE-29).
 *
 * TanStack Query's `isSuccess` stays true until the next `mutate()` or unmount,
 * so a "Claimed ✓" / "Saved ✓" badge bound straight to it never goes away and
 * stops meaning "this just happened". This shows it for `durationMs` after the
 * flag goes true, then hides it — while leaving the mutation's own state alone,
 * since other UI (cache invalidation, disabled buttons) still depends on it.
 */
export function useTransientFlag(active: boolean, durationMs: number = CONFIRMATION_MS): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return undefined;
    }
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), durationMs);
    return () => clearTimeout(timer);
  }, [active, durationMs]);

  return visible;
}
