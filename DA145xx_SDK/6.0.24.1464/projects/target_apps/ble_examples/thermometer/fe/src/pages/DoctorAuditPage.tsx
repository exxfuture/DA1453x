import { useMemo, useState } from 'react';
import { AlertTriangle, History, KeyRound, ShieldCheck, ShieldOff, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AuditLogResponse } from '../api/client';
import { useDoctorAuditLog, useDoctorPatients, useMe } from '../api/queries';
import { Alert } from '../components/ui/Alert';
import { Card } from '../components/ui/Card';
import { ErrorState, SkeletonBlock } from '../components/ui/EmptyState';
import { Pagination } from '../components/ui/Pagination';
import { Timeline, TimelineItem } from '../components/ui/Timeline';

const PAGE_SIZE = 25;

interface ActionCopy {
  icon: LucideIcon;
  /** Wording when this doctor is the actor. */
  byMe: string;
  /** Wording when somebody acted on this doctor. */
  onMe: string;
  /** Whether `subject` names a person (so it can be resolved to a username). */
  subjectIsUser: boolean;
}

/**
 * Audit actions a doctor can appear in, as written by the backend
 * (ConsentController, ThresholdController, AdminController, AccessDeniedAuditor).
 * Anything not listed falls back to the raw action string rather than being
 * hidden — an unrecognised entry is still evidence.
 */
const ACTION_COPY: Record<string, ActionCopy> = {
  'consent.grant': {
    icon: ShieldCheck,
    byMe: 'You granted access',
    onMe: 'A patient granted you access',
    subjectIsUser: true,
  },
  'consent.revoke': {
    icon: ShieldOff,
    byMe: 'You revoked access',
    onMe: 'A patient revoked your access',
    subjectIsUser: true,
  },
  'threshold.doctor_override.set': {
    icon: SlidersHorizontal,
    byMe: 'You set a threshold override',
    onMe: 'A threshold override was set for you',
    subjectIsUser: true,
  },
  'threshold.doctor_override.clear': {
    icon: SlidersHorizontal,
    byMe: 'You removed a threshold override',
    onMe: 'A threshold override of yours was removed',
    subjectIsUser: true,
  },
  'admin.user.role_change': {
    icon: KeyRound,
    byMe: 'You changed a role',
    onMe: 'An administrator changed your role',
    subjectIsUser: true,
  },
  'access.denied': {
    icon: AlertTriangle,
    byMe: 'A request of yours was denied',
    onMe: 'A request was denied',
    subjectIsUser: false,
  },
};

/**
 * The doctor's own audit trail: consent granted to or withdrawn from them,
 * threshold overrides they made, denied requests.
 *
 * Built on `useDoctorAuditLog`, which matches on actor **or** subject —
 * deliberately not on `/api/doctor/consent-activity`, which filters by actor
 * only and is therefore always empty for a doctor (consent is patient-
 * initiated, so the doctor is the subject of those rows, never the actor).
 */
export function DoctorAuditPage() {
  // 1-based for the Pagination component; the API's `page` is 0-based.
  const [page, setPage] = useState(1);

  const auditQuery = useDoctorAuditLog({ page: page - 1, size: PAGE_SIZE });
  const meQuery = useMe();
  const patientsQuery = useDoctorPatients();

  const myUserId = meQuery.data?.id ?? null;

  /** User id → display name, so the feed reads in names rather than UUIDs. */
  const namesById = useMemo(() => {
    const names = new Map<string, string>();
    for (const patient of patientsQuery.data ?? []) {
      names.set(patient.patientUserId, patient.patientUsername ?? patient.patientUserId);
    }
    if (meQuery.data) names.set(meQuery.data.id, 'you');
    return names;
  }, [patientsQuery.data, meQuery.data]);

  const items: TimelineItem[] = (auditQuery.data?.content ?? []).map((entry) =>
    toTimelineItem(entry, myUserId, namesById),
  );

  const totalPages = auditQuery.data?.totalPages ?? 1;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="font-display text-display font-semibold text-ink-primary">Audit</h1>
        <p className="text-caption text-ink-muted">
          Consent activity and every action recorded for your account, newest first
        </p>
      </div>

      <Alert status="info">
        Patients grant and withdraw access themselves, so consent entries are recorded against them and appear here as
        actions taken <em>on</em> your account. This log covers consent and configuration changes — it does not record
        individual data reads.
      </Alert>

      <Card density="compact">
        {auditQuery.isLoading ? (
          <SkeletonBlock className="h-64" />
        ) : auditQuery.isError ? (
          <ErrorState message={auditQuery.error.message} onRetry={() => auditQuery.refetch()} />
        ) : (
          <>
            <Timeline items={items} emptyText="Nothing has been recorded for your account yet." />
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} className="mt-4" />
          </>
        )}
      </Card>
    </div>
  );
}

export function toTimelineItem(
  entry: AuditLogResponse,
  myUserId: string | null,
  namesById: Map<string, string>,
): TimelineItem {
  const copy = ACTION_COPY[entry.action];
  const byMe = myUserId != null && entry.actorId === myUserId;
  const label = copy ? (byMe ? copy.byMe : copy.onMe) : entry.action;

  // The counterparty is whoever isn't the reader: the subject of an action
  // this doctor took, the actor of one taken on them.
  const counterpartyId = byMe ? entry.subject : entry.actorId;
  const details: string[] = [];
  if (copy?.subjectIsUser !== false && counterpartyId && counterpartyId !== myUserId) {
    details.push(namesById.get(counterpartyId) ?? counterpartyId);
  }
  if (copy?.subjectIsUser === false && entry.subject) details.push(entry.subject);
  if (entry.detail) details.push(entry.detail);

  return {
    id: String(entry.id),
    icon: copy?.icon ?? History,
    label,
    detail: details.length > 0 ? details.join(' · ') : undefined,
    timestamp: new Date(entry.at).getTime(),
  };
}
