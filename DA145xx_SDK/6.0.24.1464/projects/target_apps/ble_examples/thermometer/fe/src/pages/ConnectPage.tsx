import { useEffect, useRef, useState } from 'react';
import { Radio } from 'lucide-react';
import { BleTransport } from '../ble/BleTransport';
import { createBleTransport } from '../ble/createBleTransport';
import { SimulatedBluetoothTransport } from '../ble/simulatedBluetoothTransport';
import { useThermometerStore, type ConnectionStatus } from '../state/store';
import { publishMeasurement, subscribeLive, LiveMeasurement } from '../live/mqttClient';
import { buildTemperatureEnvelope } from '../live/envelope';
import { api } from '../api/client';
import { useClaimDevice, useMe } from '../api/queries';
import { useTransientFlag } from '../hooks/useTransientFlag';
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

/** How many live-feed events the panel keeps on screen. */
const LIVE_EVENT_LIMIT = 5;

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
  const signedIn = meQuery.data != null;
  const justClaimed = useTransientFlag(claimDevice.isSuccess);
  const [liveEvents, setLiveEvents] = useState<LiveMeasurement[]>([]);

  /**
   * Tears the transport down when this page unmounts (review FE-05).
   *
   * Without it, navigating away via any in-app link left the transport running:
   * the simulator's setInterval kept publishing to MQTT and REST forever in the
   * background, and a real device kept its GATT connection and notification
   * stream open — draining its battery with no way to stop short of coming back
   * to /connect. Empty dependency list on purpose: this must run on unmount
   * only, and the ref is read at that moment rather than captured.
   */
  useEffect(
    () => () => {
      transportRef.current?.disconnect();
      transportRef.current = null;
    },
    [],
  );

  // Subscribes to our own live feed regardless of connection state, so this
  // panel demonstrates the full loop: local reading -> publish -> backend
  // ingest -> live re-publish (architecture v3 §7) -> this subscription.
  //
  // No user id is passed: subscribeLive() derives the topic from the id inside
  // the broker credential the backend mints, which is server-asserted (see
  // live/mqttClient.ts, review FE-03). Gated on /api/me having resolved simply
  // because minting needs a live access token — not because the id is used here.
  useEffect(() => {
    if (!signedIn) return undefined;
    return subscribeLive((measurement) => {
      setLiveEvents((prev) => [measurement, ...prev].slice(0, LIVE_EVENT_LIMIT));
    });
  }, [signedIn]);

  const connectWith = async (transport: BleTransport) => {
    setStatus('connecting');
    try {
      const device = await transport.requestDevice();
      transportRef.current = transport;
      setDevice(device.id, device.name);

      transport.onTemperature((celsius) => {
        setReading(celsius);

        const envelope = buildTemperatureEnvelope(device.id, celsius);
        // Direct MQTT/WSS publish (primary path) — REST is the fallback
        // upload path per architecture v2 §5.2, used here as a durability
        // belt-and-braces since this demo has no offline queue yet. Both are
        // best-effort and independent: publishing now also has to mint a broker
        // credential first (review FE-03), so it can reject like any request.
        publishMeasurement(envelope).catch(() => {
          // broker or credential unavailable — the REST upload below still runs
        });
        api.uploadMeasurement(envelope).catch(() => {
          // best-effort fallback; the MQTT publish above already attempted delivery
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
    // No model is sent (review FE-14): this page cannot know what the hardware
    // actually is — Web Bluetooth doesn't expose it and the simulator isn't
    // hardware at all — so a hardcoded 'DA14535' only fed the admin console's
    // model breakdown a literal unrelated to the device. The backend defaults
    // the column, and an admin can correct it from the device registry; a real
    // value would have to come from the Device Information Service.
    claimDevice.mutate({ bdAddr: deviceId });
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
          onClick={() => void connectWith(createBleTransport())}
          disabled={status === 'connecting' || status === 'connected' || !bluetoothSupported}
          loading={status === 'connecting'}
        >
          Connect via Bluetooth
        </Button>
        <Button
          variant="secondary"
          onClick={() => void connectWith(new SimulatedBluetoothTransport())}
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
            {/* Expires on its own — see useTransientFlag (review FE-29). */}
            {justClaimed && <span className="text-body font-semibold text-success-text">Claimed ✓</span>}
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
            {liveEvents.map((event) => (
              // Keyed by the reading's own identity, not its position (review
              // FE-28): the list is built by unshifting, so an index key makes
              // React reconcile every row on each new event.
              <li key={`${event.ts}-${event.device_id}`} className="font-tabular">
                {new Date(event.ts).toLocaleTimeString()} — {event.device_id} — {JSON.stringify(event.payload)}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
