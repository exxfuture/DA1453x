package com.dialog.thermometer.api.dto;

import com.dialog.thermometer.rollout.Rollout;

import java.util.UUID;

public record RolloutResponse(
        UUID id,
        String version,
        String chipModel,
        String imageUrl,
        String deltaUrl,
        int groupPercentage,
        int abortThresholdPct,
        String status) {

    public static RolloutResponse from(Rollout rollout) {
        return new RolloutResponse(
                rollout.getId(),
                rollout.getVersion(),
                rollout.getChipModel(),
                rollout.getImageUrl(),
                rollout.getDeltaUrl(),
                rollout.getGroupPercentage(),
                rollout.getAbortThresholdPct(),
                rollout.getStatus());
    }
}
