import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, Flame, RefreshCw, Search, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMe, usePatientEvents } from '../api/queries';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState, SkeletonBlock } from '../components/ui/EmptyState';
import { Input } from '../components/ui/Input';
import { Timeline, TimelineItem } from '../components/ui/Timeline';
import { getTemperatureTier, TemperatureTier } from '../theme/temperature';
import { durationText, groupByPatient } from '../utils/doctorFeeds';
import { formatTemperature } from '../utils/temperatureFormat';

const RANGES = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 24 * 7 },
  { label: '30d', hours: 24 * 30 },
];

type TierFilter = 'all' | 'elevated' | 'fever' | 'highFever';

const TIER_FILTERS: [TierFilter, string][] = [
  ['all', 'All'],
  ['elevated', 'Elevated'],
  ['fever', 'Fever'],
  ['highFever', 'High fever'],
];

/** Episodes render in pages so a 30-day fleet feed can't mount 10k list items. */
const PAGE_SIZE = 50;

/** An episode is only ever elevated/fever/highFever; the other two tiers are
 *  here because the tier union is shared, and are never rendered. */
const TIER_ICON: Record<TemperatureTier, LucideIcon> = {
  low: AlertTriangle,
  normal: AlertTriangle,
  elevated: AlertTriangle,
  fever: Flame,
  highFever: Flame,
};

export function EventsPage() {
  const [rangeHours, setRangeHours] = useState(24 * 7);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [limit, setLimit] = useState(PAGE_SIZE);

  const eventsQuery = usePatientEvents(rangeHours);
  const meQuery = useMe();
  const unit = meQuery.data?.temperatureUnit ?? 'CELSIUS';

  const feeds = useMemo(() => groupByPatient(eventsQuery.data ?? []), [eventsQuery.data]);

  const { entries, affected } = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matching = feeds.filter(
      (feed) => !query || (feed.patientUsername ?? feed.patientUserId).toLowerCase().includes(query),
    );

    const flat = matching.flatMap((feed) =>
      feed.events
        .filter((event) => tierFilter === 'all' || event.tier === tierFilter)
        .map((event) => ({ feed, event })),
    );
    flat.sort((a, b) => new Date(b.event.startTs).getTime() - new Date(a.event.startTs).getTime());

    const affectedFeeds = matching.filter((feed) =>
      feed.events.some((event) => tierFilter === 'all' || event.tier === tierFilter),
    );
    return { entries: flat, affected: affectedFeeds };
  }, [feeds, search, tierFilter]);

  const peakCelsius = useMemo(
    () => entries.reduce<number | null>((peak, { event }) => (peak == null || event.peakCelsius > peak ? event.peakCelsius : peak), null),
    [entries],
  );

  const items: TimelineItem[] = entries.slice(0, limit).map(({ feed, event }) => {
    const start = new Date(event.startTs).getTime();
    const end = new Date(event.endTs).getTime();
    const tierLabel = getTemperatureTier(event.peakCelsius).label;
    const details = [
      `peak ${formatTemperature(event.peakCelsius, unit)}`,
      `${durationText(start, end)} · ${event.readingCount} reading${event.readingCount === 1 ? '' : 's'}`,
    ];
    // The device only matters when the patient has more than one — otherwise
    // it is noise the patient name already implies.
    if (feed.deviceCount > 1) details.push(event.deviceBdAddr);

    return {
      id: `${event.deviceBdAddr}-${event.startTs}`,
      icon: TIER_ICON[event.tier],
      label: `${feed.patientUsername ?? feed.patientUserId} — ${tierLabel}`,
      detail: details.join(' · '),
      timestamp: start,
    };
  });

  const isLoading = eventsQuery.isLoading;
  const rangeLabel = RANGES.find((r) => r.hours === rangeHours)?.label ?? `${rangeHours}h`;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-display font-semibold text-ink-primary">Events</h1>
          <p className="text-caption text-ink-muted">
            Fever episodes across every patient who has granted you access, newest first
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <Button
                key={r.label}
                size="sm"
                variant={rangeHours === r.hours ? 'primary' : 'tertiary'}
                onClick={() => {
                  setRangeHours(r.hours);
                  setLimit(PAGE_SIZE);
                }}
              >
                {r.label}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            variant="tertiary"
            onClick={() => eventsQuery.refetch()}
            loading={eventsQuery.isFetching && !eventsQuery.isLoading}
            aria-label="Refresh"
          >
            <RefreshCw className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      {isLoading && <SkeletonBlock className="h-64" />}

      {!isLoading && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile icon={CalendarClock} label={`Episodes (${rangeLabel})`} value={String(entries.length)} />
            <StatTile icon={Users} label="Patients affected" value={`${affected.length} / ${feeds.length}`} />
            <StatTile icon={Flame} label="Highest peak" value={formatTemperature(peakCelsius, unit)} />
          </div>

          <Card density="compact">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[12rem] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
                <Input
                  placeholder="Search patients…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  aria-label="Search patients"
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {TIER_FILTERS.map(([key, label]) => (
                  <Button
                    key={key}
                    size="sm"
                    variant={tierFilter === key ? 'primary' : 'tertiary'}
                    onClick={() => {
                      setTierFilter(key);
                      setLimit(PAGE_SIZE);
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </Card>

          {affected.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-caption text-ink-muted">Affected:</span>
              {affected.map((feed) => (
                <Link
                  key={feed.patientUserId}
                  to={`/patients?patient=${encodeURIComponent(feed.patientUserId)}`}
                  className="rounded-full border border-border-hairline px-2.5 py-0.5 text-label font-semibold text-primary-600 hover:bg-primary-50 dark:border-border-hairline/[0.08] dark:text-primary-300 dark:hover:bg-primary-950"
                >
                  {feed.patientUsername ?? feed.patientUserId}
                </Link>
              ))}
            </div>
          )}

          <Card density="compact">
            {entries.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="No fever episodes in this range."
                description={
                  feeds.length === 0
                    ? 'No patients have granted you access yet.'
                    : 'Everyone stayed inside their normal range — widen the range or clear the filters to see more.'
                }
              />
            ) : (
              <>
                <Timeline items={items} />
                {entries.length > items.length && (
                  <div className="mt-3 flex justify-center">
                    <Button size="sm" variant="tertiary" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                      Show more ({entries.length - items.length} older)
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function StatTile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <Card density="compact">
      <div className="flex items-center gap-2 text-ink-muted">
        <Icon className="size-4" aria-hidden />
        <span className="text-label uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-1 font-tabular text-h2 font-semibold text-ink-primary">{value}</div>
    </Card>
  );
}
