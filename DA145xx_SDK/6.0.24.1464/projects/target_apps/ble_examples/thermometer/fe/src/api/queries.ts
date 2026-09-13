import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  CreateAnnotationRequest,
  CreateCareNoteRequest,
  PageParams,
  TemperatureUnit,
  UpdateAnnotationRequest,
  UpdateCareNoteRequest,
  UpsertThresholdRequest,
} from './client';
import { resolveTimeWindow, timeWindowKey, type TimeWindow } from '../utils/timeWindow';

/**
 * Editable, low-frequency data (thresholds, notes, audit feeds): it only
 * changes when somebody acts, and every action that changes it invalidates
 * its key — so it is refetched on demand rather than on a timer.
 */
const ON_DEMAND_STALE_TIME = 60_000;

/**
 * Admin analytics panels. Each is an aggregate query over a large table, and
 * nothing on those pages is read for a to-the-second number, so they are
 * cached noticeably longer than the operational views.
 */
const ANALYTICS_STALE_TIME = 5 * 60_000;

/**
 * Fever episodes are derived from measurements, which stream in continuously
 * — but an episode is a coarse, minutes-to-hours-scale object, so a minute is
 * a fitting refresh cadence (the 5 s of the raw measurement feed would be
 * pure churn).
 */
const EVENT_REFETCH_INTERVAL = 60_000;

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: api.me });
}

export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: { displayName: string; temperatureUnit: TemperatureUnit }) => api.updateMe(update),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useDevices() {
  return useQuery({ queryKey: ['devices'], queryFn: api.listDevices });
}

export function useAvailableDevices() {
  return useQuery({ queryKey: ['devices', 'available'], queryFn: api.availableDevices, refetchInterval: 5000 });
}

export function useClaimDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bdAddr, model, fwVersion }: { bdAddr: string; model?: string; fwVersion?: string }) =>
      api.claimDevice(bdAddr, model, fwVersion),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });
}

export function useReleaseDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bdAddr: string) => api.releaseDevice(bdAddr),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });
}

export function useRenameDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bdAddr, label }: { bdAddr: string; label: string }) => api.renameDevice(bdAddr, label),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });
}

/**
 * The window (see ../utils/timeWindow.ts) drives the query key (stable
 * across refetches); the actual from/to instants are resolved fresh at fetch
 * time (mount + every refetchInterval tick) so a sliding "last N hours"
 * window keeps moving with the clock instead of freezing at first render. A
 * custom window's fixed instants just pass through unchanged.
 */
export function useMeasurementHistory(deviceId: string | null, window: TimeWindow) {
  return useQuery({
    queryKey: ['measurements', deviceId, timeWindowKey(window)],
    queryFn: () => api.measurementHistory(deviceId as string, 'temperature', resolveTimeWindow(window)),
    enabled: !!deviceId,
    refetchInterval: 5000,
  });
}

export function useDoctors() {
  return useQuery({ queryKey: ['doctors'], queryFn: api.doctors });
}

export function useConsents() {
  return useQuery({ queryKey: ['consents'], queryFn: api.consents });
}

export function useGrantConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (doctorUserId: string) => api.grantConsent(doctorUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consents'] });
      // A grant changes the consent table the integrity scan reads, so the
      // admin relationship view's tiles/"flagged only" list must not sit on
      // a 5-minute ANALYTICS_STALE_TIME snapshot of pre-grant state.
      queryClient.invalidateQueries({ queryKey: ['admin', 'analytics', 'consent-integrity'] });
    },
  });
}

export function useRevokeConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.revokeConsent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consents'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'consents'] });
      // Revoking an orphaned link is exactly what clears its integrity
      // warning — without this the flagged row and counts stay visible
      // until the analytics cache ages out.
      queryClient.invalidateQueries({ queryKey: ['admin', 'analytics', 'consent-integrity'] });
    },
  });
}

export function useDoctorPatients() {
  return useQuery({ queryKey: ['doctor-patients'], queryFn: api.doctorPatients, refetchInterval: 10000 });
}

export function useDoctorPatientsSummary(rangeHours: number) {
  return useQuery({
    queryKey: ['doctor-patients', 'summary', rangeHours],
    queryFn: () => api.doctorPatientsSummary(rangeHours),
    refetchInterval: 10000,
  });
}

/**
 * Paged, searchable user browser. `q` matches username or email, `role`
 * filters exactly; both are optional and combine. Returns a `PageResponse`,
 * so read rows from `data.content`.
 */
export function useAdminUsers(params: PageParams & { q?: string; role?: string } = {}) {
  return useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: () => api.adminUsers(params),
    staleTime: ON_DEMAND_STALE_TIME,
  });
}

/**
 * Changes the role in the local registry only — CurrentUserService re-syncs
 * it from the JWT on that user's next request, so the change is authoritative
 * until then and is not a substitute for editing the Keycloak realm.
 */
export function useAdminUpdateUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'customer' | 'doctor' | 'admin' }) =>
      api.adminUpdateUserRole(id, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit-log'] });
    },
  });
}

export function useAdminConsents(params: PageParams = {}) {
  return useQuery({
    queryKey: ['admin', 'consents', params],
    queryFn: () => api.adminConsents(params),
    staleTime: ON_DEMAND_STALE_TIME,
  });
}

export function useAdminAuditLog(
  params: PageParams & { actorId?: string; action?: string; subject?: string; from?: string; to?: string } = {},
) {
  return useQuery({
    queryKey: ['admin', 'audit-log', params],
    queryFn: () => api.adminAuditLog(params),
    staleTime: ON_DEMAND_STALE_TIME,
  });
}

/** Admin-only read of one patient's care notes (compliance view; no write path). */
export function useAdminCareNotes(patientUserId: string | null, doctorUserId?: string) {
  return useQuery({
    queryKey: ['admin', 'care-notes', patientUserId, doctorUserId ?? null],
    queryFn: () => api.adminCareNotes(patientUserId as string, doctorUserId),
    enabled: !!patientUserId,
    staleTime: ON_DEMAND_STALE_TIME,
  });
}

export function useAdminReleaseDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bdAddr: string) => api.adminReleaseDevice(bdAddr),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}

export function useAdminEditDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bdAddr, edit }: { bdAddr: string; edit: { model?: string; fwVersion?: string; label?: string | null } }) =>
      api.adminEditDevice(bdAddr, edit),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });
}

// ---- alert thresholds -------------------------------------------------------

/**
 * The scale actually in effect for a subject (omit for "me"), plus the scope
 * it came from. A doctor asking about a patient gets the scale *they* see,
 * i.e. including their own override.
 */
export function useResolvedThresholds(subjectUserId?: string) {
  return useQuery({
    queryKey: ['thresholds', 'resolved', subjectUserId ?? null],
    queryFn: () => api.getResolvedThresholds(subjectUserId),
    staleTime: ON_DEMAND_STALE_TIME,
  });
}

/** The customer's own stored scale, or null when they inherit. */
export function useMyThreshold() {
  return useQuery({
    queryKey: ['thresholds', 'mine'],
    queryFn: api.getMyThreshold,
    staleTime: ON_DEMAND_STALE_TIME,
  });
}

export function useUpsertMyThreshold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: UpsertThresholdRequest) => api.upsertMyThreshold(values),
    onSuccess: () => invalidateThresholdDerived(queryClient),
  });
}

export function useClearMyThreshold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearMyThreshold(),
    onSuccess: () => invalidateThresholdDerived(queryClient),
  });
}

/** This doctor's override for one patient, or null when they have not set one. */
export function usePatientThreshold(patientUserId: string | null) {
  return useQuery({
    queryKey: ['thresholds', 'patient', patientUserId],
    queryFn: () => api.getPatientThreshold(patientUserId as string),
    enabled: !!patientUserId,
    staleTime: ON_DEMAND_STALE_TIME,
  });
}

export function useUpsertPatientThreshold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ patientUserId, values }: { patientUserId: string; values: UpsertThresholdRequest }) =>
      api.upsertPatientThreshold(patientUserId, values),
    onSuccess: () => invalidateThresholdDerived(queryClient),
  });
}

export function useClearPatientThreshold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patientUserId: string) => api.clearPatientThreshold(patientUserId),
    onSuccess: () => invalidateThresholdDerived(queryClient),
  });
}

/** The system default scale, or null when none is stored (the hardcoded fallback applies). */
export function useSystemThreshold() {
  return useQuery({
    queryKey: ['thresholds', 'system'],
    queryFn: api.getSystemThreshold,
    staleTime: ON_DEMAND_STALE_TIME,
  });
}

export function useUpsertSystemThreshold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: UpsertThresholdRequest) => api.upsertSystemThreshold(values),
    onSuccess: () => invalidateThresholdDerived(queryClient),
  });
}

/**
 * Fever episodes and the doctor dashboard's risk ranking are both *derived*
 * from whichever scale is in effect, so any threshold edit invalidates them
 * too — otherwise the tiers on screen would keep describing the old scale
 * until their next natural refetch.
 */
function invalidateThresholdDerived(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['thresholds'] });
  queryClient.invalidateQueries({ queryKey: ['events'] });
  queryClient.invalidateQueries({ queryKey: ['doctor-patients'] });
}

// ---- fever episodes ---------------------------------------------------------

/**
 * Same sliding-window math as `resolveTimeWindow` (../utils/timeWindow.ts),
 * kept as a plain rangeHours helper for the doctor fleet feed below, which
 * has no custom-range UI of its own.
 */
function slidingWindow(rangeHours: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - rangeHours * 3_600_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Episodes for one device. The backend caps the window at 90 days. */
export function useDeviceEvents(bdAddr: string | null, window: TimeWindow) {
  return useQuery({
    queryKey: ['events', 'device', bdAddr, timeWindowKey(window)],
    queryFn: () => api.listDeviceEvents(bdAddr as string, resolveTimeWindow(window)),
    enabled: !!bdAddr,
    refetchInterval: EVENT_REFETCH_INTERVAL,
  });
}

/** Doctor fleet feed: every consenting patient's episodes in one window. */
export function usePatientEvents(rangeHours: number) {
  return useQuery({
    queryKey: ['events', 'patients', rangeHours],
    queryFn: () => api.listPatientEvents(slidingWindow(rangeHours)),
    refetchInterval: EVENT_REFETCH_INTERVAL,
  });
}

// ---- customer reading annotations -------------------------------------------

/** Notes on one device's readings over the same window as the chart. */
export function useAnnotations(deviceBdAddr: string | null, window: TimeWindow) {
  return useQuery({
    queryKey: ['annotations', deviceBdAddr, timeWindowKey(window)],
    queryFn: () => api.listAnnotations(deviceBdAddr as string, resolveTimeWindow(window)),
    enabled: !!deviceBdAddr,
    staleTime: ON_DEMAND_STALE_TIME,
  });
}

export function useCreateAnnotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (annotation: CreateAnnotationRequest) => api.createAnnotation(annotation),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['annotations'] }),
  });
}

export function useUpdateAnnotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, update }: { id: string; update: UpdateAnnotationRequest }) => api.updateAnnotation(id, update),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['annotations'] }),
  });
}

export function useDeleteAnnotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteAnnotation(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['annotations'] }),
  });
}

// ---- doctor care notes ------------------------------------------------------

/** The calling doctor's own notes about one patient — never another doctor's. */
export function useCareNotes(patientUserId: string | null) {
  return useQuery({
    queryKey: ['care-notes', patientUserId],
    queryFn: () => api.listCareNotes(patientUserId as string),
    enabled: !!patientUserId,
    staleTime: ON_DEMAND_STALE_TIME,
  });
}

export function useCreateCareNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: CreateCareNoteRequest) => api.createCareNote(note),
    onSuccess: () => invalidateCareNotes(queryClient),
  });
}

export function useUpdateCareNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, update }: { id: string; update: UpdateCareNoteRequest }) => api.updateCareNote(id, update),
    onSuccess: () => invalidateCareNotes(queryClient),
  });
}

export function useDeleteCareNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCareNote(id),
    onSuccess: () => invalidateCareNotes(queryClient),
  });
}

/** The doctor feed and the admin compliance view read the same rows under different keys. */
function invalidateCareNotes(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['care-notes'] });
  queryClient.invalidateQueries({ queryKey: ['admin', 'care-notes'] });
}

// ---- consent history & audit feeds ------------------------------------------

/**
 * The customer's own consent grant/revoke history.
 *
 * Consent *lifecycle*, not data access: the audit log records grants and
 * revocations, never reads. A UI built on this must not claim to show who
 * looked at anything.
 */
export function useConsentAccessHistory(params: PageParams = {}) {
  return useQuery({
    queryKey: ['consents', 'access-history', params],
    queryFn: () => api.consentAccessHistory(params),
    staleTime: ON_DEMAND_STALE_TIME,
  });
}

/**
 * Consent actions the doctor performed themselves — in practice always empty,
 * since consent is patient-initiated and the doctor is the *subject* of those
 * entries, not the actor. Kept for completeness; `useDoctorAuditLog` is what a
 * doctor's consent-history UI should actually read.
 */
export function useDoctorConsentActivity(params: PageParams = {}) {
  return useQuery({
    queryKey: ['doctor', 'consent-activity', params],
    queryFn: () => api.doctorConsentActivity(params),
    staleTime: ON_DEMAND_STALE_TIME,
  });
}

/** Everything this doctor did, plus everything done to them (grants, revocations, overrides). */
export function useDoctorAuditLog(params: PageParams = {}) {
  return useQuery({
    queryKey: ['doctor', 'audit-log', params],
    queryFn: () => api.doctorAuditLog(params),
    staleTime: ON_DEMAND_STALE_TIME,
  });
}

// ---- OTA rollouts (admin) ---------------------------------------------------

/** Rollout list, newest first, with per-status target tallies. */
export function useRollouts(params: PageParams = {}) {
  return useQuery({
    queryKey: ['admin', 'rollouts', params],
    queryFn: () => api.listRollouts(params),
    // An in-flight rollout's progress counts move as collectors report in.
    refetchInterval: 30_000,
  });
}

export function useRollout(id: string | null) {
  return useQuery({
    queryKey: ['admin', 'rollouts', 'detail', id],
    queryFn: () => api.rolloutDetail(id as string),
    enabled: !!id,
    refetchInterval: 30_000,
  });
}

// ---- admin analytics --------------------------------------------------------

/** "Is data still flowing?" — the one analytics panel worth refreshing on a timer. */
export function useAdminIngestStats() {
  return useQuery({
    queryKey: ['admin', 'analytics', 'ingest'],
    queryFn: api.adminIngestStats,
    refetchInterval: 60_000,
  });
}

export function useAdminDeviceInventory() {
  return useQuery({
    queryKey: ['admin', 'analytics', 'device-inventory'],
    queryFn: api.adminDeviceInventory,
    staleTime: ANALYTICS_STALE_TIME,
  });
}

export function useAdminUserGrowth() {
  return useQuery({
    queryKey: ['admin', 'analytics', 'user-growth'],
    queryFn: api.adminUserGrowth,
    staleTime: ANALYTICS_STALE_TIME,
  });
}

/** @param doctorPatientThreshold flag doctors holding more than this many active consents (default 50). */
export function useAdminConsentIntegrity(doctorPatientThreshold?: number) {
  return useQuery({
    queryKey: ['admin', 'analytics', 'consent-integrity', doctorPatientThreshold ?? null],
    queryFn: () => api.adminConsentIntegrity(doctorPatientThreshold),
    staleTime: ANALYTICS_STALE_TIME,
  });
}

export function useAdminRetention() {
  return useQuery({
    queryKey: ['admin', 'analytics', 'retention'],
    queryFn: api.adminRetention,
    staleTime: ANALYTICS_STALE_TIME,
  });
}

/** @param threshold how many repeats of one action by one actor in 24 h counts as an anomaly (default 50). */
export function useAdminSecurityOps(threshold?: number) {
  return useQuery({
    queryKey: ['admin', 'analytics', 'security-ops', threshold ?? null],
    queryFn: () => api.adminSecurityOps(threshold),
    staleTime: ANALYTICS_STALE_TIME,
  });
}
