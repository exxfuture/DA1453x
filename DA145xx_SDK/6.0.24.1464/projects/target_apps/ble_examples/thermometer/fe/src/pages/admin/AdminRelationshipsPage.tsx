import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAdminConsentIntegrity, useAdminConsents, useRevokeConsent } from '../../api/queries';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, SkeletonBlock } from '../../components/ui/EmptyState';
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
import { StatTile, StatTileGrid, Segmented } from './AdminUi';

const PAGE_SIZE = 25;

type View = 'all' | 'flagged';

const VIEWS = [
  { value: 'all' as const, label: 'All links' },
  { value: 'flagged' as const, label: 'Flagged only' },
];

const MISSING_LABEL: Record<string, string> = {
  patient: 'Patient account is missing',
  doctor: 'Doctor account is missing',
  both: 'Both accounts are missing',
};

/**
 * Doctor–patient consent links, with the integrity report from admin feature
 * #6 layered on top.
 *
 * "Flagged only" swaps in the integrity scan's own rows rather than filtering
 * the page in hand: the link list is paginated server-side, so a client-side
 * filter would only ever flag what happened to be on the current page and
 * would quietly report "no problems" on page 1 of many.
 */
export function AdminRelationshipsPage() {
  const [view, setView] = useState<View>('all');
  const integrityQuery = useAdminConsentIntegrity();
  const integrity = integrityQuery.data;

  const orphanedCount = integrity?.orphaned.length ?? 0;
  const overloadedCount = integrity?.overloadedDoctors.length ?? 0;
  const flaggedCount = orphanedCount + overloadedCount;

  return (
    <div className="space-y-4">
      {integrityQuery.isLoading ? (
        <SkeletonBlock className="h-24" />
      ) : integrityQuery.isError || !integrity ? (
        <Alert status="danger">Could not run the integrity check — the link list below still works.</Alert>
      ) : (
        <>
          <StatTileGrid className="lg:grid-cols-3">
            <StatTile label="Active links" value={integrity.activeLinks.toLocaleString()} />
            <StatTile
              label="Orphaned"
              value={orphanedCount.toLocaleString()}
              hint="Point at an account that doesn't exist"
            />
            <StatTile
              label="Overloaded doctors"
              value={overloadedCount.toLocaleString()}
              hint="Hold an unusual number of patients"
            />
          </StatTileGrid>

          {flaggedCount > 0 && view === 'all' && (
            <Alert status="warning">
              <div className="space-y-2">
                <p>
                  The integrity scan flagged {orphanedCount} orphaned link{orphanedCount === 1 ? '' : 's'} and{' '}
                  {overloadedCount} doctor{overloadedCount === 1 ? '' : 's'} over the patient-count threshold.
                </p>
                <Button size="sm" variant="secondary" onClick={() => setView('flagged')}>
                  Show flagged only
                </Button>
              </div>
            </Alert>
          )}
        </>
      )}

      <Segmented options={VIEWS} value={view} onChange={setView} label="Which consent links to show" />

      {view === 'all' ? <AllLinks /> : <FlaggedLinks />}
    </div>
  );
}

function AllLinks() {
  // Pagination is 1-based; the API's PageResponse.page is 0-based.
  const [page, setPage] = useState(1);
  const consentsQuery = useAdminConsents({ page: page - 1, size: PAGE_SIZE });
  const revokeConsent = useRevokeConsent();

  const consents = consentsQuery.data?.content ?? [];

  return (
    <Card density="compact">
      {consentsQuery.isLoading ? (
        <SkeletonBlock className="h-64" />
      ) : consents.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No consent links yet" />
      ) : (
        <Table>
          <TableHead>
            <TableHeadRow>
              <TableHeadCell>Patient</TableHeadCell>
              <TableHeadCell>Doctor</TableHeadCell>
              <TableHeadCell>Granted</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell />
            </TableHeadRow>
          </TableHead>
          <TableBody>
            {consents.map((consent) => (
              <TableRow key={consent.id}>
                <TableCell>{consent.patientUsername ?? consent.patientUserId}</TableCell>
                <TableCell>{consent.doctorUsername ?? consent.doctorUserId}</TableCell>
                <TableCell muted>{new Date(consent.grantedAt).toLocaleString()}</TableCell>
                <TableCell muted className="capitalize">
                  {consent.revokedAt ? 'revoked' : 'active'}
                </TableCell>
                <TableCell className="text-right">
                  {!consent.revokedAt && (
                    <Button
                      variant="destructive"
                      size="sm"
                      loading={revokeConsent.isPending}
                      onClick={() => revokeConsent.mutate(consent.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Pagination page={page} totalPages={consentsQuery.data?.totalPages ?? 1} onPageChange={setPage} className="mt-4" />
    </Card>
  );
}

function FlaggedLinks() {
  const integrityQuery = useAdminConsentIntegrity();
  const revokeConsent = useRevokeConsent();
  const integrity = integrityQuery.data;

  if (integrityQuery.isLoading) return <SkeletonBlock className="h-48" />;
  if (!integrity) return <Alert status="danger">Could not run the integrity check.</Alert>;

  if (integrity.orphaned.length === 0 && integrity.overloadedDoctors.length === 0) {
    return (
      <Card density="compact">
        <EmptyState
          icon={ShieldCheck}
          title="Nothing flagged"
          description="Every active link points at an account that exists, and no doctor is over the patient-count threshold."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {integrity.orphaned.length > 0 && (
        <Card
          density="compact"
          header={<h2 className="text-h3 font-semibold text-ink-primary">Orphaned links</h2>}
        >
          <p className="mb-3 text-caption text-ink-muted">
            Active links naming a user id with no account behind it. Consent links intentionally have no foreign key
            to the user table — an account is created on first sign-in — so a dangling reference is detected here
            rather than prevented.
          </p>
          <Table>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>Patient id</TableHeadCell>
                <TableHeadCell>Doctor id</TableHeadCell>
                <TableHeadCell>Problem</TableHeadCell>
                <TableHeadCell>Granted</TableHeadCell>
                <TableHeadCell />
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {integrity.orphaned.map((link) => (
                <TableRow key={link.id}>
                  <TableCell mono muted>
                    {link.patientUserId}
                  </TableCell>
                  <TableCell mono muted>
                    {link.doctorUserId}
                  </TableCell>
                  <TableCell>{MISSING_LABEL[link.missing] ?? link.missing}</TableCell>
                  <TableCell muted>{new Date(link.grantedAt).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="destructive"
                      size="sm"
                      loading={revokeConsent.isPending}
                      onClick={() => revokeConsent.mutate(link.id)}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {integrity.overloadedDoctors.length > 0 && (
        <Card
          density="compact"
          header={<h2 className="text-h3 font-semibold text-ink-primary">Doctors over the threshold</h2>}
        >
          <p className="mb-3 text-caption text-ink-muted">
            Doctors holding more active consents than the scan's threshold. Not proof of anything on its own — a busy
            practice looks the same as an account hoarding patients — but it is the shape that abuse would take.
          </p>
          <Table>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>Doctor id</TableHeadCell>
                <TableHeadCell>Active patients</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {integrity.overloadedDoctors.map((doctor) => (
                <TableRow key={doctor.doctorUserId}>
                  <TableCell mono muted>
                    {doctor.doctorUserId}
                  </TableCell>
                  <TableCell className="font-tabular">{doctor.patientCount.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
