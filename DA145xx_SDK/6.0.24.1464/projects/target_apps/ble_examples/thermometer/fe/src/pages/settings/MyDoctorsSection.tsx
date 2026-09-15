import { FormEvent, useState } from 'react';
import { ChevronDown, ChevronUp, Stethoscope } from 'lucide-react';
import { useConsents, useDoctors, useGrantConsent, useRevokeConsent } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Select } from '../../components/ui/Select';
import { ConsentHistorySection } from './ConsentHistorySection';

/**
 * Consent management (customer feature: grant/revoke a doctor's access), with
 * the grant/revoke history collapsed underneath.
 *
 * Only doctors without an active consent are offered in the picker, so granting
 * the same doctor twice isn't possible from the UI.
 */
export function MyDoctorsSection() {
  const doctorsQuery = useDoctors();
  const consentsQuery = useConsents();
  const grantConsent = useGrantConsent();
  const revokeConsent = useRevokeConsent();
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  const activeConsents = consentsQuery.data?.filter((c) => c.revokedAt === null) ?? [];
  const grantedDoctorIds = new Set(activeConsents.map((c) => c.doctorUserId));
  const grantableDoctors = doctorsQuery.data?.filter((d) => !grantedDoctorIds.has(d.id)) ?? [];

  const handleGrant = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedDoctorId) return;
    grantConsent.mutate(selectedDoctorId, { onSuccess: () => setSelectedDoctorId('') });
  };

  return (
    <Card density="compact" header={<h2 className="text-h3 font-semibold text-ink-primary">My doctors</h2>}>
      <p className="mb-3 text-caption text-ink-muted">Doctors you grant access to can see your device's readings.</p>

      {activeConsents.length === 0 ? (
        <EmptyState icon={Stethoscope} title="No doctors have access yet" />
      ) : (
        <ul className="space-y-2">
          {activeConsents.map((consent) => (
            <li key={consent.id} className="flex items-center justify-between text-body">
              <span className="text-ink-primary">{consent.doctorUsername ?? consent.doctorUserId}</span>
              <Button
                variant="tertiary"
                size="sm"
                onClick={() => revokeConsent.mutate(consent.id)}
                loading={revokeConsent.isPending}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      {grantableDoctors.length > 0 && (
        <form
          onSubmit={handleGrant}
          className="mt-3 flex items-end gap-2 border-t border-border-hairline pt-3 dark:border-border-hairline/[0.08]"
        >
          <div className="flex-1">
            <Select
              id="grant-doctor"
              label="Grant access to"
              value={selectedDoctorId}
              onChange={(e) => setSelectedDoctorId(e.target.value)}
            >
              <option value="">Select a doctor…</option>
              {grantableDoctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.displayName ?? doctor.username}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" disabled={!selectedDoctorId} loading={grantConsent.isPending}>
            Grant
          </Button>
        </form>
      )}

      <div className="mt-3 border-t border-border-hairline pt-3 dark:border-border-hairline/[0.08]">
        <Button
          type="button"
          size="sm"
          variant="tertiary"
          onClick={() => setHistoryOpen((open) => !open)}
          aria-expanded={historyOpen}
          aria-controls="consent-history"
        >
          {historyOpen ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
          Access history
        </Button>
        {/* Mounted only when opened, so the extra request is paid for on demand. */}
        {historyOpen && (
          <div id="consent-history" className="mt-3">
            <ConsentHistorySection />
          </div>
        )}
      </div>
    </Card>
  );
}
