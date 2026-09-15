import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useRollout } from '../../api/queries';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { ErrorState, SkeletonBlock } from '../../components/ui/EmptyState';
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
import { Segmented } from '../../components/ui/Segmented';
import { StatTile, StatTileGrid } from '../../components/ui/StatTile';
import { TARGET_STATUSES, progressVariant, rolloutProgress, rolloutStatusBadge, targetStatusBadge } from './rolloutProgress';

type StatusFilter = 'all' | (typeof TARGET_STATUSES)[number];

const STATUS_FILTERS = [
  { value: 'all' as const, label: 'All' },
  { value: 'installed' as const, label: 'Installed' },
  { value: 'failed' as const, label: 'Failed' },
  { value: 'pending' as const, label: 'Pending' },
];

/**
 * One rollout and every device it targets (admin feature #3, drill-down).
 * The target list is bounded by the rollout's own group percentage, so it is
 * rendered whole rather than paged — the filter below narrows it to the
 * statuses worth acting on.
 */
export function AdminRolloutDetailPage() {
  const { id } = useParams<{ id: string }>();
  const rolloutQuery = useRollout(id ?? null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const targets = useMemo(
    () =>
      (rolloutQuery.data?.targets ?? []).filter(
        (target) => statusFilter === 'all' || target.status === statusFilter,
      ),
    [rolloutQuery.data, statusFilter],
  );

  if (rolloutQuery.isLoading) return <SkeletonBlock className="h-64" />;
  if (rolloutQuery.isError || !rolloutQuery.data) {
    return <ErrorState message={rolloutQuery.error?.message} onRetry={() => rolloutQuery.refetch()} />;
  }

  const { rollout } = rolloutQuery.data;
  const progress = rolloutProgress(rollout);
  const aborting = progress.failedPct > rollout.abortThresholdPct;

  return (
    <div className="space-y-4">
      <Link
        to="/admin/rollouts"
        className="inline-flex items-center gap-1 text-body font-semibold text-primary-600 hover:underline dark:text-primary-300"
      >
        <ChevronLeft className="size-4" aria-hidden />
        All rollouts
      </Link>

      <Card
        density="compact"
        header={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-h2 font-semibold text-ink-primary">{rollout.version}</h2>
            <Badge status={rolloutStatusBadge(rollout.status)}>{rollout.status}</Badge>
          </div>
        }
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-body sm:grid-cols-2">
          <Detail label="Chip model" value={rollout.chipModel} mono />
          <Detail label="Created" value={new Date(rollout.createdAt).toLocaleString()} />
          <Detail label="Group size" value={`${rollout.groupPercentage}% of eligible devices`} />
          <Detail label="Abort threshold" value={`${rollout.abortThresholdPct}% failed`} />
          <Detail label="Image" value={rollout.imageUrl} mono className="sm:col-span-2" />
          {rollout.deltaUrl && <Detail label="Delta image" value={rollout.deltaUrl} mono className="sm:col-span-2" />}
        </dl>

        <div className="mt-4">
          <ProgressBar
            value={progress.installed}
            max={rollout.targetCount}
            variant={progressVariant(rollout)}
            label={`${progress.installed} of ${rollout.targetCount} devices installed`}
          />
          <p className="mt-1 font-tabular text-caption text-ink-muted">
            {progress.installed} of {rollout.targetCount} devices installed
            {progress.reported < rollout.targetCount &&
              ` · ${rollout.targetCount - progress.reported} yet to report`}
          </p>
        </div>
      </Card>

      {aborting && (
        <Alert status="danger">
          {progress.failed} of {rollout.targetCount} devices failed to install — past this rollout's{' '}
          {rollout.abortThresholdPct}% abort threshold.
        </Alert>
      )}

      <StatTileGrid className="lg:grid-cols-4">
        <StatTile size="lg" label="Targets" value={rollout.targetCount.toLocaleString()} />
        <StatTile size="lg" label="Installed" value={progress.installed.toLocaleString()} />
        <StatTile size="lg" label="Failed" value={progress.failed.toLocaleString()} />
        <StatTile size="lg" label="Pending" value={progress.pending.toLocaleString()} hint="Not yet reported" />
      </StatTileGrid>

      <Card density="compact" header={<h2 className="text-h3 font-semibold text-ink-primary">Devices</h2>}>
        <Segmented
          options={STATUS_FILTERS}
          value={statusFilter}
          onChange={setStatusFilter}
          label="Filter devices by install status"
          className="mb-3"
        />

        {targets.length === 0 ? (
          <p className="py-6 text-center text-body text-ink-muted">
            {statusFilter === 'all' ? 'This rollout has no targets.' : `No devices are ${statusFilter}.`}
          </p>
        ) : (
          <Table>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>Device</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell>Reported</TableHeadCell>
                <TableHeadCell>Error</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {targets.map((target) => (
                <TableRow key={target.deviceBdAddr}>
                  <TableCell mono>{target.deviceBdAddr}</TableCell>
                  <TableCell>
                    <Badge status={targetStatusBadge(target.status)}>{target.status}</Badge>
                  </TableCell>
                  <TableCell
                    muted
                    title={target.reportedAt ? new Date(target.reportedAt).toLocaleString() : undefined}
                  >
                    {target.reportedAt ? relativeTime(target.reportedAt) : '—'}
                  </TableCell>
                  <TableCell muted>{target.errorDetail ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-label uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className={mono ? 'break-all font-mono text-mono-sm text-ink-primary' : 'text-ink-primary'}>{value}</dd>
    </div>
  );
}
