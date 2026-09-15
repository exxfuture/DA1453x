package com.dialog.thermometer.it;

import com.dialog.thermometer.rollout.Rollout;
import com.dialog.thermometer.rollout.RolloutRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The two OTA collector endpoints over real HTTP — the one part of the
 * authorization surface that {@link RbacIT}'s direct controller calls cannot
 * prove, because what matters here is what happens <i>around</i> the handler:
 * that {@code GET /api/rollouts/pending} is reachable without a JWT at all
 * (SecurityConfig permits exactly these two method+path pairs), that it is not
 * shadowed by the {@code /{id}} detail mapping registered next to it, and that
 * {@link com.dialog.thermometer.config.RateLimitFilter} is actually registered
 * in the servlet chain rather than merely correct in isolation.
 *
 * <p><b>Rate-limit properties are overridden</b> so the outcomes here are
 * decided by configuration rather than by execution order: with
 * {@code trust-forwarded-for} on, every test method claims its own
 * {@code X-Forwarded-For} address and therefore its own pair of buckets. The
 * collector burst is set to 3 — each method below stays within that, except
 * the one that is about exceeding it.
 *
 * <p><b>What this cannot show:</b> the {@code test} profile disables JWT
 * validation entirely (application-test.yml), so the {@code Authorization}
 * header sent in {@link #noUserCredentialSubstitutesForTheDeviceToken} is not
 * parsed into a real identity. The assertion still records the contract that
 * was violated before the token check existed — no user credential reaches
 * these two routes — and {@code RbacIT} makes the stronger version of it by
 * putting a genuine admin {@code Authentication} in the SecurityContext and
 * showing the handler still refuses.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "thermometer.ratelimit.trust-forwarded-for=true",
        "thermometer.ratelimit.rollout.burst=3",
        // 1 token/minute back: nothing refills mid-test on a slow machine.
        "thermometer.ratelimit.rollout.requests-per-minute=1",
        "thermometer.ratelimit.default.burst=100",
        "thermometer.ratelimit.default.requests-per-minute=1"
})
@ActiveProfiles("test")
@Testcontainers
class RolloutCollectorTokenIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>(
            DockerImageName.parse("timescale/timescaledb:latest-pg16").asCompatibleSubstituteFor("postgres"))
            .withDatabaseName("thermometer")
            .withUsername("thermometer")
            .withPassword("thermometer");

    /**
     * The broker this service talks to refuses anonymous connections (see
     * {@link MosquittoDynsecContainer}); these tests don't publish over MQTT
     * themselves, but the application context connects on startup, so the
     * credentials have to be real ones.
     */
    @Container
    static GenericContainer<?> mosquitto = MosquittoDynsecContainer.create();

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("thermometer.mqtt.broker-url", () -> MosquittoDynsecContainer.brokerUrl(mosquitto));
        registry.add("thermometer.mqtt.username", () -> MosquittoDynsecContainer.ADMIN_USERNAME);
        registry.add("thermometer.mqtt.password", () -> MosquittoDynsecContainer.ADMIN_PASSWORD);
        registry.add("thermometer.mqtt.collector-password", () -> MosquittoDynsecContainer.COLLECTOR_PASSWORD);
    }

    private static final String REJECTION = "\"message\":\"missing or invalid X-Device-Token\"";
    private static final String BD_ADDR = "AA:BB:CC:DD:EE:F0";

    @Autowired
    private TestRestTemplate http;
    @Autowired
    private RolloutRepository rollouts;

    @Value("${thermometer.device.collector-token}")
    private String collectorToken;

    /**
     * Swaps {@link TestRestTemplate}'s default {@code HttpURLConnection}-backed
     * factory for the JDK {@code HttpClient} one.
     *
     * <p>{@code HttpURLConnection} refuses to hand back a <b>401</b> response
     * for a request whose body it has already streamed — it wants to replay
     * the request with credentials and cannot rewind, so it throws "cannot
     * retry due to server authentication, in streaming mode" instead. Since
     * every POST assertion in this class is precisely "this 401s", the default
     * client can never observe the thing under test. (Spring 6.1's
     * {@code SimpleClientHttpRequestFactory} always streams;
     * {@code setOutputStreaming} is a deprecated no-op there, so buffering is
     * not an option.)
     *
     * <p>Purely a test-client concern — the real collectors are a Go gateway
     * and a browser, neither of which does HttpURLConnection's auth replay.
     */
    @BeforeEach
    void useAClientThatCanReadA401ResponseToARequestWithABody() {
        http.getRestTemplate().setRequestFactory(new JdkClientHttpRequestFactory());
    }

    /**
     * A rollout the collector endpoints can actually act on. Seeded through the
     * repository rather than {@code POST /api/rollouts}, which is admin-only —
     * and the test profile resolves an unauthenticated caller to a customer.
     */
    private Rollout seedRollout(String chipModel) {
        return rollouts.save(new Rollout("2.0.0", chipModel, "http://example.test/fw.img", null,
                "sha256", "signature", 100, 50));
    }

    @Test
    void pendingRejectsAMissingOrWrongDeviceTokenAndAcceptsTheCorrectOne() {
        String caller = "10.0.0.1";
        seedRollout("IT-CHIP-A");
        String path = "/api/rollouts/pending?chipModel=IT-CHIP-A&currentVersion=1.0.0&bdAddr=" + BD_ADDR;

        ResponseEntity<String> missing = call(HttpMethod.GET, path, caller, null, null, null);
        assertEquals(401, missing.getStatusCode().value(),
                "these endpoints sit outside the JWT chain; the shared secret is the only thing guarding them");
        assertTrue(missing.getBody().contains(REJECTION), missing.getBody());

        ResponseEntity<String> wrong = call(HttpMethod.GET, path, caller, collectorToken + "x", null, null);
        assertEquals(401, wrong.getStatusCode().value());
        assertTrue(wrong.getBody().contains(REJECTION),
                "a wrong token must be indistinguishable from a missing one — no oracle for the attacker");

        ResponseEntity<String> accepted = call(HttpMethod.GET, path, caller, collectorToken, null, null);
        assertEquals(200, accepted.getStatusCode().value(),
                "the correct token alone is sufficient — no session, no JWT, no user");
        assertTrue(accepted.getBody().contains("\"version\":\"2.0.0\""), accepted.getBody());
    }

    @Test
    void statusReportsRejectAMissingOrWrongDeviceToken() {
        String caller = "10.0.0.2";
        UUID rolloutId = seedRollout("IT-CHIP-B").getId();
        String path = "/api/rollouts/" + rolloutId + "/status";
        String body = "{\"bdAddr\":\"" + BD_ADDR + "\",\"status\":\"success\"}";

        assertEquals(401, call(HttpMethod.POST, path, caller, null, null, body).getStatusCode().value(),
                "an unauthenticated caller could otherwise report fake install status for arbitrary devices");
        assertEquals(401, call(HttpMethod.POST, path, caller, collectorToken + "x", null, body)
                .getStatusCode().value());
        assertEquals(204, call(HttpMethod.POST, path, caller, collectorToken, null, body).getStatusCode().value());
    }

    @Test
    void noUserCredentialSubstitutesForTheDeviceToken() {
        String caller = "10.0.0.3";
        UUID rolloutId = seedRollout("IT-CHIP-C").getId();

        ResponseEntity<String> pending = call(HttpMethod.GET,
                "/api/rollouts/pending?chipModel=IT-CHIP-C&bdAddr=" + BD_ADDR, caller, null, "a.user.token", null);
        assertEquals(401, pending.getStatusCode().value(),
                "being a logged-in user is not being a collector — that conflation was the vulnerability");
        assertTrue(pending.getBody().contains(REJECTION), pending.getBody());

        ResponseEntity<String> status = call(HttpMethod.POST, "/api/rollouts/" + rolloutId + "/status", caller,
                null, "a.user.token", "{\"bdAddr\":\"" + BD_ADDR + "\",\"status\":\"success\"}");
        assertEquals(401, status.getStatusCode().value());
    }

    /**
     * {@code /pending} is a literal path mapped on the same controller as
     * {@code /{id}}. If the template ever won the match, a collector's poll
     * would fail UUID conversion (400) or hit the admin-only detail handler
     * (403) instead of the endpoint it is asking for.
     */
    @Test
    void pendingIsNotShadowedByTheRolloutDetailMapping() {
        ResponseEntity<String> response = call(HttpMethod.GET,
                "/api/rollouts/pending?chipModel=IT-CHIP-D&bdAddr=" + BD_ADDR, "10.0.0.4", null, null, null);

        assertEquals(401, response.getStatusCode().value(),
                "401 proves the collector handler ran; 400 would mean 'pending' was parsed as a rollout id");
        assertTrue(response.getBody().contains(REJECTION), response.getBody());
    }

    /**
     * End-to-end proof that the filter is registered and reached, which the
     * unit test in {@code RateLimitFilterTest} deliberately cannot show. The
     * collector bucket is configured to 3 above, so the fourth call is the
     * first one the limiter refuses — before the handler, hence 429 rather
     * than the 401 the same request got three times running.
     */
    @Test
    void rateLimiterIsWiredIntoTheRunningServerAndExemptsHealthProbes() {
        String caller = "10.0.0.5";
        String path = "/api/rollouts/pending?chipModel=IT-CHIP-E&bdAddr=" + BD_ADDR;

        // "not throttled" rather than a specific status: this test is about
        // the limiter, and asserting the handler's answer here would make an
        // unrelated authorization regression surface as a rate-limit failure.
        for (int i = 0; i < 3; i++) {
            assertNotEquals(429, call(HttpMethod.GET, path, caller, null, null, null).getStatusCode().value(),
                    "call " + i + " is still within the configured collector burst");
        }

        ResponseEntity<String> throttled = call(HttpMethod.GET, path, caller, null, null, null);
        assertEquals(429, throttled.getStatusCode().value());
        assertNotNull(throttled.getHeaders().getFirst(HttpHeaders.RETRY_AFTER));
        assertTrue(throttled.getBody().contains("\"message\":\"rate limit exceeded\""), throttled.getBody());

        assertEquals(200, call(HttpMethod.GET, "/actuator/health", caller, null, null, null).getStatusCode().value(),
                "a throttled caller must still be able to answer the probe that decides if this instance is up");
    }

    private ResponseEntity<String> call(HttpMethod method, String path, String forwardedFor, String deviceToken,
                                         String bearer, String body) {
        HttpHeaders headers = new HttpHeaders();
        // Gives each test method its own rate-limit buckets; see the class javadoc.
        headers.set("X-Forwarded-For", forwardedFor);
        if (deviceToken != null) {
            headers.set("X-Device-Token", deviceToken);
        }
        if (bearer != null) {
            headers.setBearerAuth(bearer);
        }
        if (body != null) {
            headers.setContentType(MediaType.APPLICATION_JSON);
        }
        return http.exchange(path, method, new HttpEntity<>(body, headers), String.class);
    }
}
