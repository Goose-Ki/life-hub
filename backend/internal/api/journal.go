package api

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

// ---------- Дневник питания ----------

type FoodEntry struct {
	ID        int64  `json:"id"`
	Date      string `json:"date"`
	Time      string `json:"time"` // HH:MM — когда ел
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

type foodInput struct {
	Date    string `json:"date"`
	Time    string `json:"time"`
	Content string `json:"content"`
}

func (in *foodInput) validate() error {
	if err := requireDate(in.Date, "date"); err != nil {
		return err
	}
	if err := requireTime(in.Time, "time"); err != nil {
		return err
	}
	c, err := requireText(in.Content, "content")
	in.Content = c
	return err
}

const foodCols = `id, entry_date::text, to_char(eaten_at, 'HH24:MI'), content, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF')`

func scanFood(sc interface{ Scan(...any) error }) (FoodEntry, error) {
	var e FoodEntry
	err := sc.Scan(&e.ID, &e.Date, &e.Time, &e.Content, &e.CreatedAt)
	return e, err
}

// queryFood — записи за период, по дням (новые сверху) и по времени внутри дня.
func (s *Server) queryFood(r *http.Request, from, to string) ([]FoodEntry, error) {
	rows, err := s.q(r).QueryContext(r.Context(), `SELECT `+foodCols+` FROM food_entries
		WHERE entry_date BETWEEN $1 AND $2 AND user_id = app_uid()
		ORDER BY entry_date DESC, eaten_at, id`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FoodEntry{}
	for rows.Next() {
		e, err := scanFood(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Server) listFood(w http.ResponseWriter, r *http.Request) error {
	from, to, err := dateRange(r, 30)
	if err != nil {
		return err
	}
	out, err := s.queryFood(r, from, to)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

func (s *Server) createFood(w http.ResponseWriter, r *http.Request) error {
	var in foodInput
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if err := in.validate(); err != nil {
		return err
	}
	e, err := scanFood(s.q(r).QueryRowContext(r.Context(), `INSERT INTO food_entries (entry_date, eaten_at, content)
		VALUES ($1, $2, $3) RETURNING `+foodCols, in.Date, in.Time, in.Content))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, e)
	return nil
}

func (s *Server) updateFood(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var in foodInput
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if err := in.validate(); err != nil {
		return err
	}
	e, err := scanFood(s.q(r).QueryRowContext(r.Context(), `UPDATE food_entries SET entry_date = $1, eaten_at = $2, content = $3
		WHERE id = $4 AND user_id = app_uid() RETURNING `+foodCols, in.Date, in.Time, in.Content, id))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, e)
	return nil
}

func (s *Server) deleteFood(w http.ResponseWriter, r *http.Request) error {
	return s.deleteByID(w, r, "food_entries")
}

// ---------- Дневник тренировок ----------

type Workout struct {
	ID          int64  `json:"id"`
	Date        string `json:"date"`
	Kind        string `json:"kind"`
	DurationMin *int   `json:"duration_min"`
	Note        string `json:"note"`
}

type workoutInput struct {
	Date        string `json:"date"`
	Kind        string `json:"kind"`
	DurationMin *int   `json:"duration_min"`
	Note        string `json:"note"`
}

func (in *workoutInput) validate() error {
	if err := requireDate(in.Date, "date"); err != nil {
		return err
	}
	k, err := requireText(in.Kind, "kind")
	if err != nil {
		return err
	}
	in.Kind = k
	in.Note = strings.TrimSpace(in.Note)
	if in.DurationMin != nil && (*in.DurationMin <= 0 || *in.DurationMin > 1440) {
		return badRequest("duration_min must be between 1 and 1440")
	}
	return nil
}

const workoutCols = `id, workout_date::text, kind, duration_min, note`

func scanWorkout(sc interface{ Scan(...any) error }) (Workout, error) {
	var wk Workout
	var dur *int
	err := sc.Scan(&wk.ID, &wk.Date, &wk.Kind, &dur, &wk.Note)
	wk.DurationMin = dur
	return wk, err
}

func (s *Server) listWorkouts(w http.ResponseWriter, r *http.Request) error {
	from, to, err := dateRange(r, 90)
	if err != nil {
		return err
	}
	rows, err := s.q(r).QueryContext(r.Context(), `SELECT `+workoutCols+` FROM workouts
		WHERE workout_date BETWEEN $1 AND $2 AND user_id = app_uid() ORDER BY workout_date DESC, id DESC`, from, to)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []Workout{}
	for rows.Next() {
		wk, err := scanWorkout(rows)
		if err != nil {
			return err
		}
		out = append(out, wk)
	}
	writeJSON(w, http.StatusOK, out)
	return rows.Err()
}

func (s *Server) createWorkout(w http.ResponseWriter, r *http.Request) error {
	var in workoutInput
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if err := in.validate(); err != nil {
		return err
	}
	wk, err := scanWorkout(s.q(r).QueryRowContext(r.Context(), `INSERT INTO workouts (workout_date, kind, duration_min, note)
		VALUES ($1, $2, $3, $4) RETURNING `+workoutCols, in.Date, in.Kind, in.DurationMin, in.Note))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, wk)
	return nil
}

func (s *Server) updateWorkout(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var in workoutInput
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if err := in.validate(); err != nil {
		return err
	}
	wk, err := scanWorkout(s.q(r).QueryRowContext(r.Context(), `UPDATE workouts
		SET workout_date = $1, kind = $2, duration_min = $3, note = $4
		WHERE id = $5 AND user_id = app_uid() RETURNING `+workoutCols, in.Date, in.Kind, in.DurationMin, in.Note, id))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, wk)
	return nil
}

func (s *Server) deleteWorkout(w http.ResponseWriter, r *http.Request) error {
	return s.deleteByID(w, r, "workouts")
}

// Список уже использованных видов тренировок — для подсказок в форме.
func (s *Server) workoutKinds(w http.ResponseWriter, r *http.Request) error {
	rows, err := s.q(r).QueryContext(r.Context(), `SELECT kind FROM workouts WHERE user_id = app_uid()
		GROUP BY kind ORDER BY count(*) DESC, kind LIMIT 30`)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return err
		}
		out = append(out, k)
	}
	writeJSON(w, http.StatusOK, out)
	return rows.Err()
}

// ---------- Экспорт дневника питания в Excel ----------

var weekdaysRU = [...]string{"Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"}

// GET /api/food/export?from=&to= — .xlsx с двумя листами: «Записи» и «По дням».
// Без параметров выгружается весь дневник.
func (s *Server) exportFood(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	from, to := q.Get("from"), q.Get("to")
	if from == "" {
		from = "0001-01-01"
	}
	if to == "" {
		to = "9999-12-31"
	}
	if !isDate(from) || !isDate(to) {
		return badRequest("from/to must be dates in YYYY-MM-DD format")
	}
	if from > to {
		return badRequest("from must not be after to")
	}

	rows, err := s.q(r).QueryContext(r.Context(), `SELECT entry_date::text, to_char(eaten_at, 'HH24:MI'), content
		FROM food_entries WHERE entry_date BETWEEN $1 AND $2 AND user_id = app_uid()
		ORDER BY entry_date, eaten_at, id`, from, to)
	if err != nil {
		return err
	}
	defer rows.Close()

	entries := xlsxSheet{
		Name:   "Записи",
		Header: []string{"Дата", "День недели", "Время", "Что съел"},
		Widths: []float64{12, 14, 9, 80},
	}
	byDay := xlsxSheet{
		Name:   "По дням",
		Header: []string{"Дата", "День недели", "Приёмов пищи", "Первый", "Последний", "Что ел за день"},
		Widths: []float64{12, 14, 14, 10, 11, 90},
	}

	type day struct {
		date  string
		times []string
		lines []string
	}
	var (
		cur         *day
		first, last string
	)
	flushDay := func() {
		if cur == nil {
			return
		}
		d, _ := time.Parse(dateLayout, cur.date)
		byDay.Rows = append(byDay.Rows, []xlsxCell{
			{d, styleDate}, {weekdaysRU[d.Weekday()], styleTop}, {len(cur.lines), styleTop},
			{xlsxClock(cur.times[0]), styleTime}, {xlsxClock(cur.times[len(cur.times)-1]), styleTime},
			{strings.Join(cur.lines, "\n"), styleWrap},
		})
	}

	for rows.Next() {
		var date, clock, content string
		if err := rows.Scan(&date, &clock, &content); err != nil {
			return err
		}
		if first == "" {
			first = date
		}
		last = date
		d, _ := time.Parse(dateLayout, date)
		entries.Rows = append(entries.Rows, []xlsxCell{
			{d, styleDate}, {weekdaysRU[d.Weekday()], styleTop}, {xlsxClock(clock), styleTime}, {content, styleWrap},
		})
		if cur == nil || cur.date != date {
			flushDay()
			cur = &day{date: date}
		}
		cur.times = append(cur.times, clock)
		// В сводке дня одна запись — одна строка: переносы внутри записи заменяем запятыми.
		oneLine := strings.Join(strings.Fields(strings.ReplaceAll(content, "\n", ", ")), " ")
		cur.lines = append(cur.lines, clock+" — "+oneLine)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	flushDay()

	name := "food-diary.xlsx"
	if first != "" {
		name = fmt.Sprintf("food-diary_%s_%s.xlsx", first, last)
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("Cache-Control", "no-store")
	return writeXLSX(w, []xlsxSheet{entries, byDay})
}
