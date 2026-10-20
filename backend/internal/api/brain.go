package api

import (
	"math"
	"net/http"
	"sort"
)

// «Мозг» — игровая визуализация развития. Опыт (XP) начисляется за:
//
//	1 минута учёбы            = 1 XP   (в зону области темы; без темы — «Логика»)
//	изученный навык (тема ✓)  = 150 XP
//	прочитанная книга         = 100 + страницы/2 XP (если страниц нет — 150)
//	книга в процессе          = прочитанные страницы/2 XP
//	выполненная задача        = 10 XP  (лобная доля — дисциплина)
//	тренировка                = 30 XP + 1 XP за каждые 2 минуты (мозжечок — тело)
const (
	xpPerStudyMinute = 1
	xpSkill          = 150
	xpBookBase       = 100
	xpBookNoPages    = 150
	xpTask           = 10
	xpWorkout        = 30
)

type zoneDef struct{ Key, Name, Desc string }

// Порядок зон фиксирован — фронтенд опирается на ключи.
var zoneDefs = []zoneDef{
	{"frontal", "Лобная доля", "Дисциплина и саморазвитие"},
	{"parietal", "Теменная доля", "Логика, наука и технологии"},
	{"temporal", "Височная доля", "Языки и гуманитарные знания"},
	{"occipital", "Затылочная доля", "Творчество и визуальное мышление"},
	{"cerebellum", "Мозжечок", "Тело и движение"},
}

var areaZone = map[string]string{"self": "frontal", "logic": "parietal", "humanities": "temporal", "creative": "occipital"}

var levelTitles = []struct {
	From  int
	Title string
}{
	{1, "Новичок"}, {3, "Ученик"}, {5, "Исследователь"}, {8, "Знаток"},
	{12, "Эксперт"}, {17, "Мастер"}, {23, "Гуру"}, {30, "Гений"},
}

// levelFor: уровень растёт по корню из опыта — каждый следующий даётся чуть тяжелее.
// step — сколько XP нужно на 2-й уровень (уровень L начинается с step*(L-1)^2).
func levelFor(xp, step int) (level, start, next int) {
	level = int(math.Sqrt(float64(xp)/float64(step))) + 1
	start = step * (level - 1) * (level - 1)
	next = step * level * level
	return
}

func titleFor(level int) string {
	t := levelTitles[0].Title
	for _, lt := range levelTitles {
		if level >= lt.From {
			t = lt.Title
		}
	}
	return t
}

type XPSource struct {
	Label string `json:"label"`
	XP    int    `json:"xp"`
}

type BrainZone struct {
	Key       string     `json:"key"`
	Name      string     `json:"name"`
	Desc      string     `json:"desc"`
	XP        int        `json:"xp"`
	Level     int        `json:"level"`
	LevelFrom int        `json:"level_from"`
	LevelTo   int        `json:"level_to"`
	Sources   []XPSource `json:"sources"`
}

type Achievement struct {
	Kind  string `json:"kind"` // skill | book
	Title string `json:"title"`
	Zone  string `json:"zone"`
	XP    int    `json:"xp"`
	Date  string `json:"date"`
}

type BrainStats struct {
	StudyMinutes int `json:"study_minutes"`
	Skills       int `json:"skills"`
	BooksDone    int `json:"books_done"`
	BooksReading int `json:"books_reading"`
	PagesRead    int `json:"pages_read"`
	TasksDone    int `json:"tasks_done"`
	Workouts     int `json:"workouts"`
}

type BrainResponse struct {
	TotalXP      int           `json:"total_xp"`
	Level        int           `json:"level"`
	Title        string        `json:"title"`
	LevelFrom    int           `json:"level_from"`
	LevelTo      int           `json:"level_to"`
	Zones        []BrainZone   `json:"zones"`
	Achievements []Achievement `json:"achievements"`
	Stats        BrainStats    `json:"stats"`
}

// brainCalc собирает опыт по зонам; отделён от БД, чтобы его можно было тестировать.
type brainCalc struct {
	zones map[string]*BrainZone
	resp  BrainResponse
}

func newBrainCalc() *brainCalc {
	c := &brainCalc{zones: map[string]*BrainZone{}}
	for _, z := range zoneDefs {
		c.zones[z.Key] = &BrainZone{Key: z.Key, Name: z.Name, Desc: z.Desc, Sources: []XPSource{}}
	}
	return c
}

func (c *brainCalc) add(zone, label string, xp int) {
	if xp <= 0 {
		return
	}
	z := c.zones[zone]
	z.XP += xp
	for i := range z.Sources {
		if z.Sources[i].Label == label {
			z.Sources[i].XP += xp
			return
		}
	}
	z.Sources = append(z.Sources, XPSource{label, xp})
}

func bookXP(status string, pages *int, pagesRead int) int {
	switch status {
	case "done":
		if pages == nil {
			return xpBookNoPages
		}
		return xpBookBase + *pages/2
	case "reading":
		return pagesRead / 2
	}
	return 0
}

func (c *brainCalc) finish() BrainResponse {
	r := &c.resp
	r.Zones = make([]BrainZone, 0, len(zoneDefs))
	for _, d := range zoneDefs {
		z := c.zones[d.Key]
		z.Level, z.LevelFrom, z.LevelTo = levelFor(z.XP, 30)
		sort.Slice(z.Sources, func(i, j int) bool { return z.Sources[i].XP > z.Sources[j].XP })
		r.TotalXP += z.XP
		r.Zones = append(r.Zones, *z)
	}
	r.Level, r.LevelFrom, r.LevelTo = levelFor(r.TotalXP, 50)
	r.Title = titleFor(r.Level)
	sort.SliceStable(r.Achievements, func(i, j int) bool { return r.Achievements[i].Date > r.Achievements[j].Date })
	if r.Achievements == nil {
		r.Achievements = []Achievement{}
	}
	return *r
}

// GET /api/brain
func (s *Server) brain(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	c := newBrainCalc()

	// Учёба: минуты по области темы
	rows, err := s.q(r).QueryContext(ctx, `SELECT COALESCE(t.area, 'logic'), COALESCE(sum(s.minutes), 0)
		FROM study_sessions s LEFT JOIN study_topics t ON t.id = s.topic_id
		WHERE s.user_id = app_uid() GROUP BY 1`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var area string
		var minutes int
		if err := rows.Scan(&area, &minutes); err != nil {
			rows.Close()
			return err
		}
		c.add(areaZone[area], "Время учёбы", minutes*xpPerStudyMinute)
		c.resp.Stats.StudyMinutes += minutes
	}
	rows.Close()

	// Изученные навыки
	rows, err = s.q(r).QueryContext(ctx, `SELECT title, area, COALESCE(done_at, created_at)::date::text
		FROM study_topics WHERE status = 'done' AND user_id = app_uid()`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var a Achievement
		var area string
		if err := rows.Scan(&a.Title, &area, &a.Date); err != nil {
			rows.Close()
			return err
		}
		a.Kind, a.Zone, a.XP = "skill", areaZone[area], xpSkill
		c.add(a.Zone, "Навыки", a.XP)
		c.resp.Achievements = append(c.resp.Achievements, a)
		c.resp.Stats.Skills++
	}
	rows.Close()

	// Книги
	rows, err = s.q(r).QueryContext(ctx, `SELECT title, area, status, pages, pages_read,
		COALESCE(finished_on, created_at::date)::text FROM books WHERE status <> 'want' AND user_id = app_uid()`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var title, area, status, date string
		var pages *int
		var pagesRead int
		if err := rows.Scan(&title, &area, &status, &pages, &pagesRead, &date); err != nil {
			rows.Close()
			return err
		}
		xp := bookXP(status, pages, pagesRead)
		zone := areaZone[area]
		if status == "done" {
			c.add(zone, "Прочитанные книги", xp)
			c.resp.Achievements = append(c.resp.Achievements, Achievement{"book", title, zone, xp, date})
			c.resp.Stats.BooksDone++
			if pages != nil {
				c.resp.Stats.PagesRead += *pages
			}
		} else {
			c.add(zone, "Книги в процессе", xp)
			c.resp.Stats.BooksReading++
			c.resp.Stats.PagesRead += pagesRead
		}
	}
	rows.Close()

	// Задачи и тренировки
	var tasksDone, workouts, workoutMin int
	if err := s.q(r).QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM tasks WHERE done AND user_id = app_uid()),
		(SELECT count(*) FROM workouts WHERE user_id = app_uid()),
		(SELECT COALESCE(sum(duration_min), 0) FROM workouts WHERE user_id = app_uid())`).Scan(&tasksDone, &workouts, &workoutMin); err != nil {
		return err
	}
	c.add("frontal", "Выполненные задачи", tasksDone*xpTask)
	c.add("cerebellum", "Тренировки", workouts*xpWorkout+workoutMin/2)
	c.resp.Stats.TasksDone, c.resp.Stats.Workouts = tasksDone, workouts

	writeJSON(w, http.StatusOK, c.finish())
	return nil
}
