package com.dialog.thermometer.security;

import java.util.List;

/** The three realm roles issued by Keycloak (deploy/keycloak/realm-export.json) — customer, doctor, admin. */
public enum Role {
    CUSTOMER, DOCTOR, ADMIN;

    /**
     * Precedence used when a JWT carries more than one known realm role. The
     * authorization model assumes exactly one role per user, and Keycloak
     * guarantees no ordering inside {@code realm_access.roles}, so scanning the
     * claim in its own order would hand a two-role user whichever role the
     * token happened to list first — an assignment that can flip between
     * logins. Most-privileged-first is the deterministic choice: a user the
     * realm has made an admin stays an admin no matter what else they hold.
     */
    private static final List<Role> PRECEDENCE = List.of(ADMIN, DOCTOR, CUSTOMER);

    /**
     * Matches a Keycloak realm role name (e.g. "doctor") case-insensitively, or
     * null if none of {@code realmRoles} names a known role. When several match,
     * the most privileged one wins — see {@link #PRECEDENCE}.
     */
    public static Role fromRealmRoles(Iterable<String> realmRoles) {
        for (Role role : PRECEDENCE) {
            for (String candidate : realmRoles) {
                if (role.name().equalsIgnoreCase(candidate)) {
                    return role;
                }
            }
        }
        return null;
    }

    public String dbValue() {
        return name().toLowerCase();
    }

    public static Role fromDbValue(String value) {
        return Role.valueOf(value.toUpperCase());
    }
}
