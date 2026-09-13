package com.dialog.thermometer.threshold;

import com.dialog.thermometer.domain.AlertThreshold;
import com.dialog.thermometer.domain.AlertThresholdRepository;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Resolves which temperature scale applies to a given person's readings.
 *
 * <p>Precedence is whole-row and most-specific first: a doctor's override for
 * this patient beats the patient's own setting, which beats the system
 * default, which falls back to the constants the frontend has always used.
 * Never a per-field merge — mixing boundaries from two sources could produce
 * a non-monotonic scale nobody configured.
 */
@Service
public class AlertThresholdService {

    /**
     * Last-resort scale, mirroring {@code fe/src/theme/temperature.ts}'s
     * TIERS array (low &lt; 36.0, normal &lt; 37.5, elevated &lt; 38.1,
     * fever &lt; 39.5, above that high fever). Those are oral-equivalent °C
     * engineering placeholders, not medical advice — see that file's header.
     * Kept in code so a database with no alert_thresholds rows still behaves
     * exactly like the app did before this table existed.
     */
    public static final ResolvedThresholds FALLBACK = new ResolvedThresholds(36.0, 37.5, 38.1, 39.5, "fallback");

    /**
     * An effective scale plus where it came from ("doctor_override", "self",
     * "system" or "fallback") — the source is shown in the UI so a patient
     * can tell a doctor-set scale from their own. Each boundary is named
     * after the tier it turns ON at (normalStartC, elevatedStartC,
     * feverStartC, highFeverStartC) — there is no field for "low", the
     * implicit floor tier below normalStartC.
     */
    public record ResolvedThresholds(double normalStartC, double elevatedStartC, double feverStartC,
                                      double highFeverStartC, String source) {
    }

    private final AlertThresholdRepository thresholds;

    public AlertThresholdService(AlertThresholdRepository thresholds) {
        this.thresholds = thresholds;
    }

    /**
     * @param subjectUserId        whose readings the scale applies to
     * @param viewingDoctorIdOrNull the doctor currently looking, if any — only
     *                              then can a doctor_override row win
     */
    public ResolvedThresholds resolve(String subjectUserId, String viewingDoctorIdOrNull) {
        if (viewingDoctorIdOrNull != null) {
            Optional<ResolvedThresholds> override = thresholds
                    .findByScopeAndSubjectUserIdAndSetByUserId(AlertThreshold.SCOPE_DOCTOR_OVERRIDE, subjectUserId,
                            viewingDoctorIdOrNull)
                    .map(AlertThresholdService::toResolved);
            if (override.isPresent()) {
                return override.get();
            }
        }
        return thresholds.findByScopeAndSubjectUserId(AlertThreshold.SCOPE_SELF, subjectUserId)
                .map(AlertThresholdService::toResolved)
                .or(() -> thresholds.findByScope(AlertThreshold.SCOPE_SYSTEM).map(AlertThresholdService::toResolved))
                .orElse(FALLBACK);
    }

    /**
     * Same precedence for many subjects at once in exactly three queries —
     * one per scope — regardless of how many subjects are asked for. The
     * doctor fleet views call this per page render, so a per-subject
     * {@link #resolve} loop would be an N+1 by construction.
     */
    public Map<String, ResolvedThresholds> resolveBatch(List<String> subjectUserIds, String viewingDoctorIdOrNull) {
        if (subjectUserIds == null || subjectUserIds.isEmpty()) {
            return Map.of();
        }
        List<String> subjects = subjectUserIds.stream().filter(java.util.Objects::nonNull).distinct().toList();
        if (subjects.isEmpty()) {
            return Map.of();
        }

        Map<String, ResolvedThresholds> overridesBySubject = viewingDoctorIdOrNull == null
                ? Map.of()
                : index(thresholds.findByScopeAndSetByUserIdAndSubjectUserIdIn(AlertThreshold.SCOPE_DOCTOR_OVERRIDE,
                        viewingDoctorIdOrNull, subjects));
        Map<String, ResolvedThresholds> selfBySubject = index(
                thresholds.findByScopeAndSubjectUserIdIn(AlertThreshold.SCOPE_SELF, subjects));
        ResolvedThresholds system = thresholds.findByScope(AlertThreshold.SCOPE_SYSTEM)
                .map(AlertThresholdService::toResolved)
                .orElse(FALLBACK);

        Map<String, ResolvedThresholds> resolved = new HashMap<>(subjects.size());
        for (String subject : subjects) {
            ResolvedThresholds effective = overridesBySubject.get(subject);
            if (effective == null) {
                effective = selfBySubject.get(subject);
            }
            resolved.put(subject, effective != null ? effective : system);
        }
        return resolved;
    }

    /**
     * The five tier names in increasing severity order, as returned by
     * {@link #tierOf}. Exposed so callers that need to compare or score tiers
     * (episode detection, the doctor dashboard's risk heuristic) rank them
     * against one definition instead of each keeping their own copy.
     */
    public static final List<String> TIER_ORDER = List.of("low", "normal", "elevated", "fever", "highFever");

    /** Position of a tier in {@link #TIER_ORDER}; 0 for an unrecognised name. */
    public static int tierRank(String tier) {
        int rank = TIER_ORDER.indexOf(tier);
        return rank < 0 ? 0 : rank;
    }

    /** The tier name a reading falls into, matching the frontend's getTemperatureTier(). */
    public String tierOf(double celsius, ResolvedThresholds t) {
        if (celsius < t.normalStartC()) {
            return "low";
        }
        if (celsius < t.elevatedStartC()) {
            return "normal";
        }
        if (celsius < t.feverStartC()) {
            return "elevated";
        }
        if (celsius < t.highFeverStartC()) {
            return "fever";
        }
        return "highFever";
    }

    private static Map<String, ResolvedThresholds> index(List<AlertThreshold> rows) {
        Map<String, ResolvedThresholds> bySubject = new HashMap<>(rows.size());
        for (AlertThreshold row : rows) {
            bySubject.put(row.getSubjectUserId(), toResolved(row));
        }
        return bySubject;
    }

    private static ResolvedThresholds toResolved(AlertThreshold row) {
        return new ResolvedThresholds(row.getNormalStartC(), row.getElevatedStartC(), row.getFeverStartC(),
                row.getHighFeverStartC(), row.getScope());
    }
}
