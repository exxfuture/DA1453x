package com.dialog.thermometer.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * Local, JIT-provisioned mirror of a Keycloak identity (see
 * com.dialog.thermometer.security.CurrentUserService) — id is the JWT `sub`.
 * username/email/role are re-synced from the JWT on every request and will
 * self-heal if the Keycloak realm changes; displayName and temperatureUnit
 * are locally-owned fields, edited via MeController and never overwritten by
 * sync.
 */
@Entity
@Table(name = "users")
public class User {

    @Id
    private String id;

    @Column(nullable = false, unique = true, length = 128)
    private String username;

    @Column(length = 256)
    private String email;

    @Column(nullable = false, length = 16)
    private String role;

    @Column(name = "display_name", length = 128)
    private String displayName;

    @Enumerated(EnumType.STRING)
    @Column(name = "temperature_unit", nullable = false, length = 10)
    private TemperatureUnit temperatureUnit = TemperatureUnit.CELSIUS;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected User() {
        // JPA
    }

    public User(String id, String username, String email, String role) {
        this.id = id;
        this.username = username;
        this.email = email;
        this.role = role;
    }

    public String getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getRole() {
        return role;
    }

    public void setRole(String role) {
        this.role = role;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public TemperatureUnit getTemperatureUnit() {
        return temperatureUnit;
    }

    public void setTemperatureUnit(TemperatureUnit temperatureUnit) {
        this.temperatureUnit = temperatureUnit;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void touch() {
        this.updatedAt = Instant.now();
    }
}
