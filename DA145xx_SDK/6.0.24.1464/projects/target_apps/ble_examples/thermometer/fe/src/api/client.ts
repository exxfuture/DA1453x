import { getAuthToken, userManager } from '../auth/oidc';
import { TemperatureTier } from '../theme/temperature';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

/**
 * The envelope every paginated endpoint returns (backend
 * `api/dto/PageResponse`) — deliberately not Spring Data's own `Page` shape,
 * whose serialized form is documented as unstable.
 *
 * `page` is **zero-based**, matching the `page` query parameter. The
 * `Pagination` component is 1-based, so pages wiring the two together need
 * the ±1.
 */
export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

/** Paging parameters accepted by every paginated endpoint. `page` is zero-based. */
export interface PageParams {
  page?: number;
  size?: number;
}

export interface DeviceResponse {
  id: string;
  bdAddr: string;
  model: string;
  /** Customer-set friendly name; null = unnamed — fall back to `model` for display. */
  label: string | null;
  fwVersion: string | null;
  ownerUserId: string | null;
  ownerUsername: string | null;
  claimedAt: string | null;
  createdAt: string;
  /** When this device last reported anything; null until the first reading arrives. */
  lastSeenAt: string | null;
  /** Which measurement that last reading was (temperature/humidity/battery). */
  lastSeenType: string | null;
}

export interface MeasurementResponse {
  ts: string;
  deviceId: string;
  type: string;
  valueNum: number | null;
  payload: string;
  collectorId: string | null;
}

export type TemperatureUnit = 'CELSIUS' | 'FAHRENHEIT';

export interface MeResponse {
  id: string;
  username: string;
  email: string | null;
  role: 'customer' | 'doctor' | 'admin';
  displayName: string | null;
  temperatureUnit: TemperatureUnit;
}

export interface DoctorResponse {
  id: string;
  username: string;
  displayName: string | null;
}

export interface ConsentResponse {
  id: string;
  patientUserId: string;
  patientUsername: string | null;
  doctorUserId: string;
  doctorUsername: string | null;
  grantedAt: string;
  revokedAt: string | null;
}

export interface PatientResponse {
  patientUserId: string;
  patientUsername: string | null;
  deviceBdAddr: string | null;
  deviceModel: string | null;
}

export interface SparkPoint {
  ts: string;
  celsius: number;
}

/**
 * Ordering hint for a doctor's worklist — a triage heuristic derived from the
 * latest reading's tier and its recency. **Not a clinical score**; never
 * present it as a medical assessment.
 */
export type RiskTier = 'urgent' | 'watch' | 'low';

export interface PatientSummaryResponse {
  patientUserId: string;
  patientUsername: string | null;
  deviceBdAddr: string | null;
  deviceModel: string | null;
  /** Unbounded — the patient's most recent reading ever, even outside the requested range. */
  latestCelsius: number | null;
  latestAt: string | null;
  avgCelsius: number | null;
  minCelsius: number | null;
  maxCelsius: number | null;
  /** Population standard deviation over the requested window — the "is this swinging?" signal. */
  stddevCelsius: number | null;
  readingCount: number;
  sparkline: SparkPoint[];
  riskTier: RiskTier;
  /** 0–100, the value `riskTier` was derived from. */
  riskScore: number;
  /** No reading within the backend's staleness window (6 h) — replaces the FE's old heuristic. */
  stale: boolean;
}

export interface AdminUserResponse {
  id: string;
  username: string;
  email: string | null;
  role: 'customer' | 'doctor' | 'admin';
  displayName: string | null;
  devices: { bdAddr: string; model: string }[];
  activeConsentCount: number;
}

// ---- alert thresholds -----------------------------------------------------

/**
 * Which scope an effective scale came from. `fallback` means nothing is
 * stored anywhere and the hardcoded defaults (mirroring `theme/temperature.ts`)
 * are in effect.
 */
export type ThresholdSource = 'doctor_override' | 'self' | 'system' | 'fallback';

/**
 * A complete tier scale. `id`/`scope`/`subjectUserId`/`setByUserId`/`updatedAt`
 * are only populated when a stored row is returned (the scoped GET/PUT
 * endpoints) — a resolved-effective read carries the boundaries and `source`
 * only.
 */
export interface ThresholdResponse {
  id: string | null;
  scope: string | null;
  subjectUserId: string | null;
  setByUserId: string | null;
  normalStartC: number;
  elevatedStartC: number;
  feverStartC: number;
  highFeverStartC: number;
  source: ThresholdSource;
  updatedAt: string | null;
}

/** All four boundaries, always — the backend rejects a partial body. */
export interface UpsertThresholdRequest {
  normalStartC: number;
  elevatedStartC: number;
  feverStartC: number;
  highFeverStartC: number;
}

// ---- fever episodes -------------------------------------------------------

/**
 * One detected fever "episode", derived on read from the measurements
 * hypertable against whichever scale applies to the viewer.
 */
export interface TemperatureEventResponse {
  deviceBdAddr: string;
  /** Worst tier reached — only ever 'elevated', 'fever' or 'highFever'. */
  tier: TemperatureTier;
  startTs: string;
  endTs: string;
  peakCelsius: number;
  readingCount: number;
}

/**
 * One consenting patient's episodes in the doctor's fleet feed. A patient
 * with no device, or with no episodes, is still present with an empty list.
 */
export interface PatientEventsResponse {
  patientUserId: string;
  patientUsername: string | null;
  deviceBdAddr: string | null;
  events: TemperatureEventResponse[];
}

// ---- customer reading annotations -----------------------------------------

export interface AnnotationResponse {
  id: string;
  userId: string;
  deviceBdAddr: string;
  tsFrom: string;
  /** Null for a note pinned to a single instant; set for a span. */
  tsTo: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnnotationRequest {
  deviceBdAddr: string;
  tsFrom: string;
  tsTo?: string | null;
  note: string;
}

/** `tsFrom` is not editable — moving a note's anchor would re-attach it to different readings. */
export interface UpdateAnnotationRequest {
  note: string;
  tsTo?: string | null;
}

// ---- doctor care notes ----------------------------------------------------

/** Doctor-private: readable by its author and, read-only, by an admin. */
export interface CareNoteResponse {
  id: string;
  doctorUserId: string;
  doctorUsername: string | null;
  patientUserId: string;
  patientUsername: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCareNoteRequest {
  patientUserId: string;
  note: string;
}

export interface UpdateCareNoteRequest {
  note: string;
}

// ---- consent history & audit log ------------------------------------------

/**
 * One entry in the caller's **consent lifecycle** history.
 *
 * This is not an access log: the audit log records grants and revocations,
 * never reads, so nothing here says whether a doctor actually looked at any
 * data. Do not label it otherwise in the UI.
 */
export interface ConsentHistoryResponse {
  id: number;
  action: 'consent.grant' | 'consent.revoke';
  doctorUserId: string | null;
  doctorUsername: string | null;
  at: string;
}

/**
 * One audit-log row. `subject` is whatever the action acted on — a BD address,
 * a user id, or a request path for `access.denied` — so it is an opaque
 * string. `actorUsername` is only filled in by the admin viewer.
 */
export interface AuditLogResponse {
  id: number;
  actorId: string | null;
  actorUsername: string | null;
  action: string;
  subject: string | null;
  detail: string | null;
  at: string;
}

// ---- OTA rollouts ---------------------------------------------------------

export interface RolloutSummaryResponse {
  id: string;
  version: string;
  chipModel: string;
  imageUrl: string;
  deltaUrl: string | null;
  groupPercentage: number;
  abortThresholdPct: number;
  status: string;
  createdAt: string;
  targetCount: number;
  /**
   * Keyed by the raw target status ('pending' / 'installed' / 'failed'), and
   * only containing statuses that actually occur — a rollout nobody has
   * reported on yet has an empty object, not three zeroes.
   */
  statusCounts: Record<string, number>;
}

export interface RolloutTargetResponse {
  deviceBdAddr: string;
  status: string;
  reportedAt: string | null;
  errorDetail: string | null;
}

export interface RolloutDetailResponse {
  rollout: RolloutSummaryResponse;
  targets: RolloutTargetResponse[];
}

// ---- admin analytics ------------------------------------------------------

export interface IngestStatsResponse {
  readingsLastHour: number;
  readingsLastDay: number;
  devicesLastHour: number;
  devicesLastDay: number;
  byTypeLastDay: { type: string; count: number }[];
}

export interface DeviceInventoryResponse {
  total: number;
  claimed: number;
  unclaimed: number;
  reportingLastDay: number;
  byModel: { model: string; fwVersion: string | null; count: number }[];
}

export interface UserGrowthResponse {
  total: number;
  byRole: { role: string; count: number }[];
  signupsLast90Days: { day: string; count: number }[];
}

export interface ConsentIntegrityResponse {
  activeLinks: number;
  orphaned: {
    id: string;
    patientUserId: string;
    doctorUserId: string;
    /** Which side has no users row. */
    missing: 'patient' | 'doctor' | 'both';
    grantedAt: string;
  }[];
  overloadedDoctors: { doctorUserId: string; patientCount: number }[];
}

export interface RetentionResponse {
  /** An estimate from pg_class.reltuples — never an exact COUNT(*) over the hypertable. */
  estimatedRows: number;
  totalBytes: number;
  /** Oldest timestamp seen in the exact 30-day breakdown; null when there are no recent readings. */
  oldestRecentReading: string | null;
  topDevicesLast30Days: {
    deviceBdAddr: string;
    rowsLast30Days: number;
    firstTs: string;
    lastTs: string;
  }[];
}

export interface SecurityOpsResponse {
  windowHours: number;
  deniedLast24h: number;
  byAction: { action: string; count: number }[];
  repeatedActions: ActorAnomaly[];
  topDenied: ActorAnomaly[];
}

export interface ActorAnomaly {
  actorId: string;
  action: string;
  count: number;
  lastAt: string;
}

/**
 * Serializes only the parameters that are actually set — an empty or
 * undefined value means "not filtering", not "match the empty string".
 * Returns '' when nothing is set, so it can always be appended to a path.
 */
function queryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

function fetchWithToken(path: string, init: RequestInit | undefined, token: string | null): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response = await fetchWithToken(path, init, getAuthToken());
  if (response.status === 401 && getAuthToken()) {
    // The access token expired between oidc-client-ts's automaticSilentRenew
    // and this call (e.g. the tab was backgrounded/suspended past the
    // renew window). Redeem the refresh token once and retry before giving
    // up — signinSilent() throws if the refresh token is itself invalid,
    // and the retry below then fails the same way the first call did.
    try {
      await userManager.signinSilent();
    } catch {
      // fall through — retry with whatever token we still have, which will
      // 401 again and surface as a normal request failure below
    }
    response = await fetchWithToken(path, init, getAuthToken());
  }
  if (!response.ok) {
    // Spring's default error body is {"message": "...", ...} — surface that
    // instead of a generic status line, falling back to the generic form if
    // the body isn't JSON/doesn't have it.
    let message = `${init?.method ?? 'GET'} ${path} failed: ${response.status} ${response.statusText}`;
    try {
      const body: unknown = await response.clone().json();
      if (body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string') {
        message = (body as { message: string }).message;
      }
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new Error(message);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/**
 * For endpoints where 204 means "nothing is stored here" rather than "done"
 * (the scoped threshold reads). Normalised to null because TanStack Query
 * rejects `undefined` as query data.
 */
async function requestOrNull<T>(path: string, init?: RequestInit): Promise<T | null> {
  return (await request<T | null>(path, init)) ?? null;
}

export const api = {
  me: () => request<MeResponse>('/api/me'),
  updateMe: (update: { displayName: string; temperatureUnit: TemperatureUnit }) =>
    request<MeResponse>('/api/me', { method: 'PATCH', body: JSON.stringify(update) }),

  claimDevice: (bdAddr: string, model?: string, fwVersion?: string) =>
    request<DeviceResponse>(`/api/devices/${encodeURIComponent(bdAddr)}/claim`, {
      method: 'POST',
      body: JSON.stringify({ model, fwVersion }),
    }),
  releaseDevice: (bdAddr: string) =>
    request<void>(`/api/devices/${encodeURIComponent(bdAddr)}/release`, { method: 'POST' }),
  /** Owner-scoped rename; an empty string clears the label (falls back to model). */
  renameDevice: (bdAddr: string, label: string) =>
    request<DeviceResponse>(`/api/devices/${encodeURIComponent(bdAddr)}/label`, {
      method: 'PATCH',
      body: JSON.stringify({ label }),
    }),
  listDevices: () => request<DeviceResponse[]>('/api/devices'),
  availableDevices: () => request<DeviceResponse[]>('/api/devices/available'),

  uploadMeasurement: (envelope: unknown) =>
    request<void>('/api/measurements', {
      method: 'POST',
      body: JSON.stringify(envelope),
    }),

  measurementHistory: (deviceId: string, type = 'temperature', options?: { from?: string; to?: string; limit?: number }) => {
    const params = new URLSearchParams({ type });
    if (options?.from) params.set('from', options.from);
    if (options?.to) params.set('to', options.to);
    if (options?.limit) params.set('limit', String(options.limit));
    return request<MeasurementResponse[]>(`/api/measurements/${encodeURIComponent(deviceId)}?${params.toString()}`);
  },

  doctors: () => request<DoctorResponse[]>('/api/doctors'),
  consents: () => request<ConsentResponse[]>('/api/consents'),
  grantConsent: (doctorUserId: string) =>
    request<ConsentResponse>('/api/consents', { method: 'POST', body: JSON.stringify({ doctorUserId }) }),
  revokeConsent: (id: string) => request<void>(`/api/consents/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  doctorPatients: () => request<PatientResponse[]>('/api/doctor/patients'),
  doctorPatientsSummary: (rangeHours: number) =>
    request<PatientSummaryResponse[]>(`/api/doctor/patients/summary?rangeHours=${rangeHours}`),

  // ---- alert thresholds ---------------------------------------------------

  /** The scale actually in effect, and where it came from. Omit the subject for "me". */
  getResolvedThresholds: (subjectUserId?: string) =>
    request<ThresholdResponse>(`/api/thresholds/resolved${queryString({ subjectUserId })}`),
  /** null when nothing is stored at this scope (the caller inherits). */
  getMyThreshold: () => requestOrNull<ThresholdResponse>('/api/thresholds/mine'),
  upsertMyThreshold: (values: UpsertThresholdRequest) =>
    request<ThresholdResponse>('/api/thresholds/mine', { method: 'PUT', body: JSON.stringify(values) }),
  clearMyThreshold: () => request<void>('/api/thresholds/mine', { method: 'DELETE' }),

  getPatientThreshold: (patientUserId: string) =>
    requestOrNull<ThresholdResponse>(`/api/thresholds/patient/${encodeURIComponent(patientUserId)}`),
  upsertPatientThreshold: (patientUserId: string, values: UpsertThresholdRequest) =>
    request<ThresholdResponse>(`/api/thresholds/patient/${encodeURIComponent(patientUserId)}`, {
      method: 'PUT',
      body: JSON.stringify(values),
    }),
  clearPatientThreshold: (patientUserId: string) =>
    request<void>(`/api/thresholds/patient/${encodeURIComponent(patientUserId)}`, { method: 'DELETE' }),

  getSystemThreshold: () => requestOrNull<ThresholdResponse>('/api/thresholds/system'),
  /** No DELETE counterpart — overwrite the system row rather than removing it. */
  upsertSystemThreshold: (values: UpsertThresholdRequest) =>
    request<ThresholdResponse>('/api/thresholds/system', { method: 'PUT', body: JSON.stringify(values) }),

  // ---- fever episodes -----------------------------------------------------

  /** Defaults to the last 7 days server-side; the window may not exceed 90 days. */
  listDeviceEvents: (bdAddr: string, options?: { from?: string; to?: string }) =>
    request<TemperatureEventResponse[]>(
      `/api/events/device/${encodeURIComponent(bdAddr)}${queryString({ from: options?.from, to: options?.to })}`,
    ),
  listPatientEvents: (options?: { from?: string; to?: string }) =>
    request<PatientEventsResponse[]>(`/api/events/patients${queryString({ from: options?.from, to: options?.to })}`),

  // ---- customer reading annotations ---------------------------------------

  createAnnotation: (annotation: CreateAnnotationRequest) =>
    request<AnnotationResponse>('/api/annotations', { method: 'POST', body: JSON.stringify(annotation) }),
  listAnnotations: (deviceBdAddr: string, options?: { from?: string; to?: string; limit?: number }) =>
    request<AnnotationResponse[]>(
      `/api/annotations${queryString({ deviceBdAddr, from: options?.from, to: options?.to, limit: options?.limit })}`,
    ),
  updateAnnotation: (id: string, update: UpdateAnnotationRequest) =>
    request<AnnotationResponse>(`/api/annotations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),
  deleteAnnotation: (id: string) => request<void>(`/api/annotations/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ---- doctor care notes --------------------------------------------------

  createCareNote: (note: CreateCareNoteRequest) =>
    request<CareNoteResponse>('/api/care-notes', { method: 'POST', body: JSON.stringify(note) }),
  listCareNotes: (patientUserId: string) =>
    request<CareNoteResponse[]>(`/api/care-notes${queryString({ patientUserId })}`),
  updateCareNote: (id: string, update: UpdateCareNoteRequest) =>
    request<CareNoteResponse>(`/api/care-notes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),
  deleteCareNote: (id: string) => request<void>(`/api/care-notes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ---- consent history & audit feeds --------------------------------------

  /** The caller's own grant/revoke history — consent lifecycle, never data reads. */
  consentAccessHistory: (params?: PageParams) =>
    request<PageResponse<ConsentHistoryResponse>>(`/api/consents/access-history${queryString({ ...params })}`),
  /**
   * Consent actions a doctor performed themselves — empty in normal operation,
   * since consent is patient-initiated. Use `doctorAuditLog` for a doctor's
   * actual consent history.
   */
  doctorConsentActivity: (params?: PageParams) =>
    request<PageResponse<AuditLogResponse>>(`/api/doctor/consent-activity${queryString({ ...params })}`),
  /** Everything this doctor did, plus everything done to them (e.g. a patient granting consent). */
  doctorAuditLog: (params?: PageParams) =>
    request<PageResponse<AuditLogResponse>>(`/api/doctor/audit-log${queryString({ ...params })}`),

  // ---- OTA rollouts (admin) -----------------------------------------------

  listRollouts: (params?: PageParams) =>
    request<PageResponse<RolloutSummaryResponse>>(`/api/rollouts${queryString({ ...params })}`),
  rolloutDetail: (id: string) => request<RolloutDetailResponse>(`/api/rollouts/${encodeURIComponent(id)}`),

  // ---- admin --------------------------------------------------------------

  adminUsers: (params?: PageParams & { q?: string; role?: string }) =>
    request<PageResponse<AdminUserResponse>>(`/api/admin/users${queryString({ ...params })}`),
  /**
   * Corrects the local role mirror only — CurrentUserService re-syncs from the
   * JWT on the user's next request, so this is not a substitute for editing
   * the Keycloak realm.
   */
  adminUpdateUserRole: (id: string, role: 'customer' | 'doctor' | 'admin') =>
    request<AdminUserResponse>(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  adminConsents: (params?: PageParams) =>
    request<PageResponse<ConsentResponse>>(`/api/admin/consents${queryString({ ...params })}`),
  adminAuditLog: (
    params?: PageParams & { actorId?: string; action?: string; subject?: string; from?: string; to?: string },
  ) => request<PageResponse<AuditLogResponse>>(`/api/admin/audit-log${queryString({ ...params })}`),
  /** Read-only compliance view; `patientUserId` is required by the backend. */
  adminCareNotes: (patientUserId: string, doctorUserId?: string) =>
    request<CareNoteResponse[]>(`/api/admin/care-notes${queryString({ patientUserId, doctorUserId })}`),
  adminReleaseDevice: (bdAddr: string) =>
    request<void>(`/api/admin/devices/${encodeURIComponent(bdAddr)}/release`, { method: 'POST' }),
  adminEditDevice: (bdAddr: string, edit: { model?: string; fwVersion?: string; label?: string | null }) =>
    request<DeviceResponse>(`/api/admin/devices/${encodeURIComponent(bdAddr)}`, {
      method: 'PATCH',
      body: JSON.stringify(edit),
    }),

  // ---- admin analytics ----------------------------------------------------

  adminIngestStats: () => request<IngestStatsResponse>('/api/admin/analytics/ingest'),
  adminDeviceInventory: () => request<DeviceInventoryResponse>('/api/admin/analytics/device-inventory'),
  adminUserGrowth: () => request<UserGrowthResponse>('/api/admin/analytics/user-growth'),
  adminConsentIntegrity: (doctorPatientThreshold?: number) =>
    request<ConsentIntegrityResponse>(`/api/admin/analytics/consent-integrity${queryString({ doctorPatientThreshold })}`),
  adminRetention: () => request<RetentionResponse>('/api/admin/analytics/retention'),
  adminSecurityOps: (threshold?: number) =>
    request<SecurityOpsResponse>(`/api/admin/analytics/security-ops${queryString({ threshold })}`),
};
