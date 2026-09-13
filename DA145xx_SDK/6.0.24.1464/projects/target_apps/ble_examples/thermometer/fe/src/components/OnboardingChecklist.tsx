import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Circle, X } from 'lucide-react';
import { useConsents, useDevices } from '../api/queries';
import { useThermometerStore } from '../state/store';
import { Card } from './ui/Card';
import { cn } from './ui/cn';

const DISMISSED_KEY = 'thermometer.onboarding.dismissed';

/**
 * localStorage is unavailable in a few real browser configurations (Safari
 * private mode, storage-blocked embeds) — a checklist is not worth throwing
 * over, so both accessors degrade to "not dismissed".
 */
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, 'true');
  } catch {
    // Dismissal just won't survive a reload — acceptable.
  }
}

interface Step {
  id: string;
  label: string;
  description: string;
  done: boolean;
  to: string;
  cta: string;
}

function StepRow({ step }: { step: Step }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border',
          step.done
            ? 'border-success-border bg-success-tint text-success-text'
            : 'border-sand-300 text-ink-muted dark:border-sand-600',
        )}
      >
        {step.done ? <Check className="size-3.5" aria-hidden /> : <Circle className="size-2.5" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'text-body font-semibold',
            step.done ? 'text-ink-muted line-through' : 'text-ink-primary',
          )}
        >
          {step.label}
        </div>
        {!step.done && (
          <>
            <p className="text-caption text-ink-secondary">{step.description}</p>
            <Link
              to={step.to}
              className="mt-1 inline-flex items-center gap-1 text-body font-semibold text-primary-600 hover:underline focus-visible:outline-none focus-visible:shadow-focus dark:text-primary-300"
            >
              {step.cta}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </>
        )}
      </div>
      <span className="sr-only">{step.done ? 'Completed' : 'Not completed'}</span>
    </li>
  );
}

/**
 * Three-step getting-started checklist for new customers (feature #10).
 *
 * Self-contained: it reads the same device/consent queries the rest of the
 * dashboard already has cached, so mounting it costs no extra request. It
 * disappears for good once all three steps are done, and can be dismissed
 * early (remembered in localStorage).
 */
export function OnboardingChecklist({ className }: { className?: string }) {
  const devicesQuery = useDevices();
  const consentsQuery = useConsents();
  const bleStatus = useThermometerStore((s) => s.status);
  const [dismissed, setDismissed] = useState(readDismissed);

  const devices = devicesQuery.data ?? [];
  const hasDevice = devices.length > 0;
  // "Has data ever reached the platform" — either this tab currently holds a
  // BLE session, or a claimed device has reported at least once through any
  // collector. The BLE store is per-session and resets on reload, so
  // lastSeenAt is what makes this step stay ticked.
  const hasReported = bleStatus === 'connected' || devices.some((device) => device.lastSeenAt != null);
  const hasDoctor = (consentsQuery.data ?? []).some((consent) => consent.revokedAt === null);

  const steps: Step[] = [
    {
      id: 'claim',
      label: 'Claim your thermometer',
      description: 'Link a device to your account so its readings are stored for you.',
      done: hasDevice,
      to: '/devices',
      cta: 'Browse devices',
    },
    {
      id: 'connect',
      label: 'Take your first reading',
      description: 'Connect over Bluetooth and let the thermometer send a measurement.',
      done: hasReported,
      to: '/connect',
      cta: 'Connect a thermometer',
    },
    {
      id: 'share',
      label: 'Share with a doctor (optional)',
      description: 'Grant a doctor access to your readings — you can revoke it at any time.',
      done: hasDoctor,
      to: '/settings',
      cta: 'Choose a doctor',
    },
  ];

  const doneCount = steps.filter((step) => step.done).length;

  // Nothing to nudge about once everything is done, and nothing worth showing
  // before the queries that decide the steps have resolved.
  if (dismissed || devicesQuery.isLoading || doneCount === steps.length) return null;

  const handleDismiss = () => {
    persistDismissed();
    setDismissed(true);
  };

  return (
    <Card
      density="compact"
      className={className}
      header={
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-h3 font-semibold text-ink-primary">
            Getting started{' '}
            <span className="font-tabular text-caption font-normal text-ink-muted">
              {doneCount} of {steps.length}
            </span>
          </h2>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss the getting-started checklist"
            className="rounded-md p-1 text-ink-muted hover:bg-sand-50 focus-visible:outline-none focus-visible:shadow-focus dark:hover:bg-surface-2"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      }
    >
      <ol className="space-y-3">
        {steps.map((step) => (
          <StepRow key={step.id} step={step} />
        ))}
      </ol>
    </Card>
  );
}
