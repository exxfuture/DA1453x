package com.dialog.thermometer.api.dto;

import com.dialog.thermometer.domain.TemperatureUnit;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record UpdateMeRequest(@Size(max = 128) String displayName, @NotNull TemperatureUnit temperatureUnit) {
}
