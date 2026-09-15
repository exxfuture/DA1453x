-- audit_log is the fastest-growing table in the schema: every audited action
-- writes a row, and so does every 403 (security/AccessDeniedAuditor). Until
-- now it carried nothing but its primary key, so all three readers filtered
-- and sorted on unindexed columns and degraded into a sequential scan plus an
-- in-memory sort as the table grew.
--
-- One index per query pattern, each already ordered the way the reader wants
-- it (newest first), so the sort is satisfied by the index too:
--   * (actor_id, at DESC) — AuditLogRepository.findByActorIdAndActionInOrderByAtDesc
--     (GET /api/consents/access-history, GET /api/doctor/consent-activity) and
--     the actorId filter of the admin viewer. `action` is deliberately not part
--     of this key: the IN-list is two values wide, so filtering it after the
--     index seek is cheaper than a third column in the key.
--   * (subject, at DESC) — the "everything done *to* me" half of
--     findByActorIdOrSubjectOrderByAtDesc (GET /api/doctor/audit-log) and the
--     admin viewer's subject filter.
--   * (action, at DESC) — the admin viewer filtered by action alone, and
--     AdminAnalyticsController's security-ops panel, which groups the last 24 h
--     of 'access.denied' rows.
-- The plain (at DESC) case (admin viewer with no filter) is served by any of
-- them via a full index scan, so it gets no index of its own.
CREATE INDEX idx_audit_log_actor_at ON audit_log (actor_id, at DESC);
CREATE INDEX idx_audit_log_subject_at ON audit_log (subject, at DESC);
CREATE INDEX idx_audit_log_action_at ON audit_log (action, at DESC);
