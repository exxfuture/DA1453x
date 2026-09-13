package com.dialog.thermometer.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Two modes, switched by {@code thermometer.security.enabled}:
 *
 * <ul>
 *   <li><b>enabled (default / docker profile):</b> Spring Security OAuth2
 *   Resource Server validates Keycloak-issued JWTs — architecture v3 §9.</li>
 *   <li><b>disabled (local profile):</b> everything permitted, so the API is
 *   trivially curl-able while iterating without a running Keycloak.</li>
 * </ul>
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    @ConditionalOnProperty(prefix = "thermometer.security", name = "enabled", havingValue = "false")
    public SecurityFilterChain openFilterChain(HttpSecurity http) throws Exception {
        http.csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                .authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
        return http.build();
    }

    @Bean
    @ConditionalOnProperty(prefix = "thermometer.security", name = "enabled", havingValue = "true", matchIfMissing = true)
    public SecurityFilterChain securedFilterChain(HttpSecurity http,
                                                   JwtAuthenticationConverter jwtAuthenticationConverter)
            throws Exception {
        http.csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                .authorizeHttpRequests(auth -> auth
                        // The two OTA collector endpoints: called by gateways
                        // and collectors, which hold no user identity and
                        // never will — they authenticate with the shared
                        // X-Device-Token secret checked inside
                        // RolloutController instead. Scoped to exactly these
                        // two method+path pairs; everything else under
                        // /api/rollouts (rollout creation, admin listing)
                        // stays behind the JWT.
                        .requestMatchers(HttpMethod.GET, "/api/rollouts/pending").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/rollouts/*/status").permitAll()
                        // Liveness/readiness probes must answer before/without
                        // a token; everything else actuator exposes (info,
                        // prometheus) is operational data and is admin-only.
                        .requestMatchers("/actuator/health", "/actuator/health/**").permitAll()
                        .requestMatchers("/actuator/**").hasRole("ADMIN")
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth2 -> oauth2.jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter)));
        return http.build();
    }

    /**
     * Maps Keycloak's {@code realm_access.roles} claim — the same claim
     * {@link com.dialog.thermometer.security.Role#fromRealmRoles} reads — to
     * Spring authorities, so {@code hasRole("ADMIN")} works at all.
     *
     * <p>Wired only into {@link #securedFilterChain}, and used only by the
     * actuator matcher above. Business endpoints keep resolving a
     * {@code CurrentUser} and checking its role by hand: under the local
     * profile's open chain there is no JWT and Spring's anonymous
     * authentication would fail every {@code hasRole} check, which is exactly
     * why that convention exists (see CurrentUserService's class javadoc).
     * Actuator paths are exempt from that concern — the local profile permits
     * them outright.
     *
     * <p>Deliberately a concrete {@link JwtAuthenticationConverter} bean, not
     * a lambda implementing the generic {@code Converter<Jwt,
     * AbstractAuthenticationToken>} interface: Spring Boot's
     * {@code WebMvcAutoConfiguration} scans every {@code Converter} bean in
     * the context to register it as an MVC data-binding converter, and a
     * lambda's synthetic class doesn't expose its generic type arguments to
     * that reflection-based scan — it fails app startup outright with
     * "Unable to determine source type &lt;S&gt; and target type &lt;T&gt;".
     * A real class (Spring Security's own {@code JwtAuthenticationConverter})
     * has a proper parameterized {@code implements} clause and doesn't hit
     * this.
     */
    @Bean
    @ConditionalOnProperty(prefix = "thermometer.security", name = "enabled", havingValue = "true", matchIfMissing = true)
    public JwtAuthenticationConverter keycloakRealmRoleConverter() {
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(SecurityConfig::realmRoleAuthorities);
        return converter;
    }

    private static Collection<GrantedAuthority> realmRoleAuthorities(Jwt jwt) {
        Map<String, Object> realmAccess = jwt.getClaimAsMap("realm_access");
        Object roles = realmAccess != null ? realmAccess.get("roles") : null;
        Collection<GrantedAuthority> authorities = new ArrayList<>();
        if (roles instanceof Collection<?> roleValues) {
            for (Object role : roleValues) {
                if (role instanceof String name && !name.isBlank()) {
                    authorities.add(new SimpleGrantedAuthority("ROLE_" + name.toUpperCase(Locale.ROOT)));
                }
            }
        }
        return authorities;
    }

    /**
     * Deliberately <b>not</b> a plain {@code spring.security.oauth2.resourceserver.jwt.issuer-uri}
     * property, which would force one URL to serve double duty: the address
     * this backend container fetches JWKS from, <i>and</i> the exact string
     * every token's {@code iss} claim must equal. Those two things need
     * different hostnames here — the backend reaches Keycloak over the
     * docker-compose network ({@code keycloak:8080}), but real tokens carry
     * {@code iss=http://localhost:8082/...} because that's the hostname
     * Keycloak's own login pages/redirects/emails use, i.e. the one an
     * actual browser (or a person reading a password-reset email) can
     * resolve — see deploy/README.md. So: fetch keys from the internal
     * docker hostname, but validate the claim against the externally-visible
     * one, with no network call needed for that check.
     */
    @Bean
    @ConditionalOnProperty(prefix = "thermometer.security", name = "enabled", havingValue = "true", matchIfMissing = true)
    public JwtDecoder jwtDecoder(
            @Value("${thermometer.oidc.jwk-set-uri}") String jwkSetUri,
            @Value("${thermometer.oidc.issuer-uri}") String issuerUri) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(jwkSetUri).build();
        OAuth2TokenValidator<Jwt> validator = JwtValidators.createDefaultWithIssuer(issuerUri);
        decoder.setJwtValidator(validator);
        return decoder;
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource(
            @Value("${thermometer.cors.allowed-origins:http://localhost:5173}") String allowedOrigins) {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(Arrays.asList(allowedOrigins.split(",")));
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("*"));
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
