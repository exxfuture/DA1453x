package com.dialog.thermometer.patient;

import com.dialog.thermometer.api.dto.PatientSummaryResponse;
import com.dialog.thermometer.domain.Device;
import com.dialog.thermometer.threshold.AlertThresholdService;
import com.dialog.thermometer.threshold.AlertThresholdService.ResolvedThresholds;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Builds one doctor-dashboard row per patient: the latest reading, the window's
 * aggregates and sparkline, a staleness flag, and the triage ranking.
 *
 * <p>Extracted from {@code ConsentController} (which now only resolves the
 * caller, checks their role and maps the response) for the same reason
 * {@link AlertThresholdService} and {@code TemperatureEventService} are
 * services: the interesting part — the risk heuristic and the staleness rule —
 * is pure arithmetic, and while it lived in a controller as private methods the
 * only way to exercise it was a full HTTP round trip in an integration test
 * against a real Postgres. {@link #riskScoreOf} and {@link #riskTierOf} are
 * public so they can be unit-tested directly.
 */
@Service
public class PatientSummaryService {

    /**
     * How long a patient may go without a reading before the dashboard calls
     * them stale. Tunable: 6 h is a "missed roughly a night's worth of
     * readings at the firmware's ~1/minute cadence" heuristic, not a clinical
     * or contractual figure — raise it if patients routinely take the device
     * off for longer.
     */
    static final Duration STALE_AFTER = Duration.ofHours(6);

    /** Sparkline width — enough to show a shape in a table cell, not a chart. */
    private static final int SPARKLINE_POINTS = 20;

    /** Risk score at or above which a patient is flagged {@code urgent}. */
    private static final double URGENT_SCORE = 70;

    /** Risk score at or above which a patient is flagged {@code watch}. */
    private static final double WATCH_SCORE = 35;

    /** How much of the score is "how hot", the rest being "how recent". */
    private static final double SEVERITY_WEIGHT = 0.7;

    /** Age at which the recency term has decayed to zero. */
    private static final Duration RECENCY_HORIZON = Duration.ofHours(24);

    private final JdbcTemplate jdbcTemplate;
    private final AlertThresholdService alertThresholds;

    public PatientSummaryService(JdbcTemplate jdbcTemplate, AlertThresholdService alertThresholds) {
        this.jdbcTemplate = jdbcTemplate;
        this.alertThresholds = alertThresholds;
    }

    /**
     * The row for a patient who has no device at all: no data, no risk, and
     * flagged stale — "we know nothing about them" is a state the dashboard has
     * to show rather than omit.
     */
    public PatientSummaryResponse noDevice(String patientUserId, String username) {
        return new PatientSummaryResponse(patientUserId, username, null, null, null, null, null, null, null, null,
                0, List.of(), "low", 0, true);
    }

    /**
     * One patient's row. The latest reading is looked up <b>unbounded</b> (the
     * true last-known value, so a stale patient still shows something) while the
     * aggregates and the sparkline are scoped to {@code from}..{@code to}.
     *
     * <p>Three small queries per patient rather than one batched query for the
     * whole fleet — the same "fine at this MVP's scale" tradeoff the doctor's
     * patient list already makes. The threshold scales, by contrast, are
     * resolved for the whole request in one batch by the caller.
     */
    public PatientSummaryResponse summarize(String patientUserId, String username, Device device, Instant from,
                                             Instant to, ResolvedThresholds scale) {
        String bdAddr = device.getBdAddr();

        List<Map.Entry<Instant, Double>> latest = jdbcTemplate.query("""
                        SELECT ts, value_num FROM measurements
                        WHERE device_id = ? AND type = 'temperature' AND value_num IS NOT NULL
                        ORDER BY ts DESC LIMIT 1
                        """,
                (rs, n) -> Map.entry(rs.getTimestamp("ts").toInstant(), rs.getDouble("value_num")),
                bdAddr);

        // STDDEV_POP rides along in the aggregate query that was already
        // being run — variability costs zero extra round trips.
        Aggregate agg = jdbcTemplate.query("""
                        SELECT AVG(value_num) avg_v, MIN(value_num) min_v, MAX(value_num) max_v,
                               STDDEV_POP(value_num) stddev_v, COUNT(*) cnt
                        FROM measurements
                        WHERE device_id = ? AND type = 'temperature' AND value_num IS NOT NULL AND ts BETWEEN ? AND ?
                        """,
                (rs, n) -> new Aggregate((Double) rs.getObject("avg_v"), (Double) rs.getObject("min_v"),
                        (Double) rs.getObject("max_v"), (Double) rs.getObject("stddev_v"), rs.getLong("cnt")),
                bdAddr, Timestamp.from(from), Timestamp.from(to)).get(0);

        List<PatientSummaryResponse.SparkPoint> sparkline = jdbcTemplate.query("""
                        SELECT ts, value_num FROM measurements
                        WHERE device_id = ? AND type = 'temperature' AND value_num IS NOT NULL AND ts BETWEEN ? AND ?
                        ORDER BY ts DESC LIMIT ?
                        """,
                (rs, n) -> new PatientSummaryResponse.SparkPoint(rs.getTimestamp("ts").toInstant(),
                        rs.getDouble("value_num")),
                bdAddr, Timestamp.from(from), Timestamp.from(to), SPARKLINE_POINTS);
        Collections.reverse(sparkline);

        Double latestCelsius = latest.isEmpty() ? null : latest.get(0).getValue();
        Instant latestAt = latest.isEmpty() ? null : latest.get(0).getKey();
        double riskScore = riskScoreOf(latestCelsius, latestAt, to, scale);

        return new PatientSummaryResponse(
                patientUserId, username, bdAddr, device.getModel(),
                latestCelsius, latestAt,
                agg.avg(), agg.min(), agg.max(), agg.stddev(), agg.count(), sparkline,
                riskTierOf(riskScore), riskScore, isStale(latestAt, to));
    }

    /** No reading at all, or none inside {@link #STALE_AFTER} of {@code now}. */
    public static boolean isStale(Instant latestAt, Instant now) {
        return latestAt == null || latestAt.isBefore(now.minus(STALE_AFTER));
    }

    /**
     * Orders a doctor's worklist: how hot the last reading was (70%) tempered
     * by how recently it arrived (30%), on a 0–100 scale.
     *
     * <p><b>A triage heuristic, not a clinical score.</b> It exists so the
     * patient most worth looking at first floats to the top of a list — it
     * carries no diagnostic meaning, is not validated against anything, and
     * must never be presented as a medical assessment. The recency term is
     * what stops a week-old 39.5 °C from outranking a live one; a patient
     * with no readings at all scores 0 and is flagged {@code stale} instead,
     * because "we know nothing" is a different problem from "they are fine".
     */
    public double riskScoreOf(Double latestCelsius, Instant latestAt, Instant now, ResolvedThresholds scale) {
        if (latestCelsius == null || latestAt == null) {
            return 0;
        }
        // 0 for "low" through 1.0 for "highFever" — four steps between the
        // five tiers of AlertThresholdService.TIER_ORDER.
        double severity = AlertThresholdService.tierRank(alertThresholds.tierOf(latestCelsius, scale))
                / (double) (AlertThresholdService.TIER_ORDER.size() - 1);
        double hoursSince = Duration.between(latestAt, now).toMinutes() / 60.0;
        double recency = Math.max(0.0, Math.min(1.0, 1.0 - hoursSince / RECENCY_HORIZON.toHours()));
        return Math.round(100 * (SEVERITY_WEIGHT * severity + (1 - SEVERITY_WEIGHT) * recency));
    }

    /** The bucket a {@link #riskScoreOf} value falls into: {@code urgent} / {@code watch} / {@code low}. */
    public static String riskTierOf(double riskScore) {
        if (riskScore >= URGENT_SCORE) {
            return "urgent";
        }
        if (riskScore >= WATCH_SCORE) {
            return "watch";
        }
        return "low";
    }

    private record Aggregate(Double avg, Double min, Double max, Double stddev, long count) {
    }
}
