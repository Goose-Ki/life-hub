# --- 1. Сборка фронтенда ---
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- 2. Сборка бэкенда ---
FROM golang:1.24-alpine AS api
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /lifehub ./cmd/server

# --- 3. Итоговый образ: один бинарник + статика ---
FROM alpine:3.20
RUN apk add --no-cache tzdata ca-certificates
WORKDIR /app
COPY --from=api /lifehub /app/lifehub
COPY --from=web /web/dist /app/web
ENV STATIC_DIR=/app/web ADDR=:8080
EXPOSE 8080
CMD ["/app/lifehub"]
