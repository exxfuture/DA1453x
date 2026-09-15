# Plain-JVM-mode build (GraalVM Native Image is an explicit opt-in per
# ARCHITECTURE_V3.html §2.3, not wired up here). Multi-stage: build with the
# full JDK + Maven, run on a slim JRE. Works unmodified on arm64 and amd64.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

# Dependency resolution as its own layer, so editing src/ doesn't re-download
# the world. Deliberately NOT `|| true`: swallowing the exit code hid a broken
# pom or an unreachable repository until the `package` step below failed with a
# far less obvious error. A genuinely offline build should pass
# `--build-arg`-free `-o` to the package step instead of ignoring failures here.
COPY pom.xml .
RUN mvn -q -B dependency:go-offline

COPY src src
RUN mvn -q -B package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app

# curl is here only for the HEALTHCHECK below — the temurin JRE image ships
# neither curl nor wget. ~1 MB, and it makes the container able to report
# whether it is *serving* rather than merely started.
RUN apt-get update \
    && apt-get install --no-install-recommends -y curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --create-home --shell /usr/sbin/nologin appuser
COPY --from=build /workspace/target/thermometer-backend-*.jar app.jar
USER appuser

EXPOSE 8080
ENV SPRING_PROFILES_ACTIVE=docker

# Boot's own readiness endpoint (management.endpoint.health.probes.enabled in
# application.yml), which is exempt from both the JWT chain and the rate limiter
# precisely so a probe can always reach it. start-period covers JVM start plus
# Flyway migrations; anything dependent on this container should gate on
# `condition: service_healthy` rather than on `started`.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
    CMD curl -fsS http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
