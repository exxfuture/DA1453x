package com.dialog.thermometer.security;

import com.dialog.thermometer.domain.AuditLog;
import com.dialog.thermometer.domain.AuditLogRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerExceptionResolver;
import org.springframework.web.servlet.ModelAndView;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;
import java.util.Map;

/**
 * Records an {@code access.denied} audit row whenever a controller refuses a
 * request with 403, so the admin security-ops panel has denials to show
 * rather than only successful actions.
 *
 * <p>Implemented as a {@link HandlerExceptionResolver} that <b>observes and
 * returns null</b>, inserted at the front of the resolver chain, rather than
 * as a {@code @ControllerAdvice}. That is the point: an {@code
 * @ExceptionHandler} would have to produce the response itself, and this
 * application has no {@code ResponseEntityExceptionHandler} — its errors are
 * rendered by Boot's default resolver into the {@code
 * {timestamp,status,error,message,path}} body the frontend reads (see
 * {@code server.error.include-message} in application.yml). Returning null
 * here means "not handled, carry on", so the response format is untouched and
 * this stays a pure side effect.
 *
 * <p>Only denials thrown by controllers pass through here. A request rejected
 * by the Spring Security filter chain (bad or missing token) never reaches the
 * dispatcher and is not recorded — that is a different event, and claiming
 * otherwise in an audit trail would be worse than not recording it.
 */
@Component
public class AccessDeniedAuditor implements HandlerExceptionResolver, WebMvcConfigurer {

    private static final Logger log = LoggerFactory.getLogger(AccessDeniedAuditor.class);

    /** audit_log.subject is VARCHAR(128); paths longer than that are truncated rather than failing the insert. */
    private static final int MAX_SUBJECT_LENGTH = 128;

    /**
     * Resolved lazily: this bean is a {@link WebMvcConfigurer}, which Spring
     * instantiates while building the MVC infrastructure. Injecting a JPA
     * repository directly would drag the persistence context into that early
     * phase and risks a circular initialization.
     */
    private final ObjectProvider<AuditLogRepository> auditLogs;
    private final ObjectMapper objectMapper;

    public AccessDeniedAuditor(ObjectProvider<AuditLogRepository> auditLogs, ObjectMapper objectMapper) {
        this.auditLogs = auditLogs;
        this.objectMapper = objectMapper;
    }

    @Override
    public void extendHandlerExceptionResolvers(List<HandlerExceptionResolver> resolvers) {
        // First in the chain so the denial is recorded before any resolver
        // gets the chance to consume the exception.
        resolvers.add(0, this);
    }

    @Override
    public ModelAndView resolveException(HttpServletRequest request, HttpServletResponse response, Object handler,
                                          Exception ex) {
        if (ex instanceof ResponseStatusException denial
                && denial.getStatusCode().value() == HttpStatus.FORBIDDEN.value()) {
            record(request, denial);
        }
        // Always null: this resolver never handles anything, it only watches.
        return null;
    }

    private void record(HttpServletRequest request, ResponseStatusException denial) {
        try {
            auditLogs.getObject().save(new AuditLog(actorId(), "access.denied", subjectOf(request),
                    detailOf(request, denial)));
        } catch (RuntimeException auditFailure) {
            // An audit write must never turn a clean 403 into a 500 — the
            // caller's answer is already decided by the time we get here.
            log.warn("failed to record access.denied audit entry for {} {}", request.getMethod(),
                    request.getRequestURI(), auditFailure);
        }
    }

    /**
     * The JWT subject, read straight off the security context. Deliberately
     * not {@link CurrentUserService#resolve} — that JIT-provisions and writes
     * a user row, which is far too much side effect for an error path (and
     * would itself be a second thing that can fail).
     */
    private static String actorId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication != null && authentication.getPrincipal() instanceof Jwt jwt ? jwt.getSubject() : null;
    }

    private static String subjectOf(HttpServletRequest request) {
        String uri = request.getRequestURI();
        if (uri == null) {
            return null;
        }
        return uri.length() <= MAX_SUBJECT_LENGTH ? uri : uri.substring(0, MAX_SUBJECT_LENGTH);
    }

    /**
     * audit_log.detail is JSONB, so this has to be valid JSON. The reason
     * text comes from our own controllers (never from user input) but is
     * serialized through Jackson anyway rather than concatenated — hand-built
     * JSON is how an injected quote ends up breaking an insert.
     */
    private String detailOf(HttpServletRequest request, ResponseStatusException denial) {
        try {
            return objectMapper.writeValueAsString(Map.of(
                    "method", String.valueOf(request.getMethod()),
                    "reason", String.valueOf(denial.getReason())));
        } catch (JsonProcessingException unexpected) {
            return null;
        }
    }
}
