# Plain-JVM-mode build (GraalVM Native Image is an explicit opt-in per
# ARCHITECTURE_V3.html §2.3, not wired up here). Multi-stage: build with the
# full JDK + Maven, run on a slim JRE. Works unmodified on arm64 and amd64.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml .
RUN mvn -q -B dependency:go-offline || true

COPY src src
RUN mvn -q -B package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --create-home --shell /usr/sbin/nologin appuser
COPY --from=build /workspace/target/thermometer-backend-*.jar app.jar
USER appuser

EXPOSE 8080
ENV SPRING_PROFILES_ACTIVE=docker
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
