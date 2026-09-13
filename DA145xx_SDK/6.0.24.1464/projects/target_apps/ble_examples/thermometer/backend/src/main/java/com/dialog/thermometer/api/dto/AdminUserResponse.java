package com.dialog.thermometer.api.dto;

import java.util.List;

public record AdminUserResponse(
        String id,
        String username,
        String email,
        String role,
        String displayName,
        List<DeviceSummary> devices,
        long activeConsentCount) {

    public record DeviceSummary(String bdAddr, String model) {
    }
}
