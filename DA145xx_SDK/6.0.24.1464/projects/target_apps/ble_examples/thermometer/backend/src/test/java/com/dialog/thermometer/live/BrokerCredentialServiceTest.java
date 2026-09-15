package com.dialog.thermometer.live;

import com.dialog.thermometer.ingest.MqttGateway;
import com.dialog.thermometer.live.BrokerCredentialService.MintedCredential;
import com.dialog.thermometer.live.MqttDynamicSecurity.Response;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The provisioning rules, without a broker: which ACLs each identity gets, that
 * re-provisioning neither fails nor rewrites what is already correct, that every
 * mint rotates the password, and that the TTL sweep deletes exactly the
 * credentials it should.
 *
 * <p>The ACL topics are asserted literally. They are the authorization boundary
 * between a gateway, a browser user and everybody else, so a widened filter
 * (a stray {@code +} or a dropped segment) has to fail a test rather than just
 * work.
 *
 * <p>Collaborators are hand-written doubles rather than Mockito mocks: they are
 * concrete classes, and Mockito's inline mock maker cannot instrument those on
 * the JDK this project builds with. A recording double is arguably clearer here
 * anyway — the assertions are about the exact command stream sent to the broker.
 */
class BrokerCredentialServiceTest {

    private static final Duration TTL = Duration.ofHours(24);

    private static final Map<String, Object> COLLECTOR_ACL = Map.of("acltype", "publishClientSend",
            "topic", "v1/+/collector/+/measurement/+", "allow", true);

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RecordingDynsec dynsec = new RecordingDynsec();
    private final StubGateway gateway = new StubGateway();

    private BrokerCredentialService service;

    @BeforeEach
    void setUp() {
        service = new BrokerCredentialService(dynsec, gateway, "admin", "collector-dev", TTL);
        // The starting point everywhere: a broker that has only been through
        // `mosquitto_ctrl dynsec init`, so the admin client exists (this service
        // is connected as it) and nothing else does.
        dynsec.existingClient("admin", "admin");
    }

    @Test
    void collectorRoleMayOnlyPublishOnCollectorMeasurementTopics() {
        service.ensureBaseIdentities();

        assertEquals(List.of(COLLECTOR_ACL), dynsec.createdRoleAcls("collector"),
                "a gateway must be able to publish measurements and nothing else — no subscribe, no live/, "
                        + "and not under another user's topic segment");
    }

    /**
     * Without this role the live feed is silently dropped by the broker: the
     * dynamic-security admin role can subscribe to everything but may only
     * publish to {@code $CONTROL/dynamic-security/#}.
     */
    @Test
    void backendGrantsItselfPublishRightsOnTheLiveFeedOnly() {
        service.ensureBaseIdentities();

        assertEquals(List.of(Map.of("acltype", "publishClientSend", "topic", "live/#", "allow", true)),
                dynsec.createdRoleAcls("backend"));
        assertTrue(dynsec.sent("addClientRole",
                        Map.of("username", "admin", "rolename", "backend", "priority", -1)),
                "the role has to be attached to this service's own broker client to have any effect");
    }

    @Test
    void collectorClientIsCreatedWithTheConfiguredPassword() {
        service.ensureBaseIdentities();

        Map<String, Object> collector = dynsec.argsOf("createClient").stream()
                .filter(args -> "collector".equals(args.get("username")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no createClient for the collector identity"));
        assertEquals("collector-dev", collector.get("password"));
        assertEquals(List.of(Map.of("rolename", "collector", "priority", -1)), collector.get("roles"));
    }

    /**
     * The loop guard. Provisioning runs on <b>every</b> connect, and the plugin
     * disconnects every client holding a role it rewrites — this service holds
     * the {@code backend} role. So a second pass over an already-correct broker
     * must write nothing at all: otherwise each pass kicks this service off, the
     * reconnect triggers another pass, and the service never stays connected.
     */
    @Test
    void reprovisioningAnAlreadyCorrectBrokerWritesNothing() {
        dynsec.existingRole("collector", COLLECTOR_ACL);
        dynsec.existingRole("backend", Map.of("acltype", "publishClientSend", "topic", "live/#", "allow", true));
        dynsec.existingClient("collector", "collector");
        dynsec.existingClient("admin", "admin", "backend");
        service.ensureBaseIdentities();     // first pass: may rotate the collector password
        dynsec.forgetCalls();

        service.ensureBaseIdentities();     // second pass: must be read-only

        assertEquals(List.of(), dynsec.writeCommands(),
                "a converged broker must be left alone — every write here disconnects somebody");
    }

    /** Converging a broker whose stored ACLs differ from what this code describes. */
    @Test
    void aRoleWithDifferentAclsIsModified() {
        dynsec.existingRole("collector", Map.of("acltype", "publishClientSend", "topic", "#", "allow", true));

        service.ensureBaseIdentities();

        assertTrue(dynsec.sent("modifyRole", Map.of("rolename", "collector", "acls", List.of(COLLECTOR_ACL))),
                "modifyRole replaces the ACL list, so an over-broad role is narrowed back");
    }

    /**
     * A rotated THERMOMETER_MQTT_COLLECTOR_PASSWORD has to take effect — but only
     * once per process, because rewriting it disconnects every gateway using it.
     */
    @Test
    void existingCollectorPasswordIsRewrittenOncePerProcess() {
        dynsec.existingRole("collector", COLLECTOR_ACL);
        dynsec.existingClient("collector", "collector");

        service.ensureBaseIdentities();
        assertTrue(dynsec.sent("setClientPassword",
                Map.of("username", "collector", "password", "collector-dev")));

        dynsec.forgetCalls();
        service.ensureBaseIdentities();
        assertFalse(dynsec.sent("setClientPassword",
                        Map.of("username", "collector", "password", "collector-dev")),
                "a reconnect must not kick every gateway off the broker");
    }

    /** An unexpected refusal must not be mistaken for "already provisioned". */
    @Test
    void aRefusedCommandIsNotSilentlyTreatedAsSuccess() {
        dynsec.errorFor("createRole", "Insufficient privileges");

        assertThrows(BrokerProvisioningException.class, () -> service.mint("u-42"));
    }

    @Test
    void mintScopesTheUserRoleToThatUsersOwnTopics() {
        MintedCredential credential = service.mint("u-42");

        assertEquals("user-u-42", credential.username());
        assertEquals("u-42", credential.userId());
        assertEquals(List.of(
                        Map.of("acltype", "subscribePattern", "topic", "live/u-42/#", "allow", true),
                        Map.of("acltype", "publishClientSend", "topic", "v1/default/u-42/+/measurement/+",
                                "allow", true)),
                dynsec.createdRoleAcls("user-u-42"),
                "a browser may read its own live feed and publish its own device's readings — nothing else");
    }

    @Test
    void mintedPasswordIsLongRandomAndRotatedOnEveryCall() {
        MintedCredential first = service.mint("u-42");
        MintedCredential second = service.mint("u-42");

        assertTrue(first.password().length() >= 32, "password must be at least 32 characters: " + first.password());
        assertNotEquals(first.password(), second.password(),
                "every mint rotates the password, so the previous credential stops working");
    }

    /** Re-minting for a user who already has a client must rewrite the password, not skip it. */
    @Test
    void reMintRewritesTheExistingClientsPassword() {
        dynsec.existingRole("user-u-42",
                Map.of("acltype", "subscribePattern", "topic", "live/u-42/#", "allow", true),
                Map.of("acltype", "publishClientSend", "topic", "v1/default/u-42/+/measurement/+", "allow", true));
        dynsec.existingClient("user-u-42", "user-u-42");

        MintedCredential credential = service.mint("u-42");

        assertTrue(dynsec.sent("setClientPassword",
                        Map.of("username", "user-u-42", "password", credential.password())),
                "the returned password is only usable if the broker was told about it");
        assertTrue(dynsec.argsOf("modifyRole").isEmpty(), "the ACLs were already right — nothing to rewrite");
    }

    @Test
    void expiresAtIsTheConfiguredTtlAhead() {
        Instant before = Instant.now();
        MintedCredential credential = service.mint("u-42");

        assertFalse(credential.expiresAt().isBefore(before.plus(TTL)),
                "expiresAt must be now + thermometer.mqtt.user-credential-ttl, was " + credential.expiresAt());
        assertTrue(credential.expiresAt().isBefore(before.plus(TTL).plusSeconds(30)));
    }

    @Test
    void mintRefusesAUserIdThatWouldWidenItsOwnTopicFilter() {
        assertThrows(BrokerProvisioningException.class, () -> service.mint("u/+"),
                "an MQTT wildcard in the id would turn a per-user ACL into a broader one");
        assertThrows(BrokerProvisioningException.class, () -> service.mint("#"));
        assertThrows(BrokerProvisioningException.class, () -> service.mint("with space"));
        assertThrows(BrokerProvisioningException.class, () -> service.mint(""));
        assertThrows(BrokerProvisioningException.class, () -> service.mint(null));
    }

    @Test
    void sweepDeletesUnknownAndExpiredUserClientsButKeepsFreshOnes() {
        gateway.connected = true;
        service.mint("fresh");           // minted just now → must survive
        dynsec.clients("admin", "collector", "user-fresh", "user-orphan");

        service.sweepExpiredUserCredentials();

        assertTrue(dynsec.sent("deleteClient", Map.of("username", "user-orphan")),
                "a user client this instance never minted is a leftover and must go");
        assertTrue(dynsec.sent("deleteRole", Map.of("rolename", "user-orphan")),
                "the role goes with the client, or the broker accumulates dead roles");
        assertFalse(dynsec.sent("deleteClient", Map.of("username", "user-fresh")),
                "a credential inside its TTL must survive the sweep");
        assertFalse(dynsec.sent("deleteClient", Map.of("username", "collector")),
                "the sweep must never touch the collector identity");
        assertFalse(dynsec.sent("deleteClient", Map.of("username", "admin")),
                "...nor this service's own client");
    }

    @Test
    void sweepDoesNothingWhileDisconnected() {
        gateway.connected = false;

        service.sweepExpiredUserCredentials();

        assertTrue(dynsec.argsOf("listClients").isEmpty(), "nothing to do, and nothing to fail, while offline");
    }

    /**
     * Records every command sent and answers the read commands from a scripted
     * broker state. Unknown roles/clients answer "not found", which is the
     * empty-broker case.
     */
    private final class RecordingDynsec extends MqttDynamicSecurity {

        private final List<Call> calls = new ArrayList<>();
        private final Map<String, String> errors = new HashMap<>();
        private final Map<String, ObjectNode> roles = new HashMap<>();
        private final Map<String, ObjectNode> clients = new HashMap<>();
        private ObjectNode clientList;

        private RecordingDynsec() {
            super(null, new ObjectMapper());
        }

        private record Call(String command, Map<String, Object> args) {
        }

        void errorFor(String command, String error) {
            errors.put(command, error);
        }

        @SafeVarargs
        final void existingRole(String rolename, Map<String, Object>... acls) {
            ObjectNode role = objectMapper.createObjectNode();
            role.put("rolename", rolename);
            var array = role.putArray("acls");
            for (Map<String, Object> acl : acls) {
                ObjectNode stored = array.addObject();
                stored.put("acltype", String.valueOf(acl.get("acltype")));
                stored.put("topic", String.valueOf(acl.get("topic")));
                stored.put("priority", 0);          // the broker echoes one back; this code never sets it
                stored.put("allow", Boolean.TRUE.equals(acl.get("allow")));
            }
            roles.put(rolename, role);
        }

        void existingClient(String username, String... rolenames) {
            ObjectNode client = objectMapper.createObjectNode();
            client.put("username", username);
            var array = client.putArray("roles");
            for (String rolename : rolenames) {
                array.addObject().put("rolename", rolename);
            }
            clients.put(username, client);
        }

        void clients(String... usernames) {
            clientList = objectMapper.createObjectNode();
            clientList.put("totalCount", usernames.length);
            var array = clientList.putArray("clients");
            for (String username : usernames) {
                array.add(username);
            }
        }

        void forgetCalls() {
            calls.clear();
        }

        List<Map<String, Object>> argsOf(String command) {
            return calls.stream().filter(call -> call.command().equals(command)).map(Call::args).toList();
        }

        /** Every command that changes broker state, in order — the thing that must not repeat. */
        List<String> writeCommands() {
            return calls.stream()
                    .map(Call::command)
                    .filter(command -> !command.startsWith("get") && !command.startsWith("list"))
                    .toList();
        }

        boolean sent(String command, Map<String, Object> args) {
            return calls.contains(new Call(command, args));
        }

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> createdRoleAcls(String roleName) {
            return argsOf("createRole").stream()
                    .filter(args -> roleName.equals(args.get("rolename")))
                    .map(args -> (List<Map<String, Object>>) args.get("acls"))
                    .findFirst()
                    .orElseThrow(() -> new AssertionError("no createRole for '" + roleName + "'"));
        }

        @Override
        public Response send(String command, Map<String, Object> args) {
            calls.add(new Call(command, args));
            String error = errors.get(command);
            ObjectNode data = objectMapper.createObjectNode();
            switch (command) {
                case "getRole" -> {
                    ObjectNode role = roles.get(String.valueOf(args.get("rolename")));
                    if (role == null) {
                        error = "Role not found";
                    } else {
                        data.set("role", role);
                    }
                }
                case "getClient" -> {
                    ObjectNode client = clients.get(String.valueOf(args.get("username")));
                    if (client == null) {
                        error = "Client not found";
                    } else {
                        data.set("client", client);
                    }
                }
                case "listClients" -> {
                    if (clientList != null) {
                        data = clientList;
                    }
                }
                default -> {
                    // A write command; recorded above, nothing to answer with.
                }
            }
            return new Response(command, error, data);
        }

        @Override
        public Response sendOrThrow(String command, Map<String, Object> args) {
            Response response = send(command, args);
            if (!response.ok()) {
                throw new BrokerProvisioningException(command + " refused: " + response.error());
            }
            return response;
        }
    }

    /** Only {@link MqttGateway#isConnected()} matters here; nothing connects. */
    private static final class StubGateway extends MqttGateway {

        private boolean connected;

        private StubGateway() {
            super("tcp://localhost:1883", "test", "", "");
        }

        @Override
        public boolean isConnected() {
            return connected;
        }

        @Override
        public void onConnected(Runnable listener) {
            // The provisioning-on-connect wiring is covered by IngestPipelineIT.
        }
    }
}
