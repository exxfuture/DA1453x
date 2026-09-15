import { useMe } from '../api/queries';
import { ProfileSection } from './settings/ProfileSection';
import { PasswordSection } from './settings/PasswordSection';
import { MyThresholdsSection } from './settings/MyThresholdsSection';
import { MyDoctorsSection } from './settings/MyDoctorsSection';
import { SystemThresholdsSection } from './settings/SystemThresholdsSection';

/**
 * The one page every role shares, composed from one section per concern in
 * `./settings/` (review FE-15 — this file used to define all six inline across
 * 461 lines, mixing profile editing, the Keycloak redirect, two threshold
 * editors, consent granting and paginated history).
 *
 * Which sections appear is the only logic left here, and it is role-driven:
 * profile and password for everyone, thresholds + doctor consent for customers,
 * the system-default scale for admins. Doctors see only the two shared
 * sections — their per-patient overrides live on the Patients page, next to the
 * patient they apply to.
 */
export function SettingsPage() {
  const meQuery = useMe();
  const role = meQuery.data?.role;

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6">
      <h1 className="font-display text-display font-semibold text-ink-primary">Settings</h1>

      <ProfileSection />
      <PasswordSection />

      {role === 'customer' && (
        <>
          <MyThresholdsSection />
          <MyDoctorsSection />
        </>
      )}

      {role === 'admin' && <SystemThresholdsSection />}
    </div>
  );
}
