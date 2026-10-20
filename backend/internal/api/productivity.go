package api

import (
	"math"
	"net/http"
)

// Балл продуктивности дня (0–100) складывается из трёх частей:
//   - задачи      — до 40: доля выполненных задач, запланированных на этот день;
//   - учёба       — до 40: минуты учёбы относительно дневной цели (не больше 100%);
//   - тренировка  — 20, если в этот день была хотя бы одна тренировка.
//
// Если на день не было задач, эта часть не учитывается, а остальные
// пересчитываются к 100 — день без задач не штрафуется.
const (
	weightTasks   = 40.0
	weightStudy   = 40.0
	weightWorkout = 20.0
)

type ProductivityParts struct {
	Tasks   float64 `json:"tasks"`
	Study   float64 `json:"study"`
	Workout float64 `json:"workout"`
}

type ProductivityDay struct {
	Date         string            `json:"date"`
	Score        int               `json:"score"`
	Parts        ProductivityParts `json:"parts"` // вклад каждой части в балл; в сумме = score
	TasksPlanned int               `json:"tasks_planned"`
	TasksDone    int               `json:"tasks_done"`
	StudyMinutes int               `json:"study_minutes"`
	Workouts     int               `json:"workouts"`
}

type ProductivityResponse struct {
	StudyGoalMin int               `json:"study_goal_min"`
	Days         []ProductivityDay `json:"days"`
}

func scoreDay(d *ProductivityDay, goalMin int) {
	possible := weightStudy + weightWorkout
	var tasks, study, workout float64
	if d.TasksPlanned > 0 {
		possible += weightTasks
		tasks = weightTasks * float64(d.TasksDone) / float64(d.TasksPlanned)
	}
	study = weightStudy * math.Min(1, float64(d.StudyMinutes)/float64(goalMin))
	if d.Workouts > 0 {
		workout = weightWorkout
	}
	k := 100 / possible
	round1 := func(x float64) float64 { return math.Round(x*10) / 10 }
	d.Parts = ProductivityParts{Tasks: round1(tasks * k), Study: round1(study * k), Workout: round1(workout * k)}
	d.Score = int(math.Round((tasks + study + workout) * k))
}

// GET /api/productivity?from=&to= — балл продуктивности по дням (по умолчанию 14 дней).
func (s *Server) productivity(w http.ResponseWriter, r *http.Request) error {
	from, to, err := dateRange(r, 14)
	if err != nil {
		return err
	}
	st, err := s.loadSettings(r)
	if err != nil {
		return err
	}
	rows, err := s.q(r).QueryContext(r.Context(), `
		WITH days AS (SELECT d::date AS day FROM generate_series($1::date, $2::date, interval '1 day') d)
		SELECT day::text,
			(SELECT count(*) FROM tasks t WHERE t.due_date = day AND t.user_id = app_uid()),
			(SELECT count(*) FROM tasks t WHERE t.due_date = day AND t.done AND t.user_id = app_uid()),
			(SELECT COALESCE(sum(minutes), 0) FROM study_sessions ss WHERE ss.session_date = day AND ss.user_id = app_uid()),
			(SELECT count(*) FROM workouts wk WHERE wk.workout_date = day AND wk.user_id = app_uid())
		FROM days ORDER BY day`, from, to)
	if err != nil {
		return err
	}
	defer rows.Close()
	resp := ProductivityResponse{StudyGoalMin: st.StudyGoalMin, Days: []ProductivityDay{}}
	for rows.Next() {
		var d ProductivityDay
		if err := rows.Scan(&d.Date, &d.TasksPlanned, &d.TasksDone, &d.StudyMinutes, &d.Workouts); err != nil {
			return err
		}
		scoreDay(&d, st.StudyGoalMin)
		resp.Days = append(resp.Days, d)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, resp)
	return nil
}
