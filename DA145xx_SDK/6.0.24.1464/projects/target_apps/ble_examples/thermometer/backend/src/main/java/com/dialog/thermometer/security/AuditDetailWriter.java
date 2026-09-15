package com.dialog.thermometer.security;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Builds the JSON that goes into {@code audit_log.detail}.
 *
 * <p>That column is {@code JSONB}, so Postgres validates the text and any
 * invalid document fails the insert — which means a hand-concatenated
 * {@code "\"" + value + "\""} turns a perfectly ordinary label containing a
 * quote or a backslash into a 500 on the user's action. Every audit detail
 * therefore goes through Jackson, the shape
 * {@link AccessDeniedAuditor#resolveException} already used, and this class
 * exists so that is the single obvious way to do it rather than a pattern each
 * caller has to remember.
 *
 * <p>Null values are allowed (they serialise to JSON {@code null}), which is
 * why the map is built here instead of with {@code Map.of}.
 */
@Component
public class AuditDetailWriter {

    private static final Logger log = LoggerFactory.getLogger(AuditDetailWriter.class);

    private final ObjectMapper objectMapper;

    public AuditDetailWriter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * @return a JSON object holding {@code key}/{@code value}, or {@code null}
     *         (a SQL NULL detail) if it somehow cannot be serialised — an audit
     *         row with no detail is better than a failed user action
     */
    public String of(String key, Object value) {
        Map<String, Object> fields = new LinkedHashMap<>(1);
        fields.put(key, value);
        return of(fields);
    }

    /** @see #of(String, Object) */
    public String of(String key1, Object value1, String key2, Object value2) {
        Map<String, Object> fields = new LinkedHashMap<>(2);
        fields.put(key1, value1);
        fields.put(key2, value2);
        return of(fields);
    }

    /** @see #of(String, Object) */
    public String of(Map<String, ?> fields) {
        try {
            return objectMapper.writeValueAsString(fields);
        } catch (JsonProcessingException unexpected) {
            log.warn("could not serialise audit detail {}", fields.keySet(), unexpected);
            return null;
        }
    }
}
