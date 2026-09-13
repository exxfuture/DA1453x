package com.dialog.thermometer.api.dto;

import com.dialog.thermometer.rollout.RolloutTarget;

import java.time.Instant;
import java.util.List;

/**
 * One rollout with its full per-device target list. Bounded by the size of
 * the targeted fleet, which is bounded by the rollout's own group percentage
 * — an admin-only drill-down, not a browse-everything endpoint.
 */
public record RolloutDetailResponse(RolloutSummaryResponse rollout, List<Target> targets) {

    public record Target(String deviceBdAddr, String status, Instant reportedAt, String errorDetail) {

        public static Target from(RolloutTarget target) {
            return new Target(target.getDevice(), target.getStatus(), target.getReportedAt(), target.getErrorDetail());
        }
    }
}
