# Static SPA build served by nginx — no Node runtime needed at serve time
# (architecture v3 §3.1: plain Vite SPA, no SSR server to operate).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .

# No VITE_* build args any more (review INF-17): the API / MQTT / Keycloak URLs
# are read at RUNTIME from /env.js, which the entrypoint below renders from the
# container's environment. One image is therefore promotable across
# environments instead of being pinned to whatever host it was built for.
RUN npm run build

# Unprivileged variant (review INF-24): the master process runs as uid 101, so
# nginx listens on 8080 rather than a privileged port. docker-compose maps
# 8090:8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine

# Rendered by the entrypoint script; see nginx.conf.template's header comment.
COPY nginx.conf.template /etc/nginx/nginx.conf.template
COPY nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY docker/20-render-runtime-config.sh /docker-entrypoint.d/20-render-runtime-config.sh
COPY --from=build /app/dist /usr/share/nginx/html

# The entrypoint rewrites env.js and default.conf as uid 101, so both trees have
# to be group-writable for it (the image's nginx user is in group 0). Done as
# root while the build is still privileged; the runtime USER below is not.
USER root
RUN chmod +x /docker-entrypoint.d/20-render-runtime-config.sh \
 && chown -R 101:0 /usr/share/nginx/html /etc/nginx/conf.d \
 && chmod -R g+w /usr/share/nginx/html /etc/nginx/conf.d
USER 101

EXPOSE 8080

# wget ships with the alpine base. --spider keeps it to a HEAD-like check.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/health || exit 1
