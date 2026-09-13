import { FormEvent, useState } from 'react';
import { History, ShieldAlert } from 'lucide-react';
import { useAdminAuditLog, useAdminSecurityOps } from '../../api/queries';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorState, SkeletonBlock } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { ProgressBar } from '../../components/ui/ProgressBar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableHeadRow,
  TableRow,
} from '../../components/ui/Table';
import { relativeTime } from '../../utils/time';
import { Segmented, StatTile, StatTileGrid, largestOf } from './AdminUi';

const PAGE_SIZE = 25;

type View = 'all' | 'anomalies';

const VIEWS = [
  { value: 'all' as const, label: 'All activity' },
  { value: 'anomalies' as const, label: 'Security anomalies' },
];

/**
 * Every action the backend records (see AuditLog writers). Offered as a
 * datalist rather than a fixed `<select>` because the filter is an exact
 * match server-side and the set can grow — an action this list doesn't know
 * about must still be typeable.
 */
const KNOWN_ACTIONS = [
  'access.denied',
  'admin.device.edit',
  'admin.device.release',
  'admin.user.role_change',
  'consent.grant',
  'consent.revoke',
  'device.claim',
  'device.release',
  'threshold.doctor_override.clear',
  'threshold.doctor_override.set',
  'threshold.system.set',
];

interface AuditFilters {
  actorId: string;
  action: string;
  subject: string;
  /** YYYY-MM-DD, from a native date input. */
  from: string;
  to: string;
}

const EMPTY_FILTERS: AuditFilters = { actorId: '', action: '', subject: '', from: '', to: '' };

/**
 * `<input type="date">` yields a bare calendar day; the API takes instants.
 * The range is widened to cover the whole local day at both ends, so "from
 * the 3rd to the 3rd" means that entire day rather than a zero-width window.
 */
function dayStart(day: string): string | undefined {
  return toInstant(day, 'T00:00:00.000');
}

function dayEnd(day: string): string | undefined {
  return toInstant(day, 'T23:59:59.999');
}

function toInstant(day: string, timeSuffix: string): string | undefined {
  if (!day) return undefined;
  const parsed = new Date(`${day}${timeSuffix}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/**
 * The admin audit surface: the filterable log itself (feature #5) and the
 * security-anomaly summary derived from the same table (feature #10), as two
 * views of one page rather than two routes — they answer the same question at
 * different zoom levels, and the anomaly rows link straight into the log.
 */
export function AdminAuditPage() {
  const [view, setView] = useState<View>('all');
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);

  return (
    <div className="space-y-4">
      <Segmented options={VIEWS} value={view} onChange={setView} label="Which audit view to show" />

      {view === 'all' ? (
        <AuditLogView filters={filters} onFiltersChange={setFilters} />
      ) : (
        <SecurityAnomaliesView
          onInspect={(actorId, action) => {
            setFilters({ ...EMPTY_FILTERS, actorId, action });
            setView('all');
          }}
        />
      )}
    </div>
  );
}

interface AuditLogViewProps {
  filters: AuditFilters;
  onFiltersChange: (filters: AuditFilters) => void;
}

function AuditLogView({ filters, onFiltersChange }: AuditLogViewProps) {
  // The filters are applied on submit, not per keystroke: every text filter is
  // an exact match server-side, so a half-typed id matches nothing and would
  // just fire a request per character on the way there.
  const [draft, setDraft] = useState<AuditFilters>(filters);
  // Pagination is 1-based; the API's PageResponse.page is 0-based.
  const [page, setPage] = useState(1);

  const auditQuery = useAdminAuditLog({
    actorId: filters.actorId,
    action: filters.action,
    subject: filters.subject,
    from: dayStart(filters.from),
    to: dayEnd(filters.to),
    page: page - 1,
    size: PAGE_SIZE,
  });

  const apply = (event: FormEvent) => {
    event.preventDefault();
    onFiltersChange(draft);
    setPage(1);
  };

  const clear = () => {
    setDraft(EMPTY_FILTERS);
    onFiltersChange(EMPTY_FILTERS);
    setPage(1);
  };

  const entries = auditQuery.data?.content ?? [];

  return (
    <Card density="compact">
      <form onSubmit={apply} className="mb-3 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            label="Actor id"
            value={draft.actorId}
            onChange={(event) => setDraft({ ...draft, actorId: event.target.value })}
            helperText="Exact user id"
          />
          <Input
            label="Action"
            list="audit-actions"
            value={draft.action}
            onChange={(event) => setDraft({ ...draft, action: event.target.value })}
            helperText="Exact action name"
          />
          <datalist id="audit-actions">
            {KNOWN_ACTIONS.map((action) => (
              <option key={action} value={action} />
            ))}
          </datalist>
          <Input
            label="Subject"
            value={draft.subject}
            onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
            helperText="Exact device address, user id or path"
          />
          <Input
            label="From"
            type="date"
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
          <Input
            label="To"
            type="date"
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm">
            Apply filters
          </Button>
          <Button type="button" size="sm" variant="tertiary" onClick={clear}>
            Clear
          </Button>
          {auditQuery.data && (
            <span className="text-caption text-ink-muted">
              {auditQuery.data.totalElements.toLocaleString()} matching
            </span>
          )}
        </div>
      </form>

      {auditQuery.isLoading ? (
        <SkeletonBlock className="h-64" />
      ) : auditQuery.isError ? (
        <ErrorState message={auditQuery.error.message} onRetry={() => auditQuery.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState icon={History} title="Nothing matches" description="Try widening the filters." />
      ) : (
        <Table>
          <TableHead>
            <TableHeadRow>
              <TableHeadCell>When</TableHeadCell>
              <TableHeadCell>Actor</TableHeadCell>
              <TableHeadCell>Action</TableHeadCell>
              <TableHeadCell>Subject</TableHeadCell>
              <TableHeadCell>Detail</TableHeadCell>
            </TableHeadRow>
          </TableHead>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell muted title={new Date(entry.at).toLocaleString()}>
                  {relativeTime(entry.at)}
                </TableCell>
                <TableCell>{entry.actorUsername ?? entry.actorId ?? 'system'}</TableCell>
                <TableCell mono>{entry.action}</TableCell>
                <TableCell muted mono>
                  {entry.subject ?? '—'}
                </TableCell>
                <TableCell muted className="max-w-[18rem] truncate" title={entry.detail ?? undefined}>
                  {entry.detail ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Pagination page={page} totalPages={auditQuery.data?.totalPages ?? 1} onPageChange={setPage} className="mt-4" />
    </Card>
  );
}

/** How many repeats of one action by one actor in the window counts as an anomaly. */
const DEFAULT_ANOMALY_THRESHOLD = 50;

function SecurityAnomaliesView({ onInspect }: { onInspect: (actorId: string, action: string) => void }) {
  const [thresholdDraft, setThresholdDraft] = useState(String(DEFAULT_ANOMALY_THRESHOLD));
  const [threshold, setThreshold] = useState(DEFAULT_ANOMALY_THRESHOLD);

  const opsQuery = useAdminSecurityOps(threshold);

  if (opsQuery.isLoading) return <SkeletonBlock className="h-64" />;
  if (opsQuery.isError || !opsQuery.data) {
    return <ErrorState message={opsQuery.error?.message} onRetry={() => opsQuery.refetch()} />;
  }

  const ops = opsQuery.data;
  const largestAction = largestOf(ops.byAction.map((row) => row.count));

  return (
    <div className="space-y-4">
      <Alert status="info">
        Everything below is derived from the audit log over the last {ops.windowHours} hours. The log records actions,
        not data reads, and a repeated action is a heuristic — a busy integration and a script probing the API look
        alike here.
      </Alert>

      <StatTileGrid className="lg:grid-cols-3">
        <StatTile
          label="Denied requests"
          value={ops.deniedLast24h.toLocaleString()}
          hint={`Last ${ops.windowHours} hours`}
        />
        <StatTile label="Repeat-action anomalies" value={ops.repeatedActions.length.toLocaleString()} />
        <StatTile label="Actors being denied" value={ops.topDenied.length.toLocaleString()} />
      </StatTileGrid>

      <Card
        density="compact"
        header={<h2 className="text-h3 font-semibold text-ink-primary">Repeated actions</h2>}
      >
        <form
          className="mb-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = Number(thresholdDraft);
            if (Number.isFinite(parsed) && parsed >= 1) setThreshold(Math.floor(parsed));
          }}
        >
          <div className="w-40">
            <Input
              label="Repeats to flag"
              type="number"
              inputMode="numeric"
              min={1}
              value={thresholdDraft}
              onChange={(event) => setThresholdDraft(event.target.value)}
            />
          </div>
          <Button type="submit" size="sm" variant="secondary">
            Apply
          </Button>
        </form>

        {ops.repeatedActions.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="Nothing over the threshold"
            description={`No actor repeated a single action more than ${threshold} times in the last ${ops.windowHours} hours.`}
          />
        ) : (
          <AnomalyTable rows={ops.repeatedActions} onInspect={onInspect} />
        )}
      </Card>

      <Card
        density="compact"
        header={<h2 className="text-h3 font-semibold text-ink-primary">Most-denied actors</h2>}
      >
        <p className="mb-3 text-caption text-ink-muted">
          Accounts whose requests were rejected for lack of permission. A handful is normal (a stale tab, a revoked
          consent); a sustained run from one account is not.
        </p>
        {ops.topDenied.length === 0 ? (
          <EmptyState icon={ShieldAlert} title="No denied requests" />
        ) : (
          <AnomalyTable rows={ops.topDenied} onInspect={onInspect} />
        )}
      </Card>

      <Card
        density="compact"
        header={<h2 className="text-h3 font-semibold text-ink-primary">Actions logged</h2>}
      >
        {ops.byAction.length === 0 ? (
          <p className="py-6 text-center text-body text-ink-muted">Nothing was recorded in the window.</p>
        ) : (
          <Table>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>Action</TableHeadCell>
                <TableHeadCell>Count</TableHeadCell>
                <TableHeadCell>Share of the most frequent</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {ops.byAction.map((row) => (
                <TableRow key={row.action}>
                  <TableCell mono>{row.action}</TableCell>
                  <TableCell className="font-tabular">{row.count.toLocaleString()}</TableCell>
                  <TableCell>
                    <ProgressBar value={row.count} max={largestAction} label={`${row.action}: ${row.count}`} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

interface AnomalyRow {
  actorId: string;
  action: string;
  count: number;
  lastAt: string;
}

function AnomalyTable({ rows, onInspect }: { rows: AnomalyRow[]; onInspect: (actorId: string, action: string) => void }) {
  return (
    <Table>
      <TableHead>
        <TableHeadRow>
          <TableHeadCell>Actor id</TableHeadCell>
          <TableHeadCell>Action</TableHeadCell>
          <TableHeadCell>Count</TableHeadCell>
          <TableHeadCell>Last seen</TableHeadCell>
          <TableHeadCell />
        </TableHeadRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.actorId}-${row.action}`}>
            <TableCell mono muted>
              {row.actorId}
            </TableCell>
            <TableCell mono>{row.action}</TableCell>
            <TableCell className="font-tabular">{row.count.toLocaleString()}</TableCell>
            <TableCell muted title={new Date(row.lastAt).toLocaleString()}>
              {relativeTime(row.lastAt)}
            </TableCell>
            <TableCell className="text-right">
              <Button size="sm" variant="tertiary" onClick={() => onInspect(row.actorId, row.action)}>
                Open in log
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
