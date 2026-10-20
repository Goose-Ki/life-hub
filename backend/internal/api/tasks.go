package api

import (
	"database/sql"
	"net/http"
	"strings"
)

type Task struct {
	ID       int64   `json:"id"`
	Title    string  `json:"title"`
	Notes    string  `json:"notes"`
	DueDate  *string `json:"due_date"`
	DueTime  *string `json:"due_time"`
	Priority int     `json:"priority"`
	Done     bool    `json:"done"`
}

type taskInput struct {
	Title    string  `json:"title"`
	Notes    string  `json:"notes"`
	DueDate  *string `json:"due_date"`
	DueTime  *string `json:"due_time"`
	Priority int     `json:"priority"`
	Done     bool    `json:"done"`
}

func (in *taskInput) validate() error {
	t, err := requireText(in.Title, "title")
	if err != nil {
		return err
	}
	in.Title = t
	in.Notes = strings.TrimSpace(in.Notes)
	if in.DueDate, err = optDate(in.DueDate, "due_date"); err != nil {
		return err
	}
	if in.DueTime, err = optTime(in.DueTime, "due_time"); err != nil {
		return err
	}
	if in.DueTime != nil && in.DueDate == nil {
		return badRequest("due_time requires due_date")
	}
	if in.Priority == 0 {
		in.Priority = 2
	}
	if in.Priority < 1 || in.Priority > 3 {
		return badRequest("priority must be 1 (high), 2 (normal) or 3 (low)")
	}
	return nil
}

const taskCols = `id, title, notes, due_date::text, to_char(due_time, 'HH24:MI'), priority, done`

func scanTask(sc interface{ Scan(...any) error }) (Task, error) {
	var t Task
	var dd, dt sql.NullString
	err := sc.Scan(&t.ID, &t.Title, &t.Notes, &dd, &dt, &t.Priority, &t.Done)
	t.DueDate, t.DueTime = nullStr(dd), nullStr(dt)
	return t, err
}

// GET /api/tasks?from=&to=      — задачи с датой в диапазоне
// GET /api/tasks?undated=true   — задачи без даты
// GET /api/tasks?overdue=true   — невыполненные задачи с прошедшей датой
func (s *Server) listTasks(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	var (
		rows *sql.Rows
		err  error
	)
	order := ` ORDER BY due_date NULLS LAST, done, due_time NULLS LAST, priority, id`
	switch {
	case q.Get("undated") == "true":
		rows, err = s.q(r).QueryContext(r.Context(), `SELECT `+taskCols+` FROM tasks WHERE due_date IS NULL AND user_id = app_uid()`+order)
	case q.Get("overdue") == "true":
		rows, err = s.q(r).QueryContext(r.Context(), `SELECT `+taskCols+` FROM tasks
			WHERE NOT done AND due_date < CURRENT_DATE AND user_id = app_uid()`+order)
	default:
		from, to, rerr := dateRange(r, 31)
		if rerr != nil {
			return rerr
		}
		rows, err = s.q(r).QueryContext(r.Context(), `SELECT `+taskCols+` FROM tasks
			WHERE due_date BETWEEN $1 AND $2 AND user_id = app_uid()`+order, from, to)
	}
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []Task{}
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return err
		}
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, out)
	return rows.Err()
}

func (s *Server) createTask(w http.ResponseWriter, r *http.Request) error {
	var in taskInput
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if err := in.validate(); err != nil {
		return err
	}
	t, err := scanTask(s.q(r).QueryRowContext(r.Context(), `INSERT INTO tasks
		(title, notes, due_date, due_time, priority, done, done_at)
		VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 THEN now() END)
		RETURNING `+taskCols, in.Title, in.Notes, in.DueDate, in.DueTime, in.Priority, in.Done))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, t)
	return nil
}

func (s *Server) updateTask(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var in taskInput
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if err := in.validate(); err != nil {
		return err
	}
	t, err := scanTask(s.q(r).QueryRowContext(r.Context(), `UPDATE tasks SET
		title = $1, notes = $2, due_date = $3, due_time = $4, priority = $5, done = $6,
		done_at = CASE WHEN $6 THEN COALESCE(done_at, now()) END
		WHERE id = $7 AND user_id = app_uid() RETURNING `+taskCols, in.Title, in.Notes, in.DueDate, in.DueTime, in.Priority, in.Done, id))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, t)
	return nil
}

// PATCH /api/tasks/{id}/toggle — отметить выполненной / вернуть в работу.
func (s *Server) toggleTask(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	t, err := scanTask(s.q(r).QueryRowContext(r.Context(), `UPDATE tasks SET
		done = NOT done, done_at = CASE WHEN done THEN NULL ELSE now() END
		WHERE id = $1 AND user_id = app_uid() RETURNING `+taskCols, id))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, t)
	return nil
}

func (s *Server) deleteTask(w http.ResponseWriter, r *http.Request) error {
	return s.deleteByID(w, r, "tasks")
}
