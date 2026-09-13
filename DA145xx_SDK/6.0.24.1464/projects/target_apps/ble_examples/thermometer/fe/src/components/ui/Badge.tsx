import { type ReactNode } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Bluetooth,
  BluetoothOff,
  BluetoothSearching,
  CheckCircle2,
  Flame,
  Info,
  Snowflake,
} from 'lucide-react';
import { cn } from './cn';
import type { TemperatureTier } from '../../theme/temperature';

export type BadgeStatus = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const STATUS_CLASSES: Record<BadgeStatus, string> = {
  success: 'bg-success-tint text-success-text border-success-border',
  warning: 'bg-warning-tint text-warning-text border-warning-border',
  danger: 'bg-danger-tint text-danger-text border-danger-border',
  info: 'bg-info-tint text-info-text border-info-border',
  neutral: 'bg-sand-100 text-sand-600 border-sand-300 dark:bg-surface-2 dark:text-sand-400 dark:border-sand-600',
};

const STATUS_ICON: Record<BadgeStatus, ReactNode> = {
  success: <CheckCircle2 className="size-4" aria-hidden />,
  warning: <AlertTriangle className="size-4" aria-hidden />,
  danger: <AlertOctagon className="size-4" aria-hidden />,
  info: <Info className="size-4" aria-hidden />,
  neutral: null,
};

export interface BadgeProps {
  status?: BadgeStatus;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Generic status pill. Always pairs color with an icon + text label — never color alone. */
export function Badge({ status = 'neutral', icon, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-label font-semibold',
        STATUS_CLASSES[status],
        className,
      )}
    >
      {icon ?? STATUS_ICON[status]}
      {children}
    </span>
  );
}

const TEMP_TIER_CLASSES: Record<TemperatureTier, string> = {
  low: 'bg-temp-low-tint text-temp-low-text border-temp-low-border',
  normal: 'bg-temp-normal-tint text-temp-normal-text border-temp-normal-border',
  elevated: 'bg-temp-elevated-tint text-temp-elevated-text border-temp-elevated-border',
  fever: 'bg-temp-fever-tint text-temp-fever-text border-temp-fever-border',
  highFever: 'bg-temp-high-fever-tint text-temp-high-fever-text border-temp-high-fever-border animate-pulse',
};

const TEMP_TIER_ICON: Record<TemperatureTier, ReactNode> = {
  low: <Snowflake className="size-4" aria-hidden />,
  normal: <CheckCircle2 className="size-4" aria-hidden />,
  elevated: <AlertTriangle className="size-4" aria-hidden />,
  fever: <Flame className="size-4" aria-hidden />,
  highFever: <Flame className="size-4 fill-current" aria-hidden />,
};

export function TemperatureBadge({ tier, label, className }: { tier: TemperatureTier; label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-label font-semibold motion-reduce:animate-none',
        TEMP_TIER_CLASSES[tier],
        className,
      )}
    >
      {TEMP_TIER_ICON[tier]}
      {label}
    </span>
  );
}

export type ConnectionState = 'connected' | 'pairing' | 'disconnected' | 'failed';

const CONNECTION_CLASSES: Record<ConnectionState, string> = {
  connected: 'bg-success-tint text-success-text border-success-border',
  pairing: 'bg-warning-tint text-warning-text border-warning-border animate-pulse',
  // An idle disconnect is normal, not an error — neutral, not danger.
  disconnected: 'bg-sand-100 text-sand-600 border-sand-300 dark:bg-surface-2 dark:text-sand-400 dark:border-sand-600',
  failed: 'bg-danger-tint text-danger-text border-danger-border',
};

const CONNECTION_ICON: Record<ConnectionState, ReactNode> = {
  connected: <Bluetooth className="size-4" aria-hidden />,
  pairing: <BluetoothSearching className="size-4" aria-hidden />,
  disconnected: <BluetoothOff className="size-4" aria-hidden />,
  failed: <AlertOctagon className="size-4" aria-hidden />,
};

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connected: 'Connected',
  pairing: 'Pairing…',
  disconnected: 'Disconnected',
  failed: 'Connection failed',
};

export function ConnectionBadge({ state, className }: { state: ConnectionState; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-label font-semibold motion-reduce:animate-none',
        CONNECTION_CLASSES[state],
        className,
      )}
    >
      {CONNECTION_ICON[state]}
      {CONNECTION_LABEL[state]}
    </span>
  );
}
