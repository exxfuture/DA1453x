# Multi-stage: static Go binary, tiny runtime image. arm64-friendly by
# construction — this is exactly why the gateway stayed Go (architecture v3
# §2.3) even though the platform backend moved to Java: it needs to run
# comfortably on a Raspberry Pi or similar SBC. Both base images are
# multi-arch, so `docker build` produces an arm64 image on an arm64 host and
# `docker buildx build --platform linux/arm64` cross-builds one anywhere.
#
# The builder tag tracks the `go` directive in go.mod (1.26) — keep the two in
# step, and the `go-version-file: gateway/go.mod` in .github/workflows/gateway.yml
# picks the same version up automatically.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# CGO off: no libc dependency, so the binary also runs in a scratch/distroless
# image if this ever needs to shrink further. -trimpath keeps build paths out
# of the binary.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /gateway .

FROM alpine:3.22
# ca-certificates for a TLS broker (mqtts://) — the only runtime dependency.
# The gateway never needs root: it opens an outbound MQTT connection and,
# optionally, one HTTP listener for --metrics-addr. Running unprivileged
# matters most here, because this is the component that runs unattended on
# edge hardware (INF-12).
RUN apk add --no-cache ca-certificates \
    && adduser -D -H -u 10001 gateway
COPY --from=build /gateway /usr/local/bin/gateway
USER gateway
ENTRYPOINT ["/usr/local/bin/gateway"]
