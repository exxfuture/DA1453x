package com.dialog.thermometer.domain;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, String> {

    List<User> findByRole(String role);

    Optional<User> findByUsername(String username);

    /**
     * Admin user browser: case-insensitive substring match on username/email
     * with an optional role filter. Both parameters are independently
     * nullable — a null one drops that half of the predicate rather than
     * matching nothing, so the same query serves "list everyone" too.
     *
     * <p>The {@code CAST(... AS string)} wrappers are not cosmetic: without
     * them Hibernate has no Java type to infer for a null argument and binds
     * it as a binary null, which Postgres then refuses to pass to
     * {@code lower()} ("function lower(bytea) does not exist"). The cast
     * pins the bind type to varchar so a null {@code q}/{@code role} works.
     */
    @Query("""
            SELECT u FROM User u
            WHERE (CAST(:q AS string) IS NULL
                   OR LOWER(u.username) LIKE LOWER(CONCAT('%', CAST(:q AS string), '%'))
                   OR LOWER(u.email) LIKE LOWER(CONCAT('%', CAST(:q AS string), '%')))
              AND (CAST(:role AS string) IS NULL OR u.role = CAST(:role AS string))
            """)
    Page<User> search(@Param("q") String q, @Param("role") String role, Pageable pageable);
}
