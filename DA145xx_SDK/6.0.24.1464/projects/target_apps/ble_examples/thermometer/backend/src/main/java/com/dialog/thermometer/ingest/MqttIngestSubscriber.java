package com.dialog.thermometer.ingest;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Subscribes directly to the broker via {@link MqttGateway} — no separate
 * durable-log tier, per architecture v3 §8 / v2 §7.1. QoS 1 + Paho's
 * synchronous callback model gives ack-after-processing for free: the
 * listener is only invoked with the next message once it returns for the
 * current one, and Paho only sends the PUBACK after the listener returns
 * normally. If {@link MeasurementIngestService#ingest} throws, the exception
 * propagates out of the listener, the message is never acknowledged, and a
 * persistent (non-clean) session redelivers it after reconnect — the same
 * at-least-once guarantee a durable log would provide, with one fewer
 * service to run.
 *
 * <p>The broker requires credentials and enforces per-identity publish ACLs
 * (dynamic-security — see {@code live/BrokerCredentialService}), so the topic a
 * message arrived on carries authorization information: the subscription filter
 * keeps the topic's user segment, and
 * {@link MeasurementIngestService#ingestFromTopic} decides from it whether this
 * is a trusted collector or a browser user who may only write their own
 * device's readings. This subscriber therefore passes the topic on rather than
 * only the decoded envelope.
 */
@Component
public class MqttIngestSubscriber {

    private static final Logger log = LoggerFactory.getLogger(MqttIngestSubscriber.class);
    private static final String TOPIC_FILTER = "v1/+/+/+/measurement/+";

    private final MeasurementIngestService ingestService;
    private final ObjectMapper objectMapper;
    private final MqttGateway mqttGateway;

    public MqttIngestSubscriber(MeasurementIngestService ingestService, ObjectMapper objectMapper, MqttGateway mqttGateway) {
        this.ingestService = ingestService;
        this.objectMapper = objectMapper;
        this.mqttGateway = mqttGateway;
    }

    @PostConstruct
    public void start() {
        mqttGateway.subscribe(TOPIC_FILTER, 1, (topic, message) -> {
            MeasurementEnvelope envelope = objectMapper.readValue(message.getPayload(), MeasurementEnvelope.class);
            boolean inserted = ingestService.ingestFromTopic(topic, envelope);
            log.debug("Ingested from topic {} device={} type={} inserted={}",
                    topic, envelope.deviceId(), envelope.type(), inserted);
        });
    }
}
