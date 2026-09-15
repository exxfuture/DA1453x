package com.dialog.thermometer.patient;

import com.dialog.thermometer.api.dto.PatientSummaryResponse;
import com.dialog.thermometer.threshold.AlertThresholdService;
import com.dialog.thermometer.threshold.AlertThresholdService.ResolvedThresholds;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The doctor worklist's triage heuristic, unit-tested directly. It used to live
 * in {@code ConsentController} as private methods, so the only way to exercise
 * it was a full HTTP round trip against a real Postgres in {@code RbacIT} —
 * which meant its arithmetic (rather than its authorization) was never really
 * asserted.
 *
 * <p>No database is involved: the risk score and the staleness rule are pure
 * functions of a reading, its timestamp and the applicable scale.
 */
class PatientSummaryServiceTest {

    /**
     * Both collaborators are null on purpose, and that is the point of this
     * test: everything asserted here is a pure function of a reading, its
     * timestamp and the scale that was passed in — no query, and no threshold
     * resolution (the scale is an argument, and {@code tierOf} only compares
     * numbers). A test that strayed into the database or the repository would
     * fail loudly with an NPE instead of quietly needing infrastructure.
     */
    private final AlertThresholdService thresholds = new AlertThresholdService(null);
    private final PatientSummaryService service = new PatientSummaryService(null, thresholds);

    private final ResolvedThresholds scale = AlertThresholdService.FALLBACK;
    private final Instant now = Instant.parse("2026-09-14T12:00:00Z");

    private double scoreOf(double celsius, Duration age) {
        return service.riskScoreOf(celsius, now.minus(age), now, scale);
    }

    @Test
    void aPatientWithNoReadingScoresZeroRatherThanLow() {
        assertEquals(0, service.riskScoreOf(null, null, now, scale),
                "\"we know nothing\" is not \"they are fine\" — it is surfaced as stale, not as a low score");
        assertEquals("low", PatientSummaryService.riskTierOf(0));
        assertTrue(PatientSummaryService.isStale(null, now));
    }

    @Test
    void hotterReadingsScoreHigherAtTheSameAge() {
        double low = scoreOf(35.0, Duration.ZERO);
        double normal = scoreOf(36.8, Duration.ZERO);
        double elevated = scoreOf(37.8, Duration.ZERO);
        double fever = scoreOf(38.5, Duration.ZERO);
        double highFever = scoreOf(40.0, Duration.ZERO);

        assertTrue(low < normal && normal < elevated && elevated < fever && fever < highFever,
                "severity must be monotonic across the five tiers: " + low + " " + normal + " " + elevated
                        + " " + fever + " " + highFever);
        assertEquals(100, highFever, "a live high fever is the top of the scale");
    }

    /** The recency term is what stops a week-old 39.5 °C from outranking a live one. */
    @Test
    void olderReadingsScoreLowerAtTheSameTemperature() {
        double live = scoreOf(40.0, Duration.ZERO);
        double sixHours = scoreOf(40.0, Duration.ofHours(6));
        double aDay = scoreOf(40.0, Duration.ofHours(24));
        double aWeek = scoreOf(40.0, Duration.ofDays(7));

        assertTrue(live > sixHours && sixHours > aDay, "recency must decay: " + live + " " + sixHours + " " + aDay);
        assertEquals(aDay, aWeek, "past the 24 h horizon the recency term is clamped at 0, not negative");
        assertEquals(70, aDay, "a day-old high fever keeps exactly the severity share of the score");
    }

    @Test
    void aLiveHighFeverOutranksAStaleOne() {
        assertTrue(scoreOf(38.5, Duration.ofMinutes(5)) > scoreOf(40.0, Duration.ofDays(3)),
                "the worklist must put the patient worth looking at now on top");
    }

    @Test
    void riskTierBoundariesAreInclusiveAtTheBottomOfEachBucket() {
        assertEquals("urgent", PatientSummaryService.riskTierOf(70));
        assertEquals("watch", PatientSummaryService.riskTierOf(69.9));
        assertEquals("watch", PatientSummaryService.riskTierOf(35));
        assertEquals("low", PatientSummaryService.riskTierOf(34.9));
        assertEquals("low", PatientSummaryService.riskTierOf(0));
    }

    @Test
    void scoreIsBoundedToZeroThroughOneHundred() {
        for (double celsius = 30.0; celsius <= 44.0; celsius += 0.5) {
            for (long hours = 0; hours <= 48; hours += 6) {
                double score = scoreOf(celsius, Duration.ofHours(hours));
                assertTrue(score >= 0 && score <= 100, "score out of range for " + celsius + " °C, " + hours + " h");
            }
        }
    }

    /** The scale is part of the question: a doctor's override re-tiers the same reading. */
    @Test
    void aDifferentScaleChangesTheScoreForTheSameReading() {
        ResolvedThresholds strict = new ResolvedThresholds(35.0, 36.5, 37.0, 37.5, "doctor_override");
        double onFallback = service.riskScoreOf(37.6, now, now, AlertThresholdService.FALLBACK);
        double onStrict = service.riskScoreOf(37.6, now, now, strict);

        assertTrue(onStrict > onFallback,
                "37.6 °C is 'elevated' on the default scale but 'highFever' on this override");
    }

    @Test
    void stalenessIsSixHoursWithoutAReading() {
        assertFalse(PatientSummaryService.isStale(now.minus(Duration.ofHours(5)), now));
        assertTrue(PatientSummaryService.isStale(now.minus(Duration.ofHours(7)), now));
    }

    @Test
    void aPatientWithNoDeviceIsAnEmptyStaleRow() {
        PatientSummaryResponse row = service.noDevice("p1", "patient1");

        assertEquals("p1", row.patientUserId());
        assertEquals("patient1", row.patientUsername());
        assertTrue(row.stale());
        assertEquals(0, row.readingCount());
        assertEquals("low", row.riskTier());
        assertTrue(row.sparkline().isEmpty());
    }
}
