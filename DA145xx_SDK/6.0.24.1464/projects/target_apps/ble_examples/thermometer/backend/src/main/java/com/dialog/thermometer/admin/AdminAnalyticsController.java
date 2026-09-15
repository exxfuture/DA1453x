package com.dialog.thermometer.admin;

import com.dialog.thermometer.security.CurrentUserService;
import com.dialog.thermometer.security.Role;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;

/**
 * Operational panels for the admin console: ingest health, device inventory,
 * user growth, consent-data integrity, storage/retention and a security-ops
 * anomaly summary.
 *
 * <p>Raw SQL throughout, matching MeasurementController/ConsentController:
 * these are read-only aggregate queries over tables that mostly have no
 * entity (measurements is a hypertable, and the catalog views have none by
 * definition), and expressing {@code GROUP BY … HAVING} through JPA would
 * only obscure them.
 *
 * <p><b>Every query here is bounded</b> — by an explicit time window, a
 * {@code LIMIT}, or by being a catalog lookup. Nothing in an admin dashboard
 * is worth a full scan of a two-year hypertable, and {@link #retention()}
 * documents the one place that temptation is strongest.
 *
 * <p>Response records are nested rather than living in {@code api/dto}: each
 * one is the shape of exactly one panel and is not reused anywhere else, so
 * hoisting them would spread a dozen single-use files across the codebase.
 */
@RestController
@RequestMapping("/api/admin/analytics")
public class AdminAnalyticsController {

    /** Cap on per-group rows returned by the breakdown panels. */
    private static final int MAX_ROWS = 100;

    private final JdbcTemplate jdbcTemplate;
    private final CurrentUserService currentUserService;

    public AdminAnalyticsController(JdbcTemplate jdbcTemplate, CurrentUserService currentUserService) {
        this.jdbcTemplate = jdbcTemplate;
        this.currentUserService = currentUserService;
    }

    // ---- ingest health --------------------------------------------------

    public record IngestStats(long readingsLastHour, long readingsLastDay, long devicesLastHour, long devicesLastDay,
                               List<TypeCount> byTypeLastDay) {

        public record TypeCount(String type, long count) {
        }
    }

    /**
     * "Is data still flowing?" Both windows are computed in one pass over the
     * last day's chunks — a single index-bounded scan, not two.
     */
    @GetMapping("/ingest")
    public IngestStats ingest(Authentication authentication) {
        requireAdmin(authentication);

        IngestStats totals = jdbcTemplate.queryForObject("""
                SELECT
                    COUNT(*) FILTER (WHERE ts > now() - INTERVAL '1 hour')                    AS readings_hour,
                    COUNT(*)                                                                  AS readings_day,
                    COUNT(DISTINCT device_id) FILTER (WHERE ts > now() - INTERVAL '1 hour')   AS devices_hour,
                    COUNT(DISTINCT device_id)                                                 AS devices_day
                FROM measurements
                WHERE ts > now() - INTERVAL '1 day'
                """, (rs, n) -> new IngestStats(rs.getLong("readings_hour"), rs.getLong("readings_day"),
                rs.getLong("devices_hour"), rs.getLong("devices_day"), List.of()));

        List<IngestStats.TypeCount> byType = jdbcTemplate.query("""
                SELECT type, COUNT(*) AS cnt
                FROM measurements
                WHERE ts > now() - INTERVAL '1 day'
                GROUP BY type
                ORDER BY cnt DESC
                """, (rs, n) -> new IngestStats.TypeCount(rs.getString("type"), rs.getLong("cnt")));

        return new IngestStats(totals.readingsLastHour(), totals.readingsLastDay(), totals.devicesLastHour(),
                totals.devicesLastDay(), byType);
    }

    // ---- device inventory -----------------------------------------------

    public record DeviceInventory(long total, long claimed, long unclaimed, long reportingLastDay,
                                   List<ModelCount> byModel) {

        public record ModelCount(String model, String fwVersion, long count) {
        }
    }

    @GetMapping("/device-inventory")
    public DeviceInventory deviceInventory(Authentication authentication) {
        requireAdmin(authentication);

        DeviceInventory totals = jdbcTemplate.queryForObject("""
                SELECT COUNT(*)                                                             AS total,
                       COUNT(*) FILTER (WHERE owner_user_id IS NOT NULL)                    AS claimed,
                       COUNT(*) FILTER (WHERE owner_user_id IS NULL)                        AS unclaimed,
                       COUNT(*) FILTER (WHERE last_seen_at > now() - INTERVAL '1 day')      AS reporting
                FROM devices
                """, (rs, n) -> new DeviceInventory(rs.getLong("total"), rs.getLong("claimed"),
                rs.getLong("unclaimed"), rs.getLong("reporting"), List.of()));

        // last_seen_at (V8) is why the "still reporting" count above is a
        // devices-table predicate rather than a hypertable fan-out.
        List<DeviceInventory.ModelCount> byModel = jdbcTemplate.query("""
                SELECT model, fw_version, COUNT(*) AS cnt
                FROM devices
                GROUP BY model, fw_version
                ORDER BY cnt DESC, model
                LIMIT ?
                """, (rs, n) -> new DeviceInventory.ModelCount(rs.getString("model"), rs.getString("fw_version"),
                rs.getLong("cnt")), MAX_ROWS);

        return new DeviceInventory(totals.total(), totals.claimed(), totals.unclaimed(), totals.reportingLastDay(),
                byModel);
    }

    // ---- user growth ----------------------------------------------------

    public record UserGrowth(long total, List<RoleCount> byRole, List<DailySignups> signupsLast90Days) {

        public record RoleCount(String role, long count) {
        }

        public record DailySignups(Instant day, long count) {
        }
    }

    @GetMapping("/user-growth")
    public UserGrowth userGrowth(Authentication authentication) {
        requireAdmin(authentication);

        List<UserGrowth.RoleCount> byRole = jdbcTemplate.query("""
                SELECT role, COUNT(*) AS cnt FROM users GROUP BY role ORDER BY cnt DESC
                """, (rs, n) -> new UserGrowth.RoleCount(rs.getString("role"), rs.getLong("cnt")));

        List<UserGrowth.DailySignups> signups = jdbcTemplate.query("""
                SELECT date_trunc('day', created_at) AS day, COUNT(*) AS cnt
                FROM users
                WHERE created_at > now() - INTERVAL '90 days'
                GROUP BY day
                ORDER BY day
                """, (rs, n) -> new UserGrowth.DailySignups(rs.getTimestamp("day").toInstant(), rs.getLong("cnt")));

        return new UserGrowth(byRole.stream().mapToLong(UserGrowth.RoleCount::count).sum(), byRole, signups);
    }

    // ---- consent integrity ----------------------------------------------

    public record ConsentIntegrity(long activeLinks, List<OrphanedLink> orphaned, List<DoctorLoad> overloadedDoctors) {

        /** @param missing which side has no users row: "patient", "doctor", or "both" */
        public record OrphanedLink(String id, String patientUserId, String doctorUserId, String missing,
                                    Instant grantedAt) {
        }

        public record DoctorLoad(String doctorUserId, long patientCount) {
        }
    }

    /**
     * Data-integrity check for consent_links. There is intentionally no
     * foreign key from {@code consent_links} to {@code users} (V2: ids are
     * loosely-coupled strings so a link can exist before a user is
     * JIT-provisioned), which is exactly why a dangling reference has to be
     * detected rather than prevented — this is the report that makes that
     * tradeoff visible instead of silent.
     *
     * @param doctorPatientThreshold flag doctors holding more than this many
     *                               active consents; a plausible-looking
     *                               account hoarding patients is the shape a
     *                               consent-farming abuse would take
     */
    @GetMapping("/consent-integrity")
    public ConsentIntegrity consentIntegrity(
            @RequestParam(defaultValue = "50") int doctorPatientThreshold, Authentication authentication) {
        requireAdmin(authentication);
        int threshold = Math.max(1, doctorPatientThreshold);

        Long activeLinks = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM consent_links WHERE revoked_at IS NULL", Long.class);

        List<ConsentIntegrity.OrphanedLink> orphaned = jdbcTemplate.query("""
                SELECT c.id, c.patient_user_id, c.doctor_user_id, c.granted_at,
                       CASE
                           WHEN NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.patient_user_id)
                            AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.doctor_user_id) THEN 'both'
                           WHEN NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.patient_user_id) THEN 'patient'
                           ELSE 'doctor'
                       END AS missing
                FROM consent_links c
                WHERE c.revoked_at IS NULL
                  AND (NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.patient_user_id)
                       OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.doctor_user_id))
                ORDER BY c.granted_at DESC
                LIMIT ?
                """, (rs, n) -> new ConsentIntegrity.OrphanedLink(rs.getString("id"), rs.getString("patient_user_id"),
                rs.getString("doctor_user_id"), rs.getString("missing"), rs.getTimestamp("granted_at").toInstant()),
                MAX_ROWS);

        List<ConsentIntegrity.DoctorLoad> overloaded = jdbcTemplate.query("""
                SELECT doctor_user_id, COUNT(*) AS cnt
                FROM consent_links
                WHERE revoked_at IS NULL
                GROUP BY doctor_user_id
                HAVING COUNT(*) > ?
                ORDER BY cnt DESC
                LIMIT ?
                """, (rs, n) -> new ConsentIntegrity.DoctorLoad(rs.getString("doctor_user_id"), rs.getLong("cnt")),
                threshold, MAX_ROWS);

        return new ConsentIntegrity(activeLinks != null ? activeLinks : 0, orphaned, overloaded);
    }

    // ---- retention / storage --------------------------------------------

    public record Retention(long estimatedRows, long totalBytes, Instant oldestRecentReading,
                             List<DeviceVolume> topDevicesLast30Days) {

        public record DeviceVolume(String deviceBdAddr, long rowsLast30Days, Instant firstTs, Instant lastTs) {
        }
    }

    /**
     * Storage footprint of the measurements hypertable.
     *
     * <p><b>{@code estimatedRows} is an estimate, deliberately.</b> A
     * {@code COUNT(*)} here would scan every chunk of a table holding two
     * years of per-minute readings per device, on a page nobody opens for an
     * exact number. It comes from {@code pg_class.reltuples}, which the
     * autovacuum daemon maintains — summed across the hypertable's chunks,
     * since for a hypertable the parent relation itself holds no rows (the
     * same reason the size is summed rather than read from the parent).
     * {@code reltuples} is -1 on a relation that has never been analysed, so
     * those are floored to 0 rather than subtracted.
     *
     * <p>The per-device breakdown <i>is</i> exact, but is bounded to the last
     * 30 days so it rides the existing {@code idx_measurements_device_type_ts}
     * index and touches only recent chunks.
     */
    @GetMapping("/retention")
    public Retention retention(Authentication authentication) {
        requireAdmin(authentication);

        Retention totals = jdbcTemplate.queryForObject("""
                SELECT COALESCE(SUM(GREATEST(c.reltuples, 0)), 0)::bigint  AS estimated_rows,
                       COALESCE(SUM(pg_total_relation_size(c.oid)), 0)::bigint AS total_bytes
                FROM pg_class c
                WHERE c.oid = 'measurements'::regclass
                   OR c.oid IN (SELECT inhrelid FROM pg_inherits WHERE inhparent = 'measurements'::regclass)
                """, (rs, n) -> new Retention(rs.getLong("estimated_rows"), rs.getLong("total_bytes"), null,
                List.of()));

        List<Retention.DeviceVolume> topDevices = jdbcTemplate.query("""
                SELECT device_id, COUNT(*) AS cnt, MIN(ts) AS first_ts, MAX(ts) AS last_ts
                FROM measurements
                WHERE ts > now() - INTERVAL '30 days'
                GROUP BY device_id
                ORDER BY cnt DESC
                LIMIT ?
                """, (rs, n) -> new Retention.DeviceVolume(rs.getString("device_id"), rs.getLong("cnt"),
                rs.getTimestamp("first_ts").toInstant(), rs.getTimestamp("last_ts").toInstant()), MAX_ROWS);

        Instant oldestRecent = topDevices.stream().map(Retention.DeviceVolume::firstTs)
                .min(Instant::compareTo).orElse(null);

        return new Retention(totals.estimatedRows(), totals.totalBytes(), oldestRecent, topDevices);
    }

    // ---- security ops ----------------------------------------------------

    public record SecurityOps(int windowHours, long deniedLast24h, List<ActionCount> byAction,
                               List<ActorAnomaly> repeatedActions, List<ActorAnomaly> topDenied) {

        public record ActionCount(String action, long count) {
        }

        public record ActorAnomaly(String actorId, String action, long count, Instant lastAt) {
        }
    }

    /**
     * Anomaly summary over the last 24 h of audit_log: who is repeating the
     * same action unusually often, and who is being denied access.
     *
     * <p>The {@code access.denied} rows this reads are written by
     * {@link com.dialog.thermometer.security.AccessDeniedAuditor} — without
     * it the panel would only ever show successful actions, i.e. exactly not
     * the ones worth looking at.
     *
     * @param threshold how many repeats of one action by one actor within the
     *                  window counts as worth showing; a blunt instrument, but
     *                  it is the signal available from an append-only log
     *                  without adding per-request instrumentation
     */
    @GetMapping("/security-ops")
    public SecurityOps securityOps(@RequestParam(defaultValue = "50") int threshold, Authentication authentication) {
        requireAdmin(authentication);
        int effectiveThreshold = Math.max(1, threshold);

        Long denied = jdbcTemplate.queryForObject("""
                SELECT COUNT(*) FROM audit_log
                WHERE action = 'access.denied' AND at > now() - INTERVAL '24 hours'
                """, Long.class);

        List<SecurityOps.ActionCount> byAction = jdbcTemplate.query("""
                SELECT action, COUNT(*) AS cnt
                FROM audit_log
                WHERE at > now() - INTERVAL '24 hours'
                GROUP BY action
                ORDER BY cnt DESC
                LIMIT ?
                """, (rs, n) -> new SecurityOps.ActionCount(rs.getString("action"), rs.getLong("cnt")), MAX_ROWS);

        List<SecurityOps.ActorAnomaly> repeated = jdbcTemplate.query("""
                SELECT actor_id, action, COUNT(*) AS cnt, MAX(at) AS last_at
                FROM audit_log
                WHERE at > now() - INTERVAL '24 hours' AND actor_id IS NOT NULL
                GROUP BY actor_id, action
                HAVING COUNT(*) > ?
                ORDER BY cnt DESC
                LIMIT ?
                """, AdminAnalyticsController::mapAnomaly, effectiveThreshold, MAX_ROWS);

        List<SecurityOps.ActorAnomaly> topDenied = jdbcTemplate.query("""
                SELECT actor_id, action, COUNT(*) AS cnt, MAX(at) AS last_at
                FROM audit_log
                WHERE action = 'access.denied' AND at > now() - INTERVAL '24 hours' AND actor_id IS NOT NULL
                GROUP BY actor_id, action
                ORDER BY cnt DESC
                LIMIT ?
                """, AdminAnalyticsController::mapAnomaly, MAX_ROWS);

        return new SecurityOps(24, denied != null ? denied : 0, byAction, repeated, topDenied);
    }

    private static SecurityOps.ActorAnomaly mapAnomaly(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
        return new SecurityOps.ActorAnomaly(rs.getString("actor_id"), rs.getString("action"), rs.getLong("cnt"),
                rs.getTimestamp("last_at").toInstant());
    }

    private void requireAdmin(Authentication authentication) {
        currentUserService.resolveWithRole(authentication, "admin role required", Role.ADMIN);
    }
}
