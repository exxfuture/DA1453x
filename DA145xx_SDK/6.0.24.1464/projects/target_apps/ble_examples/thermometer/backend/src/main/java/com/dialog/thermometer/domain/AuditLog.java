package com.dialog.thermometer.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/** Append-only record of ownership/access-control-relevant actions (device claim/release, consent grant/revoke, admin edits). */
@Entity
@Table(name = "audit_log")
public class AuditLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "actor_id", length = 64)
    private String actorId;

    @Column(nullable = false, length = 64)
    private String action;

    @Column(length = 128)
    private String subject;

    @JdbcTypeCode(SqlTypes.JSON)
    private String detail;

    @Column(nullable = false)
    private Instant at = Instant.now();

    protected AuditLog() {
        // JPA
    }

    public AuditLog(String actorId, String action, String subject, String detail) {
        this.actorId = actorId;
        this.action = action;
        this.subject = subject;
        this.detail = detail;
    }

    public Long getId() {
        return id;
    }

    public String getActorId() {
        return actorId;
    }

    public String getAction() {
        return action;
    }

    public String getSubject() {
        return subject;
    }

    public String getDetail() {
        return detail;
    }

    public Instant getAt() {
        return at;
    }
}
