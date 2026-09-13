package com.dialog.thermometer.domain;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DeviceRepository extends JpaRepository<Device, UUID> {

    Optional<Device> findByBdAddr(String bdAddr);

    /** Owner-scoped lookup — the query *is* the authorization for rename (DeviceController#renameLabel). */
    Optional<Device> findByBdAddrAndOwnerUserId(String bdAddr, String ownerUserId);

    List<Device> findByOwnerUserId(String ownerUserId);

    List<Device> findByOwnerUserIdIsNull();

    List<Device> findByOwnerUserIdIn(List<String> ownerUserIds);
}
