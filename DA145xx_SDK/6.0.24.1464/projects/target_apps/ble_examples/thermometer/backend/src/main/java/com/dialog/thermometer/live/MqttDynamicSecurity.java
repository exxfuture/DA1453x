package com.dialog.thermometer.live;

import com.dialog.thermometer.ingest.MqttGateway;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Speaks Mosquitto's <a href="https://mosquitto.org/documentation/dynamic-security/">
 * dynamic-security</a> control protocol: commands are published to
 * {@code $CONTROL/dynamic-security/v1} and the broker answers on
 * {@code …/v1/response}, addressed only to the client that asked.
 *
 * <p>Responses carry back the {@code correlationData} they were sent with, and
 * that is the only thing tying an answer to a request — MQTT has no
 * request/response semantics of its own, and several commands may be in flight.
 * Each call therefore parks a future under its own correlation id and waits for
 * it with a <b>bounded</b> timeout: a broker that is up but not answering must
 * fail a mint request in a second or two, not hang an HTTP worker forever.
 *
 * <p>Uses {@link MqttGateway} rather than a connection of its own — that class
 * stays the single owner of this service's broker connection, and this one is
 * only a codec on top of it.
 */
@Component
public class MqttDynamicSecurity {

    private static final Logger log = LoggerFactory.getLogger(MqttDynamicSecurity.class);

    static final String COMMAND_TOPIC = "$CONTROL/dynamic-security/v1";
    static final String RESPONSE_TOPIC = COMMAND_TOPIC + "/response";

    /**
     * How long to wait for the broker's answer. Short on purpose: the broker is
     * a container away, the plugin answers from memory, and this wait sits
     * inside the HTTP request that mints a browser credential.
     */
    private static final Duration COMMAND_TIMEOUT = Duration.ofSeconds(5);

    private final MqttGateway mqttGateway;
    private final ObjectMapper objectMapper;
    private final Map<String, CompletableFuture<Response>> pending = new ConcurrentHashMap<>();

    public MqttDynamicSecurity(MqttGateway mqttGateway, ObjectMapper objectMapper) {
        this.mqttGateway = mqttGateway;
        this.objectMapper = objectMapper;
    }

    /**
     * One command's outcome. {@code error} is the broker's own message
     * ("Role already exists", "Client not found", …) and is what callers branch
     * on to stay idempotent, rather than probing with a {@code get*} command
     * first and racing themselves.
     */
    public record Response(String command, String error, JsonNode data) {

        public boolean ok() {
            return error == null;
        }

        public boolean alreadyExists() {
            return error != null && error.toLowerCase().contains("already exists");
        }
    }

    /**
     * Registered here rather than in a connect listener so the subscription is
     * in place before the first command is ever published (MqttGateway applies
     * queued subscriptions ahead of running its connect listeners).
     */
    @PostConstruct
    void subscribeToResponses() {
        mqttGateway.subscribe(RESPONSE_TOPIC, 1, (topic, message) ->
                dispatch(new String(message.getPayload(), StandardCharsets.UTF_8)));
    }

    /**
     * Sends one dynamic-security command and returns the broker's answer.
     *
     * @param command the {@code command} name, e.g. {@code createRole}
     * @param args    command arguments; {@code correlationData} is added here
     * @throws BrokerProvisioningException if the command cannot be published, or
     *                                     no answer arrives within the timeout
     */
    public Response send(String command, Map<String, Object> args) {
        String correlationData = UUID.randomUUID().toString();
        Map<String, Object> payload = new LinkedHashMap<>(args.size() + 2);
        payload.put("command", command);
        payload.putAll(args);
        payload.put("correlationData", correlationData);

        CompletableFuture<Response> answer = new CompletableFuture<>();
        pending.put(correlationData, answer);
        try {
            mqttGateway.publishOrThrow(COMMAND_TOPIC,
                    objectMapper.writeValueAsString(Map.of("commands", List.of(payload))));
            return answer.get(COMMAND_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
        } catch (MqttException e) {
            throw new BrokerProvisioningException("could not publish dynamic-security command " + command, e);
        } catch (TimeoutException e) {
            throw new BrokerProvisioningException(
                    "broker did not answer dynamic-security command " + command + " within " + COMMAND_TIMEOUT, e);
        } catch (ExecutionException e) {
            throw new BrokerProvisioningException("dynamic-security command " + command + " failed", e.getCause());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BrokerProvisioningException("interrupted waiting for dynamic-security command " + command, e);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new BrokerProvisioningException("could not encode dynamic-security command " + command, e);
        } finally {
            pending.remove(correlationData);
        }
    }

    /** Like {@link #send}, but treats anything other than success as a failure. */
    public Response sendOrThrow(String command, Map<String, Object> args) {
        Response response = send(command, args);
        if (!response.ok()) {
            throw new BrokerProvisioningException(
                    "dynamic-security command " + command + " refused: " + response.error());
        }
        return response;
    }

    /**
     * Completes the futures for every response in one broker message. Responses
     * for correlation ids nobody is waiting on (a timed-out command whose answer
     * arrived late) are logged and dropped — the alternative, keeping them
     * around, is an unbounded map keyed by attacker-independent but unbounded
     * input.
     */
    private void dispatch(String payload) {
        try {
            JsonNode responses = objectMapper.readTree(payload).path("responses");
            for (JsonNode response : responses) {
                String correlationData = response.path("correlationData").asText(null);
                CompletableFuture<Response> waiting = correlationData != null ? pending.get(correlationData) : null;
                if (waiting == null) {
                    log.debug("Unmatched dynamic-security response: {}", response);
                    continue;
                }
                waiting.complete(new Response(
                        response.path("command").asText(null),
                        response.hasNonNull("error") ? response.get("error").asText() : null,
                        response.path("data")));
            }
        } catch (Exception e) {
            // Parsing the broker's own control answers should never fail; if it
            // does, the waiting commands time out rather than this throwing on
            // Paho's callback thread (which would drop the connection).
            log.warn("Could not parse dynamic-security response '{}': {}", payload, e.getMessage());
        }
    }
}
