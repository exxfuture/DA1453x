package com.dialog.thermometer.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Branch coverage for {@link RateLimitFilter}: which bucket a request charges,
 * who shares a bucket with whom, what an exhausted bucket answers, and what is
 * exempt.
 *
 * <p>A plain unit test rather than a {@code @SpringBootTest} on purpose. The
 * filter is a pure function of (request, configured limits) with no Spring or
 * database involvement, and constructing it directly is what makes these
 * assertions deterministic: the real {@code application.yml} limits (240/80)
 * would need ~81 requests to prove a single rejection, and every test in the
 * class would share one bucket keyed on the same address. That the filter is
 * actually <i>registered</i> and reachable in a running server — the one thing
 * this style cannot show — is asserted over real HTTP in
 * {@code RolloutCollectorTokenIT.rateLimiterIsWiredIntoTheRunningServer...}.
 *
 * <p>Every bucket here refills at 1 token/minute, so no test can flake by a
 * token trickling back in between two assertions on a slow machine; the burst
 * capacity alone decides the outcome.
 */
class RateLimitFilterTest {

    /** Slow enough that refill never happens within a test method. */
    private static final long REFILL_PER_MINUTE = 1;

    private RateLimitFilter filter(long generalBurst, long rolloutBurst) {
        return filter(generalBurst, rolloutBurst, true);
    }

    private RateLimitFilter filter(long generalBurst, long rolloutBurst, boolean trustForwardedFor) {
        // A CorsConfigurationSource returning null is the "no CORS config for
        // this path" case; DefaultCorsProcessor lets a non-CORS request (no
        // Origin header, as below) straight through, so the 429 body is still
        // written. The real source is exercised by the HTTP-level IT.
        return new RateLimitFilter(REFILL_PER_MINUTE, generalBurst, REFILL_PER_MINUTE, rolloutBurst,
                trustForwardedFor, request -> null, new ObjectMapper());
    }

    private MockHttpServletResponse call(RateLimitFilter filter, String method, String uri, String forwardedFor)
            throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest(method, uri);
        if (forwardedFor != null) {
            request.addHeader("X-Forwarded-For", forwardedFor);
        }
        MockHttpServletResponse response = new MockHttpServletResponse();
        // A fresh chain per call: MockFilterChain refuses a second invocation.
        filter.doFilter(request, response, new MockFilterChain());
        return response;
    }

    /**
     * The rejection body has to match the shape Spring produces for a
     * {@code ResponseStatusException} (with {@code server.error.include-message:
     * always}), because the frontend's fetch wrapper reads {@code message} off
     * any error body and shows it verbatim.
     */
    @Test
    void blanketBucketRejectsAfterTheBurstIsSpentAndSaysWhenToRetry() throws Exception {
        RateLimitFilter filter = filter(5, 10);

        for (int i = 0; i < 5; i++) {
            assertEquals(200, call(filter, "GET", "/api/devices", "1.2.3.4").getStatus(),
                    "request " + i + " is still within the burst capacity");
        }

        MockHttpServletResponse rejected = call(filter, "GET", "/api/devices", "1.2.3.4");
        assertEquals(429, rejected.getStatus());
        assertEquals("application/json", rejected.getContentType());
        assertTrue(rejected.getContentAsString().contains("\"message\":\"rate limit exceeded\""),
                rejected.getContentAsString());
        assertTrue(rejected.getContentAsString().contains("\"path\":\"/api/devices\""),
                rejected.getContentAsString());
        assertNotNull(rejected.getHeader("Retry-After"), "a 429 without Retry-After tells the caller nothing");
        assertTrue(Long.parseLong(rejected.getHeader("Retry-After")) >= 1,
                "Retry-After: 0 would invite an immediate retry");
    }

    @Test
    void oneCallerExhaustingTheirBudgetDoesNotThrottleAnother() throws Exception {
        RateLimitFilter filter = filter(2, 10);

        call(filter, "GET", "/api/devices", "1.2.3.4");
        call(filter, "GET", "/api/devices", "1.2.3.4");
        assertEquals(429, call(filter, "GET", "/api/devices", "1.2.3.4").getStatus());

        assertEquals(200, call(filter, "GET", "/api/devices", "5.6.7.8").getStatus(),
                "buckets are per caller — one flooder must not deny service to everyone else");
    }

    /**
     * The two OTA collector endpoints sit outside the JWT chain and share one
     * fleet-wide {@code X-Device-Token}, so they get their own much tighter
     * budget — charged <i>before</i> the general one, so abusing them cannot
     * also drain the caller's ordinary allowance.
     */
    @Test
    void collectorEndpointsAreCappedSeparatelyAndFirst() throws Exception {
        RateLimitFilter filter = filter(20, 3);

        for (int i = 0; i < 3; i++) {
            assertEquals(200, call(filter, "GET", "/api/rollouts/pending", "1.2.3.4").getStatus());
        }
        assertEquals(429, call(filter, "GET", "/api/rollouts/pending", "1.2.3.4").getStatus());

        // Only the 3 consumed collector calls charged the 20-token general
        // bucket, so ordinary traffic from the same caller still gets through.
        assertEquals(200, call(filter, "GET", "/api/devices", "1.2.3.4").getStatus());
    }

    @Test
    void statusReportsShareTheCollectorBudgetButAdminRolloutEndpointsDoNot() throws Exception {
        RateLimitFilter filter = filter(20, 1);
        String statusPath = "/api/rollouts/2b1f0f6a-0000-0000-0000-000000000000/status";

        assertEquals(200, call(filter, "POST", statusPath, "9.9.9.9").getStatus());
        assertEquals(429, call(filter, "POST", statusPath, "9.9.9.9").getStatus(),
                "POST /{id}/status matches the same tighter bucket as GET /pending");

        assertEquals(200, call(filter, "GET", "/api/rollouts", "9.9.9.9").getStatus(),
                "admin rollout management is ordinary JWT-guarded traffic, not collector traffic");
        assertEquals(200, call(filter, "GET", statusPath, "9.9.9.9").getStatus(),
                "the tighter bucket is method-scoped — only POST is a status report");
    }

    /**
     * A container restarting in a loop, or probes sharing a NAT address with
     * real traffic, must never be able to throttle the signal that decides
     * whether this instance is considered up.
     */
    @Test
    void healthProbesAreExemptButOtherActuatorEndpointsAreNot() throws Exception {
        RateLimitFilter filter = filter(1, 10);

        for (int i = 0; i < 50; i++) {
            assertEquals(200, call(filter, "GET", "/actuator/health", "1.2.3.4").getStatus());
            assertEquals(200, call(filter, "GET", "/actuator/health/readiness", "1.2.3.4").getStatus());
        }

        assertEquals(200, call(filter, "GET", "/actuator/prometheus", "1.2.3.4").getStatus(),
                "the 100 health probes above consumed nothing, so the single general token is still there");
        assertEquals(429, call(filter, "GET", "/actuator/prometheus", "1.2.3.4").getStatus());
    }

    /**
     * The property defaults to false because nothing fronts this service in
     * the stack this repo ships, which makes {@code X-Forwarded-For} pure
     * client input — a caller could otherwise rotate it to mint a fresh budget
     * per request, defeating even the collector-endpoint cap.
     */
    @Test
    void forwardedForIsIgnoredUnlessTrusted() throws Exception {
        RateLimitFilter untrusting = filter(1, 10, false);

        assertEquals(200, call(untrusting, "GET", "/api/devices", "1.1.1.1").getStatus());
        assertEquals(429, call(untrusting, "GET", "/api/devices", "2.2.2.2").getStatus(),
                "a spoofed header must not buy a fresh bucket — both requests came from one socket address");

        RateLimitFilter trusting = filter(1, 10, true);
        assertEquals(200, call(trusting, "GET", "/api/devices", "1.1.1.1").getStatus());
        assertEquals(200, call(trusting, "GET", "/api/devices", "2.2.2.2").getStatus(),
                "behind a trusted proxy the header is the only thing distinguishing two clients");
    }

    /** Only the client-most entry identifies the caller; the proxy hops behind it are not the client. */
    @Test
    void onlyTheFirstForwardedForEntryKeysTheBucket() throws Exception {
        RateLimitFilter filter = filter(1, 10);

        assertEquals(200, call(filter, "GET", "/api/devices", "1.1.1.1, 10.0.0.1").getStatus());
        assertEquals(429, call(filter, "GET", "/api/devices", "1.1.1.1, 10.0.0.9").getStatus(),
                "a different downstream hop is still the same client");
    }
}
