package com.dialog.thermometer.live;

import com.dialog.thermometer.domain.AuditLog;
import com.dialog.thermometer.domain.AuditLogRepository;
import com.dialog.thermometer.domain.TemperatureUnit;
import com.dialog.thermometer.ingest.MqttGateway;
import com.dialog.thermometer.live.BrokerCredentialService.MintedCredential;
import com.dialog.thermometer.security.AuditDetailWriter;
import com.dialog.thermometer.security.CurrentUser;
import com.dialog.thermometer.security.CurrentUserService;
import com.dialog.thermometer.security.Role;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.http.HttpHeaders;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.security.core.Authentication;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Duration;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The HTTP contract of {@code POST /api/live/credentials} — the one endpoint
 * that hands a caller a secret, so its shape, its caching behaviour, its audit
 * trail and its failure mode all matter more than usual.
 *
 * <p>{@code standaloneSetup} rather than {@code @WebMvcTest} for the reason
 * given in {@code ConsentPaginationMvcTest}: Mockito cannot mock the concrete
 * service classes on this JDK, so the collaborators are hand-written doubles.
 */
class LiveCredentialControllerTest {

    private static final Instant EXPIRES_AT = Instant.parse("2026-09-15T12:00:00Z");

    private final AuditLogRepository auditLogs = Mockito.mock(AuditLogRepository.class);

    private MockMvc mockMvcFor(CurrentUser caller, BrokerCredentialService brokerCredentials) {
        return MockMvcBuilders.standaloneSetup(new LiveCredentialController(brokerCredentials,
                        new FixedCurrentUserService(caller), auditLogs, new AuditDetailWriter(new ObjectMapper())))
                // Boot configures its ObjectMapper this way; a standalone setup
                // does not, and `expiresAt` would serialise as an epoch float —
                // which is not what the frontend parses.
                .setMessageConverters(new MappingJackson2HttpMessageConverter(new ObjectMapper()
                        .registerModule(new JavaTimeModule())
                        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)))
                .build();
    }

    private static CurrentUser user(String id, Role role) {
        return new CurrentUser(id, id + "-name", id + "@example.test", role, null, TemperatureUnit.CELSIUS);
    }

    /**
     * Any authenticated role, on purpose: the broker ACLs scope the credential to
     * the caller's own topics, so there is nothing a role check would protect.
     */
    @Test
    void anyRoleMayMintACredentialForItself() throws Exception {
        for (Role role : Role.values()) {
            mockMvcFor(user("u-" + role, role), new StubBrokerCredentials())
                    .perform(post("/api/live/credentials"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.username").value("user-u-" + role))
                    .andExpect(jsonPath("$.userId").value("u-" + role))
                    .andExpect(jsonPath("$.password").value("a-32-character-or-longer-password"))
                    .andExpect(jsonPath("$.expiresAt").value("2026-09-15T12:00:00Z"));
        }
    }

    /** The response body is a bearer secret; no cache may keep a copy of it. */
    @Test
    void responseIsNotCacheable() throws Exception {
        mockMvcFor(user("u-1", Role.CUSTOMER), new StubBrokerCredentials())
                .perform(post("/api/live/credentials"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"));
    }

    /** Mints are audited: "who asked for a broker credential, and when" has to be answerable. */
    @Test
    void everyMintIsAudited() throws Exception {
        mockMvcFor(user("u-1", Role.DOCTOR), new StubBrokerCredentials())
                .perform(post("/api/live/credentials"))
                .andExpect(status().isOk());

        ArgumentCaptor<AuditLog> entry = ArgumentCaptor.forClass(AuditLog.class);
        Mockito.verify(auditLogs).save(entry.capture());
        assertEquals("live.credentials.mint", entry.getValue().getAction());
        assertEquals("u-1", entry.getValue().getActorId());
        assertEquals("user-u-1", entry.getValue().getSubject(), "the subject is the broker identity that was minted");
        assertEquals("{\"expiresAt\":\"2026-09-15T12:00:00Z\"}", entry.getValue().getDetail(),
                "audit_log.detail is JSONB — it has to be valid JSON, and it must not contain the password");
        assertTrue(entry.getValue().getDetail() != null && !entry.getValue().getDetail().contains("password"));
    }

    /**
     * A credential this service could not actually provision would fail at
     * connect time with no explanation, so an unreachable broker is a clean 503
     * rather than a plausible-looking body.
     */
    @Test
    void anUnreachableBrokerIsA503NotABrokenCredential() throws Exception {
        BrokerCredentialService failing = new StubBrokerCredentials() {
            @Override
            public MintedCredential mint(String localUserId) {
                throw new BrokerProvisioningException("broker did not answer");
            }
        };

        mockMvcFor(user("u-1", Role.CUSTOMER), failing)
                .perform(post("/api/live/credentials"))
                .andExpect(status().isServiceUnavailable());

        Mockito.verify(auditLogs, Mockito.never()).save(Mockito.any());
    }

    /** Mints a fixed credential for whoever asks, with no broker anywhere. */
    private static class StubBrokerCredentials extends BrokerCredentialService {

        private StubBrokerCredentials() {
            super(null, new NoGateway(), "admin", "collector-dev", Duration.ofHours(24));
        }

        @Override
        public MintedCredential mint(String localUserId) {
            return new MintedCredential(BrokerCredentialService.USER_PREFIX + localUserId,
                    "a-32-character-or-longer-password", localUserId, EXPIRES_AT);
        }
    }

    private static final class NoGateway extends MqttGateway {

        private NoGateway() {
            super("tcp://localhost:1883", "test", "", "");
        }

        @Override
        public void onConnected(Runnable listener) {
            // Never connects; provisioning is covered by BrokerCredentialServiceTest.
        }
    }

    private static final class FixedCurrentUserService extends CurrentUserService {

        private final CurrentUser caller;

        private FixedCurrentUserService(CurrentUser caller) {
            super(null);
            this.caller = caller;
        }

        @Override
        public CurrentUser resolve(Authentication authentication) {
            return caller;
        }
    }
}
