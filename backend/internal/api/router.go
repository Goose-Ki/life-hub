package api

import (
	"database/sql"
	"encoding/json"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Server struct {
	db          *sql.DB
	trustProxy  bool // за обратным прокси (Render и т.п.): доверять X-Forwarded-*
	authLimiter *rateLimiter
}

func NewServer(db *sql.DB, trustProxy bool) *Server {
	return &Server{db: db, trustProxy: trustProxy, authLimiter: newRateLimiter(10, 10*time.Minute)}
}

// Routes собирает все маршруты API. Если staticDir не пуст — раздаёт собранный фронтенд (SPA).
func (s *Server) Routes(staticDir string) http.Handler {
	mux := http.NewServeMux()
	// h — маршрут только для вошедших (данные пользователя); pub — открытый.
	h := func(pattern string, fn handlerFunc) { mux.Handle(pattern, s.authed(fn)) }
	pub := func(pattern string, fn handlerFunc) { mux.Handle(pattern, fn) }

	pub("GET /api/ping", s.ping)
	pub("GET /api/health", s.health)
	pub("GET /api/auth/status", s.authStatus)
	pub("POST /api/auth/register", s.register)
	pub("POST /api/auth/login", s.login)
	pub("POST /api/auth/logout", s.logout)
	pub("GET /api/invites/{code}", s.checkInvite)
	h("GET /api/auth/me", s.me)
	h("PUT /api/auth/password", s.changePassword)
	h("GET /api/invites", s.adminOnly(s.listInvites))
	h("POST /api/invites", s.adminOnly(s.createInvite))
	h("DELETE /api/invites/{code}", s.adminOnly(s.deleteInvite))

	h("GET /api/food", s.listFood)
	h("GET /api/food/export", s.exportFood)
	h("POST /api/food", s.createFood)
	h("PUT /api/food/{id}", s.updateFood)
	h("DELETE /api/food/{id}", s.deleteFood)

	h("GET /api/workouts", s.listWorkouts)
	h("GET /api/workouts/kinds", s.workoutKinds)
	h("POST /api/workouts", s.createWorkout)
	h("PUT /api/workouts/{id}", s.updateWorkout)
	h("DELETE /api/workouts/{id}", s.deleteWorkout)

	h("GET /api/tasks", s.listTasks)
	h("POST /api/tasks", s.createTask)
	h("PUT /api/tasks/{id}", s.updateTask)
	h("PATCH /api/tasks/{id}/toggle", s.toggleTask)
	h("DELETE /api/tasks/{id}", s.deleteTask)

	h("GET /api/classes", s.listClasses)
	h("POST /api/classes", s.createClass)
	h("PUT /api/classes/{id}", s.updateClass)
	h("DELETE /api/classes/{id}", s.deleteClass)

	h("GET /api/study/topics", s.listTopics)
	h("POST /api/study/topics", s.createTopic)
	h("PUT /api/study/topics/{id}", s.updateTopic)
	h("DELETE /api/study/topics/{id}", s.deleteTopic)
	h("GET /api/study/sessions", s.listSessions)
	h("POST /api/study/sessions", s.createSession)
	h("DELETE /api/study/sessions/{id}", s.deleteSession)
	h("GET /api/study/stats", s.studyStats)

	h("GET /api/books", s.listBooks)
	h("POST /api/books", s.createBook)
	h("PUT /api/books/{id}", s.updateBook)
	h("DELETE /api/books/{id}", s.deleteBook)
	h("GET /api/brain", s.brain)

	h("GET /api/settings", s.getSettings)
	h("PUT /api/settings", s.putSettings)

	h("GET /api/day", s.dayOverview)
	h("GET /api/calendar", s.calendarMonth)
	h("GET /api/productivity", s.productivity)

	mux.Handle("/api/", handlerFunc(func(w http.ResponseWriter, r *http.Request) error { return errNotFound }))
	if staticDir != "" {
		mux.Handle("/", spaHandler(staticDir))
	}
	return logRequests(securityHeaders(s.sameOrigin(mux)))
}

// ping — без обращения к базе: для проверок «живости» хостинга, чтобы не будить БД.
func (s *Server) ping(w http.ResponseWriter, r *http.Request) error {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	return nil
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) error {
	if err := s.db.PingContext(r.Context()); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	return nil
}

var deletableTables = map[string]bool{
	"food_entries": true, "workouts": true, "tasks": true,
	"classes": true, "study_topics": true, "study_sessions": true, "books": true,
}

func (s *Server) deleteByID(w http.ResponseWriter, r *http.Request, table string) error {
	if !deletableTables[table] {
		panic("deleteByID: unexpected table " + table)
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	res, err := s.q(r).ExecContext(r.Context(), `DELETE FROM `+table+` WHERE id = $1 AND user_id = app_uid()`, id)
	if err != nil {
		return err
	}
	if err := mustAffect(res); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ---------- Настройки ----------

const defaultStudyGoalMin = 120

type Settings struct {
	SemesterStart *string `json:"semester_start"`
	StudyGoalMin  int     `json:"study_goal_min"` // цель учёбы на день, минут (для графика продуктивности)
}

func (s *Server) loadSettings(r *http.Request) (Settings, error) {
	st := Settings{StudyGoalMin: defaultStudyGoalMin}
	rows, err := s.q(r).QueryContext(r.Context(), `SELECT key, value FROM settings WHERE user_id = app_uid()`)
	if err != nil {
		return st, err
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return st, err
		}
		switch k {
		case "semester_start":
			v := v
			st.SemesterStart = &v
		case "study_goal_min":
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				st.StudyGoalMin = n
			}
		}
	}
	return st, rows.Err()
}

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) error {
	st, err := s.loadSettings(r)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, st)
	return nil
}

func (s *Server) setSetting(r *http.Request, key string, value *string) error {
	var err error
	if value == nil {
		_, err = s.q(r).ExecContext(r.Context(), `DELETE FROM settings WHERE key = $1 AND user_id = app_uid()`, key)
	} else {
		_, err = s.q(r).ExecContext(r.Context(), `INSERT INTO settings (key, value) VALUES ($1, $2)
			ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`, key, *value)
	}
	return err
}

// PUT /api/settings — частичное обновление: меняются только переданные поля.
func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) error {
	var in map[string]json.RawMessage
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if raw, ok := in["semester_start"]; ok {
		var v *string
		if err := json.Unmarshal(raw, &v); err != nil {
			return badRequest("semester_start must be a date or null")
		}
		d, err := optDate(v, "semester_start")
		if err != nil {
			return err
		}
		if err := s.setSetting(r, "semester_start", d); err != nil {
			return err
		}
	}
	if raw, ok := in["study_goal_min"]; ok {
		var n int
		if err := json.Unmarshal(raw, &n); err != nil || n < 10 || n > 1440 {
			return badRequest("study_goal_min must be between 10 and 1440")
		}
		v := strconv.Itoa(n)
		if err := s.setSetting(r, "study_goal_min", &v); err != nil {
			return err
		}
	}
	return s.getSettings(w, r)
}

// ---------- Обзор дня ----------

type DayOverview struct {
	Date         string      `json:"date"`
	Weekday      int         `json:"weekday"`
	WeekNumber   *int        `json:"week_number"`
	Parity       *string     `json:"parity"`
	Classes      []Class     `json:"classes"`
	Tasks        []Task      `json:"tasks"`
	Food         []FoodEntry `json:"food"`
	Workouts     []Workout   `json:"workouts"`
	StudyMinutes int         `json:"study_minutes"`
}

// GET /api/day?date=YYYY-MM-DD — всё, что относится к одному дню.
func (s *Server) dayOverview(w http.ResponseWriter, r *http.Request) error {
	date := r.URL.Query().Get("date")
	if date == "" {
		date = time.Now().Format(dateLayout)
	}
	day, err := time.Parse(dateLayout, date)
	if err != nil {
		return badRequest("date must be in YYYY-MM-DD format")
	}
	st, err := s.loadSettings(r)
	if err != nil {
		return err
	}
	ov := DayOverview{Date: date, Weekday: (int(day.Weekday())+6)%7 + 1}
	if st.SemesterStart != nil {
		ov.WeekNumber, ov.Parity = weekInfo(day, *st.SemesterStart)
	}

	// Пары: если чётность известна — фильтруем, иначе показываем все пары этого дня недели.
	if ov.Parity != nil {
		ov.Classes, err = s.queryClasses(r, `AND weekday = $1 AND parity IN ('all', $2)`, ov.Weekday, *ov.Parity)
	} else {
		ov.Classes, err = s.queryClasses(r, `AND weekday = $1`, ov.Weekday)
	}
	if err != nil {
		return err
	}

	ctx := r.Context()
	ov.Tasks = []Task{}
	rows, err := s.q(r).QueryContext(ctx, `SELECT `+taskCols+` FROM tasks WHERE due_date = $1 AND user_id = app_uid()
		ORDER BY done, due_time NULLS LAST, priority, id`, date)
	if err != nil {
		return err
	}
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			rows.Close()
			return err
		}
		ov.Tasks = append(ov.Tasks, t)
	}
	rows.Close()

	if ov.Food, err = s.queryFood(r, date, date); err != nil {
		return err
	}

	ov.Workouts = []Workout{}
	rows, err = s.q(r).QueryContext(ctx, `SELECT `+workoutCols+` FROM workouts WHERE workout_date = $1 AND user_id = app_uid() ORDER BY id`, date)
	if err != nil {
		return err
	}
	for rows.Next() {
		wk, err := scanWorkout(rows)
		if err != nil {
			rows.Close()
			return err
		}
		ov.Workouts = append(ov.Workouts, wk)
	}
	rows.Close()

	if err := s.q(r).QueryRowContext(ctx, `SELECT COALESCE(sum(minutes), 0) FROM study_sessions
		WHERE session_date = $1 AND user_id = app_uid()`, date).Scan(&ov.StudyMinutes); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, ov)
	return nil
}

// ---------- Сводка месяца для календаря ----------

type CalendarDay struct {
	Date         string `json:"date"`
	TasksOpen    int    `json:"tasks_open"`
	TasksDone    int    `json:"tasks_done"`
	Workouts     int    `json:"workouts"`
	FoodEntries  int    `json:"food_entries"`
	StudyMinutes int    `json:"study_minutes"`
}

// GET /api/calendar?month=YYYY-MM
func (s *Server) calendarMonth(w http.ResponseWriter, r *http.Request) error {
	month := r.URL.Query().Get("month")
	if month == "" {
		month = time.Now().Format("2006-01")
	}
	first, err := time.Parse("2006-01", month)
	if err != nil {
		return badRequest("month must be in YYYY-MM format")
	}
	from := first.Format(dateLayout)
	to := first.AddDate(0, 1, -1).Format(dateLayout)

	rows, err := s.q(r).QueryContext(r.Context(), `
		WITH days AS (SELECT d::date AS day FROM generate_series($1::date, $2::date, interval '1 day') d)
		SELECT day::text,
			(SELECT count(*) FROM tasks t WHERE t.due_date = day AND NOT t.done AND t.user_id = app_uid()),
			(SELECT count(*) FROM tasks t WHERE t.due_date = day AND t.done AND t.user_id = app_uid()),
			(SELECT count(*) FROM workouts wk WHERE wk.workout_date = day AND wk.user_id = app_uid()),
			(SELECT count(*) FROM food_entries f WHERE f.entry_date = day AND f.user_id = app_uid()),
			(SELECT COALESCE(sum(minutes), 0) FROM study_sessions ss WHERE ss.session_date = day AND ss.user_id = app_uid())
		FROM days ORDER BY day`, from, to)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []CalendarDay{}
	for rows.Next() {
		var c CalendarDay
		if err := rows.Scan(&c.Date, &c.TasksOpen, &c.TasksDone, &c.Workouts, &c.FoodEntries, &c.StudyMinutes); err != nil {
			return err
		}
		out = append(out, c)
	}
	writeJSON(w, http.StatusOK, out)
	return rows.Err()
}

// ---------- Инфраструктура ----------

func init() {
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

func spaHandler(dir string) http.Handler {
	fileServer := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(dir, filepath.Clean("/"+r.URL.Path))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				// Имена файлов сборки содержат хэш — их можно кешировать навсегда
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "no-cache")
			}
			fileServer.ServeHTTP(w, r)
			return
		}
		// Неизвестный путь или корень — отдаём index.html, дальше маршрутизирует React.
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}

// securityHeaders — базовые заголовки безопасности для всех ответов.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "same-origin")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		defer func() {
			if p := recover(); p != nil {
				log.Printf("panic: %v", p)
				http.Error(rec, "internal error", http.StatusInternalServerError)
			}
			if strings.HasPrefix(r.URL.Path, "/api/") {
				log.Printf("%s %s %d %s", r.Method, r.URL.RequestURI(), rec.status, time.Since(start).Round(time.Millisecond))
			}
		}()
		next.ServeHTTP(rec, r)
	})
}
