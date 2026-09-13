# Multi-stage: static Go binary, tiny runtime image. arm64-friendly by
# construction — this is exactly why the gateway stayed Go (architecture v3
# §2.3) even though the platform backend moved to Java: it needs to run
# comfortably on a Raspberry Pi or similar SBC.
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /gateway .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=build /gateway /usr/local/bin/gateway
ENTRYPOINT ["/usr/local/bin/gateway"]
