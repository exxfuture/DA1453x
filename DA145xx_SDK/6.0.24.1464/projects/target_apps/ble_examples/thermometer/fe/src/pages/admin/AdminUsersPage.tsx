import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { AdminUserResponse } from '../../api/client';
import { useAdminUpdateUserRole, useAdminUserGrowth, useAdminUsers, useMe } from '../../api/queries';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, SkeletonBlock } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableHeadRow,
  TableRow,
} from '../../components/ui/Table';
import { TrendChart } from '../../components/ui/TrendChart';
import { cn } from '../../components/ui/cn';
import { StatTile, StatTileGrid } from './AdminUi';
import { fillDailySeries } from './dailySeries';

const PAGE_SIZE = 25;
const GROWTH_DAYS = 90;

type UserRole = AdminUserResponse['role'];

const ROLES: UserRole[] = ['customer', 'doctor', 'admin'];

/** Mirrors the native-select styling SettingsPage uses; `sm` matches Button's row height. */
function selectClasses(size: 'sm' | 'md'): string {
  return cn(
    size === 'sm' ? 'h-9' : 'h-touch',
    'rounded-md border border-sand-500 bg-surface-1 px-2 text-body text-ink-primary dark:border-sand-600',
    'focus-visible:outline-none focus-visible:border-primary-600 focus-visible:shadow-focus',
  );
}

/**
 * Search runs server-side, so it fires a request per change of the term —
 * debounced rather than bound straight to the keystroke.
 */
function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * User administration: a searchable, paged browser with inline role changes
 * (admin feature #7) over a growth/role-distribution strip (#4).
 */
export function AdminUsersPage() {
  return (
    <div className="space-y-4">
      <UserGrowthStrip />
      <UserBrowser />
    </div>
  );
}

/** Admin feature #4 — how many users there are, split by role, and how that got there. */
function UserGrowthStrip() {
  const growthQuery = useAdminUserGrowth();

  const series = useMemo(
    () => fillDailySeries(growthQuery.data?.signupsLast90Days ?? [], GROWTH_DAYS),
    [growthQuery.data],
  );

  if (growthQuery.isLoading) return <SkeletonBlock className="h-40" />;
  if (growthQuery.isError || !growthQuery.data) {
    return <Alert status="danger">Could not load user growth — the panel below still works.</Alert>;
  }

  const growth = growthQuery.data;
  const countsByRole = new Map(growth.byRole.map((entry) => [entry.role, entry.count]));

  return (
    <div className="space-y-3">
      <StatTileGrid>
        <StatTile label="Users" value={growth.total.toLocaleString()} hint="All roles" />
        {ROLES.map((role) => (
          <StatTile key={role} label={role} value={(countsByRole.get(role) ?? 0).toLocaleString()} />
        ))}
      </StatTileGrid>

      <Card
        density="compact"
        header={<h2 className="text-h3 font-semibold text-ink-primary">New sign-ups per day</h2>}
      >
        <p className="mb-2 text-caption text-ink-muted">
          Accounts created in the last {GROWTH_DAYS} days. A user appears the first time they sign in — the
          identity provider creates them there, not here.
        </p>
        <TrendChart
          data={series}
          label="Sign-ups"
          height={160}
          xFormatter={(x) => new Date(Number(x)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        />
      </Card>
    </div>
  );
}

/** Admin feature #7 — server-side search/filter plus per-row role correction. */
function UserBrowser() {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounced(search);
  // Pagination is 1-based; the API's PageResponse.page is 0-based.
  const usersQuery = useAdminUsers({
    q: debouncedSearch.trim(),
    role,
    page: page - 1,
    size: PAGE_SIZE,
  });

  const meQuery = useMe();
  const updateRole = useAdminUpdateUserRole();

  /** Pending role edits, by user id — only the rows the admin actually touched. */
  const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>({});

  const users = usersQuery.data?.content ?? [];
  const totalPages = usersQuery.data?.totalPages ?? 1;

  const resetToFirstPage = () => setPage(1);

  return (
    <Card density="compact">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <Input
            label="Search"
            type="search"
            placeholder="Username or email"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              resetToFirstPage();
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-label uppercase tracking-wide text-ink-secondary" htmlFor="user-role-filter">
            Role
          </label>
          <select
            id="user-role-filter"
            className={selectClasses('md')}
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              resetToFirstPage();
            }}
          >
            <option value="">Any role</option>
            {ROLES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        {usersQuery.data && (
          <p className="pb-2.5 text-caption text-ink-muted" aria-live="polite">
            {usersQuery.data.totalElements.toLocaleString()} matching
          </p>
        )}
      </div>

      <Alert status="info" className="mb-3">
        A role change here corrects this system's local copy only. Every user's role is re-read from the identity
        provider on their next request, so a lasting change has to be made in the Keycloak realm.
      </Alert>

      {updateRole.isError && (
        <Alert status="danger" className="mb-3">
          {updateRole.error.message}
        </Alert>
      )}

      {usersQuery.isLoading ? (
        <SkeletonBlock className="h-64" />
      ) : users.length === 0 ? (
        <EmptyState icon={Search} title="No users match" description="Try a different search term or role." />
      ) : (
        <Table>
          <TableHead>
            <TableHeadRow>
              <TableHeadCell>Username</TableHeadCell>
              <TableHeadCell>Email</TableHeadCell>
              <TableHeadCell>Devices</TableHeadCell>
              <TableHeadCell>Active links</TableHeadCell>
              <TableHeadCell>Role</TableHeadCell>
            </TableHeadRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                isMe={meQuery.data?.id === user.id}
                draft={roleDrafts[user.id]}
                saving={updateRole.isPending && updateRole.variables?.id === user.id}
                onDraftChange={(next) => setRoleDrafts((drafts) => ({ ...drafts, [user.id]: next }))}
                onSave={(next) =>
                  updateRole.mutate(
                    { id: user.id, role: next },
                    {
                      // Drop the draft once it's persisted, so the row goes
                      // back to reflecting the server's value.
                      onSuccess: () =>
                        setRoleDrafts((drafts) => {
                          const remaining = { ...drafts };
                          delete remaining[user.id];
                          return remaining;
                        }),
                    },
                  )
                }
              />
            ))}
          </TableBody>
        </Table>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} className="mt-4" />
    </Card>
  );
}

interface UserRowProps {
  user: AdminUserResponse;
  /** The signed-in admin: the backend refuses self-demotion, so the control is not offered. */
  isMe: boolean;
  draft: UserRole | undefined;
  saving: boolean;
  onDraftChange: (role: UserRole) => void;
  onSave: (role: UserRole) => void;
}

function UserRow({ user, isMe, draft, saving, onDraftChange, onSave }: UserRowProps) {
  const selected = draft ?? user.role;
  const isDirty = selected !== user.role;

  return (
    <TableRow>
      <TableCell>{user.displayName ?? user.username}</TableCell>
      <TableCell muted>{user.email ?? '—'}</TableCell>
      <TableCell muted mono>
        {user.devices.length > 0 ? user.devices.map((device) => device.bdAddr).join(', ') : '—'}
      </TableCell>
      <TableCell muted>{user.activeConsentCount}</TableCell>
      <TableCell>
        {isMe ? (
          <span className="capitalize text-ink-secondary">{user.role} (you)</span>
        ) : (
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`role-${user.id}`}>
              Role for {user.username}
            </label>
            <select
              id={`role-${user.id}`}
              className={selectClasses('sm')}
              value={selected}
              onChange={(event) => onDraftChange(event.target.value as UserRole)}
            >
              {ROLES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {isDirty && (
              <Button size="sm" loading={saving} onClick={() => onSave(selected)}>
                Save
              </Button>
            )}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
