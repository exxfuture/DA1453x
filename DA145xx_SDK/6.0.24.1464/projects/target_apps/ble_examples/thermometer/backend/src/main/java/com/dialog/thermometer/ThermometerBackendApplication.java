package com.dialog.thermometer;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Scheduling is enabled for exactly one job today:
 * {@code live/BrokerCredentialService.sweepExpiredUserCredentials}, which
 * deletes broker credentials nobody has re-minted inside their TTL. Under
 * {@code spring.threads.virtual.enabled} Boot gives the scheduler a virtual
 * thread executor, so this costs no platform thread while idle.
 */
@SpringBootApplication
@EnableScheduling
public class ThermometerBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(ThermometerBackendApplication.class, args);
    }
}
