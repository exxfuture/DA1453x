package com.dialog.thermometer.api.dto;

import com.dialog.thermometer.domain.TemperatureUnit;
import com.dialog.thermometer.security.CurrentUser;

public record MeResponse(String id, String username, String email, String role, String displayName,
                          TemperatureUnit temperatureUnit) {

    public static MeResponse from(CurrentUser user) {
        return new MeResponse(user.id(), user.username(), user.email(), user.role().dbValue(), user.displayName(),
                user.temperatureUnit());
    }
}
