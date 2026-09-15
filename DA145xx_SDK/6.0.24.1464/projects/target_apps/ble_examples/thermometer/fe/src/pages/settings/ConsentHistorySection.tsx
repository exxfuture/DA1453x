import { useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { useConsentAccessHistory } from '../../api/queries';
import { Alert } from '../../components/ui/Alert';
import { SkeletonBlock } from '../../components/ui/EmptyState';
import { Pagination } from '../../components/ui/Pagination';
import { Timeline, type TimelineItem } from '../../components/ui/Timeline';

/**
 * Doctor-access transparency (customer feature #8).
 *
 * Strictly the consent *lifecycle*: the audit log records grants and
 * revocations, never reads, so this must never be presented as "who looked at
 * my data". The heading and the note below say so explicitly.
 *
 * Rendered inside MyDoctorsSection, and only once opened, so the extra request
 * is paid for on demand.
 */
export function ConsentHistorySection() {
  // Pagination is 1-based, the API's PageResponse is 0-based.
  const [page, setPage] = useState(1);
  const historyQuery = useConsentAccessHistory({ page: page - 1, size: 10 });

  const items: TimelineItem[] = (historyQuery.data?.content ?? []).map((entry) => {
    const granted = entry.action === 'consent.grant';
    const doctor = entry.doctorUsername ?? entry.doctorUserId ?? 'a doctor';
    return {
      id: String(entry.id),
      icon: granted ? ShieldCheck : ShieldOff,
      label: granted ? `You granted access to ${doctor}` : `You revoked access from ${doctor}`,
      timestamp: new Date(entry.at).getTime(),
    };
  });

  if (historyQuery.isLoading) return <SkeletonBlock className="h-24" />;

  if (historyQuery.isError) {
    return <Alert status="danger">Could not load your access history — please try again.</Alert>;
  }

  return (
    <div className="space-y-3">
      <p className="text-caption text-ink-muted">
        A record of every time you granted or revoked a doctor's access. It does not show when a doctor
        actually opened your readings — that is not tracked.
      </p>
      <Timeline items={items} emptyText="You haven't granted or revoked access yet." />
      <Pagination page={page} totalPages={historyQuery.data?.totalPages ?? 1} onPageChange={setPage} />
    </div>
  );
}
