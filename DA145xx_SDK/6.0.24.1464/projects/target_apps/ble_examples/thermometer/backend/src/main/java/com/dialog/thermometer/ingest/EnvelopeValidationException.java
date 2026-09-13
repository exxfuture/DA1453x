package com.dialog.thermometer.ingest;

/** Malformed measurement envelope — quarantined, never silently dropped. */
public class EnvelopeValidationException extends RuntimeException {

    public EnvelopeValidationException(String message) {
        super(message);
    }
}
