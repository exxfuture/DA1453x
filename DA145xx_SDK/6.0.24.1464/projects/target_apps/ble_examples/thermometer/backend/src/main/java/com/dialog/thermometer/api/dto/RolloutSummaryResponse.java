package com.dialog.thermometer.api.dto;

import com.dialog.thermometer.rollout.Rollout;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * A rollout plus its per-status target tallies, for the admin list.
 *
 * <p>{@code statusCounts} is keyed by the raw status strings
 * rollout_targets uses — exactly {@code pending}, {@code success} and
 * {@code failed}, the vocabulary {@code RolloutStatusRequest} validates (there
 * is no {@code installed} key; nothing has ever written that value) — and only
 * contains statuses that actually occur: a rollout nobody has reported on yet
 * has an empty map, not three zeroes. Clients must therefore treat a missing key
 * as zero. Counts come from one grouped query for the whole page
 * (RolloutTargetRepository.countByStatusForRollouts), never one query per row.
 */
public record RolloutSummaryResponse(
        UUID id,
        String version,
        String chipModel,
        String imageUrl,
        String deltaUrl,
        int groupPercentage,
        int abortThresholdPct,
        String status,
        Instant createdAt,
        long targetCount,
        Map<String, Long> statusCounts) {

    public static RolloutSummaryResponse from(Rollout rollout, Map<String, Long> statusCounts) {
        Map<String, Long> counts = statusCounts != null ? statusCounts : Map.of();
        return new RolloutSummaryResponse(
                rollout.getId(),
                rollout.getVersion(),
                rollout.getChipModel(),
                rollout.getImageUrl(),
                rollout.getDeltaUrl(),
                rollout.getGroupPercentage(),
                rollout.getAbortThresholdPct(),
                rollout.getStatus(),
                rollout.getCreatedAt(),
                counts.values().stream().mapToLong(Long::longValue).sum(),
                counts);
    }
}
