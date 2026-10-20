-- Дневник питания: свободный текст по приёмам пищи
CREATE TABLE food_entries (
    id          SERIAL PRIMARY KEY,
    entry_date  DATE        NOT NULL,
    meal        TEXT        NOT NULL DEFAULT 'other'
                CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
    content     TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX food_entries_date_idx ON food_entries (entry_date);

-- Дневник тренировок: простой журнал
CREATE TABLE workouts (
    id            SERIAL PRIMARY KEY,
    workout_date  DATE        NOT NULL,
    kind          TEXT        NOT NULL,
    duration_min  INTEGER     CHECK (duration_min IS NULL OR duration_min > 0),
    note          TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workouts_date_idx ON workouts (workout_date);

-- Задачи (календарь). due_date = NULL — задача без даты (инбокс)
CREATE TABLE tasks (
    id          SERIAL PRIMARY KEY,
    title       TEXT        NOT NULL,
    notes       TEXT        NOT NULL DEFAULT '',
    due_date    DATE,
    due_time    TIME,
    priority    SMALLINT    NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
    done        BOOLEAN     NOT NULL DEFAULT false,
    done_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tasks_due_date_idx ON tasks (due_date);

-- Расписание пар. parity: all — каждую неделю, odd/even — нечётная/чётная
CREATE TABLE classes (
    id          SERIAL PRIMARY KEY,
    weekday     SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    start_time  TIME     NOT NULL,
    end_time    TIME     NOT NULL,
    subject     TEXT     NOT NULL,
    kind        TEXT     NOT NULL DEFAULT '',
    room        TEXT     NOT NULL DEFAULT '',
    teacher     TEXT     NOT NULL DEFAULT '',
    parity      TEXT     NOT NULL DEFAULT 'all' CHECK (parity IN ('all', 'odd', 'even')),
    CHECK (end_time > start_time)
);

-- План самообучения
CREATE TABLE study_topics (
    id            SERIAL PRIMARY KEY,
    title         TEXT        NOT NULL,
    description   TEXT        NOT NULL DEFAULT '',
    deadline      DATE,
    status        TEXT        NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
    target_hours  NUMERIC(6,1) CHECK (target_hours IS NULL OR target_hours > 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Учёт времени учёбы
CREATE TABLE study_sessions (
    id            SERIAL PRIMARY KEY,
    topic_id      INTEGER REFERENCES study_topics (id) ON DELETE SET NULL,
    session_date  DATE        NOT NULL,
    minutes       INTEGER     NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
    note          TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX study_sessions_date_idx ON study_sessions (session_date);

-- Настройки (например, дата начала семестра для чётности недель)
CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
