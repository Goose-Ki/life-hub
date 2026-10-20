package api

import "testing"

func TestLevelFor(t *testing.T) {
	cases := []struct{ xp, level, from, to int }{
		{0, 1, 0, 50}, {49, 1, 0, 50}, {50, 2, 50, 200}, {199, 2, 50, 200}, {200, 3, 200, 450}, {5000, 11, 5000, 6050},
	}
	for _, c := range cases {
		l, f, to := levelFor(c.xp, 50)
		if l != c.level || f != c.from || to != c.to {
			t.Errorf("levelFor(%d) = %d,%d,%d want %d,%d,%d", c.xp, l, f, to, c.level, c.from, c.to)
		}
	}
	if titleFor(1) != "Новичок" || titleFor(9) != "Знаток" || titleFor(40) != "Гений" {
		t.Error("wrong level titles")
	}
}

func TestBrainCalc(t *testing.T) {
	c := newBrainCalc()
	c.add("parietal", "Время учёбы", 90)
	c.add("parietal", "Навыки", 150)
	c.add("parietal", "Время учёбы", 30)
	c.add("cerebellum", "Тренировки", 0) // ноль не добавляет источник
	r := c.finish()
	if r.TotalXP != 270 {
		t.Fatalf("total = %d", r.TotalXP)
	}
	var par BrainZone
	for _, z := range r.Zones {
		if z.Key == "parietal" {
			par = z
		}
		if z.Key == "cerebellum" && len(z.Sources) != 0 {
			t.Error("zero XP source should be skipped")
		}
	}
	if par.XP != 270 || len(par.Sources) != 2 || par.Sources[0].Label != "Навыки" {
		t.Errorf("parietal = %+v", par)
	}
	if len(r.Zones) != 5 || r.Achievements == nil {
		t.Error("zones/achievements shape")
	}
}

func TestBookXP(t *testing.T) {
	p := 300
	if got := bookXP("done", &p, 0); got != 250 {
		t.Errorf("done 300p = %d", got)
	}
	if got := bookXP("done", nil, 0); got != 150 {
		t.Errorf("done no pages = %d", got)
	}
	if got := bookXP("reading", &p, 120); got != 60 {
		t.Errorf("reading = %d", got)
	}
	if got := bookXP("want", &p, 0); got != 0 {
		t.Errorf("want = %d", got)
	}
}
