package com.dialog.thermometer.security;

import com.dialog.thermometer.domain.TemperatureUnit;
import com.dialog.thermometer.domain.User;
import com.dialog.thermometer.domain.UserRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

/**
 * Resolves the caller's identity and JIT-provisions/re-syncs its local
 * {@link User} row from the Keycloak JWT on every call — there's no separate
 * sign-up step, the first authenticated request from a Keycloak user creates
 * their local row. username/email/role are re-synced from the JWT every time
 * (self-healing if the Keycloak realm changes); displayName and
 * temperatureUnit are intentionally left untouched by sync — they're the
 * fields a user owns locally, edited via {@code PATCH /api/me}.
 *
 * <p>Deliberately not using Spring Security's {@code @PreAuthorize}/{@code
 * hasRole()}: under the {@code local} profile's fully-open filter chain,
 * Spring populates an anonymous authentication with {@code ROLE_ANONYMOUS},
 * which would make any {@code hasRole(...)} check reject every local curl
 * request — defeating the local profile's "security disabled, everything
 * curlable" purpose (see SecurityConfig). Callers instead resolve a {@link
 * CurrentUser} and do a plain role check.
 */
@Service
public class CurrentUserService {

    /** Matches DeviceController's pre-existing fallback subject for unauthenticated/local-profile requests. */
    private static final String LOCAL_DEV_USER_ID = "local-dev-user";

    private final UserRepository users;

    public CurrentUserService(UserRepository users) {
        this.users = users;
    }

    /**
     * Deliberately not {@code @Transactional} at this level — see
     * {@link #findExistingOrProvision} for why the insert-race retry needs
     * each attempt to be its own transaction rather than sharing one across
     * this whole call.
     */
    public CurrentUser resolve(Authentication authentication) {
        if (authentication != null && authentication.getPrincipal() instanceof Jwt jwt) {
            return provisionFromJwt(jwt);
        }
        return provisionLocalDevUser();
    }

    /**
     * {@link #resolve} plus a role check — the shape every controller needs at
     * the top of a role-restricted handler.
     *
     * <p>This exists because that three-line shape (resolve, compare
     * {@code role()}, throw a 403 {@code ResponseStatusException}) was copied
     * into eight controllers, sometimes as a private helper and sometimes
     * inline. A change to the 403 shape, or adding an audit hook to refusals,
     * had to be applied in eight places and would eventually be applied in
     * seven.
     *
     * @param message the 403 reason shown to the caller — deliberately a
     *                parameter rather than a generated string, because
     *                "only customers can claim a device" is a better answer
     *                than "customer role required"
     * @throws ResponseStatusException 403 if the caller holds none of {@code allowed}
     */
    public CurrentUser resolveWithRole(Authentication authentication, String message, Role... allowed) {
        return requireRole(resolve(authentication), message, allowed);
    }

    /** @see #resolveWithRole */
    public static CurrentUser requireRole(CurrentUser me, String message, Role... allowed) {
        for (Role role : allowed) {
            if (me.role() == role) {
                return me;
            }
        }
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, message);
    }

    @Transactional
    public CurrentUser updateProfile(CurrentUser me, String displayName, TemperatureUnit temperatureUnit) {
        User user = users.findById(me.id()).orElseThrow();
        user.setDisplayName(displayName);
        user.setTemperatureUnit(temperatureUnit);
        user.touch();
        users.save(user);
        return new CurrentUser(user.getId(), user.getUsername(), user.getEmail(), me.role(), user.getDisplayName(),
                user.getTemperatureUnit());
    }

    private CurrentUser provisionFromJwt(Jwt jwt) {
        String id = jwt.getSubject();
        String username = jwt.getClaimAsString("preferred_username");
        if (username == null || username.isBlank()) {
            username = id;
        }
        String email = jwt.getClaimAsString("email");
        Role role = extractRole(jwt);
        String resolvedUsername = username;

        // Falls back to a username lookup before creating a row: Keycloak's
        // dev-mode container (docker-compose.yml, `start-dev --import-realm`)
        // has no persistent volume, so a restart re-imports the realm with a
        // brand-new random `sub` per demo user while Postgres's `users` table
        // (which does persist) still has the old row under the old id. A
        // blind findById-miss -> insert would then collide with the
        // username's unique constraint. Reusing the existing row instead
        // keeps its id — and everything foreign-keyed to it (devices,
        // consents) — intact and self-heals in place.
        User user = findExistingOrProvision(id, resolvedUsername, email, role);
        user.setUsername(username);
        user.setEmail(email);
        user.setRole(role.dbValue());
        user.touch();
        users.save(user);

        return new CurrentUser(user.getId(), user.getUsername(), user.getEmail(), role, user.getDisplayName(),
                user.getTemperatureUnit());
    }

    /**
     * Finds the existing local row for {@code id}/{@code username}, or
     * inserts a new one.
     *
     * <p>Two requests from the very same brand-new user can arrive close
     * enough together — several API calls firing right after a first
     * sign-in is the common case — that both miss the lookup and race to
     * insert the same row; the loser's flush throws a {@code users_pkey}
     * (or {@code users_username_key}) violation. Postgres blocks a
     * conflicting concurrent insert until the other transaction commits or
     * rolls back, so by the time that violation surfaces here the winner's
     * row is already visible — a retry read finds it. The insert attempt
     * uses {@code saveAndFlush} in its own implicit transaction (via Spring
     * Data's per-method {@code @Transactional}), deliberately not sharing a
     * broader transaction with the retry: catching a failed flush's
     * exception inside the same transaction/persistence context leaves
     * Hibernate's session unusable for anything after it, which the retry
     * read would otherwise hit.
     */
    private User findExistingOrProvision(String id, String username, String email, Role role) {
        return users.findById(id)
                .or(() -> users.findByUsername(username))
                .orElseGet(() -> {
                    try {
                        return users.saveAndFlush(new User(id, username, email, role.dbValue()));
                    } catch (DataIntegrityViolationException lostTheRace) {
                        return users.findById(id)
                                .or(() -> users.findByUsername(username))
                                .orElseThrow(() -> lostTheRace);
                    }
                });
    }

    private CurrentUser provisionLocalDevUser() {
        User user = users.findById(LOCAL_DEV_USER_ID)
                .orElseGet(() -> {
                    try {
                        return users.saveAndFlush(new User(LOCAL_DEV_USER_ID, LOCAL_DEV_USER_ID, null, Role.CUSTOMER.dbValue()));
                    } catch (DataIntegrityViolationException lostTheRace) {
                        return users.findById(LOCAL_DEV_USER_ID).orElseThrow(() -> lostTheRace);
                    }
                });
        users.save(user);
        return new CurrentUser(user.getId(), user.getUsername(), user.getEmail(), Role.CUSTOMER, user.getDisplayName(),
                user.getTemperatureUnit());
    }

    @SuppressWarnings("unchecked")
    private Role extractRole(Jwt jwt) {
        Map<String, Object> realmAccess = jwt.getClaimAsMap("realm_access");
        List<String> roles = realmAccess != null
                ? (List<String>) realmAccess.getOrDefault("roles", List.of())
                : List.of();
        Role role = Role.fromRealmRoles(roles);
        return role != null ? role : Role.CUSTOMER;
    }
}
