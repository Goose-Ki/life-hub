package api

// Интеграционный тест на настоящей PostgreSQL: регистрация, приглашения и, главное,
// изоляция данных между пользователями во всех разделах.
// Запуск: TEST_DATABASE_URL=postgres://…/lifehub_test?sslmode=disable go test ./...
// ВНИМАНИЕ: тест очищает схему public в указанной базе.

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/dgusev/life-hub/backend/internal/db"
)

type client struct {
	t    *testing.T
	base string
	http *http.Client
}

func newClient(t *testing.T, base string) *client {
	jar, _ := cookiejar.New(nil)
	return &client{t: t, base: base, http: &http.Client{Jar: jar}}
}

func (c *client) do(method, path string, body any, headers ...string) (int, []byte) {
	c.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.base+path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	res, err := c.http.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(res.Body)
	return res.StatusCode, out
}

func (c *client) want(status int, method, path string, body any) []byte {
	c.t.Helper()
	got, out := c.do(method, path, body)
	if got != status {
		c.t.Fatalf("%s %s: status %d, want %d; body %s", method, path, got, status, out)
	}
	return out
}

func (c *client) json(method, path string, body any, v any) {
	c.t.Helper()
	out := c.want(map[string]int{"POST": 201}[method]+map[bool]int{true: 200}[method != "POST"], method, path, body)
	if v != nil {
		if err := json.Unmarshal(out, v); err != nil {
			c.t.Fatalf("decode %s: %v (%s)", path, err, out)
		}
	}
}

func count(c *client, path string) int {
	c.t.Helper()
	var arr []any
	c.json("GET", path, nil, &arr)
	return len(arr)
}

func TestIntegrationUsers(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	conn, err := db.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public`); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(ctx, conn); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(NewServer(conn, false).Routes(""))
	defer srv.Close()

	anon := newClient(t, srv.URL)
	a := newClient(t, srv.URL)
	b := newClient(t, srv.URL)
	today := time.Now().Format(dateLayout)

	// --- Первый пользователь ---
	var st map[string]bool
	anon.json("GET", "/api/auth/status", nil, &st)
	if st["has_users"] {
		t.Fatal("fresh db must have no users")
	}
	for _, p := range []string{"/api/food", "/api/classes", "/api/brain", "/api/auth/me", "/api/settings"} {
		anon.want(401, "GET", p, nil)
	}
	anon.want(400, "POST", "/api/auth/register", map[string]string{"username": "A", "name": "x", "password": "short"})
	var ua User
	a.json("POST", "/api/auth/register", map[string]string{"username": "Dima", "name": "Дима", "password": "password-a"}, &ua)
	if !ua.IsAdmin || ua.Username != "dima" {
		t.Fatalf("first user must be admin with lowercase name: %+v", ua)
	}
	// Расписание из миграции 003 и начало семестра достались первому пользователю
	if n := count(a, "/api/classes"); n != 20 {
		t.Fatalf("A classes = %d, want 20", n)
	}
	var sa Settings
	a.json("GET", "/api/settings", nil, &sa)
	if sa.SemesterStart == nil {
		t.Fatal("A must own semester_start")
	}

	// --- Приглашения ---
	b.want(403, "POST", "/api/auth/register", map[string]string{"username": "mama", "name": "Мама", "password": "password-b"})
	var inv Invite
	a.json("POST", "/api/invites", nil, &inv)
	anon.want(200, "GET", "/api/invites/"+inv.Code, nil)
	anon.want(404, "GET", "/api/invites/nope", nil)
	b.want(409, "POST", "/api/auth/register", map[string]string{"invite": inv.Code, "username": "dima", "name": "x", "password": "password-b"})
	var ub User
	b.json("POST", "/api/auth/register", map[string]string{"invite": inv.Code, "username": "mama", "name": "Мама", "password": "password-b"}, &ub)
	if ub.IsAdmin {
		t.Fatal("invited user must not be admin")
	}
	newClient(t, srv.URL).want(403, "POST", "/api/auth/register", map[string]string{"invite": inv.Code, "username": "papa", "name": "Папа", "password": "password-c"})
	b.want(403, "POST", "/api/invites", nil)
	b.want(403, "GET", "/api/invites", nil)

	// --- B начинает с чистого листа ---
	if n := count(b, "/api/classes"); n != 0 {
		t.Fatalf("B sees %d classes of A", n)
	}
	var sb Settings
	b.json("GET", "/api/settings", nil, &sb)
	if sb.SemesterStart != nil {
		t.Fatal("B sees A's settings")
	}

	// --- Данные обоих ---
	type idObj struct {
		ID int64 `json:"id"`
	}
	mk := func(c *client, path string, body any) int64 {
		var o idObj
		c.json("POST", path, body, &o)
		return o.ID
	}
	ids := map[string]int64{}
	for who, c := range map[string]*client{"a": a, "b": b} {
		ids[who+"food"] = mk(c, "/api/food", map[string]any{"date": today, "time": "08:00", "content": who + " ел"})
		ids[who+"workout"] = mk(c, "/api/workouts", map[string]any{"date": today, "kind": "Зал-" + who, "duration_min": 30})
		ids[who+"task"] = mk(c, "/api/tasks", map[string]any{"title": who + " задача", "due_date": today, "done": true})
		ids[who+"topic"] = mk(c, "/api/study/topics", map[string]any{"title": who + " тема", "status": "done", "area": "logic"})
		ids[who+"session"] = mk(c, "/api/study/sessions", map[string]any{"date": today, "minutes": 60, "topic_id": ids[who+"topic"]})
		ids[who+"book"] = mk(c, "/api/books", map[string]any{"title": who + " книга", "status": "done", "pages": 100})
		ids[who+"class"] = mk(c, "/api/classes", map[string]any{"weekday": 1, "start_time": "09:00", "end_time": "10:30", "subject": who})
	}
	b.want(400, "POST", "/api/study/sessions", map[string]any{"date": today, "minutes": 10, "topic_id": ids["atopic"]})

	// Списки — только свои
	week := fmt.Sprintf("?from=%s&to=%s", time.Now().AddDate(0, 0, -7).Format(dateLayout), today)
	for _, p := range []string{"/api/food" + week, "/api/workouts" + week, "/api/tasks" + week, "/api/study/topics",
		"/api/study/sessions" + week, "/api/books", "/api/workouts/kinds", "/api/classes"} {
		if n := count(b, p); n != 1 {
			t.Errorf("B %s: %d items, want 1", p, n)
		}
	}
	if n := count(a, "/api/classes"); n != 21 {
		t.Errorf("A classes = %d, want 21", n)
	}

	// Чужое нельзя изменить или удалить
	b.want(404, "PUT", fmt.Sprintf("/api/food/%d", ids["afood"]), map[string]any{"date": today, "time": "09:00", "content": "взлом"})
	b.want(404, "PUT", fmt.Sprintf("/api/workouts/%d", ids["aworkout"]), map[string]any{"date": today, "kind": "x"})
	b.want(404, "PUT", fmt.Sprintf("/api/tasks/%d", ids["atask"]), map[string]any{"title": "x"})
	b.want(404, "PATCH", fmt.Sprintf("/api/tasks/%d/toggle", ids["atask"]), nil)
	b.want(404, "PUT", fmt.Sprintf("/api/study/topics/%d", ids["atopic"]), map[string]any{"title": "x"})
	b.want(404, "PUT", fmt.Sprintf("/api/books/%d", ids["abook"]), map[string]any{"title": "x"})
	b.want(404, "PUT", fmt.Sprintf("/api/classes/%d", ids["aclass"]), map[string]any{"weekday": 1, "start_time": "09:00", "end_time": "10:00", "subject": "x"})
	for _, p := range []string{"food/%d", "workouts/%d", "tasks/%d", "study/topics/%d", "study/sessions/%d", "books/%d", "classes/%d"} {
		key := map[string]string{"food/%d": "afood", "workouts/%d": "aworkout", "tasks/%d": "atask", "study/topics/%d": "atopic",
			"study/sessions/%d": "asession", "books/%d": "abook", "classes/%d": "aclass"}[p]
		b.want(404, "DELETE", "/api/"+fmt.Sprintf(p, ids[key]), nil)
	}
	// …а у A всё на месте
	if n := count(a, "/api/food"+week); n != 1 {
		t.Errorf("A food = %d after B's attempts", n)
	}

	// Сводки считают только своё
	var day DayOverview
	b.json("GET", "/api/day?date="+today, nil, &day)
	if len(day.Food) != 1 || len(day.Tasks) != 1 || len(day.Workouts) != 1 || day.StudyMinutes != 60 {
		t.Errorf("B day overview leaks: %+v", day)
	}
	var cal []CalendarDay
	b.json("GET", "/api/calendar?month="+today[:7], nil, &cal)
	for _, d := range cal {
		if d.Date == today && (d.FoodEntries != 1 || d.TasksDone != 1 || d.Workouts != 1 || d.StudyMinutes != 60) {
			t.Errorf("B calendar leaks: %+v", d)
		}
	}
	var prod ProductivityResponse
	b.json("GET", "/api/productivity", nil, &prod)
	last := prod.Days[len(prod.Days)-1]
	if last.TasksPlanned != 1 || last.StudyMinutes != 60 || last.Workouts != 1 {
		t.Errorf("B productivity leaks: %+v", last)
	}
	var stats []DayMinutes
	b.json("GET", "/api/study/stats", nil, &stats)
	if stats[len(stats)-1].Minutes != 60 {
		t.Errorf("B study stats leak: %+v", stats[len(stats)-1])
	}
	var br BrainResponse
	b.json("GET", "/api/brain", nil, &br)
	if br.Stats.Skills != 1 || br.Stats.BooksDone != 1 || br.Stats.TasksDone != 1 || br.Stats.Workouts != 1 || br.Stats.StudyMinutes != 60 {
		t.Errorf("B brain leaks: %+v", br.Stats)
	}
	code, xlsx := b.do("GET", "/api/food/export", nil)
	zr, err := zip.NewReader(bytes.NewReader(xlsx), int64(len(xlsx)))
	if code != 200 || err != nil {
		t.Fatalf("B export: status %d, zip error %v", code, err)
	}
	f, _ := zr.Open("xl/worksheets/sheet1.xml")
	sheet, _ := io.ReadAll(f)
	if !bytes.Contains(sheet, []byte("b ел")) || bytes.Contains(sheet, []byte("a ел")) {
		t.Errorf("B export must contain only B's food: %s", sheet)
	}

	// Настройки независимы
	b.want(200, "PUT", "/api/settings", map[string]any{"study_goal_min": 45})
	a.json("GET", "/api/settings", nil, &sa)
	if sa.StudyGoalMin != defaultStudyGoalMin || sa.SemesterStart == nil {
		t.Errorf("A settings changed by B: %+v", sa)
	}

	// CSRF: запрос с чужого сайта отклоняется
	if code, _ := a.do("POST", "/api/tasks", map[string]any{"title": "csrf"}, "Origin", "https://evil.example"); code != 403 {
		t.Errorf("cross-origin POST: %d, want 403", code)
	}

	// Вход / выход / смена пароля
	c := newClient(t, srv.URL)
	c.want(401, "POST", "/api/auth/login", map[string]string{"username": "mama", "password": "wrong-pass"})
	c.want(200, "POST", "/api/auth/login", map[string]string{"username": "MAMA", "password": "password-b"})
	if n := count(c, "/api/books"); n != 1 {
		t.Errorf("relogin B books = %d", n)
	}
	b.want(403, "PUT", "/api/auth/password", map[string]string{"current": "nope", "new": "new-password"})
	b.want(204, "PUT", "/api/auth/password", map[string]string{"current": "password-b", "new": "new-password"})
	c.want(401, "GET", "/api/auth/me", nil) // другие сессии завершены
	b.want(200, "GET", "/api/auth/me", nil)
	b.want(204, "POST", "/api/auth/logout", nil)
	b.want(401, "GET", "/api/auth/me", nil)
	if !strings.Contains(string(c.want(200, "POST", "/api/auth/login", map[string]string{"username": "mama", "password": "new-password"})), "Мама") {
		t.Error("login with new password failed")
	}
}
