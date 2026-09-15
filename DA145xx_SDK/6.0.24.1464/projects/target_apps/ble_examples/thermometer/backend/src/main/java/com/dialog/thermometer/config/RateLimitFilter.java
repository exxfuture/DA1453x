package com.dialog.thermometer.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.ConsumptionProbe;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.CorsProcessor;
import org.springframework.web.cors.DefaultCorsProcessor;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Per-caller request throttling (plan §1.5 item 4 — the API previously had no
 * rate limiting at all).
 *
 * <p>Two token buckets are consulted per request, both keyed by caller IP:
 *
 * <ul>
 *   <li>a <b>blanket</b> bucket every request passes through, and</li>
 *   <li>a <b>tighter</b> bucket scoped to the two OTA collector endpoints
 *   ({@code GET /api/rollouts/pending}, {@code POST /api/rollouts/*<!---->/status}).
 *   Those sit outside the JWT filter chain and authenticate with one shared
 *   {@code X-Device-Token} for the whole fleet (see
 *   {@link com.dialog.thermometer.rollout.RolloutController}), so a leaked token
 *   is the one credential that still buys an attacker useful API access —
 *   worth capping much harder than ordinary traffic.</li>
 * </ul>
 *
 * <p>State is <b>in-memory</b>, deliberately: {@code docker-compose.yml} runs
 * a single {@code backend} service with no replicas, so a distributed store
 * (Redis) would add an operational dependency to solve a problem this
 * deployment doesn't have. Horizontal scaling would change that — the
 * per-instance limit would effectively become {@code limit × instances}.
 *
 * <p>Registered ahead of Spring Security's chain (see {@link RateLimitConfig})
 * so that unauthenticated floods are rejected before any JWT parsing happens.
 * The cost of running that early is that {@code http.cors()} hasn't run yet
 * either, hence the explicit CORS handling in {@link #reject}.
 */
public class RateLimitFilter extends OncePerRequestFilter {

    private static final AntPathMatcher PATH_MATCHER = new AntPathMatcher();
    private static final String ROLLOUT_PENDING_PATH = "/api/rollouts/pending";
    private static final String ROLLOUT_STATUS_PATTERN = "/api/rollouts/*/status";
    private static final String HEALTH_PATH_PREFIX = "/actuator/health";

    private static final Duration REFILL_PERIOD = Duration.ofMinutes(1);

    /**
     * Idle buckets are dropped after this long, so memory tracks the number of
     * <i>recently active</i> callers rather than every caller ever seen.
     */
    private static final Duration IDLE_EVICTION = Duration.ofMinutes(10);

    /**
     * Hard ceiling on tracked callers on top of the idle eviction above. With
     * {@code trust-forwarded-for} enabled the cache key is partly
     * caller-controlled ({@code X-Forwarded-For}), so without this a
     * spoofed-header flood could grow the cache unbounded within a single
     * eviction window. Evicting a bucket resets that caller's counter, which
     * is the (accepted) tradeoff: an attacker able to sustain ~100k distinct
     * keys can churn themselves back to a full bucket — but on such a
     * deployment they could do that far more cheaply by just rotating the
     * header value, which is why that property defaults to off.
     */
    private static final int MAX_TRACKED_CALLERS = 100_000;

    /** Cap on how much caller-supplied header text ends up in a cache key. */
    private static final int MAX_KEY_LENGTH = 64;

    private final Cache<String, Bucket> generalBuckets;
    private final Cache<String, Bucket> rolloutBuckets;
    private final long generalRequestsPerMinute;
    private final long generalBurst;
    private final long rolloutRequestsPerMinute;
    private final long rolloutBurst;
    private final boolean trustForwardedFor;
    private final CorsConfigurationSource corsConfigurationSource;
    private final CorsProcessor corsProcessor = new DefaultCorsProcessor();
    private final ObjectMapper objectMapper;

    public RateLimitFilter(long generalRequestsPerMinute, long generalBurst,
                           long rolloutRequestsPerMinute, long rolloutBurst,
                           boolean trustForwardedFor,
                           CorsConfigurationSource corsConfigurationSource,
                           ObjectMapper objectMapper) {
        this.generalRequestsPerMinute = generalRequestsPerMinute;
        this.generalBurst = generalBurst;
        this.rolloutRequestsPerMinute = rolloutRequestsPerMinute;
        this.rolloutBurst = rolloutBurst;
        this.trustForwardedFor = trustForwardedFor;
        this.corsConfigurationSource = corsConfigurationSource;
        this.objectMapper = objectMapper;
        this.generalBuckets = newBucketCache();
        this.rolloutBuckets = newBucketCache();
    }

    private static Cache<String, Bucket> newBucketCache() {
        return Caffeine.newBuilder()
                .expireAfterAccess(IDLE_EVICTION)
                .maximumSize(MAX_TRACKED_CALLERS)
                .build();
    }

    /**
     * Liveness/readiness probes are exempt: an orchestrator polling
     * {@code /actuator/health} shares one source address with nothing else,
     * but a container restarting in a loop (or several probes plus real
     * traffic from the same NAT address) must never be able to throttle the
     * signal that decides whether this instance is considered up.
     */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = pathWithinApplication(request);
        return path.equals(HEALTH_PATH_PREFIX) || path.startsWith(HEALTH_PATH_PREFIX + "/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String caller = callerKey(request);
        String path = pathWithinApplication(request);

        // Endpoint-specific budget first, so collector-endpoint abuse is
        // rejected without also draining the caller's general allowance.
        if (isRolloutCollectorEndpoint(request.getMethod(), path)) {
            ConsumptionProbe probe = bucketFor(rolloutBuckets, caller, rolloutBurst, rolloutRequestsPerMinute)
                    .tryConsumeAndReturnRemaining(1);
            if (!probe.isConsumed()) {
                reject(request, response, probe);
                return;
            }
        }

        ConsumptionProbe probe = bucketFor(generalBuckets, caller, generalBurst, generalRequestsPerMinute)
                .tryConsumeAndReturnRemaining(1);
        if (!probe.isConsumed()) {
            reject(request, response, probe);
            return;
        }

        chain.doFilter(request, response);
    }

    /**
     * A token bucket of {@code capacity} tokens refilling greedily (smoothly,
     * token by token) at {@code refillTokens} per minute: {@code capacity}
     * bounds how many requests may arrive back-to-back, {@code refillTokens}
     * bounds the sustained rate.
     */
    private static Bucket bucketFor(Cache<String, Bucket> cache, String key, long capacity, long refillTokens) {
        return cache.get(key, ignored -> Bucket.builder()
                .addLimit(limit -> limit.capacity(capacity).refillGreedy(refillTokens, REFILL_PERIOD))
                .build());
    }

    private static boolean isRolloutCollectorEndpoint(String method, String path) {
        return (HttpMethod.GET.matches(method) && ROLLOUT_PENDING_PATH.equals(path))
                || (HttpMethod.POST.matches(method) && PATH_MATCHER.match(ROLLOUT_STATUS_PATTERN, path));
    }

    /**
     * Identifies the caller by {@code X-Forwarded-For}'s first (client-most)
     * entry, falling back to the socket address.
     *
     * <p><b>Only sound behind a proxy that overwrites that header</b>, which is
     * why {@code thermometer.ratelimit.trust-forwarded-for} defaults to
     * {@code false}: nothing fronts the backend in {@code docker-compose.yml}
     * (it publishes {@code 8080:8080} directly), so the header is pure client
     * input — a caller could rotate it to draw a fresh bucket per request,
     * defeating both limits including the one guarding a leaked
     * {@code X-Device-Token}, or set a victim's address to drain their bucket.
     * Keying on the socket address is the safe default for that topology.
     *
     * <p>A deployment that <i>does</i> add a trusted reverse proxy must set the
     * property back to {@code true}: behind an ingress every request arrives
     * from the same socket address, so the whole internet would otherwise
     * share one bucket.
     */
    private String callerKey(HttpServletRequest request) {
        if (trustForwardedFor) {
            String forwarded = request.getHeader("X-Forwarded-For");
            if (forwarded != null) {
                int comma = forwarded.indexOf(',');
                String client = (comma >= 0 ? forwarded.substring(0, comma) : forwarded).trim();
                if (!client.isEmpty()) {
                    return client.length() > MAX_KEY_LENGTH ? client.substring(0, MAX_KEY_LENGTH) : client;
                }
            }
        }
        String remoteAddr = request.getRemoteAddr();
        return remoteAddr != null ? remoteAddr : "unknown";
    }

    /** Request path with any servlet context path stripped, so it can be compared to the mapping literals above. */
    private static String pathWithinApplication(HttpServletRequest request) {
        String uri = request.getRequestURI();
        String contextPath = request.getContextPath();
        if (contextPath != null && !contextPath.isEmpty() && uri.startsWith(contextPath)) {
            return uri.substring(contextPath.length());
        }
        return uri;
    }

    /**
     * Writes the 429 in the same JSON shape Spring's default error handling
     * produces for a {@code ResponseStatusException} (with
     * {@code server.error.include-message: always}, which
     * {@code application.yml} sets) — the frontend's fetch wrapper reads
     * {@code message} off any error body and shows it verbatim.
     *
     * <p>CORS headers are applied by hand first: this filter runs before the
     * security chain that {@code http.cors()} lives in, so without this a
     * browser would see a header-less cross-origin response and report an
     * opaque network error instead of the 429. Reusing the app's
     * {@link CorsConfigurationSource} keeps one source of truth for allowed
     * origins.
     */
    private void reject(HttpServletRequest request, HttpServletResponse response, ConsumptionProbe probe)
            throws IOException {
        CorsConfiguration corsConfiguration = corsConfigurationSource.getCorsConfiguration(request);
        if (!corsProcessor.processRequest(corsConfiguration, request, response)) {
            // Disallowed origin — the processor already wrote its own rejection.
            return;
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", Instant.now().toString());
        body.put("status", HttpStatus.TOO_MANY_REQUESTS.value());
        body.put("error", HttpStatus.TOO_MANY_REQUESTS.getReasonPhrase());
        body.put("message", "rate limit exceeded");
        body.put("path", pathWithinApplication(request));
        // writeValueAsBytes is UTF-8, which is the only encoding application/json has.
        byte[] payload = objectMapper.writeValueAsBytes(body);

        response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        response.setHeader(HttpHeaders.RETRY_AFTER, Long.toString(retryAfterSeconds(probe)));
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setContentLength(payload.length);
        response.getOutputStream().write(payload);
    }

    /** Rounded <i>up</i> to whole seconds, and never 0 — {@code Retry-After: 0} would invite an immediate retry. */
    private static long retryAfterSeconds(ConsumptionProbe probe) {
        long seconds = TimeUnit.NANOSECONDS.toSeconds(probe.getNanosToWaitForRefill());
        if (TimeUnit.SECONDS.toNanos(seconds) < probe.getNanosToWaitForRefill()) {
            seconds++;
        }
        return Math.max(1, seconds);
    }
}
