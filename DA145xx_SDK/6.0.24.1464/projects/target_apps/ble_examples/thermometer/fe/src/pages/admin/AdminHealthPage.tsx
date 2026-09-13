import { Activity } from 'lucide-react';
import { useAdminIngestStats } from '../../api/queries';
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
import { StatTile, StatTileGrid, largestOf } from './AdminUi';

/**
 * Ingest health (admin feature #1): is data still arriving, and from how many
 * devices.
 *
 * Two fixed windows, not a time series — the endpoint aggregates the last
 * hour and the last day in one pass over recent chunks, deliberately avoiding
 * a per-bucket scan of the measurements hypertable. There is therefore no
 * trend chart here: drawing one would mean inventing points the API doesn't
 * have. The panel refreshes itself every minute.
 */
export function AdminHealthPage() {
  const statsQuery = useAdminIngestStats();

  if (statsQuery.isLoading) return <SkeletonBlock className="h-64" />;
  if (statsQuery.isError || !statsQuery.data) {
    return <ErrorState message={statsQuery.error?.message} onRetry={() => statsQuery.refetch()} />;
  }

  const stats = statsQuery.data;
  const largest = largestOf(stats.byTypeLastDay.map((row) => row.count));

  return (
    <div className="space-y-4">
      {stats.readingsLastHour === 0 && (
        <Alert status={stats.readingsLastDay === 0 ? 'danger' : 'warning'}>
          {stats.readingsLastDay === 0
            ? 'No readings have arrived in the last 24 hours. Check the collectors and the MQTT bridge.'
            : 'No readings in the last hour, though some arrived earlier today. Collectors may have stopped.'}
        </Alert>
      )}

      <StatTileGrid>
        <StatTile label="Readings" value={stats.readingsLastHour.toLocaleString()} hint="Last hour" />
        <StatTile label="Readings" value={stats.readingsLastDay.toLocaleString()} hint="Last 24 hours" />
        <StatTile label="Devices reporting" value={stats.devicesLastHour.toLocaleString()} hint="Last hour" />
        <StatTile label="Devices reporting" value={stats.devicesLastDay.toLocaleString()} hint="Last 24 hours" />
      </StatTileGrid>

      <Card
        density="compact"
        header={<h2 className="text-h3 font-semibold text-ink-primary">Readings by type</h2>}
      >
        <p className="mb-3 text-caption text-ink-muted">
          What arrived in the last 24 hours. A type dropping to zero usually means one profile stopped reporting
          rather than the whole device going quiet.
        </p>
        {stats.byTypeLastDay.length === 0 ? (
          <EmptyState icon={Activity} title="Nothing ingested today" description="No readings in the last 24 hours." />
        ) : (
          <Table>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>Type</TableHeadCell>
                <TableHeadCell>Readings</TableHeadCell>
                <TableHeadCell>Share of the largest type</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {stats.byTypeLastDay.map((row) => (
                <TableRow key={row.type}>
                  <TableCell>{row.type}</TableCell>
                  <TableCell className="font-tabular">{row.count.toLocaleString()}</TableCell>
                  <TableCell>
                    <ProgressBar value={row.count} max={largest} label={`${row.type}: ${row.count} readings`} />
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
