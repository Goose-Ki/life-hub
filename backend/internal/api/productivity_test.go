package api

import "testing"

func TestScoreDay(t *testing.T) {
	cases := []struct {
		name  string
		day   ProductivityDay
		score int
	}{
		{"пустой день", ProductivityDay{}, 0},
		{"всё сделано", ProductivityDay{TasksPlanned: 2, TasksDone: 2, StudyMinutes: 120, Workouts: 1}, 100},
		{"без задач, цель по учёбе и тренировка", ProductivityDay{StudyMinutes: 200, Workouts: 1}, 100},
		{"без задач, только половина учёбы", ProductivityDay{StudyMinutes: 60}, 33},
		{"половина задач, без учёбы", ProductivityDay{TasksPlanned: 4, TasksDone: 2}, 20},
		{"только тренировка при задачах", ProductivityDay{TasksPlanned: 1, Workouts: 1}, 20},
	}
	for _, c := range cases {
		d := c.day
		scoreDay(&d, 120)
		if d.Score != c.score {
			t.Errorf("%s: score = %d, want %d", c.name, d.Score, c.score)
		}
		sum := d.Parts.Tasks + d.Parts.Study + d.Parts.Workout
		if diff := sum - float64(d.Score); diff > 0.6 || diff < -0.6 {
			t.Errorf("%s: parts sum %.1f != score %d", c.name, sum, d.Score)
		}
	}
}
