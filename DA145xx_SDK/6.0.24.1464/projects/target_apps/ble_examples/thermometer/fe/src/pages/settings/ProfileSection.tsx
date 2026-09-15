import { FormEvent, useEffect, useState } from 'react';
import { TemperatureUnit } from '../../api/client';
import { useMe, useUpdateMe } from '../../api/queries';
import { useTransientFlag } from '../../hooks/useTransientFlag';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';

/**
 * Identity and display preferences — every role sees this section.
 *
 * Username, e-mail and role are read-only here on purpose: they come from
 * Keycloak, and the local copy is a mirror (see backend `CurrentUserService`),
 * so an editable field would promise something this app cannot keep.
 */
export function ProfileSection() {
  const meQuery = useMe();
  const updateMe = useUpdateMe();
  const [displayName, setDisplayName] = useState('');
  const [temperatureUnit, setTemperatureUnit] = useState<TemperatureUnit>('CELSIUS');
  const justSaved = useTransientFlag(updateMe.isSuccess);

  useEffect(() => {
    if (meQuery.data) {
      setDisplayName(meQuery.data.displayName ?? '');
      setTemperatureUnit(meQuery.data.temperatureUnit);
    }
  }, [meQuery.data]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    updateMe.mutate({ displayName, temperatureUnit });
  };

  return (
    <Card density="compact" header={<h2 className="text-h3 font-semibold text-ink-primary">Profile</h2>}>
      {meQuery.data && (
        <div className="space-y-3">
          <div className="text-body text-ink-secondary">
            Username: <span className="text-ink-primary">{meQuery.data.username}</span>
          </div>
          <div className="text-body text-ink-secondary">
            Email: <span className="text-ink-primary">{meQuery.data.email ?? '—'}</span>
          </div>
          <div className="text-body text-ink-secondary">
            Role: <span className="text-ink-primary capitalize">{meQuery.data.role}</span>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              id="displayName"
              label="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <Select
              id="temperatureUnit"
              label="Temperature unit"
              value={temperatureUnit}
              onChange={(e) => setTemperatureUnit(e.target.value as TemperatureUnit)}
            >
              <option value="CELSIUS">Celsius (°C)</option>
              <option value="FAHRENHEIT">Fahrenheit (°F)</option>
            </Select>
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" loading={updateMe.isPending}>
                Save
              </Button>
              {/* Expires on its own — see useTransientFlag (review FE-29). */}
              {justSaved && <span className="text-body font-semibold text-success-text">Saved ✓</span>}
            </div>
            {updateMe.isError && <Alert status="danger">Could not save settings — please try again.</Alert>}
          </form>
        </div>
      )}
    </Card>
  );
}
