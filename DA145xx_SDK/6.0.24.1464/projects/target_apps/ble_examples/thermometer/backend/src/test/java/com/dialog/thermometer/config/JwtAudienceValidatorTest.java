package com.dialog.thermometer.config;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The check that a token was issued to <i>this</i> OAuth2 client, on top of the
 * issuer/expiry validation Spring provides. Unit-tested rather than left to the
 * integration suite because {@code RbacIT} builds its {@link Jwt}s by hand and
 * never goes through a decoder, so nothing else exercises this at all.
 */
class JwtAudienceValidatorTest {

    private static final String CLIENT_ID = "thermometer-web";

    private static Jwt jwt(Map<String, Object> claims) {
        Jwt.Builder builder = Jwt.withTokenValue("fake")
                .header("alg", "RS256")
                .subject("user-1")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(300));
        claims.forEach(builder::claim);
        return builder.build();
    }

    @Test
    void acceptsATokenWhoseAzpIsThisClient() {
        assertTrue(SecurityConfig.audienceValidator(CLIENT_ID)
                .validate(jwt(Map.of("azp", CLIENT_ID))).getErrors().isEmpty());
    }

    @Test
    void acceptsATokenThatOnlyNamesThisClientInAud() {
        assertTrue(SecurityConfig.audienceValidator(CLIENT_ID)
                .validate(jwt(Map.of("aud", List.of("account", CLIENT_ID)))).getErrors().isEmpty());
    }

    /** The whole point: same realm, same signing key, different client. */
    @Test
    void rejectsATokenMintedForAnotherClientInTheSameRealm() {
        assertFalse(SecurityConfig.audienceValidator(CLIENT_ID)
                .validate(jwt(Map.of("azp", "some-other-client", "aud", List.of("account")))).getErrors().isEmpty());
    }

    @Test
    void rejectsATokenWithNeitherClaim() {
        assertFalse(SecurityConfig.audienceValidator(CLIENT_ID)
                .validate(jwt(Map.of("scope", "openid"))).getErrors().isEmpty());
    }

    /** The documented escape hatch for a realm whose tokens carry no client claim. */
    @Test
    void blankClientIdDisablesTheCheck() {
        assertTrue(SecurityConfig.audienceValidator("")
                .validate(jwt(Map.of("azp", "anything-at-all"))).getErrors().isEmpty());
        assertTrue(SecurityConfig.audienceValidator(null)
                .validate(jwt(Map.of("azp", "anything-at-all"))).getErrors().isEmpty());
    }
}
