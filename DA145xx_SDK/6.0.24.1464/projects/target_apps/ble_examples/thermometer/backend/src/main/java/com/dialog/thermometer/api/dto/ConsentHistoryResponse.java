package com.dialog.thermometer.api.dto;

import com.dialog.thermometer.domain.AuditLog;

import java.time.Instant;

/**
 * One entry in the caller's <b>consent lifecycle</b> history: a share they
 * granted, or one they revoked.
 *
 * <p><b>This is not an access log.</b> The audit_log table records
 * consent grants/revocations and ownership changes — it does not record
 * reads, so nothing here says whether or when a doctor actually looked at any
 * data. Named accordingly so no UI built on top of it can imply otherwise.
 *
 * @param action        "consent.grant" or "consent.revoke"
 * @param doctorUserId  the doctor the consent was granted to / revoked from
 */
public record ConsentHistoryResponse(
        Long id,
        String action,
        String doctorUserId,
        String doctorUsername,
        Instant at) {

    public static ConsentHistoryResponse from(AuditLog entry, String doctorUsername) {
        return new ConsentHistoryResponse(entry.getId(), entry.getAction(), entry.getSubject(), doctorUsername,
                entry.getAt());
    }
}
