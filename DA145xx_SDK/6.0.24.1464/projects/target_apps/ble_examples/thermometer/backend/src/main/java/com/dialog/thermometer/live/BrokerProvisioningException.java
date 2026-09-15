package com.dialog.thermometer.live;

/**
 * A dynamic-security command could not be applied: the broker is not
 * connected, did not answer within the bounded wait, or answered with an
 * error. Never swallowed — a credential this service failed to provision must
 * not be handed to a client that would then fail to connect with it.
 */
public class BrokerProvisioningException extends RuntimeException {

    public BrokerProvisioningException(String message) {
        super(message);
    }

    public BrokerProvisioningException(String message, Throwable cause) {
        super(message, cause);
    }
}
