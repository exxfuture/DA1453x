package com.dialog.thermometer.security;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class RoleTest {

    @Test
    void matchesARealmRoleNameCaseInsensitively() {
        assertEquals(Role.DOCTOR, Role.fromRealmRoles(List.of("offline_access", "doctor")));
        assertEquals(Role.CUSTOMER, Role.fromRealmRoles(List.of("CUSTOMER")));
        assertNull(Role.fromRealmRoles(List.of("offline_access", "uma_authorization")));
        assertNull(Role.fromRealmRoles(List.of()));
    }

    /**
     * The authorization model assumes one role per user, and Keycloak does not
     * guarantee the order of {@code realm_access.roles} — so a two-role token
     * must resolve to the same role every time regardless of how the claim is
     * ordered, or a user's effective permissions flip between logins.
     */
    @Test
    void resolvesAMultiRoleTokenByPrecedenceNotByClaimOrder() {
        assertEquals(Role.ADMIN, Role.fromRealmRoles(List.of("customer", "doctor", "admin")));
        assertEquals(Role.ADMIN, Role.fromRealmRoles(List.of("admin", "doctor", "customer")));
        assertEquals(Role.DOCTOR, Role.fromRealmRoles(List.of("customer", "doctor")));
        assertEquals(Role.DOCTOR, Role.fromRealmRoles(List.of("doctor", "customer")));
    }

    @Test
    void roundTripsThroughItsDatabaseValue() {
        for (Role role : Role.values()) {
            assertEquals(role, Role.fromDbValue(role.dbValue()));
            assertEquals(role.name().toLowerCase(), role.dbValue(),
                    "the db value is what V1__init.sql's users.role CHECK constraint allows");
        }
    }
}
