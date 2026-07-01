# ---- Build stage ----
FROM golang:1.22-alpine AS build

WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
# 静态二进制，移除 cgo 依赖
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# ---- Runtime stage ----
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -S app && adduser -S -G app app

WORKDIR /app
COPY --from=build /out/server /app/server

USER app
EXPOSE 8080

# 通过 -config 指定配置文件，或挂载到 /app/config/config.yaml
CMD ["/app/server", "-config", "/app/config/config.yaml"]
