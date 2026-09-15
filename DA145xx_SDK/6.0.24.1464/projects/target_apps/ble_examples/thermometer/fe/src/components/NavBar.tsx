import { useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Link, useLocation } from 'react-router-dom';
import {
  Bluetooth,
  CalendarClock,
  History,
  LayoutDashboard,
  Menu,
  Settings as SettingsIcon,
  ShieldCheck,
  Smartphone,
  Thermometer,
  Users,
  X,
} from 'lucide-react';
import { roleOf } from '../auth/oidc';
import { closeLiveSession } from '../live/mqttClient';
import { ThemeToggle } from './ui/ThemeToggle';
import { cn } from './ui/cn';

const LINKS_BY_ROLE = {
  customer: [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/devices', label: 'Devices', icon: Smartphone },
    { to: '/history', label: 'History', icon: History },
    { to: '/connect', label: 'Connect', icon: Bluetooth },
    { to: '/settings', label: 'Settings', icon: SettingsIcon },
  ],
  doctor: [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/patients', label: 'Patients', icon: Users },
    { to: '/events', label: 'Events', icon: CalendarClock },
    { to: '/audit', label: 'Audit', icon: History },
    { to: '/settings', label: 'Settings', icon: SettingsIcon },
  ],
  admin: [
    { to: '/admin', label: 'Admin', icon: ShieldCheck },
    { to: '/settings', label: 'Settings', icon: SettingsIcon },
  ],
} as const;

export function NavBar() {
  const auth = useAuth();
  const username = auth.user?.profile.preferred_username;
  const role = roleOf(auth.user);
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const links = role ? LINKS_BY_ROLE[role] : [];
  const isCustomer = role === 'customer';

  /**
   * Path-segment match, not a bare prefix (review FE-32): `startsWith('/history')`
   * would also light up on a future `/history-export`. A trailing slash makes the
   * boundary explicit, so `/admin` still matches every `/admin/*` sub-path — which
   * is what keeps the admin console's deep links showing the right nav entry.
   */
  const isActive = (to: string) => location.pathname === to || location.pathname.startsWith(`${to}/`);

  return (
    <>
      <nav className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border-hairline bg-surface-1/95 px-4 backdrop-blur dark:border-border-hairline/[0.08] sm:px-6">
        <Link to="/" className="flex items-center gap-2 font-display text-h3 font-semibold text-primary-600 dark:text-primary-300">
          <Thermometer className="size-6" aria-hidden />
          <span className="hidden sm:inline">Thermometer</span>
        </Link>

        {/* Desktop link set — always the top bar for every role at md+. */}
        <div className="ml-6 hidden items-center gap-1 md:flex">
          {links.map((link) => {
            const active = isActive(link.to);
            return (
              <Link
                key={link.to}
                to={link.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-touch items-center gap-2 rounded-md px-3 text-body font-semibold transition-colors duration-fast ease-standard',
                  'focus-visible:outline-none focus-visible:shadow-focus',
                  active
                    ? 'text-primary-600 dark:text-primary-300'
                    : 'text-ink-secondary hover:bg-sand-50 dark:hover:bg-surface-2',
                )}
              >
                <link.icon className="size-4" aria-hidden />
                {link.label}
              </Link>
            );
          })}
        </div>

        {/* Doctor/admin mobile: hamburger → drawer (not bottom tabs — lower one-handed priority). */}
        {!isCustomer && links.length > 0 && (
          <button
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={drawerOpen}
            className="flex size-touch items-center justify-center rounded-md text-ink-secondary hover:bg-sand-50 dark:hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-focus md:hidden"
          >
            {drawerOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-caption text-ink-secondary sm:inline">
            {username} <span className="text-ink-muted">({role})</span>
          </span>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => {
              // Drop the broker session before leaving: its credential was
              // minted for this user and must not outlive their sign-out
              // (review FE-03).
              closeLiveSession();
              void auth.signoutRedirect();
            }}
            className="h-touch rounded-md px-3 text-body font-semibold text-ink-secondary hover:bg-sand-50 dark:hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-focus"
          >
            Sign out
          </button>
        </div>
      </nav>

      {!isCustomer && drawerOpen && (
        <div className="border-b border-border-hairline bg-surface-1 px-4 py-2 dark:border-border-hairline/[0.08] md:hidden">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setDrawerOpen(false)}
              className="flex h-touch items-center gap-2 rounded-md px-2 text-body font-semibold text-ink-secondary hover:bg-sand-50 dark:hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-focus"
            >
              <link.icon className="size-4" aria-hidden />
              {link.label}
            </Link>
          ))}
        </div>
      )}

      {/* Customer mobile: bottom tab bar. */}
      {isCustomer && (
        <nav
          aria-label="Primary"
          className="fixed inset-x-0 bottom-0 z-20 flex h-16 items-stretch border-t border-border-hairline bg-surface-1 pb-[env(safe-area-inset-bottom)] dark:border-border-hairline/[0.08] md:hidden"
        >
          {links.map((link) => {
            const active = isActive(link.to);
            return (
              <Link
                key={link.to}
                to={link.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex flex-1 flex-col items-center justify-center gap-0.5 text-caption',
                  'focus-visible:outline-none focus-visible:shadow-focus',
                  active ? 'text-primary-600 dark:text-primary-300 font-semibold' : 'text-ink-muted',
                )}
              >
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-primary-600 dark:bg-primary-300" />}
                <link.icon className="size-5" aria-hidden strokeWidth={active ? 2.5 : 2} />
                {link.label}
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
