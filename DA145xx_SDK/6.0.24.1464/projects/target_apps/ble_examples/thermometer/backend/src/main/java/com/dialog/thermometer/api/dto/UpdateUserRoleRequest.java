package com.dialog.thermometer.api.dto;

import com.dialog.thermometer.security.Role;
import jakarta.validation.constraints.NotBlank;

/**
 * Admin role change.
 *
 * <p>Carried as a string and parsed by {@link #parsedRole()} rather than
 * bound straight to the {@link Role} enum: the rest of the API speaks the
 * database's lowercase spelling ("doctor"), while the enum constants are
 * uppercase, and Jackson's enum binding is case-sensitive by default. Parsing
 * here accepts either spelling and turns anything else into a 400 with a
 * readable message, instead of a Jackson error naming internal constants.
 */
public record UpdateUserRoleRequest(@NotBlank String role) {

    /** @return the matching role, or null if the value names no known role */
    public Role parsedRole() {
        for (Role candidate : Role.values()) {
            if (candidate.name().equalsIgnoreCase(role)) {
                return candidate;
            }
        }
        return null;
    }
}
