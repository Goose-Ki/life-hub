package api

import (
	"database/sql"
	"net/http"
	"strings"
	"time"
)

// ---------- Расписание пар ----------

type Class struct {
	ID        int64  `json:"id"`
	Weekday   int    `json:"weekday"` // 1 = понедельник … 7 = воскресенье
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
	Subject   string `json:"subject"`
	Kind      string `json:"kind"`
	Room      string `json:"room"`
	Teacher   string `json:"teacher"`
	Parity    string `json:"parity"` // all | odd | even
}

type classInput struct {
	Weekday   int    `json:"weekday"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
	Subject   string `json:"subject"`
	Kind      string `json:"kind"`
	Room      string `json:"room"`
	Teacher   string `json:"teacher"`
	Parity    string `json:"parity"`
}

func (in *classInput) validate() error {
	if in.Weekday < 1 || in.Weekday > 7 {
		return badRequest("weekday must be between 1 (Mon) and 7 (Sun)")
	}
	if err := requireTime(in.StartTime, "start_time"); err != nil {
		return err
	}
	if err := requireTime(in.EndTime, "end_time"); err != nil {
		return err
	}
	if in.EndTime <= in.StartTime {
		return badRequest("end_time must be after start_time")
	}
	subj, err := requireText(in.Subject, "subject")
	if err != nil {
		return err
	}
	in.Subject = subj
	in.Kind, in.Room, in.Teacher = strings.TrimSpace(in.Kind), strings.TrimSpace(in.Room), strings.TrimSpace(in.Teacher)
	if in.Parity == "" {
		in.Parity = "all"
	}
	if in.Parity != "all" && in.Parity != "odd" && in.Parity != "even" {
		return badRequest("parity must be all, odd or even")
	}
	return nil
}

const classCols = `id, weekday, to_char(start_time, 'HH24:MI'), to_char(end_time, 'HH24:MI'), subject, kind, room, teacher, parity`

func scanClass(sc interface{ Scan(...any) error }) (Class, error) {
	var c Class
	err := sc.Scan(&c.ID, &c.Weekday, &c.StartTime, &c.EndTime, &c.Subject, &c.Kind, &c.Room, &c.Teacher, &c.Parity)
	return c, err
}

func (s *Server) queryClasses(r *http.Request, where string, args ...any) ([]Class, error) {
	// where — дополнительное условие вида "AND …"; пары всегда только текущего пользователя.
	rows, err := s.q(r).QueryContext(r.Context(), `SELECT `+classCols+` FROM classes WHERE user_id = app_uid() `+where+
		` ORDER BY weekday, start_time, id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Class{}
	for rows.Next() {
		c, err := scanClass(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Server) listClasses(w http.ResponseWriter, r *http.Request) error {
	out, err := s.queryClasses(r, "")
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

func (s *Server) createClass(w http.ResponseWriter, r *http.Request) error {
	var in classInput
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if err := in.validate(); err != nil {
		return err
	}
	c, err := scanClass(s.q(r).QueryRowContext(r.Context(), `INSERT INTO classes
		(weekday, start_time, end_time, subject, kind, room, teacher, parity)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING `+classCols,
		in.Weekday, in.StartTime, in.EndTime, in.Subject, in.Kind, in.Room, in.Teacher, in.Parity))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, c)
	return nil
}

func (s *Server) updateClass(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var in classInput
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if err := in.validate(); err != nil {
		return err
	}
	c, err := scanClass(s.q(r).QueryRowContext(r.Context(), `UPDATE classes SET
		weekday = $1, start_time = $2, end_time = $3, subject = $4, kind = $5, room = $6, teacher = $7, parity = $8
		WHERE id = $9 AND user_id = app_uid() RETURNING `+classCols,
		in.Weekday, in.StartTime, in.EndTime, in.Subject, in.Kind, in.Room, in.Teacher, in.Parity, id))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, c)
	return nil
}

func (s *Server) deleteClass(w http.ResponseWriter, r *http.Request) error {
	return s.deleteByID(w, r, "classes")
}

// weekInfo возвращает номер учебной недели и её чётность относительно даты начала семестра.
// Если дата начала не задана или день раньше начала семестра — nil.
func weekInfo(day time.Time, semesterStart string) (*int, *string) {
	start, err := time.Parse(dateLayout, semesterStart)
	if err != nil {
		return nil, nil
	}
	monday := func(t time.Time) time.Time {
		wd := (int(t.Weekday()) + 6) % 7 // пн = 0
		return time.Date(t.Year(), t.Month(), t.Day()-wd, 0, 0, 0, 0, time.UTC)
	}
	days := int(monday(day).Sub(monday(start)).Hours() / 24)
	if days < 0 {
		return nil, nil
	}
	n := days/7 + 1
	parity := "even"
	if n%2 == 1 {
		parity = "odd"
	}
	return &n, &parity
}

// ---------- План самообучения ----------

type Topic struct {
	ID           int64    `json:"id"`
	Title        string   `json:"title"`
	Description  string   `json:"description"`
	Deadline     *string  `json:"deadline"`
	Status       string   `json:"status"`
	TargetHours  *float64 `json:"target_hours"`
	Area         string   `json:"area"`
	SpentMinutes int      `json:"spent_minutes"`
}

type topicInput struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Deadline    *string  `json:"deadline"`
	Status      string   `json:"status"`
	TargetHours *float64 `json:"target_hours"`
	Area        string   `json:"area"`
}

func (in *topicInput) validate() error {
	t, err := requireText(in.Title, "title")
	if err != nil {
		return err
	}
	in.Title = t
	in.Description = strings.TrimSpace(in.Description)
	if in.Deadline, err = optDate(in.Deadline, "deadline"); err != nil {
		return err
	}
	if in.Status == "" {
		in.Status = "todo"
	}
	if in.Status != "todo" && in.Status != "in_progress" && in.Status != "done" {
		return badRequest("status must be todo, in_progress or done")
	}
	if in.TargetHours != nil && (*in.TargetHours <= 0 || *in.TargetHours > 10000) {
		return badRequest("target_hours must be positive")
	}
	return validateArea(&in.Area)
}

const topicSelect = `SELECT t.id, t.title, t.description, t.deadline::text, t.status, t.target_hours::float8, t.area,
	COALESCE((SELECT sum(minutes) FROM study_sessions s WHERE s.topic_id = t.id), 0)
	FROM study_topics t WHERE t.user_id = app_uid()`

func scanTopic(sc interface{ Scan(...any) error }) (Topic, error) {
	var t Topic
	var dl sql.NullString
	var th sql.NullFloat64
	err := sc.Scan(&t.ID, &t.Title, &t.Description, &dl, &t.Status, &th, &t.Area, &t.SpentMinutes)
	t.Deadline = nullStr(dl)
	if th.Valid {
		t.TargetHours = &th.Float64
	}
	return t, err
}

func (s *Server) getTopic(r *http.Request, id int64) (Topic, error) {
	return scanTopic(s.q(r).QueryRowContext(r.Context(), topicSelect+` AND t.id = $1`, id))
}

func (s *Server) listTopics(w http.ResponseWriter, r *http.Request) error {
	rows, err := s.q(r).QueryContext(r.Context(), topicSelect+`
		ORDER BY array_position(ARRAY['in_progress','todo','done'], t.status), t.deadline NULLS LAST, t.id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []Topic{}
	for rows.Next() {
		t, err := scanTopic(rows)
		if err != nil {
			return err
		}
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, out)
	return rows.Err()
}

func (s *Server) createTopic(w http.ResponseWriter, r *http.Request) error {
	var in topicInput
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if err := in.validate(); err != nil {
		return err
	}
	var id int64
	if err := s.q(r).QueryRowContext(r.Context(), `INSERT INTO study_topics
		(title, description, deadline, status, target_hours, area, done_at)
		VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $4 = 'done' THEN now() END) RETURNING id`,
		in.Title, in.Description, in.Deadline, in.Status, in.TargetHours, in.Area).Scan(&id); err != nil {
		return err
	}
	t, err := s.getTopic(r, id)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, t)
	return nil
}

func (s *Server) updateTopic(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var in topicInput
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if err := in.validate(); err != nil {
		return err
	}
	res, err := s.q(r).ExecContext(r.Context(), `UPDATE study_topics SET
		title = $1, description = $2, deadline = $3, status = $4, target_hours = $5, area = $6,
		done_at = CASE WHEN $4 = 'done' THEN COALESCE(done_at, now()) END
		WHERE id = $7 AND user_id = app_uid()`,
		in.Title, in.Description, in.Deadline, in.Status, in.TargetHours, in.Area, id)
	if err != nil {
		return err
	}
	if err := mustAffect(res); err != nil {
		return err
	}
	t, err := s.getTopic(r, id)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, t)
	return nil
}

func (s *Server) deleteTopic(w http.ResponseWriter, r *http.Request) error {
	return s.deleteByID(w, r, "study_topics")
}

// ---------- Учёт времени учёбы ----------

type Session struct {
	ID         int64   `json:"id"`
	TopicID    *int64  `json:"topic_id"`
	TopicTitle *string `json:"topic_title"`
	Date       string  `json:"date"`
	Minutes    int     `json:"minutes"`
	Note       string  `json:"note"`
}

type sessionInput struct {
	TopicID *int64 `json:"topic_id"`
	Date    string `json:"date"`
	Minutes int    `json:"minutes"`
	Note    string `json:"note"`
}

const sessionSelect = `SELECT s.id, s.topic_id, t.title, s.session_date::text, s.minutes, s.note
	FROM study_sessions s LEFT JOIN study_topics t ON t.id = s.topic_id
	WHERE s.user_id = app_uid()`

func scanSession(sc interface{ Scan(...any) error }) (Session, error) {
	var ss Session
	var tid sql.NullInt64
	var title sql.NullString
	err := sc.Scan(&ss.ID, &tid, &title, &ss.Date, &ss.Minutes, &ss.Note)
	if tid.Valid {
		ss.TopicID = &tid.Int64
	}
	ss.TopicTitle = nullStr(title)
	return ss, err
}

func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) error {
	from, to, err := dateRange(r, 30)
	if err != nil {
		return err
	}
	rows, err := s.q(r).QueryContext(r.Context(), sessionSelect+`
		AND s.session_date BETWEEN $1 AND $2 ORDER BY s.session_date DESC, s.id DESC`, from, to)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		ss, err := scanSession(rows)
		if err != nil {
			return err
		}
		out = append(out, ss)
	}
	writeJSON(w, http.StatusOK, out)
	return rows.Err()
}

func (s *Server) createSession(w http.ResponseWriter, r *http.Request) error {
	var in sessionInput
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if err := requireDate(in.Date, "date"); err != nil {
		return err
	}
	if in.Minutes <= 0 || in.Minutes > 1440 {
		return badRequest("minutes must be between 1 and 1440")
	}
	if in.TopicID != nil {
		var exists bool
		if err := s.q(r).QueryRowContext(r.Context(),
			`SELECT EXISTS (SELECT 1 FROM study_topics WHERE id = $1 AND user_id = app_uid())`, *in.TopicID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return badRequest("topic not found")
		}
	}
	var id int64
	if err := s.q(r).QueryRowContext(r.Context(), `INSERT INTO study_sessions (topic_id, session_date, minutes, note)
		VALUES ($1, $2, $3, $4) RETURNING id`, in.TopicID, in.Date, in.Minutes, strings.TrimSpace(in.Note)).Scan(&id); err != nil {
		return err
	}
	ss, err := scanSession(s.q(r).QueryRowContext(r.Context(), sessionSelect+` AND s.id = $1`, id))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, ss)
	return nil
}

func (s *Server) deleteSession(w http.ResponseWriter, r *http.Request) error {
	return s.deleteByID(w, r, "study_sessions")
}

type DayMinutes struct {
	Date    string `json:"date"`
	Minutes int    `json:"minutes"`
}

// GET /api/study/stats?from=&to= — минуты учёбы по дням (дни без учёбы = 0).
func (s *Server) studyStats(w http.ResponseWriter, r *http.Request) error {
	from, to, err := dateRange(r, 14)
	if err != nil {
		return err
	}
	rows, err := s.q(r).QueryContext(r.Context(), `SELECT d::date::text, COALESCE(sum(s.minutes), 0)
		FROM generate_series($1::date, $2::date, interval '1 day') AS d
		LEFT JOIN study_sessions s ON s.session_date = d::date AND s.user_id = app_uid()
		GROUP BY d ORDER BY d`, from, to)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []DayMinutes{}
	for rows.Next() {
		var dm DayMinutes
		if err := rows.Scan(&dm.Date, &dm.Minutes); err != nil {
			return err
		}
		out = append(out, dm)
	}
	writeJSON(w, http.StatusOK, out)
	return rows.Err()
}
