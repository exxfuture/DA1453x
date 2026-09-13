package com.dialog.thermometer.api.dto;

import com.dialog.thermometer.domain.AuditLog;

import java.time.Instant;

/**
 * One audit-log row. {@code subject} is whatever the action acted on — a BD
 * address for device actions, a user id for consent/role actions, a request
 * path for {@code access.denied} — so it is deliberately an opaque string
 * here rather than a typed reference.
 *
 * <p>{@code actorUsername} is only filled in where the caller is allowed to
 * see it and a batch lookup was done (the admin viewer); elsewhere it is null.
 */
public record AuditLogResponse(
        Long id,
        String actorId,
        String actorUsername,
        String action,
        String subject,
        String detail,
        Instant at) {

    public static AuditLogResponse from(AuditLog entry) {
        return from(entry, null);
    }

    public static AuditLogResponse from(AuditLog entry, String actorUsername) {
        return new AuditLogResponse(entry.getId(), entry.getActorId(), actorUsername, entry.getAction(),
                entry.getSubject(), entry.getDetail(), entry.getAt());
    }
}
