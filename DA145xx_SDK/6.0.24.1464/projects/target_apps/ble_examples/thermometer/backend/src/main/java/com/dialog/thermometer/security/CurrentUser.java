package com.dialog.thermometer.security;

import com.dialog.thermometer.domain.TemperatureUnit;

/** Resolved, locally-provisioned identity for the caller of the current request — see CurrentUserService. */
public record CurrentUser(String id, String username, String email, Role role, String displayName,
                           TemperatureUnit temperatureUnit) {
}
