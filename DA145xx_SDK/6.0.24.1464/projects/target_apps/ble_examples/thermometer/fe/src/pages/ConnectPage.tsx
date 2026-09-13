import { useEffect, useRef, useState } from 'react';
import { Radio } from 'lucide-react';
import { BleTransport } from '../ble/BleTransport';
import { createBleTransport } from '../ble/createBleTransport';
import { SimulatedBluetoothTransport } from '../ble/simulatedBluetoothTransport';
import { useThermometerStore, type ConnectionStatus } from '../state/store';
import { publishMeasurement, subscribeLive, LiveMeasurement } from '../live/mqttClient';
import { api } from '../api/client';
import { useClaimDevice, useMe } from '../api/queries';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { ConnectionBadge, type ConnectionState } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { convertFromCelsius, unitSuffix } from '../utils/temperature';

const CONNECTION_STATE_BY_STATUS: Record<ConnectionStatus, ConnectionState> = {
  idle: 'disconnected',
  connecting: 'pairing',
  connected: 'connected',
  error: 'failed',
};

/**
 * Two ways to get a BleTransport here: the real one (Web Bluetooth or the
 * Capacitor native plugin, picked by createBleTransport()) and the
 * simulator — same interface, same rest-of-the-app code either way.
 */
export function ConnectPage() {
  const transportRef = useRef<BleTransport | null>(null);
  const { status, temperature, lastReadingAt, errorMessage, deviceId, deviceName, setStatus, setReading, setError, setDevice, reset } =
    useThermometerStore();
  const claimDevice = useClaimDevice();
  const meQuery = useMe();
  const unit = meQuery.data?.temperatureUnit ?? 'CELSIUS';
  const myId = meQuery.data?.id;
  const [liveEvents, setLiveEvents] = useState<LiveMeasurement[]>([]);

  // Subscribes to our own live feed regardless of connection state, so this
  // panel demonstrates the full loop: local reading -> publish -> backend
  // ingest -> live re-publish (architecture v3 §7) -> this subscription.
  // Keyed on /api/me's stable id — see subscribeLive() for why the JWT `sub`
  // must not be used here.
  useEffect(() => {
    if (!myId) return;
    const unsubscribe = subscribeLive((measurement) => {
      setLiveEvents((prev) => [measurement, ...prev].slice(0, 5));
    }, myId);
    return unsubscribe;
  }, [myId]);

  const connectWith = async (transport: BleTransport) => {
    setStatus('connecting');
    try {
      const device = await transport.requestDevice();
      transportRef.current = transport;
      setDevice(device.id, device.name);

      transport.onTemperature((celsius) => {
        setReading(celsius);

        const envelope = {
          v: 1,
          device_id: device.id,
          collector_id: 'web-fe',
          ts: new Date().toISOString(),
          type: 'temperature',
          payload: { celsius },
        };
        // Direct MQTT/WSS publish (primary path) — REST is the fallback
        // upload path per architecture v2 §5.2, used here as a durability
        // belt-and-braces since this demo has no offline queue yet.
        publishMeasurement(envelope);
        api.uploadMeasurement(envelope).catch(() => {
          // best-effort fallback; MQTT publish above already attempted delivery
        });
      });

      transport.onDisconnected(() => {
        reset();
      });

      setStatus('connected');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDisconnect = () => {
    transportRef.current?.disconnect();
    transportRef.current = null;
    reset();
  };

  const handleClaim = () => {
    if (!deviceId) return;
    claimDevice.mutate({ bdAddr: deviceId, model: 'DA14535' });
  };

  const bluetoothSupported = typeof navigator !== 'undefined' && !!navigator.bluetooth;
  const connectionState = CONNECTION_STATE_BY_STATUS[status];

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-display font-semibold text-ink-primary">Connect a thermometer</h1>
        <ConnectionBadge state={connectionState} />
      </div>

      {!bluetoothSupported && (
        <Alert status="info">
          Web Bluetooth isn't available in this browser (needs Chrome or Edge) — use "Connect (Simulated Device)"
          below, or the mobile app.
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => connectWith(createBleTransport())}
          disabled={status === 'connecting' || status === 'connected' || !bluetoothSupported}
          loading={status === 'connecting'}
        >
          Connect via Bluetooth
        </Button>
        <Button
          variant="secondary"
          onClick={() => connectWith(new SimulatedBluetoothTransport())}
          disabled={status === 'connecting' || status === 'connected'}
        >
          Connect (Simulated Device)
        </Button>
        <Button variant="tertiary" onClick={handleDisconnect} disabled={status !== 'connected'}>
          Disconnect
        </Button>
      </div>

      {status === 'error' && <Alert status="danger">{errorMessage}</Alert>}

      {status === 'connected' && (
        <Card>
          <div className="mb-3 text-caption text-ink-secondary">
            {deviceName} <span className="text-ink-muted">({deviceId})</span>
          </div>
          <div className="font-tabular font-display text-hero-2 text-ink-primary">
            {temperature !== null ? (
              <>
                {convertFromCelsius(temperature, unit).toFixed(2)} <span className="text-h2 text-ink-muted">{unitSuffix(unit)}</span>
              </>
            ) : (
              <span className="text-h1 text-ink-muted">Waiting for a reading…</span>
            )}
          </div>
          {lastReadingAt && (
            <div className="mt-1 text-caption text-ink-muted">last reading {lastReadingAt.toLocaleTimeString()}</div>
          )}
          <div className="mt-4 flex items-center gap-3">
            <Button size="sm" onClick={handleClaim} loading={claimDevice.isPending}>
              Claim this device to my account
            </Button>
            {claimDevice.isSuccess && (
              <span className="text-body font-semibold text-success-text">Claimed ✓</span>
            )}
          </div>
          {claimDevice.isError && (
            <div className="mt-2">
              <Alert status="danger">
                Could not claim — this device is already claimed by another user (a device can have only
                one owner; you may claim as many devices as you like).
              </Alert>
            </div>
          )}
        </Card>
      )}

      <Card density="compact" header={<h2 className="text-h3 font-semibold text-ink-primary">Live feed</h2>}>
        <p className="mb-3 text-caption text-ink-muted">
          Direct MQTT/WSS subscription — only appears once a device is claimed; the backend fans readings out to{' '}
          <code className="font-mono">live/&#123;user_id&#125;/...</code> after ingest (architecture v3 §7).
        </p>
        {liveEvents.length === 0 ? (
          <EmptyState icon={Radio} title="No live events yet." />
        ) : (
          <ul className="space-y-1 text-body text-ink-secondary">
            {liveEvents.map((event, i) => (
              <li key={i} className="font-tabular">
                {new Date(event.ts).toLocaleTimeString()} — {event.device_id} — {JSON.stringify(event.payload)}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
