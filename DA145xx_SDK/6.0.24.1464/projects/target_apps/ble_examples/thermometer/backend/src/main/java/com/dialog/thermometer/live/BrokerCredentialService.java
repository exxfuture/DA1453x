package com.dialog.thermometer.live;

import com.dialog.thermometer.ingest.MqttGateway;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * The single provisioning authority for every broker identity except its own.
 *
 * <p>Mosquitto runs with the dynamic-security plugin and
 * {@code allow_anonymous false}; this service connects as that plugin's admin
 * client and creates, on every successful connect, exactly the identities the
 * platform needs — nothing is configured by hand in the broker beyond the
 * initial {@code mosquitto_ctrl dynsec init}:
 *
 * <ul>
 *   <li>role <b>{@code collector}</b> — {@code publishClientSend} allow on
 *   {@code v1/+/collector/+/measurement/+} and nothing else, plus client
 *   {@code collector} with {@code thermometer.mqtt.collector-password}. Every
 *   gateway connects as that one identity; the ACL is what makes the topic's
 *   user segment a <i>trust label</i> rather than a claim (a gateway cannot
 *   publish as a user, and a user cannot publish as a collector).</li>
 *   <li>role <b>{@code backend}</b> — {@code publishClientSend} allow on
 *   {@code live/#}, attached to this service's own client. Necessary because
 *   the plugin's built-in {@code admin} role can subscribe to everything but
 *   may only <i>publish</i> to {@code $CONTROL/dynamic-security/#}, so without
 *   this the live-feed fan-out would be silently refused by the broker.</li>
 *   <li>role+client <b>{@code user-<localUserId>}</b> per browser user, minted
 *   on demand by {@link #mint} — {@code subscribePattern} allow on
 *   {@code live/<id>/#} and {@code publishClientSend} allow on
 *   {@code v1/default/<id>/+/measurement/+}. Every mint rotates the password,
 *   so the previous credential dies immediately, and a
 *   {@link #sweepExpiredUserCredentials() scheduled sweep} deletes clients that
 *   have not been re-minted within {@code thermometer.mqtt.user-credential-ttl}
 *   — that is what makes these credentials short-lived rather than merely
 *   per-user.</li>
 * </ul>
 *
 * <p><b>Issue times are held in memory</b>, not in the database: the mint
 * endpoint is the only writer, and a credential outliving a backend restart
 * buys nothing (the frontend mints on every connect). The sweep therefore also
 * treats a {@code user-} client it has no issue time for as expired, which is
 * what cleans up after a restart. This assumes a single backend instance, the
 * same assumption {@code RateLimitFilter} already documents; a second instance
 * would revoke the first's credentials at its next sweep.
 */
@Service
public class BrokerCredentialService {

    private static final Logger log = LoggerFactory.getLogger(BrokerCredentialService.class);

    /** The one identity every gateway/collector shares. */
    public static final String COLLECTOR_USERNAME = "collector";

    /** Prefix of every per-browser-user client and role, and the marker the sweep looks for. */
    public static final String USER_PREFIX = "user-";

    static final String COLLECTOR_ROLE = "collector";
    static final String COLLECTOR_PUBLISH_FILTER = "v1/+/collector/+/measurement/+";
    static final String BACKEND_ROLE = "backend";
    static final String BACKEND_PUBLISH_FILTER = "live/#";

    /**
     * Tenant segment the browser collector publishes under. Single-tenant today
     * (the ingest subscriber accepts any tenant); the ACL pins it so a browser
     * cannot publish into a future tenant that isn't theirs.
     */
    static final String DEFAULT_TENANT = "default";

    /** 24 random bytes, URL-safe Base64 → 32 characters, no padding. */
    private static final int PASSWORD_BYTES = 24;

    /** How many clients one {@code listClients} page asks for during the sweep. */
    private static final int LIST_PAGE_SIZE = 500;

    private final MqttDynamicSecurity dynsec;
    private final MqttGateway mqttGateway;
    private final String adminUsername;
    private final String collectorPassword;
    private final Duration userCredentialTtl;
    private final SecureRandom random = new SecureRandom();

    /** localUserId → when its credential was last minted. */
    private final Map<String, Instant> issuedAt = new ConcurrentHashMap<>();

    /**
     * Whether this process has yet completed a provisioning pass — see
     * {@link #ensureBaseIdentities()} for why the collector password is only
     * rewritten on the first one.
     */
    private final AtomicBoolean firstProvisioningPass = new AtomicBoolean(true);

    public BrokerCredentialService(MqttDynamicSecurity dynsec, MqttGateway mqttGateway,
                                    @Value("${thermometer.mqtt.username:}") String adminUsername,
                                    @Value("${thermometer.mqtt.collector-password:}") String collectorPassword,
                                    @Value("${thermometer.mqtt.user-credential-ttl:PT24H}") Duration userCredentialTtl) {
        this.dynsec = dynsec;
        this.mqttGateway = mqttGateway;
        this.adminUsername = adminUsername;
        this.collectorPassword = collectorPassword;
        this.userCredentialTtl = userCredentialTtl;
    }

    /** A freshly minted browser credential. The password exists only in this object and the broker. */
    public record MintedCredential(String username, String password, String userId, Instant expiresAt) {
    }

    @PostConstruct
    void provisionOnEveryConnect() {
        mqttGateway.onConnected(this::ensureBaseIdentities);
    }

    /**
     * Idempotently (re-)creates the {@code collector} and {@code backend}
     * identities. Runs on every successful connect rather than once at startup:
     * a broker that was restarted from a fresh volume, or replaced, comes back
     * needing exactly this, and re-running it costs two or three control
     * messages.
     */
    void ensureBaseIdentities() {
        try {
            // The collector password is rewritten once per process, not on every
            // reconnect: dynamic-security disconnects a client whose credential
            // it rewrites, and doing that on every reconnect would kick every
            // gateway off the broker for no reason. Once per start is enough for
            // a rotated THERMOMETER_MQTT_COLLECTOR_PASSWORD to take effect.
            boolean rotateCollectorPassword = firstProvisioningPass.compareAndSet(true, false);

            ensureRole(COLLECTOR_ROLE, List.of(acl("publishClientSend", COLLECTOR_PUBLISH_FILTER)));
            ensureClient(COLLECTOR_USERNAME, collectorPassword, COLLECTOR_ROLE, rotateCollectorPassword);

            ensureRole(BACKEND_ROLE, List.of(acl("publishClientSend", BACKEND_PUBLISH_FILTER)));
            if (!adminUsername.isBlank()) {
                ensureClientRole(adminUsername, BACKEND_ROLE);
            }
            log.info("Broker identities provisioned: role/client '{}', role '{}' on '{}'",
                    COLLECTOR_USERNAME, BACKEND_ROLE, adminUsername);
        } catch (BrokerProvisioningException e) {
            // Logged, not rethrown: the connect listener must not take down the
            // connection, and the next connect (or the next sweep tick) retries.
            log.error("Broker identity provisioning failed — collectors and the live feed may be refused: {}",
                    e.getMessage());
        }
    }

    /**
     * Creates or rotates the credential a browser uses to reach the broker
     * directly (architecture v3 §7 — the live feed is broker→browser, never
     * relayed through this service).
     *
     * <p>Rotating on every mint is deliberate: it is what makes a leaked
     * credential short-lived in practice rather than only in theory, and the
     * frontend mints one per session anyway.
     *
     * @param localUserId {@code users.id} — the same id {@code GET /api/me}
     *                    returns and the live topic is keyed by
     * @throws BrokerProvisioningException if the broker refuses or is unreachable
     */
    public MintedCredential mint(String localUserId) {
        String topicSafeId = requireTopicSafe(localUserId);
        String username = USER_PREFIX + topicSafeId;
        String password = randomPassword();

        ensureRole(username, List.of(
                acl("subscribePattern", "live/" + topicSafeId + "/#"),
                acl("publishClientSend", "v1/" + DEFAULT_TENANT + "/" + topicSafeId + "/+/measurement/+")));
        // Always rewrite the password here: rotating it is the point of a mint,
        // and the broker dropping the previous session is exactly what makes the
        // old credential stop working.
        ensureClient(username, password, username, true);

        Instant now = Instant.now();
        issuedAt.put(localUserId, now);
        return new MintedCredential(username, password, localUserId, now.plus(userCredentialTtl));
    }

    /**
     * Deletes browser credentials that have not been re-minted within the TTL,
     * which is the mechanism behind the {@code expiresAt} the mint endpoint
     * promises — dynamic-security has no notion of expiry of its own, so
     * something has to come round and remove them.
     *
     * <p>Also removes any {@code user-} client this instance has no issue time
     * for: the only writer is {@link #mint}, so such a client is a leftover
     * from a previous run of this service.
     */
    @Scheduled(fixedDelayString = "${thermometer.mqtt.credential-sweep-interval:PT15M}",
            initialDelayString = "${thermometer.mqtt.credential-sweep-interval:PT15M}")
    public void sweepExpiredUserCredentials() {
        if (!mqttGateway.isConnected()) {
            log.debug("Skipping broker credential sweep — not connected");
            return;
        }
        try {
            Instant cutoff = Instant.now().minus(userCredentialTtl);
            for (String username : listUserClients()) {
                String userId = username.substring(USER_PREFIX.length());
                Instant minted = issuedAt.get(userId);
                if (minted != null && minted.isAfter(cutoff)) {
                    continue;
                }
                revoke(username, userId);
            }
        } catch (BrokerProvisioningException e) {
            log.warn("Broker credential sweep failed, retrying next tick: {}", e.getMessage());
        }
    }

    private void revoke(String username, String userId) {
        dynsec.send("deleteClient", Map.of("username", username));
        dynsec.send("deleteRole", Map.of("rolename", username));
        issuedAt.remove(userId);
        log.info("Revoked expired broker credential '{}'", username);
    }

    /** Every {@code user-} client the broker currently holds, across as many pages as it takes. */
    private List<String> listUserClients() {
        List<String> userClients = new ArrayList<>();
        int offset = 0;
        while (true) {
            JsonNode data = dynsec.sendOrThrow("listClients",
                    Map.of("count", LIST_PAGE_SIZE, "offset", offset)).data();
            JsonNode page = data.path("clients");
            if (!page.isArray() || page.isEmpty()) {
                return userClients;
            }
            page.forEach(client -> {
                String username = client.asText("");
                if (username.startsWith(USER_PREFIX)) {
                    userClients.add(username);
                }
            });
            offset += page.size();
            if (offset >= data.path("totalCount").asInt(offset)) {
                return userClients;
            }
        }
    }

    /**
     * Makes the role exist with exactly these ACLs — <b>reading before
     * writing</b>, which matters more than it looks: the plugin disconnects
     * every client holding a role it rewrites, and this service holds
     * {@link #BACKEND_ROLE}. A write-unconditionally version would therefore
     * kick this service on every connect, and since provisioning runs on every
     * connect, that is an endless reconnect loop. Checking first makes the second
     * and later passes no-ops.
     */
    private void ensureRole(String roleName, List<Map<String, Object>> acls) {
        MqttDynamicSecurity.Response existing = dynsec.send("getRole", Map.of("rolename", roleName));
        if (!existing.ok()) {
            MqttDynamicSecurity.Response created = dynsec.send("createRole",
                    Map.of("rolename", roleName, "acls", acls));
            if (!created.ok() && !created.alreadyExists()) {
                throw new BrokerProvisioningException("createRole " + roleName + " refused: " + created.error());
            }
            return;
        }
        if (!aclsMatch(existing.data().path("role").path("acls"), acls)) {
            // modifyRole replaces the ACL list wholesale, so the role converges
            // on what this code describes whatever it looked like before.
            dynsec.sendOrThrow("modifyRole", Map.of("rolename", roleName, "acls", acls));
        }
    }

    /**
     * True if the broker's stored ACLs are the set this code wants. Compared as
     * a set of (type, topic, allow) triples: the broker echoes back a
     * {@code priority} this service never sets, and ACL order is not meaningful
     * for a role whose entries are all allows.
     */
    private static boolean aclsMatch(JsonNode storedAcls, List<Map<String, Object>> wanted) {
        Set<String> stored = new HashSet<>();
        storedAcls.forEach(acl -> stored.add(acl.path("acltype").asText() + ' ' + acl.path("topic").asText()
                + ' ' + acl.path("allow").asBoolean()));
        Set<String> expected = new HashSet<>();
        wanted.forEach(acl -> expected.add(acl.get("acltype") + " " + acl.get("topic") + " " + acl.get("allow")));
        return stored.equals(expected);
    }

    /**
     * Makes the client exist with this role, and — only when
     * {@code rotatePassword} — with this password.
     *
     * <p>The password cannot be compared (the broker stores a hash), so rewriting
     * it is the only way to apply a rotated one; but a rewrite disconnects the
     * client's live sessions, so the caller decides whether that is wanted. For a
     * browser credential it is the whole point; for the shared collector identity
     * it would kick every gateway.
     */
    private void ensureClient(String username, String password, String roleName, boolean rotatePassword) {
        MqttDynamicSecurity.Response existing = dynsec.send("getClient", Map.of("username", username));
        if (!existing.ok()) {
            MqttDynamicSecurity.Response created = dynsec.send("createClient", Map.of(
                    "username", username,
                    "password", password,
                    "roles", List.of(Map.of("rolename", roleName, "priority", -1))));
            if (!created.ok() && !created.alreadyExists()) {
                throw new BrokerProvisioningException("createClient " + username + " refused: " + created.error());
            }
            return;
        }
        if (rotatePassword) {
            dynsec.sendOrThrow("setClientPassword", Map.of("username", username, "password", password));
        }
        addRoleIfMissing(username, existing.data().path("client").path("roles"), roleName);
    }

    /**
     * Adds a role to a client unless it already holds it. Read first because
     * {@code addClientRole} answers a re-add with a bare "Internal error", which
     * is indistinguishable from a real failure — and because the add itself
     * disconnects the client, so it must happen once and not on every connect.
     */
    private void ensureClientRole(String username, String roleName) {
        addRoleIfMissing(username,
                dynsec.sendOrThrow("getClient", Map.of("username", username)).data().path("client").path("roles"),
                roleName);
    }

    private void addRoleIfMissing(String username, JsonNode currentRoles, String roleName) {
        for (JsonNode role : currentRoles) {
            if (roleName.equals(role.path("rolename").asText(null))) {
                return;
            }
        }
        dynsec.sendOrThrow("addClientRole", Map.of("username", username, "rolename", roleName, "priority", -1));
    }

    private static Map<String, Object> acl(String aclType, String topic) {
        return Map.of("acltype", aclType, "topic", topic, "allow", true);
    }

    private String randomPassword() {
        byte[] bytes = new byte[PASSWORD_BYTES];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /**
     * A user id goes straight into a topic filter, so a {@code /}, {@code +} or
     * {@code #} in it would widen that ACL instead of narrowing it. Keycloak
     * subjects are UUIDs and the local-dev id is a plain slug, so this is a
     * guard against a future id format rather than against user input — but it
     * is the kind of guard whose absence turns a schema change into a privilege
     * escalation.
     */
    private static String requireTopicSafe(String localUserId) {
        if (localUserId == null || localUserId.isBlank()
                || localUserId.chars().anyMatch(c -> c == '/' || c == '+' || c == '#' || c <= ' ')) {
            throw new BrokerProvisioningException("user id is not usable in an MQTT topic: " + localUserId);
        }
        return localUserId;
    }
}
