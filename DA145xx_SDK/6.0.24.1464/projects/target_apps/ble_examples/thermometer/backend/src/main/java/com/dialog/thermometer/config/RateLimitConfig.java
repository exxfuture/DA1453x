package com.dialog.thermometer.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.security.SecurityProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfigurationSource;

/**
 * Registers {@link RateLimitFilter} as a servlet filter.
 *
 * <p>Ordering matters and is the reason this is a {@code FilterRegistrationBean}
 * rather than a {@code @Component}: Spring Security is itself one servlet
 * filter ({@code springSecurityFilterChain}, registered by Boot at
 * {@link SecurityProperties#DEFAULT_FILTER_ORDER}), so "before Spring
 * Security" means a lower order in the <i>servlet</i> chain, not a position
 * inside the security chain. Running earlier means a flood is rejected before
 * JWT validation, {@code CurrentUserService} provisioning, or any database
 * work happens.
 *
 * <p>{@code RateLimitFilter} is deliberately not annotated {@code @Component}:
 * Boot auto-registers every {@code Filter} bean it finds, which combined with
 * this registration would run the filter twice and charge two tokens per
 * request.
 */
@Configuration
public class RateLimitConfig {

    /** Comfortably ahead of Spring Security's own filter, with room to slot others in between. */
    private static final int RATE_LIMIT_FILTER_ORDER = SecurityProperties.DEFAULT_FILTER_ORDER - 10;

    /**
     * @param enabled           escape hatch for load/e2e runs that legitimately
     *                          exceed the limits from one address; leave on
     *                          everywhere else
     * @param trustForwardedFor see {@code RateLimitFilter.callerKey} — off
     *                          unless a trusted proxy overwrites the header;
     *                          the fallback here matches {@code
     *                          application.yml} so an omitted property is
     *                          safe-by-default rather than silently trusting
     *                          client input
     * @implNote every {@code @Value} fallback below is kept identical to the
     *           value {@code application.yml} ships. {@code application.yml} is
     *           the canonical source — these literals only apply if someone
     *           removes an entry from it, and they used to disagree (60/20 vs.
     *           240/80), so deleting the YAML block "because it looks
     *           redundant" silently cut the effective limit by 4×. If you
     *           change one, change both.
     */
    @Bean
    public FilterRegistrationBean<RateLimitFilter> rateLimitFilterRegistration(
            @Value("${thermometer.ratelimit.enabled:true}") boolean enabled,
            @Value("${thermometer.ratelimit.trust-forwarded-for:false}") boolean trustForwardedFor,
            @Value("${thermometer.ratelimit.default.requests-per-minute:240}") long defaultRequestsPerMinute,
            @Value("${thermometer.ratelimit.default.burst:80}") long defaultBurst,
            @Value("${thermometer.ratelimit.rollout.requests-per-minute:10}") long rolloutRequestsPerMinute,
            @Value("${thermometer.ratelimit.rollout.burst:10}") long rolloutBurst,
            CorsConfigurationSource corsConfigurationSource,
            ObjectMapper objectMapper) {

        RateLimitFilter filter = new RateLimitFilter(
                defaultRequestsPerMinute, defaultBurst,
                rolloutRequestsPerMinute, rolloutBurst,
                trustForwardedFor, corsConfigurationSource, objectMapper);

        FilterRegistrationBean<RateLimitFilter> registration = new FilterRegistrationBean<>(filter);
        registration.addUrlPatterns("/*");
        registration.setOrder(RATE_LIMIT_FILTER_ORDER);
        registration.setEnabled(enabled);
        return registration;
    }
}
