package com.dialog.thermometer.api.dto;

/**
 * bdAddr is now a path variable (POST /api/devices/{bdAddr}/claim). Both
 * fields are optional: claiming an already-registered device (the normal
 * case — the simulated fleet and any real device register themselves on
 * first measurement upload, see MeasurementIngestService) needs neither;
 * they only matter for claiming a brand-new bdAddr the backend hasn't seen
 * a reading from yet. A null/absent request body is valid (see DeviceController).
 */
public record ClaimDeviceRequest(String model, String fwVersion) {
}
