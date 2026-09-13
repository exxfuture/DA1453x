package com.dialog.thermometer.api.dto;

public record PatientResponse(
        String patientUserId,
        String patientUsername,
        String deviceBdAddr,
        String deviceModel) {
}
