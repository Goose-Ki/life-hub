package api

import (
	"bytes"
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// ---------- Пароли: PBKDF2-SHA256 из стандартной библиотеки ----------

const pbkdf2Iter = 310_000

func hashPassword(pw string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := pbkdf2.Key(sha256.New, pw, salt, pbkdf2Iter, 32)
	if err != nil {
		return "", err
	}
	enc := base64.RawStdEncoding
	return fmt.Sprintf("pbkdf2_sha256$%d$%s$%s", pbkdf2Iter, enc.EncodeToString(salt), enc.EncodeToString(key)), nil
}

func checkPassword(stored, pw string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2_sha256" {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter < 1 {
		return false
	}
	enc := base64.RawStdEncoding
	salt, err1 := enc.DecodeString(parts[2])
	want, err2 := enc.DecodeString(parts[3])
	if err1 != nil || err2 != nil {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, pw, salt, iter, len(want))
	return err == nil && subtle.ConstantTimeCompare(got, want) == 1
}

// ---------- Сессии ----------

const (
	sessionCookie = "lh_session"
	sessionTTL    = 90 * 24 * time.Hour
)

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func tokenHash(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

type User struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name"`
	IsAdmin  bool   `json:"is_admin"`
}

type ctxKey int

const (
	ctxUser ctxKey = iota
	ctxTx
)

func userFrom(r *http.Request) *User {
	u, _ := r.Context().Value(ctxUser).(*User)
	return u
}

// querier — общее у *sql.DB и *sql.Tx.
type querier interface {
	QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, q string, args ...any) *sql.Row
	ExecContext(ctx context.Context, q string, args ...any) (sql.Result, error)
}

// q — транзакция текущего запроса, в которой выставлен app.user_id.
// Все запросы к данным пользователя идут только через неё.
func (s *Server) q(r *http.Request) querier {
	if tx, ok := r.Context().Value(ctxTx).(*sql.Tx); ok {
		return tx
	}
	// Без пользователя (не должно случаться для защищённых маршрутов): app_uid() = NULL → пусто.
	return s.db
}

func (s *Server) secureCookies(r *http.Request) bool {
	return r.TLS != nil || (s.trustProxy && r.Header.Get("X-Forwarded-Proto") == "https")
}

func (s *Server) setSessionCookie(w http.ResponseWriter, r *http.Request, token string, exp time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", Expires: exp, MaxAge: int(time.Until(exp).Seconds()),
		HttpOnly: true, Secure: s.secureCookies(r), SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: s.secureCookies(r), SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) startSession(ctx context.Context, w http.ResponseWriter, r *http.Request, q querier, userID int64) error {
	token := randomToken(32)
	exp := time.Now().Add(sessionTTL)
	if _, err := q.ExecContext(ctx, `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
		tokenHash(token), userID, exp); err != nil {
		return err
	}
	s.setSessionCookie(w, r, token, exp)
	return nil
}

func (s *Server) currentUser(r *http.Request) (*User, error) {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" || len(c.Value) > 200 {
		return nil, nil
	}
	var u User
	var exp time.Time
	err = s.db.QueryRowContext(r.Context(), `SELECT u.id, u.username, u.name, u.is_admin, s.expires_at
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.expires_at > now()`, tokenHash(c.Value)).
		Scan(&u.ID, &u.Username, &u.Name, &u.IsAdmin, &exp)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	// Скользящий срок: активные пользователи не выходят из аккаунта
	if time.Until(exp) < sessionTTL-24*time.Hour {
		_, _ = s.db.ExecContext(r.Context(), `UPDATE sessions SET expires_at = $2 WHERE token_hash = $1`,
			tokenHash(c.Value), time.Now().Add(sessionTTL))
	}
	return &u, nil
}

// bufferedWriter копит ответ, чтобы отправить его только после успешного COMMIT.
type bufferedWriter struct {
	header http.Header
	status int
	buf    bytes.Buffer
}

func (b *bufferedWriter) Header() http.Header         { return b.header }
func (b *bufferedWriter) Write(p []byte) (int, error) { return b.buf.Write(p) }
func (b *bufferedWriter) WriteHeader(code int)        { b.status = code }

// authed: пускает только вошедших и выполняет обработчик в транзакции от имени пользователя.
func (s *Server) authed(next handlerFunc) http.Handler {
	return handlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		u, err := s.currentUser(r)
		if err != nil {
			return err
		}
		if u == nil {
			return &apiError{http.StatusUnauthorized, "unauthorized"}
		}
		tx, err := s.db.BeginTx(r.Context(), nil)
		if err != nil {
			return err
		}
		defer tx.Rollback() //nolint:errcheck — после Commit это no-op
		if _, err := tx.ExecContext(r.Context(), `SELECT set_config('app.user_id', $1, true)`,
			strconv.FormatInt(u.ID, 10)); err != nil {
			return err
		}
		ctx := context.WithValue(context.WithValue(r.Context(), ctxUser, u), ctxTx, tx)
		bw := &bufferedWriter{header: w.Header(), status: http.StatusOK}
		if err := next(bw, r.WithContext(ctx)); err != nil {
			return err // откат; ошибка превратится в JSON-ответ
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		w.WriteHeader(bw.status)
		_, _ = w.Write(bw.buf.Bytes())
		return nil
	})
}

func (s *Server) adminOnly(next handlerFunc) handlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		if u := userFrom(r); u == nil || !u.IsAdmin {
			return &apiError{http.StatusForbidden, "admin only"}
		}
		return next(w, r)
	}
}

// ---------- Ограничение попыток входа ----------

type rateLimiter struct {
	mu    sync.Mutex
	hits  map[string][]time.Time
	limit int
	win   time.Duration
}

func newRateLimiter(limit int, win time.Duration) *rateLimiter {
	return &rateLimiter{hits: map[string][]time.Time{}, limit: limit, win: win}
}

func (l *rateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	h := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if now.Sub(t) < l.win {
			h = append(h, t)
		}
	}
	if len(h) >= l.limit {
		l.hits[key] = h
		return false
	}
	l.hits[key] = append(h, now)
	if len(l.hits) > 10000 { // защита от разрастания
		l.hits = map[string][]time.Time{}
	}
	return true
}

func (s *Server) clientIP(r *http.Request) string {
	if s.trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			return strings.TrimSpace(strings.Split(xff, ",")[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

var errTooMany = &apiError{http.StatusTooManyRequests, "too many attempts, try again later"}

// ---------- Обработчики ----------

var usernameRe = regexp.MustCompile(`^[a-z0-9_.-]{3,32}$`)

type registerInput struct {
	Invite   string `json:"invite"`
	Username string `json:"username"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

func validatePassword(pw string) error {
	if utf8.RuneCountInString(pw) < 8 {
		return badRequest("password must be at least 8 characters")
	}
	if len(pw) > 200 {
		return badRequest("password is too long")
	}
	return nil
}

// GET /api/auth/status — есть ли уже пользователи (иначе фронтенд предлагает создать первый аккаунт).
func (s *Server) authStatus(w http.ResponseWriter, r *http.Request) error {
	var has bool
	if err := s.db.QueryRowContext(r.Context(), `SELECT EXISTS (SELECT 1 FROM users)`).Scan(&has); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]bool{"has_users": has})
	return nil
}

// POST /api/auth/register
func (s *Server) register(w http.ResponseWriter, r *http.Request) error {
	if !s.authLimiter.allow("reg:" + s.clientIP(r)) {
		return errTooMany
	}
	var in registerInput
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	in.Username = strings.ToLower(strings.TrimSpace(in.Username))
	in.Name = strings.TrimSpace(in.Name)
	in.Invite = strings.TrimSpace(in.Invite)
	if !usernameRe.MatchString(in.Username) {
		return badRequest("username: 3–32 characters, latin letters, digits, _ . -")
	}
	if in.Name == "" || utf8.RuneCountInString(in.Name) > 50 {
		return badRequest("name is required (up to 50 characters)")
	}
	if err := validatePassword(in.Password); err != nil {
		return err
	}
	hash, err := hashPassword(in.Password)
	if err != nil {
		return err
	}

	ctx := r.Context()
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	var userCount int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&userCount); err != nil {
		return err
	}
	first := userCount == 0
	if !first {
		var ok bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM invites
			WHERE code = $1 AND used_by IS NULL AND expires_at > now())`, in.Invite).Scan(&ok); err != nil {
			return err
		}
		if in.Invite == "" || !ok {
			return &apiError{http.StatusForbidden, "invite is invalid or expired"}
		}
	}
	var taken bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE username = $1)`, in.Username).Scan(&taken); err != nil {
		return err
	}
	if taken {
		return &apiError{http.StatusConflict, "username is taken"}
	}
	var id int64
	if err := tx.QueryRowContext(ctx, `INSERT INTO users (username, name, password_hash, is_admin)
		VALUES ($1, $2, $3, $4) RETURNING id`, in.Username, in.Name, hash, first).Scan(&id); err != nil {
		return err
	}
	if first {
		// Данные, созданные до появления аккаунтов, переходят первому пользователю.
		for _, t := range []string{"food_entries", "workouts", "tasks", "classes", "study_topics", "study_sessions", "books", "settings"} {
			if _, err := tx.ExecContext(ctx, `UPDATE `+t+` SET user_id = $1 WHERE user_id IS NULL`, id); err != nil {
				return err
			}
		}
	} else {
		if _, err := tx.ExecContext(ctx, `UPDATE invites SET used_by = $1, used_at = now() WHERE code = $2`, id, in.Invite); err != nil {
			return err
		}
	}
	if err := s.startSession(ctx, w, r, tx, id); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, User{ID: id, Username: in.Username, Name: in.Name, IsAdmin: first})
	return nil
}

// POST /api/auth/login
func (s *Server) login(w http.ResponseWriter, r *http.Request) error {
	if !s.authLimiter.allow("login:" + s.clientIP(r)) {
		return errTooMany
	}
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	in.Username = strings.ToLower(strings.TrimSpace(in.Username))
	var u User
	var hash string
	err := s.db.QueryRowContext(r.Context(), `SELECT id, username, name, is_admin, password_hash FROM users WHERE username = $1`,
		in.Username).Scan(&u.ID, &u.Username, &u.Name, &u.IsAdmin, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		checkPassword(dummyHash, in.Password) // одинаковое время ответа
		return &apiError{http.StatusUnauthorized, "wrong username or password"}
	}
	if err != nil {
		return err
	}
	if !checkPassword(hash, in.Password) {
		return &apiError{http.StatusUnauthorized, "wrong username or password"}
	}
	// Чистим просроченные сессии этого пользователя
	_, _ = s.db.ExecContext(r.Context(), `DELETE FROM sessions WHERE user_id = $1 AND expires_at < now()`, u.ID)
	if err := s.startSession(r.Context(), w, r, s.db, u.ID); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, u)
	return nil
}

var dummyHash, _ = hashPassword("dummy-password-for-timing")

// POST /api/auth/logout
func (s *Server) logout(w http.ResponseWriter, r *http.Request) error {
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		if _, err := s.db.ExecContext(r.Context(), `DELETE FROM sessions WHERE token_hash = $1`, tokenHash(c.Value)); err != nil {
			return err
		}
	}
	s.clearSessionCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// GET /api/auth/me
func (s *Server) me(w http.ResponseWriter, r *http.Request) error {
	writeJSON(w, http.StatusOK, userFrom(r))
	return nil
}

// PUT /api/auth/password — смена пароля; остальные сессии завершаются.
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Current string `json:"current"`
		New     string `json:"new"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	u := userFrom(r)
	var hash string
	if err := s.q(r).QueryRowContext(r.Context(), `SELECT password_hash FROM users WHERE id = $1`, u.ID).Scan(&hash); err != nil {
		return err
	}
	if !checkPassword(hash, in.Current) {
		return &apiError{http.StatusForbidden, "current password is wrong"}
	}
	if err := validatePassword(in.New); err != nil {
		return err
	}
	nh, err := hashPassword(in.New)
	if err != nil {
		return err
	}
	if _, err := s.q(r).ExecContext(r.Context(), `UPDATE users SET password_hash = $1 WHERE id = $2`, nh, u.ID); err != nil {
		return err
	}
	c, _ := r.Cookie(sessionCookie)
	if _, err := s.q(r).ExecContext(r.Context(), `DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`,
		u.ID, tokenHash(c.Value)); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ---------- Приглашения (только админ) ----------

type Invite struct {
	Code      string  `json:"code"`
	CreatedAt string  `json:"created_at"`
	ExpiresAt string  `json:"expires_at"`
	UsedBy    *string `json:"used_by"` // имя того, кто зарегистрировался
}

func (s *Server) listInvites(w http.ResponseWriter, r *http.Request) error {
	rows, err := s.q(r).QueryContext(r.Context(), `SELECT i.code, i.created_at::date::text, i.expires_at::date::text, u.name
		FROM invites i LEFT JOIN users u ON u.id = i.used_by
		WHERE i.created_by = $1 AND (i.used_by IS NOT NULL OR i.expires_at > now())
		ORDER BY i.created_at DESC LIMIT 50`, userFrom(r).ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []Invite{}
	for rows.Next() {
		var in Invite
		var used sql.NullString
		if err := rows.Scan(&in.Code, &in.CreatedAt, &in.ExpiresAt, &used); err != nil {
			return err
		}
		in.UsedBy = nullStr(used)
		out = append(out, in)
	}
	writeJSON(w, http.StatusOK, out)
	return rows.Err()
}

func (s *Server) createInvite(w http.ResponseWriter, r *http.Request) error {
	code := randomToken(9) // 12 символов, ~72 бита
	var in Invite
	if err := s.q(r).QueryRowContext(r.Context(), `INSERT INTO invites (code, created_by, expires_at)
		VALUES ($1, $2, now() + interval '14 days') RETURNING code, created_at::date::text, expires_at::date::text`,
		code, userFrom(r).ID).Scan(&in.Code, &in.CreatedAt, &in.ExpiresAt); err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, in)
	return nil
}

func (s *Server) deleteInvite(w http.ResponseWriter, r *http.Request) error {
	res, err := s.q(r).ExecContext(r.Context(), `DELETE FROM invites WHERE code = $1 AND created_by = $2 AND used_by IS NULL`,
		r.PathValue("code"), userFrom(r).ID)
	if err != nil {
		return err
	}
	if err := mustAffect(res); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// GET /api/invites/{code} — проверка приглашения перед регистрацией (публично).
func (s *Server) checkInvite(w http.ResponseWriter, r *http.Request) error {
	if !s.authLimiter.allow("inv:" + s.clientIP(r)) {
		return errTooMany
	}
	var from string
	err := s.db.QueryRowContext(r.Context(), `SELECT u.name FROM invites i JOIN users u ON u.id = i.created_by
		WHERE i.code = $1 AND i.used_by IS NULL AND i.expires_at > now()`, r.PathValue("code")).Scan(&from)
	if errors.Is(err, sql.ErrNoRows) {
		return &apiError{http.StatusNotFound, "invite is invalid or expired"}
	}
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]string{"from": from})
	return nil
}

// ---------- Защита от CSRF: изменяющие запросы только со своего сайта ----------

func (s *Server) sameOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead && strings.HasPrefix(r.URL.Path, "/api/") {
			if origin := r.Header.Get("Origin"); origin != "" {
				u, err := url.Parse(origin)
				host := r.Host
				if fh := r.Header.Get("X-Forwarded-Host"); fh != "" && s.trustProxy {
					host = fh
				}
				if err != nil || u.Host != host {
					writeJSON(w, http.StatusForbidden, map[string]string{"error": "cross-origin request blocked"})
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}
