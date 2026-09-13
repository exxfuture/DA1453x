package com.dialog.thermometer.api.dto;

import org.springframework.data.domain.Page;

import java.util.List;
import java.util.function.Function;

/**
 * Stable JSON envelope for a page of results.
 *
 * <p>Deliberately not returning Spring Data's {@code Page}/{@code PageImpl}
 * straight out of a controller: its serialized shape is explicitly
 * documented as unstable (Spring Data 3.3 logs a warning on every such
 * response) and leaks internals like {@code pageable.sort.unsorted} into a
 * public API contract. This carries exactly what a client needs, under names
 * that will not change under us.
 *
 * @param content       the page's items, already mapped to their response type
 * @param page          zero-based page index
 * @param size          requested page size
 * @param totalElements total across all pages
 * @param totalPages    total page count
 */
public record PageResponse<T>(List<T> content, int page, int size, long totalElements, int totalPages) {

    public static <E, T> PageResponse<T> of(Page<E> source, Function<E, T> mapper) {
        return new PageResponse<>(
                source.getContent().stream().map(mapper).toList(),
                source.getNumber(),
                source.getSize(),
                source.getTotalElements(),
                source.getTotalPages());
    }

    /** For pages whose items are mapped in bulk (e.g. after a batch username lookup). */
    public static <E, T> PageResponse<T> of(Page<E> source, List<T> mappedContent) {
        return new PageResponse<>(mappedContent, source.getNumber(), source.getSize(), source.getTotalElements(),
                source.getTotalPages());
    }
}
