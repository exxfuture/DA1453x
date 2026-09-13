package com.dialog.thermometer.api.dto;

import java.time.Instant;
import java.util.List;

/**
 * Aggregated per-patient stats for the doctor dashboard's "at a glance"
 * view (see ConsentController#myPatientsSummary). {@code latestCelsius}/
 * {@code latestAt} are unbounded (the patient's single most recent reading
 * ever, so a stale patient's last-known value still shows even if it falls
 * outside the requested range); {@code avgCelsius}/{@code minCelsius}/
 * {@code maxCelsius}/{@code stddevCelsius}/{@code readingCount}/
 * {@code sparkline} are all scoped to the requested {@code rangeHours} window.
 *
 * @param stddevCelsius population standard deviation over the window — the
 *                      "is this patient's temperature swinging?" signal a
 *                      min/max pair can't distinguish from one outlier
 * @param riskTier      "urgent" / "watch" / "low"; see
 *                      ConsentController#riskScoreOf — an ordering heuristic
 *                      for a worklist, <b>not</b> a clinical score
 * @param riskScore     0–100, the value {@code riskTier} was derived from
 * @param stale         no reading within the staleness window — the patient
 *                      may simply not be wearing the device
 */
public record PatientSummaryResponse(
        String patientUserId,
        String patientUsername,
        String deviceBdAddr,
        String deviceModel,
        Double latestCelsius,
        Instant latestAt,
        Double avgCelsius,
        Double minCelsius,
        Double maxCelsius,
        Double stddevCelsius,
        long readingCount,
        List<SparkPoint> sparkline,
        String riskTier,
        double riskScore,
        boolean stale) {

    public record SparkPoint(Instant ts, double celsius) {
    }
}
