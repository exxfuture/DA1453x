package com.dialog.thermometer.it;

import com.dialog.thermometer.admin.AdminAnalyticsController;
import com.dialog.thermometer.annotation.AnnotationController;
import com.dialog.thermometer.admin.AdminController;
import com.dialog.thermometer.api.ConsentController;
import com.dialog.thermometer.api.DeviceController;
import com.dialog.thermometer.api.MeController;
import com.dialog.thermometer.api.MeasurementController;
import com.dialog.thermometer.rollout.RolloutController;
import com.dialog.thermometer.api.dto.AdminUserResponse;
import com.dialog.thermometer.api.dto.AnnotationResponse;
import com.dialog.thermometer.api.dto.AuditLogResponse;
import com.dialog.thermometer.api.dto.CareNoteResponse;
import com.dialog.thermometer.api.dto.ConsentHistoryResponse;
import com.dialog.thermometer.api.dto.ConsentResponse;
import com.dialog.thermometer.api.dto.CreateAnnotationRequest;
import com.dialog.thermometer.api.dto.CreateCareNoteRequest;
import com.dialog.thermometer.api.dto.CreateRolloutRequest;
import com.dialog.thermometer.api.dto.DeviceResponse;
import com.dialog.thermometer.api.dto.GrantConsentRequest;
import com.dialog.thermometer.api.dto.MeResponse;
import com.dialog.thermometer.api.dto.MeasurementResponse;
import com.dialog.thermometer.api.dto.PageResponse;
import com.dialog.thermometer.api.dto.PatientEventsResponse;
import com.dialog.thermometer.api.dto.PatientSummaryResponse;
import com.dialog.thermometer.api.dto.RenameDeviceRequest;
import com.dialog.thermometer.api.dto.RolloutResponse;
import com.dialog.thermometer.api.dto.RolloutStatusRequest;
import com.dialog.thermometer.api.dto.ThresholdResponse;
import com.dialog.thermometer.api.dto.UpdateAnnotationRequest;
import com.dialog.thermometer.api.dto.UpdateCareNoteRequest;
import com.dialog.thermometer.api.dto.UpdateMeRequest;
import com.dialog.thermometer.api.dto.UpdateUserRoleRequest;
import com.dialog.thermometer.api.dto.UpsertThresholdRequest;
import com.dialog.thermometer.care.CareNoteController;
import com.dialog.thermometer.domain.AlertThreshold;
import com.dialog.thermometer.domain.AlertThresholdRepository;
import com.dialog.thermometer.domain.Device;
import com.dialog.thermometer.domain.DeviceRepository;
import com.dialog.thermometer.domain.TemperatureUnit;
import com.dialog.thermometer.event.EventController;
import com.dialog.thermometer.event.TemperatureEvent;
import com.dialog.thermometer.ingest.MeasurementEnvelope;
import com.dialog.thermometer.security.CurrentUser;
import com.dialog.thermometer.security.CurrentUserService;
import com.dialog.thermometer.threshold.AlertThresholdService;
import com.dialog.thermometer.threshold.ThresholdController;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Covers the core RBAC/ownership/consent matrix introduced alongside the
 * local {@code users} table and CurrentUserService (see
 * ARCHITECTURE_V3.html §5/§9, backend/README.md). Exercises real controller
 * methods (real JPA, real Postgres via Testcontainers, same pattern as
 * {@link IngestPipelineIT}) with hand-built {@link Jwt}-backed
 * Authentications — the `test` profile disables JWT parsing entirely (see
 * application-test.yml), so this is the only way to drive role-differentiated
 * requests without standing up a real Keycloak.
 */
@SpringBootTest
@ActiveProfiles("test")
@Testcontainers
class RbacIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>(
            DockerImageName.parse("timescale/timescaledb:latest-pg16").asCompatibleSubstituteFor("postgres"))
            .withDatabaseName("thermometer")
            .withUsername("thermometer")
            .withPassword("thermometer");

    /**
     * The broker this service talks to refuses anonymous connections (see
     * {@link MosquittoDynsecContainer}); these tests don't publish over MQTT
     * themselves, but the application context connects on startup, so the
     * credentials have to be real ones.
     */
    @Container
    static GenericContainer<?> mosquitto = MosquittoDynsecContainer.create();

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("thermometer.mqtt.broker-url", () -> MosquittoDynsecContainer.brokerUrl(mosquitto));
        registry.add("thermometer.mqtt.username", () -> MosquittoDynsecContainer.ADMIN_USERNAME);
        registry.add("thermometer.mqtt.password", () -> MosquittoDynsecContainer.ADMIN_PASSWORD);
        registry.add("thermometer.mqtt.collector-password", () -> MosquittoDynsecContainer.COLLECTOR_PASSWORD);
    }

    @Autowired
    private DeviceController deviceController;
    @Autowired
    private ConsentController consentController;
    @Autowired
    private AdminController adminController;
    @Autowired
    private MeasurementController measurementController;
    @Autowired
    private MeController meController;
    @Autowired
    private ThresholdController thresholdController;
    @Autowired
    private EventController eventController;
    @Autowired
    private AnnotationController annotationController;
    @Autowired
    private CareNoteController careNoteController;
    @Autowired
    private AdminAnalyticsController adminAnalyticsController;
    @Autowired
    private RolloutController rolloutController;
    @Autowired
    private DeviceRepository devices;
    @Autowired
    private AlertThresholdRepository alertThresholds;
    @Autowired
    private CurrentUserService currentUserService;

    /**
     * Read from configuration rather than hardcoded, so this stays a test of
     * "the configured secret is required" and not of one particular string.
     */
    @Value("${thermometer.device.collector-token}")
    private String collectorToken;

    private Authentication authFor(String sub, String username, String role) {
        Jwt jwt = Jwt.withTokenValue("fake." + sub)
                .header("alg", "none")
                .subject(sub)
                .claim("preferred_username", username)
                .claim("email", username + "@example.test")
                .claim("realm_access", Map.of("roles", List.of(role)))
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(3600))
                .build();
        Authentication authentication = new JwtAuthenticationToken(jwt);
        currentUserService.resolve(authentication); // provisions the local users row before it's referenced elsewhere
        return authentication;
    }

    @Test
    void customerCanClaimMultipleDevicesButNotOneAnotherCustomerAlreadyOwns() {
        devices.save(new Device("AA:AA:AA:AA:AA:01", "unknown", null));
        devices.save(new Device("AA:AA:AA:AA:AA:02", "unknown", null));
        Authentication customerA = authFor("rbac-customer-1", "rbac-customer1", "customer");
        Authentication customerB = authFor("rbac-customer-1b", "rbac-customer1b", "customer");

        ResponseEntity<DeviceResponse> firstClaim = deviceController.claim("AA:AA:AA:AA:AA:01", null, customerA);
        assertEquals(HttpStatus.OK, firstClaim.getStatusCode());

        ResponseEntity<DeviceResponse> secondClaim = deviceController.claim("AA:AA:AA:AA:AA:02", null, customerA);
        assertEquals(HttpStatus.OK, secondClaim.getStatusCode(), "a customer may own more than one device");
        assertEquals(2, deviceController.list(customerA).size());

        ResponseEntity<DeviceResponse> stolenClaim = deviceController.claim("AA:AA:AA:AA:AA:01", null, customerB);
        assertEquals(HttpStatus.CONFLICT, stolenClaim.getStatusCode(),
                "a device already owned by someone else must still be rejected");
    }

    @Test
    void doctorCannotClaimADevice() {
        devices.save(new Device("AA:AA:AA:AA:AA:03", "unknown", null));
        Authentication doctor = authFor("rbac-doctor-1", "rbac-doctor1", "doctor");

        ResponseStatusException rejection = assertThrows(ResponseStatusException.class,
                () -> deviceController.claim("AA:AA:AA:AA:AA:03", null, doctor));
        assertEquals(HttpStatus.FORBIDDEN, rejection.getStatusCode());
    }

    @Test
    void adminForceReleasesADeviceInsteadOfClaimingIt() {
        devices.save(new Device("AA:AA:AA:AA:AA:04", "unknown", null));
        Authentication customer = authFor("rbac-customer-2", "rbac-customer2", "customer");
        Authentication admin = authFor("rbac-admin-1", "rbac-admin1", "admin");

        deviceController.claim("AA:AA:AA:AA:AA:04", null, customer);

        // Admin never hits the customer claim path for itself — attempting
        // to would 403, matching doctor's rejection above.
        assertThrows(ResponseStatusException.class, () -> deviceController.claim("AA:AA:AA:AA:AA:05", null, admin));

        ResponseEntity<Void> release = adminController.releaseDevice("AA:AA:AA:AA:AA:04", admin);
        assertEquals(HttpStatus.NO_CONTENT, release.getStatusCode());
        assertNull(devices.findByBdAddr("AA:AA:AA:AA:AA:04").orElseThrow().getOwnerUserId());
    }

    @Test
    void consentGrantsDoctorAccessToPatientHistoryButNotAnUnrelatedCustomer() {
        String bdAddr = "AA:AA:AA:AA:AA:06";
        devices.save(new Device(bdAddr, "unknown", null));

        Authentication patient = authFor("rbac-patient-1", "rbac-patient1", "customer");
        Authentication doctor = authFor("rbac-doctor-2", "rbac-doctor2", "doctor");
        Authentication strangerCustomer = authFor("rbac-stranger-1", "rbac-stranger1", "customer");

        deviceController.claim(bdAddr, null, patient);
        measurementController.ingest(new MeasurementEnvelope(
                1, bdAddr, "rbac-it", Instant.now(), "temperature", Map.of("celsius", 21.5), Map.of()), patient);

        assertThrows(ResponseStatusException.class,
                () -> measurementController.history(bdAddr, "temperature", null, null, 500, doctor),
                "no consent granted yet — doctor must not see this patient's readings");
        assertThrows(ResponseStatusException.class,
                () -> measurementController.history(bdAddr, "temperature", null, null, 500, strangerCustomer),
                "an unrelated customer must never see another customer's device history");

        consentController.grant(new GrantConsentRequest("rbac-doctor-2"), patient);

        List<MeasurementResponse> readings = measurementController.history(bdAddr, "temperature", null, null, 500, doctor);
        assertFalse(readings.isEmpty(), "doctor should now read the consenting patient's history");

        assertThrows(ResponseStatusException.class,
                () -> measurementController.history(bdAddr, "temperature", null, null, 500, strangerCustomer),
                "consent to one doctor must not leak access to unrelated customers");
    }

    @Test
    void provisioningReusesTheExistingRowWhenKeycloaksSubChangesButUsernameDoesnt() {
        // Regression test: the `keycloak` docker-compose service runs
        // `start-dev --import-realm` with no persistent volume, so a
        // Keycloak-only restart re-imports the realm and issues a brand-new
        // random `sub` per demo user while Postgres's `users` table (which
        // does persist) still has the old row under the old `sub`. Simulate
        // that here by resolving the same username under two different
        // subs, as two separate logins would after such a restart.
        CurrentUser firstLogin = currentUserService.resolve(authFor("rbac-churn-sub-1", "rbac-churn-user", "customer"));

        CurrentUser secondLogin = currentUserService.resolve(
                authFor("rbac-churn-sub-2", "rbac-churn-user", "customer"));

        assertEquals(firstLogin.id(), secondLogin.id(),
                "a sub change for the same username must reuse the existing row, not collide on the username's unique constraint");
    }

    @Test
    void adminSeesFullUsersAndRelationshipListings() {
        Authentication patient = authFor("rbac-patient-2", "rbac-patient2", "customer");
        Authentication doctor = authFor("rbac-doctor-3", "rbac-doctor3", "doctor");
        Authentication admin = authFor("rbac-admin-2", "rbac-admin2", "admin");

        consentController.grant(new GrantConsentRequest("rbac-doctor-3"), patient);

        // The admin listings are paged now; a page big enough to hold the
        // whole test fixture keeps this assertion about visibility, not
        // pagination (which ScratchEndpointSmokeIT covers separately).
        Pageable firstPage = PageRequest.of(0, 200);

        List<AdminUserResponse> allUsers = adminController.users(null, null, firstPage, admin).content();
        assertTrue(allUsers.stream().anyMatch(u -> u.id().equals("rbac-patient-2")));
        assertTrue(allUsers.stream().anyMatch(u -> u.id().equals("rbac-doctor-3")));

        List<ConsentResponse> allConsents = adminController.consents(firstPage, admin).content();
        assertTrue(allConsents.stream()
                .anyMatch(c -> c.patientUserId().equals("rbac-patient-2") && c.doctorUserId().equals("rbac-doctor-3")));

        assertThrows(ResponseStatusException.class, () -> adminController.users(null, null, firstPage, doctor),
                "only admin can list all users");
    }

    @Test
    void customerCanUpdateDisplayNameAndTemperatureUnitViaPatchMe() {
        Authentication customer = authFor("rbac-customer-4", "rbac-customer4", "customer");

        MeResponse defaults = meController.me(customer);
        assertEquals(TemperatureUnit.CELSIUS, defaults.temperatureUnit(), "new users default to Celsius");

        MeResponse updated = meController.update(new UpdateMeRequest("Jane Doe", TemperatureUnit.FAHRENHEIT), customer);
        assertEquals("Jane Doe", updated.displayName());
        assertEquals(TemperatureUnit.FAHRENHEIT, updated.temperatureUnit());

        MeResponse refetched = meController.me(customer);
        assertEquals("Jane Doe", refetched.displayName(), "the saved display name must persist across requests");
        assertEquals(TemperatureUnit.FAHRENHEIT, refetched.temperatureUnit());
    }

    @Test
    void doctorPatientsSummaryAggregatesWithinRangeShowsUnboundedLatestAndEnforcesRole() {
        String activeBdAddr = "AA:AA:AA:AA:AA:07";
        String staleBdAddr = "AA:AA:AA:AA:AA:08";
        devices.save(new Device(activeBdAddr, "unknown", null));
        devices.save(new Device(staleBdAddr, "unknown", null));

        Authentication activePatient = authFor("rbac-summary-patient-1", "rbac-summary-patient1", "customer");
        Authentication stalePatient = authFor("rbac-summary-patient-2", "rbac-summary-patient2", "customer");
        authFor("rbac-summary-patient-3", "rbac-summary-patient3", "customer"); // never grants consent
        Authentication doctor = authFor("rbac-summary-doctor-1", "rbac-summary-doctor1", "doctor");

        deviceController.claim(activeBdAddr, null, activePatient);
        deviceController.claim(staleBdAddr, null, stalePatient);
        consentController.grant(new GrantConsentRequest("rbac-summary-doctor-1"), activePatient);
        consentController.grant(new GrantConsentRequest("rbac-summary-doctor-1"), stalePatient);

        Instant now = Instant.now();
        ingest(activeBdAddr, now.minusSeconds(600), 37.0, activePatient);
        ingest(activeBdAddr, now.minusSeconds(300), 38.0, activePatient);
        ingest(activeBdAddr, now.minusSeconds(60), 39.0, activePatient);
        ingest(staleBdAddr, now.minusSeconds(7200), 40.0, stalePatient); // outside the 1h range queried below

        List<PatientSummaryResponse> summary = consentController.myPatientsSummary(1, doctor);
        assertEquals(2, summary.size(), "only consenting patients should appear, not the unconsented third patient");

        PatientSummaryResponse active = summary.stream()
                .filter(s -> s.patientUserId().equals("rbac-summary-patient-1")).findFirst().orElseThrow();
        assertEquals(3, active.readingCount());
        assertEquals(39.0, active.latestCelsius(), 0.001);
        assertEquals(38.0, active.avgCelsius(), 0.001);
        assertEquals(37.0, active.minCelsius(), 0.001);
        assertEquals(39.0, active.maxCelsius(), 0.001);
        assertEquals(3, active.sparkline().size());

        PatientSummaryResponse stale = summary.stream()
                .filter(s -> s.patientUserId().equals("rbac-summary-patient-2")).findFirst().orElseThrow();
        assertEquals(0, stale.readingCount(), "the only reading falls outside the requested 1h range");
        assertNull(stale.avgCelsius());
        assertEquals(40.0, stale.latestCelsius(), 0.001,
                "latest reading is unbounded by range — a stale patient still shows their last known value");

        assertThrows(ResponseStatusException.class, () -> consentController.myPatientsSummary(24, activePatient),
                "only doctors can see the aggregated patient summary");
    }

    /**
     * Enumeration safety: a caller who may not revoke a consent link must not
     * be able to tell whether that id exists, so the lookup is owner-scoped in
     * the query and the answer is 404 — never 403 — matching how annotations
     * and care notes already behave.
     */
    @Test
    void revokingSomeoneElsesConsentIs404NotForbidden() {
        Authentication patient = authFor("rbac-revoke-patient-1", "rbac-revoke-patient1", "customer");
        Authentication stranger = authFor("rbac-revoke-stranger-1", "rbac-revoke-stranger1", "customer");
        Authentication doctor = authFor("rbac-revoke-doctor-1", "rbac-revoke-doctor1", "doctor");
        Authentication admin = authFor("rbac-revoke-admin-1", "rbac-revoke-admin1", "admin");

        UUID consentId = consentController.grant(new GrantConsentRequest("rbac-revoke-doctor-1"), patient)
                .getBody().id();

        ResponseStatusException byStranger = assertThrows(ResponseStatusException.class,
                () -> consentController.revoke(consentId, stranger));
        assertEquals(HttpStatus.NOT_FOUND, byStranger.getStatusCode(),
                "a 403 here would confirm the consent id exists to a caller who has no business knowing");

        ResponseStatusException byDoctor = assertThrows(ResponseStatusException.class,
                () -> consentController.revoke(consentId, doctor));
        assertEquals(HttpStatus.NOT_FOUND, byDoctor.getStatusCode(),
                "the doctor a link points at still cannot revoke it — consent is patient-initiated");

        ResponseStatusException missing = assertThrows(ResponseStatusException.class,
                () -> consentController.revoke(UUID.randomUUID(), patient));
        assertEquals(HttpStatus.NOT_FOUND, missing.getStatusCode(),
                "a nonexistent id is indistinguishable from someone else's");

        assertEquals(HttpStatus.NO_CONTENT, consentController.revoke(consentId, admin).getStatusCode(),
                "an admin may still revoke any link on a patient's behalf");
    }

    /**
     * The three paged audit feeds, end to end against real Postgres: rows
     * written by real grant/revoke calls, read back through the derived queries
     * the {@code V3__audit_log_indexes.sql} indexes exist for.
     *
     * <p>{@code ConsentPaginationMvcTest} pins their HTTP shape and role rules;
     * what only a real database can show is that each feed contains exactly the
     * rows it claims to — in particular that the customer feed is scoped to the
     * caller, and that the doctor feed picks up entries where the doctor is the
     * <i>subject</i> rather than the actor (which is why the dedicated
     * consent-activity feed is empty by design).
     */
    @Test
    void consentAndAuditFeedsContainExactlyTheCallersOwnEntries() {
        Authentication patient = authFor("rbac-feed-patient-1", "rbac-feed-patient1", "customer");
        Authentication otherPatient = authFor("rbac-feed-patient-2", "rbac-feed-patient2", "customer");
        Authentication doctor = authFor("rbac-feed-doctor-1", "rbac-feed-doctor1", "doctor");
        Pageable firstPage = PageRequest.of(0, 50);

        UUID consentId = consentController.grant(new GrantConsentRequest("rbac-feed-doctor-1"), patient)
                .getBody().id();
        consentController.revoke(consentId, patient);
        consentController.grant(new GrantConsentRequest("rbac-feed-doctor-1"), otherPatient);

        PageResponse<ConsentHistoryResponse> myHistory = consentController.myConsentHistory(firstPage, patient);
        assertEquals(2, myHistory.totalElements(), "one grant and one revoke, and nobody else's");
        assertEquals(List.of("consent.revoke", "consent.grant"),
                myHistory.content().stream().map(ConsentHistoryResponse::action).toList(),
                "newest first by default — these feeds are only ever read that way");
        assertTrue(myHistory.content().stream().allMatch(entry -> "rbac-feed-doctor-1".equals(entry.doctorUserId())),
                "the subject of a consent row is the doctor it concerns");

        assertEquals(0, consentController.doctorConsentActivity(firstPage, doctor).totalElements(),
                "empty by design: consent is patient-initiated, so a doctor is never the actor");

        PageResponse<AuditLogResponse> doctorFeed = consentController.myAuditLog(firstPage, doctor);
        assertEquals(3, doctorFeed.totalElements(),
                "actor OR subject: both patients' grants and the revoke all name this doctor");
        assertTrue(doctorFeed.content().stream().allMatch(entry -> "rbac-feed-doctor-1".equals(entry.subject())),
                "every entry here names the doctor as its subject");

        assertRejects(HttpStatus.FORBIDDEN, () -> consentController.myConsentHistory(firstPage, doctor),
                "a doctor has no consent history of their own to read");
        assertRejects(HttpStatus.FORBIDDEN, () -> consentController.myAuditLog(firstPage, patient),
                "the doctor audit feed is doctor-only");
        assertRejects(HttpStatus.FORBIDDEN, () -> consentController.doctorConsentActivity(firstPage, patient),
                "...as is the doctor consent-activity feed");
    }

    /**
     * The REST upload path is authenticated as a person (the browser
     * collector), so it must not let one customer write readings tagged with
     * another customer's device — injected data feeds episode detection and
     * the doctor dashboard's risk triage. Doctors and admins can't write at
     * all; an unclaimed device stays open, which is what lets a device be
     * discovered before anyone has claimed it.
     */
    @Test
    void onlyTheOwningCustomerCanUploadReadingsForAClaimedDevice() {
        String bdAddr = "AA:AA:AA:AA:AA:09";
        String unclaimedBdAddr = "AA:AA:AA:AA:AA:0A";
        devices.save(new Device(bdAddr, "unknown", null));

        Authentication owner = authFor("rbac-ingest-owner-1", "rbac-ingest-owner1", "customer");
        Authentication stranger = authFor("rbac-ingest-stranger-1", "rbac-ingest-stranger1", "customer");
        Authentication doctor = authFor("rbac-ingest-doctor-1", "rbac-ingest-doctor1", "doctor");
        Authentication admin = authFor("rbac-ingest-admin-1", "rbac-ingest-admin1", "admin");

        deviceController.claim(bdAddr, null, owner);
        consentController.grant(new GrantConsentRequest("rbac-ingest-doctor-1"), owner);

        assertEquals(HttpStatus.CREATED, ingest(bdAddr, Instant.now(), 37.1, owner).getStatusCode(),
                "the device's owner is the one caller who may upload for it");

        ResponseStatusException byStranger = assertThrows(ResponseStatusException.class,
                () -> ingest(bdAddr, Instant.now(), 41.0, stranger));
        assertEquals(HttpStatus.FORBIDDEN, byStranger.getStatusCode(),
                "another customer must not be able to fabricate readings for a device they don't own");

        // Consent grants a doctor *read* access; it must not become a write path.
        ResponseStatusException byDoctor = assertThrows(ResponseStatusException.class,
                () -> ingest(bdAddr, Instant.now(), 41.0, doctor));
        assertEquals(HttpStatus.FORBIDDEN, byDoctor.getStatusCode(), "a doctor never submits readings for a patient");

        ResponseStatusException byAdmin = assertThrows(ResponseStatusException.class,
                () -> ingest(bdAddr, Instant.now(), 41.0, admin));
        assertEquals(HttpStatus.FORBIDDEN, byAdmin.getStatusCode(), "admin is an operator role, not a data producer");

        assertEquals(HttpStatus.CREATED, ingest(unclaimedBdAddr, Instant.now(), 22.0, stranger).getStatusCode(),
                "an unowned device stays writable — auto-registration on first reading is how a device becomes claimable");

        // The same must hold for a bd_addr that already has a devices row with
        // no owner (claimed once and force-released by an admin, or registered
        // by an earlier reading), not only for one this system has never seen.
        // These are two different branches of ensureDeviceRegistered.
        String releasedBdAddr = "AA:AA:AA:AA:AA:10";
        devices.save(new Device(releasedBdAddr, "unknown", null));
        assertEquals(HttpStatus.CREATED, ingest(releasedBdAddr, Instant.now(), 22.5, stranger).getStatusCode(),
                "an existing but unclaimed devices row is as open as no row at all");

        // The role check runs before the ownership check, so an unclaimed
        // device is not a loophole for the roles that may never write at all.
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
                        () -> ingest(releasedBdAddr, Instant.now(), 41.0, doctor)).getStatusCode(),
                "'unclaimed' widens who may write, not which roles may");
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
                () -> ingest(releasedBdAddr, Instant.now(), 41.0, admin)).getStatusCode());

        // Bounds the residual risk DeviceAccessGuard.requireIngestAccess
        // documents and accepts: seeded readings for an unclaimed address are
        // unreadable by anyone but an admin, so they reach no doctor's
        // dashboard and no other customer's chart while they stay unclaimed.
        assertThrows(ResponseStatusException.class,
                () -> measurementController.history(releasedBdAddr, "temperature", null, null, 500, stranger),
                "not even the customer who wrote it can read it back — nobody owns an unclaimed device's history");
        assertThrows(ResponseStatusException.class,
                () -> measurementController.history(releasedBdAddr, "temperature", null, null, 500, owner),
                "and certainly not an unrelated customer");
        assertThrows(ResponseStatusException.class,
                () -> measurementController.history(releasedBdAddr, "temperature", null, null, 500, doctor),
                "nor can a doctor — an unclaimed device has no consenting patient behind it");
        assertFalse(measurementController.history(releasedBdAddr, "temperature", null, null, 500, admin).isEmpty(),
                "only an admin can see it, which is what makes the seeded data inert rather than injected");
    }

    /**
     * The friendly label is cosmetic data, but still owner-scoped: the lookup
     * is scoped in the query so a non-owner gets an indistinguishable 404
     * (same enumeration-safety rule as consent revocation), and only a
     * customer may hold one — doctors and admins have no devices of their own.
     */
    @Test
    void onlyTheOwningCustomerCanRenameADevice() {
        String bdAddr = "AA:AA:AA:AA:AA:0F";
        devices.save(new Device(bdAddr, "unknown", null));

        Authentication owner = authFor("rbac-rename-owner-1", "rbac-rename-owner1", "customer");
        Authentication stranger = authFor("rbac-rename-stranger-1", "rbac-rename-stranger1", "customer");
        Authentication doctor = authFor("rbac-rename-doctor-1", "rbac-rename-doctor1", "doctor");
        Authentication admin = authFor("rbac-rename-admin-1", "rbac-rename-admin1", "admin");

        deviceController.claim(bdAddr, null, owner);

        DeviceResponse named = deviceController.renameLabel(bdAddr, new RenameDeviceRequest("  Baby's thermometer  "), owner);
        assertEquals("Baby's thermometer", named.label(), "the label is stored trimmed");

        assertEquals("Baby's thermometer", deviceController.list(owner).stream()
                .filter(d -> d.bdAddr().equals(bdAddr)).findFirst().orElseThrow().label(),
                "the label comes back on the owner's device list");

        assertRejects(HttpStatus.NOT_FOUND, () -> deviceController.renameLabel(bdAddr, new RenameDeviceRequest("x"), stranger),
                "a non-owner gets an indistinguishable 404 — a 403 would confirm the address exists");
        assertRejects(HttpStatus.NOT_FOUND, () -> deviceController.renameLabel(bdAddr, new RenameDeviceRequest("x"), doctor),
                "a doctor never owns a device, so never its name");
        assertRejects(HttpStatus.NOT_FOUND, () -> deviceController.renameLabel(bdAddr, new RenameDeviceRequest("x"), admin),
                "an admin corrects through /api/admin/devices, not the owner route");

        DeviceResponse cleared = deviceController.renameLabel(bdAddr, new RenameDeviceRequest("   "), owner);
        assertNull(cleared.label(), "a blank label clears the name instead of storing whitespace");
    }

    // ---- thresholds -----------------------------------------------------

    /**
     * The three threshold scopes are three separate routes precisely so that
     * each carries one obvious authorization rule; this walks all three and
     * asserts no role can reach a scope that isn't theirs.
     *
     * <p>The system row it writes deliberately holds the same boundaries as
     * {@link AlertThresholdService#FALLBACK}. That row is global and single
     * (ux_alert_thresholds_system), so leaving different values behind would
     * silently change which tier the episode-detection tests below see.
     */
    @Test
    void eachThresholdScopeIsReadableAndWritableOnlyByTheRoleThatOwnsIt() {
        Authentication customer = authFor("rbac-thr-customer-1", "rbac-thr-customer1", "customer");
        authFor("rbac-thr-customer-2", "rbac-thr-customer2", "customer");
        Authentication doctor = authFor("rbac-thr-doctor-1", "rbac-thr-doctor1", "doctor");
        Authentication strangerDoctor = authFor("rbac-thr-doctor-2", "rbac-thr-doctor2", "doctor");
        Authentication admin = authFor("rbac-thr-admin-1", "rbac-thr-admin1", "admin");

        // ---- /mine: a customer's own scale
        assertEquals(HttpStatus.NO_CONTENT, thresholdController.mine(customer).getStatusCode(),
                "nothing stored yet — 204 is how the UI tells 'inheriting' apart from 'configured'");
        assertEquals("self", thresholdController.upsertMine(scale(35.5, 37.2, 38.0, 39.2), customer).source());
        assertEquals(HttpStatus.OK, thresholdController.mine(customer).getStatusCode());

        assertRejects(HttpStatus.FORBIDDEN, () -> thresholdController.mine(doctor),
                "a doctor has no personal scale — they set per-patient overrides instead");
        assertRejects(HttpStatus.FORBIDDEN, () -> thresholdController.mine(admin),
                "an admin has no personal scale either — they edit the system default");
        assertRejects(HttpStatus.FORBIDDEN, () -> thresholdController.upsertMine(scale(35.0, 37.0, 38.0, 39.0), doctor),
                "and cannot write one");
        assertRejects(HttpStatus.FORBIDDEN, () -> thresholdController.resolved("rbac-thr-customer-2", customer),
                "?subjectUserId= must not become a way to read another customer's scale");

        // ---- /patient/{id}: a doctor's override, gated on live consent
        assertRejects(HttpStatus.FORBIDDEN, () -> thresholdController.patientOverride("rbac-thr-customer-1", doctor),
                "no consent granted yet");
        assertRejects(HttpStatus.FORBIDDEN, () -> thresholdController.upsertPatientOverride("rbac-thr-customer-1",
                        scale(33.0, 35.0, 36.0, 37.0), doctor),
                "and writing is gated on the same consent as reading");

        consentController.grant(new GrantConsentRequest("rbac-thr-doctor-1"), customer);

        assertEquals(HttpStatus.NO_CONTENT,
                thresholdController.patientOverride("rbac-thr-customer-1", doctor).getStatusCode());
        assertEquals("doctor_override", thresholdController
                .upsertPatientOverride("rbac-thr-customer-1", scale(33.0, 35.0, 36.0, 37.0), doctor).source());
        assertEquals(HttpStatus.OK,
                thresholdController.patientOverride("rbac-thr-customer-1", doctor).getStatusCode());

        assertRejects(HttpStatus.FORBIDDEN,
                () -> thresholdController.patientOverride("rbac-thr-customer-1", strangerDoctor),
                "a doctor without consent cannot even see that an override exists");
        assertRejects(HttpStatus.FORBIDDEN,
                () -> thresholdController.patientOverride("rbac-thr-customer-1", customer),
                "the patient does not reach their own record through the doctor route");
        assertRejects(HttpStatus.FORBIDDEN,
                () -> thresholdController.patientOverride("rbac-thr-customer-1", admin),
                "nor does an admin — an override belongs to a specific doctor");

        // ---- /system: the admin's default
        assertRejects(HttpStatus.FORBIDDEN, () -> thresholdController.system(customer), "admin role required");
        assertRejects(HttpStatus.FORBIDDEN, () -> thresholdController.system(doctor), "admin role required");
        assertRejects(HttpStatus.FORBIDDEN,
                () -> thresholdController.upsertSystem(scale(30.0, 31.0, 32.0, 33.0), doctor),
                "one doctor must not be able to move the default every user inherits");

        assertEquals("system", thresholdController.upsertSystem(fallbackScale(), admin).source());
        assertEquals(HttpStatus.OK, thresholdController.system(admin).getStatusCode());

        // ---- clearing, back down the same three routes
        thresholdController.clearPatientOverride("rbac-thr-customer-1", doctor);
        assertEquals(HttpStatus.NO_CONTENT,
                thresholdController.patientOverride("rbac-thr-customer-1", doctor).getStatusCode());
        assertRejects(HttpStatus.FORBIDDEN, () -> thresholdController.clearMine(doctor), "still customer-only");
        thresholdController.clearMine(customer);
        assertEquals(HttpStatus.NO_CONTENT, thresholdController.mine(customer).getStatusCode());
    }

    /**
     * Precedence is asserted through the controller rather than
     * {@link AlertThresholdService} alone, because the layer that decides
     * <i>which doctor is looking</i> ({@code viewingDoctorId}) lives in the
     * controller — a service-level test cannot catch an endpoint that forgets
     * to pass it, which is exactly how a patient would start seeing another
     * doctor's scale.
     *
     * <p>Owns the single global system row for its duration: it starts by
     * removing it and restores that state at the end, so no other test in this
     * class depends on the order it runs in.
     */
    @Test
    void resolvedThresholdPrefersDoctorOverrideThenSelfThenSystemThenTheHardcodedFallback() {
        alertThresholds.findByScope(AlertThreshold.SCOPE_SYSTEM).ifPresent(alertThresholds::delete);

        Authentication patient = authFor("rbac-prec-patient-1", "rbac-prec-patient1", "customer");
        Authentication doctor = authFor("rbac-prec-doctor-1", "rbac-prec-doctor1", "doctor");
        Authentication otherDoctor = authFor("rbac-prec-doctor-2", "rbac-prec-doctor2", "doctor");
        Authentication admin = authFor("rbac-prec-admin-1", "rbac-prec-admin1", "admin");
        consentController.grant(new GrantConsentRequest("rbac-prec-doctor-1"), patient);
        consentController.grant(new GrantConsentRequest("rbac-prec-doctor-2"), patient);

        // 1. nothing configured anywhere
        ThresholdResponse fallback = thresholdController.resolved(null, patient);
        assertEquals("fallback", fallback.source());
        assertEquals(AlertThresholdService.FALLBACK.highFeverStartC(), fallback.highFeverStartC(), 0.001);

        // 2. the admin's system default beats the fallback
        thresholdController.upsertSystem(scale(35.0, 37.0, 38.0, 39.0), admin);
        assertEquals("system", thresholdController.resolved(null, patient).source());
        assertEquals(39.0, thresholdController.resolved(null, patient).highFeverStartC(), 0.001);

        // 3. the patient's own scale beats the system default
        thresholdController.upsertMine(scale(34.0, 36.0, 37.0, 38.0), patient);
        assertEquals("self", thresholdController.resolved(null, patient).source());
        assertEquals(38.0, thresholdController.resolved(null, patient).highFeverStartC(), 0.001);

        // 4. a doctor's override beats that — but only in that doctor's view
        thresholdController.upsertPatientOverride("rbac-prec-patient-1", scale(33.0, 35.0, 36.0, 37.0), doctor);
        ThresholdResponse asOverridingDoctor = thresholdController.resolved("rbac-prec-patient-1", doctor);
        assertEquals("doctor_override", asOverridingDoctor.source());
        assertEquals(37.0, asOverridingDoctor.highFeverStartC(), 0.001);

        assertEquals("self", thresholdController.resolved("rbac-prec-patient-1", otherDoctor).source(),
                "an override belongs to the doctor who set it, not to the patient's record");
        assertEquals("self", thresholdController.resolved(null, patient).source(),
                "and the patient keeps seeing their own scale, not one imposed on them");
        assertEquals("self", thresholdController.resolved("rbac-prec-patient-1", admin).source(),
                "an admin sees the patient's effective scale, not any one doctor's view of it");

        // 5. peel the layers back off in reverse and watch it fall through
        thresholdController.clearPatientOverride("rbac-prec-patient-1", doctor);
        assertEquals("self", thresholdController.resolved("rbac-prec-patient-1", doctor).source());
        thresholdController.clearMine(patient);
        assertEquals("system", thresholdController.resolved(null, patient).source());

        alertThresholds.findByScope(AlertThreshold.SCOPE_SYSTEM).ifPresent(alertThresholds::delete);
        assertEquals("fallback", thresholdController.resolved(null, patient).source());
    }

    // ---- events ---------------------------------------------------------

    /**
     * Episodes are derived from the readings themselves, so they are exactly
     * as sensitive: {@code /api/events/device/{bdAddr}} must not become a side
     * channel around the measurement-history rule.
     */
    @Test
    void deviceEventFeedEnforcesTheSameOwnershipAndConsentRuleAsMeasurementHistory() {
        String bdAddr = "AA:AA:AA:AA:AA:0B";
        devices.save(new Device(bdAddr, "unknown", null));

        Authentication owner = authFor("rbac-evt-owner-1", "rbac-evt-owner1", "customer");
        Authentication stranger = authFor("rbac-evt-stranger-1", "rbac-evt-stranger1", "customer");
        Authentication doctor = authFor("rbac-evt-doctor-1", "rbac-evt-doctor1", "doctor");
        Authentication admin = authFor("rbac-evt-admin-1", "rbac-evt-admin1", "admin");

        deviceController.claim(bdAddr, null, owner);

        Instant now = Instant.now();
        ingest(bdAddr, now.minusSeconds(240), 36.5, owner);
        ingest(bdAddr, now.minusSeconds(180), 38.5, owner);
        ingest(bdAddr, now.minusSeconds(120), 39.9, owner);
        ingest(bdAddr, now.minusSeconds(60), 36.4, owner);
        Instant from = now.minusSeconds(600);
        Instant to = now.plusSeconds(60);

        List<TemperatureEvent> ownersView = eventController.deviceEvents(bdAddr, from, to, owner);
        assertEquals(1, ownersView.size(), "the two consecutive above-elevated readings are one episode");
        assertEquals("highFever", ownersView.get(0).tier());
        assertEquals(39.9, ownersView.get(0).peakCelsius(), 0.001);
        assertEquals(2, ownersView.get(0).readingCount());

        assertRejects(HttpStatus.FORBIDDEN, () -> eventController.deviceEvents(bdAddr, from, to, stranger),
                "an unrelated customer must never see another customer's device history");
        assertRejects(HttpStatus.FORBIDDEN, () -> eventController.deviceEvents(bdAddr, from, to, doctor),
                "no consent granted yet — a doctor gets no more here than on the readings themselves");

        consentController.grant(new GrantConsentRequest("rbac-evt-doctor-1"), owner);

        assertEquals(1, eventController.deviceEvents(bdAddr, from, to, doctor).size(),
                "consent opens the derived feed exactly as it opens the raw one");
        assertEquals(1, eventController.deviceEvents(bdAddr, from, to, admin).size());
        assertRejects(HttpStatus.FORBIDDEN, () -> eventController.deviceEvents(bdAddr, from, to, stranger),
                "consent to one doctor must not leak access to unrelated customers");

        assertRejects(HttpStatus.BAD_REQUEST, () -> eventController.deviceEvents(bdAddr, to, from, owner),
                "from must be before to");
        assertRejects(HttpStatus.BAD_REQUEST, () -> eventController.deviceEvents(bdAddr, Instant.EPOCH, to, owner),
                "an unbounded window would pull the whole hypertable into memory to answer one request");
    }

    @Test
    void doctorFleetEventFeedCoversExactlyTheConsentingPatients() {
        String consentingBdAddr = "AA:AA:AA:AA:AA:0C";
        String unrelatedBdAddr = "AA:AA:AA:AA:AA:0D";
        devices.save(new Device(consentingBdAddr, "unknown", null));
        devices.save(new Device(unrelatedBdAddr, "unknown", null));

        Authentication consentingPatient = authFor("rbac-fleet-patient-1", "rbac-fleet-patient1", "customer");
        Authentication unrelatedPatient = authFor("rbac-fleet-patient-2", "rbac-fleet-patient2", "customer");
        Authentication doctor = authFor("rbac-fleet-doctor-1", "rbac-fleet-doctor1", "doctor");
        Authentication admin = authFor("rbac-fleet-admin-1", "rbac-fleet-admin1", "admin");

        deviceController.claim(consentingBdAddr, null, consentingPatient);
        deviceController.claim(unrelatedBdAddr, null, unrelatedPatient);

        Instant now = Instant.now();
        ingest(consentingBdAddr, now.minusSeconds(180), 39.4, consentingPatient);
        ingest(consentingBdAddr, now.minusSeconds(120), 39.9, consentingPatient);
        ingest(unrelatedBdAddr, now.minusSeconds(120), 39.9, unrelatedPatient);
        Instant from = now.minusSeconds(600);
        Instant to = now.plusSeconds(60);

        assertTrue(eventController.patientEvents(from, to, doctor).isEmpty(),
                "a doctor with no consents has no fleet");

        UUID consentId = consentController.grant(new GrantConsentRequest("rbac-fleet-doctor-1"), consentingPatient)
                .getBody().id();

        List<PatientEventsResponse> fleet = eventController.patientEvents(from, to, doctor);
        assertEquals(1, fleet.size());
        assertEquals("rbac-fleet-patient-1", fleet.get(0).patientUserId());
        assertEquals(consentingBdAddr, fleet.get(0).deviceBdAddr());
        assertFalse(fleet.get(0).events().isEmpty());
        assertFalse(fleet.stream().anyMatch(row -> unrelatedBdAddr.equals(row.deviceBdAddr())),
                "a patient who never consented must not surface in any doctor's fleet feed");

        assertRejects(HttpStatus.FORBIDDEN, () -> eventController.patientEvents(from, to, consentingPatient),
                "only doctors have patients");
        assertRejects(HttpStatus.FORBIDDEN, () -> eventController.patientEvents(from, to, admin),
                "an admin is an operator, not a clinician with a caseload");

        consentController.revoke(consentId, consentingPatient);
        assertTrue(eventController.patientEvents(from, to, doctor).isEmpty(),
                "revoking consent removes the patient from the feed immediately, not at the next window");
    }

    // ---- annotations ----------------------------------------------------

    /**
     * Annotations carry two different rules on purpose: reading them follows
     * {@link com.dialog.thermometer.security.DeviceAccessGuard} (so a
     * consenting doctor sees their patient's context), while authoring, editing
     * and deleting are the owning customer's alone — a doctor must never write
     * in the patient's voice, and care notes are their own surface.
     */
    @Test
    void annotationsAreReadableWithDeviceAccessButWritableOnlyByTheirAuthor() {
        String bdAddr = "AA:AA:AA:AA:AA:0E";
        devices.save(new Device(bdAddr, "unknown", null));

        Authentication author = authFor("rbac-ann-author-1", "rbac-ann-author1", "customer");
        Authentication stranger = authFor("rbac-ann-stranger-1", "rbac-ann-stranger1", "customer");
        Authentication doctor = authFor("rbac-ann-doctor-1", "rbac-ann-doctor1", "doctor");
        Authentication admin = authFor("rbac-ann-admin-1", "rbac-ann-admin1", "admin");

        deviceController.claim(bdAddr, null, author);
        consentController.grant(new GrantConsentRequest("rbac-ann-doctor-1"), author);

        Instant ts = Instant.now().minusSeconds(120);
        AnnotationResponse note = annotationController
                .create(new CreateAnnotationRequest(bdAddr, ts, null, "took ibuprofen"), author).getBody();
        assertNotNull(note);

        assertEquals(1, annotationController.list(bdAddr, null, null, 50, author).size());
        assertEquals(1, annotationController.list(bdAddr, null, null, 50, doctor).size(),
                "a consenting doctor reads the patient's context alongside their readings");
        assertEquals(1, annotationController.list(bdAddr, null, null, 50, admin).size());
        assertRejects(HttpStatus.FORBIDDEN, () -> annotationController.list(bdAddr, null, null, 50, stranger),
                "read access is device access, and a stranger has none");

        assertRejects(HttpStatus.FORBIDDEN,
                () -> annotationController.create(new CreateAnnotationRequest(bdAddr, ts, null, "x"), doctor),
                "reading a patient's notes is not authoring notes in their voice");
        assertRejects(HttpStatus.FORBIDDEN,
                () -> annotationController.create(new CreateAnnotationRequest(bdAddr, ts, null, "x"), stranger),
                "you do not own this device");
        assertRejects(HttpStatus.FORBIDDEN,
                () -> annotationController.create(new CreateAnnotationRequest(bdAddr, ts, null, "x"), admin),
                "admin is an operator role, not a data author");

        // Edits/deletes are author-scoped inside the query (findByIdAndUserId),
        // so everyone else gets 404 — a 403 would confirm the note exists.
        UpdateAnnotationRequest edit = new UpdateAnnotationRequest("took paracetamol", null);
        assertRejects(HttpStatus.NOT_FOUND, () -> annotationController.update(note.id(), edit, stranger),
                "a 403 here would confirm the annotation id exists to a caller with no business knowing");
        assertRejects(HttpStatus.NOT_FOUND, () -> annotationController.update(note.id(), edit, doctor),
                "read access through consent is not edit access");
        assertRejects(HttpStatus.NOT_FOUND, () -> annotationController.update(note.id(), edit, admin),
                "not even an admin rewrites someone's note — it would stop being theirs");
        assertRejects(HttpStatus.NOT_FOUND, () -> annotationController.delete(note.id(), stranger),
                "same rule for deletes");
        assertRejects(HttpStatus.NOT_FOUND, () -> annotationController.update(UUID.randomUUID(), edit, author),
                "a nonexistent id is indistinguishable from someone else's");

        assertEquals("took paracetamol", annotationController.update(note.id(), edit, author).note());
        assertEquals(HttpStatus.NO_CONTENT, annotationController.delete(note.id(), author).getStatusCode());
        assertEquals(0, annotationController.list(bdAddr, null, null, 50, author).size());
    }

    // ---- care notes -----------------------------------------------------

    /**
     * Care notes are doctor-private (V1__init.sql). Both doctors here
     * hold active consent to the same patient, which is the point: consent is
     * not what gates a care note — authorship is.
     */
    @Test
    void careNotesAreVisibleAndEditableOnlyByTheDoctorWhoWroteThem() {
        Authentication patient = authFor("rbac-care-patient-1", "rbac-care-patient1", "customer");
        Authentication authorDoctor = authFor("rbac-care-doctor-1", "rbac-care-doctor1", "doctor");
        Authentication secondDoctor = authFor("rbac-care-doctor-2", "rbac-care-doctor2", "doctor");
        Authentication unconsentedDoctor = authFor("rbac-care-doctor-3", "rbac-care-doctor3", "doctor");
        Authentication admin = authFor("rbac-care-admin-1", "rbac-care-admin1", "admin");

        UUID authorConsentId = consentController.grant(new GrantConsentRequest("rbac-care-doctor-1"), patient)
                .getBody().id();
        consentController.grant(new GrantConsentRequest("rbac-care-doctor-2"), patient);

        assertRejects(HttpStatus.FORBIDDEN, () -> careNoteController
                        .create(new CreateCareNoteRequest("rbac-care-patient-1", "x"), unconsentedDoctor),
                "writing a note about someone who never consented to your care");

        CareNoteResponse note = careNoteController
                .create(new CreateCareNoteRequest("rbac-care-patient-1", "reviewed overnight trend"), authorDoctor)
                .getBody();
        assertNotNull(note);

        assertEquals(1, careNoteController.list("rbac-care-patient-1", authorDoctor).size());
        assertEquals(0, careNoteController.list("rbac-care-patient-1", secondDoctor).size(),
                "a second doctor with equally valid consent still sees none of the first doctor's notes");
        assertRejects(HttpStatus.NOT_FOUND,
                () -> careNoteController.update(note.id(), new UpdateCareNoteRequest("edited"), secondDoctor),
                "404 rather than 403 — a 403 would confirm another doctor's note exists");
        assertRejects(HttpStatus.NOT_FOUND, () -> careNoteController.delete(note.id(), secondDoctor),
                "same rule for deletes");

        assertRejects(HttpStatus.FORBIDDEN, () -> careNoteController.list("rbac-care-patient-1", patient),
                "there is no patient read path at all — consent only ever flows patient to doctor");
        assertRejects(HttpStatus.FORBIDDEN,
                () -> careNoteController.create(new CreateCareNoteRequest("rbac-care-patient-1", "x"), patient),
                "and no patient write path either");
        assertRejects(HttpStatus.FORBIDDEN, () -> careNoteController.list("rbac-care-patient-1", admin),
                "not even an admin reads them here — /api/admin/care-notes is the one audited exception");

        assertEquals("edited", careNoteController.update(note.id(), new UpdateCareNoteRequest("edited"), authorDoctor)
                .note(), "the author can still edit their own");

        // Revoking consent closes the write path but not the read path: the
        // notes already authored remain a clinical record.
        consentController.revoke(authorConsentId, patient);
        assertRejects(HttpStatus.FORBIDDEN, () -> careNoteController
                        .create(new CreateCareNoteRequest("rbac-care-patient-1", "after revocation"), authorDoctor),
                "no active consent — the doctor may no longer add to the record");
        assertEquals(1, careNoteController.list("rbac-care-patient-1", authorDoctor).size(),
                "but what they already wrote stays theirs to read — deleting it would destroy a clinical record");
    }

    @Test
    void onlyAnAdminReachesTheReadOnlyCareNoteComplianceView() {
        Authentication patient = authFor("rbac-comp-patient-1", "rbac-comp-patient1", "customer");
        Authentication doctorA = authFor("rbac-comp-doctor-1", "rbac-comp-doctor1", "doctor");
        Authentication doctorB = authFor("rbac-comp-doctor-2", "rbac-comp-doctor2", "doctor");
        Authentication admin = authFor("rbac-comp-admin-1", "rbac-comp-admin1", "admin");

        consentController.grant(new GrantConsentRequest("rbac-comp-doctor-1"), patient);
        consentController.grant(new GrantConsentRequest("rbac-comp-doctor-2"), patient);
        careNoteController.create(new CreateCareNoteRequest("rbac-comp-patient-1", "note from A"), doctorA);
        careNoteController.create(new CreateCareNoteRequest("rbac-comp-patient-1", "note from B"), doctorB);

        List<CareNoteResponse> everyNote = adminController.careNotes("rbac-comp-patient-1", null, admin);
        assertEquals(2, everyNote.size(),
                "the compliance view is the only place both doctors' notes are visible together");

        List<CareNoteResponse> onlyA = adminController.careNotes("rbac-comp-patient-1", "rbac-comp-doctor-1", admin);
        assertEquals(1, onlyA.size());
        assertEquals("note from A", onlyA.get(0).note());

        assertRejects(HttpStatus.FORBIDDEN, () -> adminController.careNotes("rbac-comp-patient-1", null, doctorA),
                "a doctor cannot read their colleague's notes by going through the admin route");
        assertRejects(HttpStatus.FORBIDDEN, () -> adminController.careNotes("rbac-comp-patient-1", null, patient),
                "nor can the patient the notes are about");
    }

    // ---- admin surfaces --------------------------------------------------

    /**
     * Each analytics panel answers for an admin — which also executes its raw
     * SQL against the real schema, the only check those queries get — and is
     * refused for every other role.
     */
    @Test
    void everyAdminAnalyticsPanelIsAdminOnly() {
        Authentication admin = authFor("rbac-an-admin-1", "rbac-an-admin1", "admin");
        Authentication customer = authFor("rbac-an-customer-1", "rbac-an-customer1", "customer");
        Authentication doctor = authFor("rbac-an-doctor-1", "rbac-an-doctor1", "doctor");

        assertNotNull(adminAnalyticsController.ingest(admin));
        assertNotNull(adminAnalyticsController.deviceInventory(admin));
        assertNotNull(adminAnalyticsController.userGrowth(admin));
        assertNotNull(adminAnalyticsController.consentIntegrity(50, admin));
        assertNotNull(adminAnalyticsController.retention(admin));
        assertNotNull(adminAnalyticsController.securityOps(50, admin));

        for (Authentication caller : List.of(customer, doctor)) {
            assertRejects(HttpStatus.FORBIDDEN, () -> adminAnalyticsController.ingest(caller), "ingest panel");
            assertRejects(HttpStatus.FORBIDDEN, () -> adminAnalyticsController.deviceInventory(caller),
                    "device-inventory panel");
            assertRejects(HttpStatus.FORBIDDEN, () -> adminAnalyticsController.userGrowth(caller),
                    "user-growth panel");
            assertRejects(HttpStatus.FORBIDDEN, () -> adminAnalyticsController.consentIntegrity(50, caller),
                    "consent-integrity panel exposes every doctor-patient relationship in the system");
            assertRejects(HttpStatus.FORBIDDEN, () -> adminAnalyticsController.retention(caller),
                    "retention panel");
            assertRejects(HttpStatus.FORBIDDEN, () -> adminAnalyticsController.securityOps(50, caller),
                    "security-ops panel names who is being denied access to what");
        }
    }

    @Test
    void adminRoleChangeIsAdminOnlyAndRefusesSelfDemotion() {
        Authentication admin = authFor("rbac-role-admin-1", "rbac-role-admin1", "admin");
        Authentication doctor = authFor("rbac-role-doctor-1", "rbac-role-doctor1", "doctor");
        Authentication customer = authFor("rbac-role-customer-1", "rbac-role-customer1", "customer");
        authFor("rbac-role-subject-1", "rbac-role-subject1", "customer");

        assertRejects(HttpStatus.FORBIDDEN, () -> adminController
                        .updateUserRole("rbac-role-subject-1", new UpdateUserRoleRequest("doctor"), customer),
                "a customer promoting anyone would be the whole role model bypassed in one call");
        assertRejects(HttpStatus.FORBIDDEN, () -> adminController
                        .updateUserRole("rbac-role-subject-1", new UpdateUserRoleRequest("doctor"), doctor),
                "and a doctor promoting their own patients is a privilege-escalation path");

        assertRejects(HttpStatus.BAD_REQUEST, () -> adminController
                        .updateUserRole("rbac-role-admin-1", new UpdateUserRoleRequest("customer"), admin),
                "an admin demoting themselves would immediately lose the only role that can undo it");
        assertRejects(HttpStatus.BAD_REQUEST, () -> adminController
                        .updateUserRole("rbac-role-admin-1", new UpdateUserRoleRequest("admin"), admin),
                "the self-lockout guard is on the target, not on whether the value actually changes");

        assertRejects(HttpStatus.BAD_REQUEST, () -> adminController
                        .updateUserRole("rbac-role-subject-1", new UpdateUserRoleRequest("wizard"), admin),
                "unknown role");
        assertRejects(HttpStatus.NOT_FOUND, () -> adminController
                        .updateUserRole("rbac-role-nobody", new UpdateUserRoleRequest("doctor"), admin),
                "no such user");

        assertEquals("doctor", adminController
                        .updateUserRole("rbac-role-subject-1", new UpdateUserRoleRequest("DOCTOR"), admin).role(),
                "the request spelling is case-insensitive; what gets stored is the database's lowercase one");
    }

    // ---- rollouts --------------------------------------------------------

    /**
     * Rollout <i>management</i> is admin-only; the two <i>collector</i>
     * endpoints are the opposite — they take no {@code Authentication}
     * parameter at all and accept exactly one credential, the fleet-wide
     * {@code X-Device-Token}.
     *
     * <p>The last block is the regression guard for the vulnerability that was
     * fixed here: before the token check existed, being authenticated at all
     * was enough. A fully-privileged admin sitting in the SecurityContext must
     * buy nothing on these two routes.
     */
    @Test
    void rolloutManagementIsAdminOnlyWhileCollectorEndpointsTakeOnlyTheDeviceToken() {
        Authentication admin = authFor("rbac-roll-admin-1", "rbac-roll-admin1", "admin");
        Authentication customer = authFor("rbac-roll-customer-1", "rbac-roll-customer1", "customer");
        Authentication doctor = authFor("rbac-roll-doctor-1", "rbac-roll-doctor1", "doctor");

        // A chip model unique to this test, so findPending cannot match a
        // rollout some other test left behind.
        CreateRolloutRequest create = new CreateRolloutRequest("9.9.9", "RBAC-IT-CHIP",
                "http://example.test/fw.img", null, "sha256", "signature", 100, 50);

        assertRejects(HttpStatus.FORBIDDEN, () -> rolloutController.create(create, customer),
                "a customer must not be able to push firmware to anyone's device");
        assertRejects(HttpStatus.FORBIDDEN, () -> rolloutController.create(create, doctor), "nor a doctor");

        UUID rolloutId = rolloutController.create(create, admin).getBody().id();
        assertRejects(HttpStatus.FORBIDDEN, () -> rolloutController.list(PageRequest.of(0, 20), customer),
                "the rollout list names every firmware image and its target group");
        assertRejects(HttpStatus.FORBIDDEN, () -> rolloutController.detail(rolloutId, doctor), "and its per-device detail");
        assertTrue(rolloutController.list(PageRequest.of(0, 20), admin).totalElements() >= 1);
        assertNotNull(rolloutController.detail(rolloutId, admin));

        String bdAddr = "AA:AA:AA:AA:AA:0F";
        assertRejects(HttpStatus.UNAUTHORIZED, () -> rolloutController.pending("RBAC-IT-CHIP", "1.0.0", bdAddr, null),
                "a missing X-Device-Token");
        assertRejects(HttpStatus.UNAUTHORIZED,
                () -> rolloutController.pending("RBAC-IT-CHIP", "1.0.0", bdAddr, collectorToken + "x"),
                "a wrong one is rejected identically — no distinguishing message");
        assertRejects(HttpStatus.UNAUTHORIZED, () -> rolloutController.pending("RBAC-IT-CHIP", "1.0.0", bdAddr, ""),
                "and so is a blank one");

        ResponseEntity<RolloutResponse> offered = rolloutController
                .pending("RBAC-IT-CHIP", "1.0.0", bdAddr, collectorToken);
        assertEquals(HttpStatus.OK, offered.getStatusCode(),
                "the correct token is sufficient on its own — collectors carry no user identity");
        assertEquals(rolloutId, offered.getBody().id());

        RolloutStatusRequest report = new RolloutStatusRequest(bdAddr, "success", null);
        assertRejects(HttpStatus.UNAUTHORIZED, () -> rolloutController.reportStatus(rolloutId, report, null),
                "status reports are guarded by the same one credential");
        assertRejects(HttpStatus.UNAUTHORIZED,
                () -> rolloutController.reportStatus(rolloutId, report, collectorToken + "x"), "wrong token");
        assertEquals(HttpStatus.NO_CONTENT,
                rolloutController.reportStatus(rolloutId, report, collectorToken).getStatusCode());
        assertEquals(HttpStatus.NO_CONTENT,
                rolloutController.pending("RBAC-IT-CHIP", "1.0.0", bdAddr, collectorToken).getStatusCode(),
                "already reported — nothing further to offer this device");

        SecurityContextHolder.getContext().setAuthentication(admin);
        try {
            assertRejects(HttpStatus.UNAUTHORIZED,
                    () -> rolloutController.pending("RBAC-IT-CHIP", "1.0.0", bdAddr, null),
                    "an admin JWT is not a collector credential — these routes read only X-Device-Token");
            assertRejects(HttpStatus.UNAUTHORIZED, () -> rolloutController.reportStatus(rolloutId, report, null),
                    "and no user role substitutes for it on the status route either");
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    // ---- helpers ---------------------------------------------------------

    private ResponseEntity<Void> ingest(String bdAddr, Instant ts, double celsius, Authentication as) {
        return measurementController.ingest(new MeasurementEnvelope(
                1, bdAddr, "rbac-it", ts, "temperature", Map.of("celsius", celsius), Map.of()), as);
    }

    private static UpsertThresholdRequest scale(double normalStart, double elevatedStart, double feverStart,
                                                 double highFeverStart) {
        return new UpsertThresholdRequest(normalStart, elevatedStart, feverStart, highFeverStart);
    }

    /** The stored scale that leaves resolution behaving exactly as if no row existed. */
    private static UpsertThresholdRequest fallbackScale() {
        return scale(AlertThresholdService.FALLBACK.normalStartC(), AlertThresholdService.FALLBACK.elevatedStartC(),
                AlertThresholdService.FALLBACK.feverStartC(), AlertThresholdService.FALLBACK.highFeverStartC());
    }

    /**
     * Asserts a call is refused with exactly {@code expected}. The same
     * assertion the older tests above spell out inline, factored out because
     * the authorization matrix makes it several dozen times — and because the
     * <i>exact</i> status is the point (404-not-403 for enumeration safety,
     * 401-not-403 for the collector token), so a bare "it threw" would miss
     * the regressions these guard against.
     */
    private static void assertRejects(HttpStatus expected, Executable call, String why) {
        ResponseStatusException rejection = assertThrows(ResponseStatusException.class, call, why);
        assertEquals(expected, rejection.getStatusCode(), why);
    }
}
