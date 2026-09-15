package com.dialog.thermometer.security;

import com.dialog.thermometer.domain.TemperatureUnit;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * The shared role check every controller now calls instead of keeping its own
 * copy of the same three lines. Worth its own test because every authorization
 * decision in the application funnels through it, including the exact status it
 * refuses with (403, never 401 — the caller is authenticated, just not
 * permitted).
 */
class RequireRoleTest {

    private static CurrentUser user(Role role) {
        return new CurrentUser("u1", "user1", "user1@example.test", role, null, TemperatureUnit.CELSIUS);
    }

    @Test
    void returnsTheCallerWhenTheRoleMatches() {
        CurrentUser customer = user(Role.CUSTOMER);
        assertSame(customer, CurrentUserService.requireRole(customer, "nope", Role.CUSTOMER));
    }

    @Test
    void acceptsAnyOfSeveralAllowedRoles() {
        CurrentUser admin = user(Role.ADMIN);
        CurrentUser customer = user(Role.CUSTOMER);
        assertSame(admin, CurrentUserService.requireRole(admin, "nope", Role.CUSTOMER, Role.ADMIN));
        assertSame(customer, CurrentUserService.requireRole(customer, "nope", Role.CUSTOMER, Role.ADMIN));
    }

    @Test
    void refusesWith403AndTheCallersOwnMessage() {
        ResponseStatusException refusal = assertThrows(ResponseStatusException.class,
                () -> CurrentUserService.requireRole(user(Role.DOCTOR), "only customers can claim a device",
                        Role.CUSTOMER));

        assertEquals(HttpStatus.FORBIDDEN, refusal.getStatusCode());
        assertEquals("only customers can claim a device", refusal.getReason(),
                "the message is the endpoint's own explanation, not a generic one");
    }

    @Test
    void refusesWhenNoRoleIsAllowedAtAll() {
        assertThrows(ResponseStatusException.class,
                () -> CurrentUserService.requireRole(user(Role.ADMIN), "nobody may do this"));
    }
}
