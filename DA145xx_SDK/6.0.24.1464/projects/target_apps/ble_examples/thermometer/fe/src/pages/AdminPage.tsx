import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { cn } from '../components/ui/cn';
import { AdminAuditPage } from './admin/AdminAuditPage';
import { AdminDevicesPage } from './admin/AdminDevicesPage';
import { AdminHealthPage } from './admin/AdminHealthPage';
import { AdminRelationshipsPage } from './admin/AdminRelationshipsPage';
import { AdminRetentionPage } from './admin/AdminRetentionPage';
import { AdminRolloutDetailPage } from './admin/AdminRolloutDetailPage';
import { AdminRolloutsPage } from './admin/AdminRolloutsPage';
import { AdminUsersPage } from './admin/AdminUsersPage';

const TABS = [
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/devices', label: 'Devices' },
  { to: '/admin/relationships', label: 'Relationships' },
  { to: '/admin/health', label: 'Health' },
  { to: '/admin/rollouts', label: 'Rollouts' },
  { to: '/admin/audit', label: 'Audit' },
  { to: '/admin/retention', label: 'Retention' },
];

/**
 * The admin console shell: a tab strip over a nested router.
 *
 * Sections are routes rather than `useState` tabs so each one is linkable and
 * survives a reload — a rollout being watched, or a filtered audit view, can
 * be sent to somebody. `NavLink` matches by path prefix, which is why the
 * Rollouts tab stays lit on a rollout's detail page, and why NavBar's own
 * `/admin` entry keeps working unchanged across every sub-path.
 *
 * This component is mounted on `/admin/*`; the sub-paths below are relative
 * to it.
 */
export function AdminPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <h1 className="font-display text-display font-semibold text-ink-primary">Admin</h1>

      <div className="flex gap-1 overflow-x-auto border-b border-border-hairline dark:border-border-hairline/[0.08]">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                '-mb-px shrink-0 border-b-2 px-3 py-2.5 text-body font-semibold transition-colors duration-fast ease-standard',
                'focus-visible:outline-none focus-visible:shadow-focus',
                isActive
                  ? 'border-primary-600 text-primary-600 dark:border-primary-300 dark:text-primary-300'
                  : 'border-transparent text-ink-muted hover:text-ink-secondary',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      <Routes>
        <Route index element={<Navigate to="users" replace />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="devices" element={<AdminDevicesPage />} />
        <Route path="relationships" element={<AdminRelationshipsPage />} />
        <Route path="health" element={<AdminHealthPage />} />
        <Route path="rollouts" element={<AdminRolloutsPage />} />
        <Route path="rollouts/:id" element={<AdminRolloutDetailPage />} />
        <Route path="audit" element={<AdminAuditPage />} />
        <Route path="retention" element={<AdminRetentionPage />} />
        {/* An unknown sub-path lands on the console's own home rather than a blank page. */}
        <Route path="*" element={<Navigate to="/admin/users" replace />} />
      </Routes>
    </div>
  );
}
