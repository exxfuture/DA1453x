package com.dialog.thermometer.api.dto;

import com.dialog.thermometer.event.TemperatureEvent;

import java.util.List;

/**
 * One consenting patient's fever episodes in the requested window, for the
 * doctor's fleet-wide feed. A patient with no claimed device, or with no
 * episodes, is still present with an empty list — "nothing happened" and "not
 * monitored" are both useful to see, and dropping the row would hide them.
 */
public record PatientEventsResponse(
        String patientUserId,
        String patientUsername,
        String deviceBdAddr,
        List<TemperatureEvent> events) {
}
