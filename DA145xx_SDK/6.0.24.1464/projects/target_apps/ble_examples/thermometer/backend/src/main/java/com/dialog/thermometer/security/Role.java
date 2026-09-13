package com.dialog.thermometer.security;

/** The three realm roles issued by Keycloak (deploy/keycloak/realm-export.json) — customer, doctor, admin. */
public enum Role {
    CUSTOMER, DOCTOR, ADMIN;

    /** Matches a Keycloak realm role name (e.g. "doctor") case-insensitively, or null if none of realmRoles matches a known role. */
    public static Role fromRealmRoles(Iterable<String> realmRoles) {
        for (String candidate : realmRoles) {
            for (Role role : values()) {
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
