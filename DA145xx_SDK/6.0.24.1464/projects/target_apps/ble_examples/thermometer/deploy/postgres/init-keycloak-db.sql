-- Runs once, on the very first start of an empty postgres_data volume
-- (docker-entrypoint-initdb.d). docker-compose.prod.yml runs Keycloak in
-- production mode, which needs a real database: it shares this TimescaleDB
-- instance through a separate `keycloak` database owned by the same role
-- (KC_DB_URL / KC_DB_USERNAME in the overlay), so no second Postgres runs.
-- Not mounted by the local stack, whose dev-mode Keycloak uses its own H2.
CREATE DATABASE keycloak OWNER thermometer;
