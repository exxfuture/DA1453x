package com.dialog.thermometer.api;

import com.dialog.thermometer.domain.AuditLog;
import com.dialog.thermometer.domain.AuditLogRepository;
import com.dialog.thermometer.domain.TemperatureUnit;
import com.dialog.thermometer.domain.UserRepository;
import com.dialog.thermometer.security.CurrentUser;
import com.dialog.thermometer.security.CurrentUserService;
import com.dialog.thermometer.security.Role;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableHandlerMethodArgumentResolver;
import org.springframework.security.core.Authentication;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The three paged audit feeds — {@code GET /api/consents/access-history},
 * {@code GET /api/doctor/consent-activity} and {@code GET /api/doctor/audit-log}
 * — which had no test of any kind: none of them appeared in {@code RbacIT}, so
 * neither their role rules nor their {@code PageResponse} shape was pinned
 * anywhere.
 *
 * <p>An MVC-level test rather than an integration test because what is
 * interesting here is HTTP-shaped: the role refusal, the JSON envelope the
 * frontend's pagination component reads, and the newest-first default ordering,
 * which lives in a private controller helper and is invisible from the
 * repository layer. None of that needs a database.
 *
 * <p>Built with {@code standaloneSetup} instead of {@code @WebMvcTest} on
 * purpose: that slice would need Mockito mocks of concrete service classes, and
 * Mockito's inline mock maker cannot instrument those on the JDK this project
 * builds with (it fails the whole application context, not just one mock).
 * Hand-written doubles keep the test honest and fast, and the dispatcher, the
 * argument resolvers and the exception → status mapping are all still real.
 */
class ConsentPaginationMvcTest {

    private static final CurrentUser CUSTOMER =
            new CurrentUser("c1", "customer1", "c1@example.test", Role.CUSTOMER, null, TemperatureUnit.CELSIUS);
    private static final CurrentUser DOCTOR =
            new CurrentUser("d1", "doctor1", "d1@example.test", Role.DOCTOR, null, TemperatureUnit.CELSIUS);

    private final AuditLogRepository auditLogs = Mockito.mock(AuditLogRepository.class);

    /**
     * Only reached to resolve the doctor usernames the consent-history rows point
     * at; no local row exists for them here, which is a case the endpoint has to
     * survive anyway (a doctor who was never provisioned locally).
     */
    private final UserRepository users = Mockito.mock(UserRepository.class);

    private MockMvc mockMvcFor(CurrentUser caller) {
        ConsentController controller = new ConsentController(users, null, null, auditLogs,
                new FixedCurrentUserService(caller), null, null);
        return MockMvcBuilders.standaloneSetup(controller)
                // Same resolver Boot registers, so `page`/`size`/`sort` behave as in production.
                .setCustomArgumentResolvers(new PageableHandlerMethodArgumentResolver())
                .build();
    }

    private MockMvc mockMvcForNoLocalUsers(CurrentUser caller) {
        Mockito.when(users.findAllById(Mockito.anyIterable())).thenReturn(List.of());
        return mockMvcFor(caller);
    }

    private static Page<AuditLog> onePageOf(AuditLog... entries) {
        return new PageImpl<>(List.of(entries), PageRequest.of(0, 20), entries.length);
    }

    @Test
    void customerSeesTheirOwnConsentHistoryAsAPageEnvelope() throws Exception {
        givenOwnConsentActions(onePageOf(new AuditLog("c1", "consent.grant", "d1", null)));

        mockMvcForNoLocalUsers(CUSTOMER).perform(get("/api/consents/access-history"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].action").value("consent.grant"))
                .andExpect(jsonPath("$.content[0].doctorUserId").value("d1"))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.totalPages").value(1));

        assertEquals(List.of("consent.grant", "consent.revoke"), capturedActions(),
                "a consent history must be exactly the consent actions — not the whole audit log");
    }

    /** Audit feeds are only ever read newest-first; a client may override, but the default is not "unsorted". */
    @Test
    void consentHistoryDefaultsToNewestFirst() throws Exception {
        givenOwnConsentActions(onePageOf());

        mockMvcFor(CUSTOMER).perform(get("/api/consents/access-history")).andExpect(status().isOk());

        assertEquals(Sort.by(Sort.Direction.DESC, "at"), capturedPageableOfOwnActions().getSort());
    }

    @Test
    void anExplicitSortWinsOverTheDefault() throws Exception {
        givenActorOrSubject(onePageOf());

        mockMvcFor(DOCTOR).perform(get("/api/doctor/audit-log").param("sort", "at,asc"))
                .andExpect(status().isOk());

        assertEquals(Sort.by(Sort.Direction.ASC, "at"), capturedPageableOfActorOrSubject().getSort());
    }

    @Test
    void pageAndSizeParametersReachTheRepository() throws Exception {
        givenActorOrSubject(onePageOf());

        mockMvcFor(DOCTOR).perform(get("/api/doctor/audit-log").param("page", "2").param("size", "5"))
                .andExpect(status().isOk());

        Pageable pageable = capturedPageableOfActorOrSubject();
        assertEquals(2, pageable.getPageNumber());
        assertEquals(5, pageable.getPageSize());
    }

    @Test
    void consentHistoryIsCustomerOnly() throws Exception {
        mockMvcFor(DOCTOR).perform(get("/api/consents/access-history")).andExpect(status().isForbidden());
    }

    @Test
    void doctorConsentActivityIsDoctorOnlyAndEmptyByDesign() throws Exception {
        givenOwnConsentActions(onePageOf());

        mockMvcFor(DOCTOR).perform(get("/api/doctor/consent-activity"))
                .andExpect(status().isOk())
                // Empty by design: consent rows record the *customer* as actor.
                .andExpect(jsonPath("$.content.length()").value(0));

        mockMvcFor(CUSTOMER).perform(get("/api/doctor/consent-activity")).andExpect(status().isForbidden());
    }

    @Test
    void doctorAuditLogCoversActorAndSubjectAndIsDoctorOnly() throws Exception {
        givenActorOrSubject(onePageOf(
                new AuditLog("c1", "consent.grant", "d1", null),
                new AuditLog("d1", "threshold.doctor_override.set", "c1", null)));

        mockMvcFor(DOCTOR).perform(get("/api/doctor/audit-log"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(2))
                // Both directions: an entry the doctor caused, and one naming them.
                .andExpect(jsonPath("$.content[0].actorId").value("c1"))
                .andExpect(jsonPath("$.content[0].subject").value("d1"))
                .andExpect(jsonPath("$.content[1].action").value("threshold.doctor_override.set"));

        mockMvcFor(CUSTOMER).perform(get("/api/doctor/audit-log")).andExpect(status().isForbidden());
    }

    // ---- stubbing / capture helpers --------------------------------------

    private void givenOwnConsentActions(Page<AuditLog> page) {
        Mockito.when(auditLogs.findByActorIdAndActionInOrderByAtDesc(Mockito.anyString(), Mockito.anyList(),
                Mockito.any())).thenReturn(page);
    }

    private void givenActorOrSubject(Page<AuditLog> page) {
        Mockito.when(auditLogs.findByActorIdOrSubjectOrderByAtDesc(Mockito.anyString(), Mockito.anyString(),
                Mockito.any())).thenReturn(page);
    }

    @SuppressWarnings("unchecked")
    private List<String> capturedActions() {
        ArgumentCaptor<List<String>> actions = ArgumentCaptor.forClass(List.class);
        Mockito.verify(auditLogs).findByActorIdAndActionInOrderByAtDesc(Mockito.anyString(), actions.capture(),
                Mockito.any());
        return actions.getValue();
    }

    private Pageable capturedPageableOfOwnActions() {
        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        Mockito.verify(auditLogs).findByActorIdAndActionInOrderByAtDesc(Mockito.anyString(), Mockito.anyList(),
                pageable.capture());
        return pageable.getValue();
    }

    private Pageable capturedPageableOfActorOrSubject() {
        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        Mockito.verify(auditLogs).findByActorIdOrSubjectOrderByAtDesc(Mockito.anyString(), Mockito.anyString(),
                pageable.capture());
        return pageable.getValue();
    }

    /** Resolves one fixed caller; the real {@code resolveWithRole} does the role check. */
    private static final class FixedCurrentUserService extends CurrentUserService {

        private final CurrentUser caller;

        private FixedCurrentUserService(CurrentUser caller) {
            super(null);
            this.caller = caller;
        }

        @Override
        public CurrentUser resolve(Authentication authentication) {
            return caller;
        }
    }
}
