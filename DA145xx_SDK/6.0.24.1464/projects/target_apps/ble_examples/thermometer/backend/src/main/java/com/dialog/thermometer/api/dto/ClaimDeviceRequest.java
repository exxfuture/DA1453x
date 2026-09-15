package com.dialog.thermometer.api.dto;

import jakarta.validation.constraints.Size;

/**
 * bdAddr is now a path variable (POST /api/devices/{bdAddr}/claim). Both
 * fields are optional: claiming an already-registered device (the normal
 * case — the simulated fleet and any real device register themselves on
 * first measurement upload, see MeasurementIngestService) needs neither;
 * they only matter for claiming a brand-new bdAddr the backend hasn't seen
 * a reading from yet. A null/absent request body is valid (see DeviceController).
 *
 * <p>The bounds match the columns they land in (devices.model VARCHAR(64),
 * devices.fw_version VARCHAR(32)), so over-length input is a 400 with a field
 * message rather than a Hibernate/Postgres length error surfacing as a 500.
 */
public record ClaimDeviceRequest(
        @Size(max = 64, message = "model must be at most 64 characters") String model,
        @Size(max = 32, message = "fwVersion must be at most 32 characters") String fwVersion) {
}
