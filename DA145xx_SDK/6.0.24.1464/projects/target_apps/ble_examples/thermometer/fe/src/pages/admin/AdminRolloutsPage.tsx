import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PackageOpen } from 'lucide-react';
import { useRollouts } from '../../api/queries';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorState, SkeletonBlock } from '../../components/ui/EmptyState';
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
import { progressVariant, rolloutProgress, rolloutStatusBadge } from './rolloutProgress';

const PAGE_SIZE = 20;

/**
 * OTA rollout list (admin feature #3). Progress bars are driven by the
 * per-status tallies the list endpoint returns in one grouped query — see
 * rolloutProgress() for why those counts are read defensively.
 */
export function AdminRolloutsPage() {
  // Pagination is 1-based; the API's PageResponse.page is 0-based.
  const [page, setPage] = useState(1);
  const rolloutsQuery = useRollouts({ page: page - 1, size: PAGE_SIZE });

  if (rolloutsQuery.isLoading) return <SkeletonBlock className="h-64" />;
  if (rolloutsQuery.isError) {
    return <ErrorState message={rolloutsQuery.error.message} onRetry={() => rolloutsQuery.refetch()} />;
  }

  const rollouts = rolloutsQuery.data?.content ?? [];

  return (
    <Card density="compact">
      <p className="mb-3 text-caption text-ink-muted">
        Firmware rollouts, newest first. Progress counts update as collectors report each device's install result.
      </p>

      {rollouts.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title="No rollouts yet"
          description="Rollouts are created through the API; none exist for this deployment."
        />
      ) : (
        <Table>
          <TableHead>
            <TableHeadRow>
              <TableHeadCell>Version</TableHeadCell>
              <TableHeadCell>Chip</TableHeadCell>
              <TableHeadCell>State</TableHeadCell>
              <TableHeadCell>Progress</TableHeadCell>
              <TableHeadCell>Created</TableHeadCell>
            </TableHeadRow>
          </TableHead>
          <TableBody>
            {rollouts.map((rollout) => {
              const progress = rolloutProgress(rollout);
              return (
                <TableRow key={rollout.id}>
                  <TableCell>
                    <Link
                      to={rollout.id}
                      className="font-semibold text-primary-600 hover:underline dark:text-primary-300"
                    >
                      {rollout.version}
                    </Link>
                  </TableCell>
                  <TableCell muted mono>
                    {rollout.chipModel}
                  </TableCell>
                  <TableCell>
                    <Badge status={rolloutStatusBadge(rollout.status)}>{rollout.status}</Badge>
                  </TableCell>
                  <TableCell className="min-w-[12rem]">
                    <ProgressBar
                      value={progress.installed}
                      max={rollout.targetCount}
                      variant={progressVariant(rollout)}
                      label={`${rollout.version}: ${progress.installed} of ${rollout.targetCount} installed`}
                    />
                    <p className="mt-1 font-tabular text-caption text-ink-muted">
                      {progress.installed}/{rollout.targetCount} installed
                      {progress.failed > 0 && ` · ${progress.failed} failed`}
                      {progress.pending > 0 && ` · ${progress.pending} pending`}
                    </p>
                  </TableCell>
                  <TableCell muted title={new Date(rollout.createdAt).toLocaleString()}>
                    {relativeTime(rollout.createdAt)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Pagination page={page} totalPages={rolloutsQuery.data?.totalPages ?? 1} onPageChange={setPage} className="mt-4" />
    </Card>
  );
}
