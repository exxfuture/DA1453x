import { Database } from 'lucide-react';
import { useAdminRetention } from '../../api/queries';
import { Alert } from '../../components/ui/Alert';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorState, SkeletonBlock } from '../../components/ui/EmptyState';
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
import { StatTile, StatTileGrid, largestOf } from './AdminUi';

const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];

/** Binary-scaled size for a storage figure, one decimal above kilobytes. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const exponent = Math.min(BYTE_UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${BYTE_UNITS[exponent]}`;
}

/**
 * Storage and retention insight (admin feature #9).
 *
 * Two different kinds of number share this page and the copy keeps them
 * apart: the total row count is an **estimate** from PostgreSQL's own table
 * statistics — a real `COUNT(*)` would scan every chunk of a hypertable
 * holding years of per-minute readings — while the per-device breakdown is
 * exact but deliberately bounded to the last 30 days. Neither is presented as
 * the other, and no trend chart is drawn: the endpoint returns no time series,
 * and inventing one would be inventing data.
 */
export function AdminRetentionPage() {
  const retentionQuery = useAdminRetention();

  if (retentionQuery.isLoading) return <SkeletonBlock className="h-64" />;
  if (retentionQuery.isError || !retentionQuery.data) {
    return <ErrorState message={retentionQuery.error?.message} onRetry={() => retentionQuery.refetch()} />;
  }

  const retention = retentionQuery.data;
  const largest = largestOf(retention.topDevicesLast30Days.map((row) => row.rowsLast30Days));

  return (
    <div className="space-y-4">
      <Alert status="info">
        The stored-readings figure is an estimate maintained by the database's own statistics collector, not a count —
        it drifts between vacuums and should be read as an order of magnitude. The per-device table below is exact,
        but only covers the last 30 days.
      </Alert>

      <StatTileGrid className="lg:grid-cols-3">
        <StatTile
          label="Stored readings"
          value={`≈ ${retention.estimatedRows.toLocaleString()}`}
          hint="Estimate, not a count"
        />
        <StatTile
          label="Storage used"
          value={formatBytes(retention.totalBytes)}
          hint="Measurements table, indexes included"
        />
        <StatTile
          label="Oldest recent reading"
          value={retention.oldestRecentReading ? relativeTime(retention.oldestRecentReading) : '—'}
          hint={
            retention.oldestRecentReading
              ? new Date(retention.oldestRecentReading).toLocaleString()
              : 'No readings in the last 30 days'
          }
        />
      </StatTileGrid>

      <Card
        density="compact"
        header={<h2 className="text-h3 font-semibold text-ink-primary">Busiest devices, last 30 days</h2>}
      >
        <p className="mb-3 text-caption text-ink-muted">
          Which devices account for the recent write volume. A device far above the rest is usually one reporting
          faster than it should.
        </p>
        {retention.topDevicesLast30Days.length === 0 ? (
          <EmptyState
            icon={Database}
            title="No readings in the last 30 days"
            description="Nothing has been written recently, so there is no breakdown to show."
          />
        ) : (
          <Table>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>Device</TableHeadCell>
                <TableHeadCell>Readings</TableHeadCell>
                <TableHeadCell>First</TableHeadCell>
                <TableHeadCell>Last</TableHeadCell>
                <TableHeadCell>Share of the busiest</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {retention.topDevicesLast30Days.map((row) => (
                <TableRow key={row.deviceBdAddr}>
                  <TableCell mono>{row.deviceBdAddr}</TableCell>
                  <TableCell className="font-tabular">{row.rowsLast30Days.toLocaleString()}</TableCell>
                  <TableCell muted title={new Date(row.firstTs).toLocaleString()}>
                    {relativeTime(row.firstTs)}
                  </TableCell>
                  <TableCell muted title={new Date(row.lastTs).toLocaleString()}>
                    {relativeTime(row.lastTs)}
                  </TableCell>
                  <TableCell>
                    <ProgressBar
                      value={row.rowsLast30Days}
                      max={largest}
                      label={`${row.deviceBdAddr}: ${row.rowsLast30Days} readings`}
                    />
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
