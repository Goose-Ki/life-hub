package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/dgusev/life-hub/backend/internal/api"
	"github.com/dgusev/life-hub/backend/internal/db"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// cleanDSN убирает параметры, которых не знает драйвер lib/pq (Neon добавляет channel_binding),
// и передаёт базе часовой пояс из TZ.
func cleanDSN(dsn string) string {
	u, err := url.Parse(dsn)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		return dsn
	}
	q := u.Query()
	q.Del("channel_binding")
	// Часовой пояс сессии БД = часовой пояс сервера (CURRENT_DATE для «просроченных» задач)
	if tz := os.Getenv("TZ"); tz != "" && q.Get("timezone") == "" {
		q.Set("timezone", tz)
	}
	u.RawQuery = q.Encode()
	return u.String()
}

func main() {
	dsn := env("DATABASE_URL", "postgres://lifehub:lifehub@localhost:5432/lifehub?sslmode=disable")
	addr := env("ADDR", ":8080")
	if port := os.Getenv("PORT"); port != "" { // Render, Railway и т.п. задают порт так
		addr = ":" + port
	}
	dsn = cleanDSN(dsn)
	staticDir := os.Getenv("STATIC_DIR")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	conn, err := db.Open(ctx, dsn)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer conn.Close()

	if err := db.Migrate(ctx, conn); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           api.NewServer(conn, os.Getenv("TRUST_PROXY") == "1").Routes(staticDir),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("Life Hub listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down…")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}
