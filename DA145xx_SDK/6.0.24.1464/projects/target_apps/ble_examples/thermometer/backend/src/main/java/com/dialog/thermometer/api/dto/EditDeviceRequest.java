package com.dialog.thermometer.api.dto;

/** Admin-only device metadata edit — all fields optional, only non-null ones are applied. */
public record EditDeviceRequest(String model, String fwVersion, String label) {
}
