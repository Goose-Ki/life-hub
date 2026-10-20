-- Переносит данные из схемы import (копия локальной базы) в аккаунт пользователя :'uname'.
-- Запускается скриптом import-to-cloud.sh один раз. Всё в одной транзакции: либо всё, либо ничего.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE target AS SELECT id FROM users WHERE username = lower(:'uname');
DO $$ BEGIN
  IF (SELECT count(*) FROM target) <> 1 THEN
    RAISE EXCEPTION 'Пользователь не найден на сайте — сначала зарегистрируйся там';
  END IF;
END $$;

INSERT INTO food_entries (entry_date, eaten_at, content, created_at, user_id)
SELECT entry_date, eaten_at, content, created_at, (SELECT id FROM target) FROM import.food_entries;

INSERT INTO workouts (workout_date, kind, duration_min, note, created_at, user_id)
SELECT workout_date, kind, duration_min, note, created_at, (SELECT id FROM target) FROM import.workouts;

INSERT INTO tasks (title, notes, due_date, due_time, priority, done, done_at, created_at, user_id)
SELECT title, notes, due_date, due_time, priority, done, done_at, created_at, (SELECT id FROM target) FROM import.tasks;

-- Пары: не дублируем уже существующие (расписание группы уже есть в аккаунте)
INSERT INTO classes (weekday, start_time, end_time, subject, kind, room, teacher, parity, user_id)
SELECT i.weekday, i.start_time, i.end_time, i.subject, i.kind, i.room, i.teacher, i.parity, (SELECT id FROM target)
FROM import.classes i
WHERE NOT EXISTS (
  SELECT 1 FROM classes c WHERE c.user_id = (SELECT id FROM target)
    AND c.weekday = i.weekday AND c.start_time = i.start_time AND c.subject = i.subject AND c.parity = i.parity);

-- Темы получают новые id; занятия переносим с привязкой к новым id тем
CREATE TEMP TABLE topic_map AS
SELECT id AS old_id, nextval(pg_get_serial_sequence('study_topics', 'id')) AS new_id FROM import.study_topics;

INSERT INTO study_topics (id, title, description, deadline, status, target_hours, created_at, area, done_at, user_id)
SELECT m.new_id, t.title, t.description, t.deadline, t.status, t.target_hours, t.created_at, t.area, t.done_at, (SELECT id FROM target)
FROM import.study_topics t JOIN topic_map m ON m.old_id = t.id;

INSERT INTO study_sessions (topic_id, session_date, minutes, note, created_at, user_id)
SELECT m.new_id, s.session_date, s.minutes, s.note, s.created_at, (SELECT id FROM target)
FROM import.study_sessions s LEFT JOIN topic_map m ON m.old_id = s.topic_id;

INSERT INTO books (title, author, area, status, pages, pages_read, finished_on, rating, notes, created_at, user_id)
SELECT title, author, area, status, pages, pages_read, finished_on, rating, notes, created_at, (SELECT id FROM target) FROM import.books;

-- Настройки с компьютера заменяют настройки на сайте
INSERT INTO settings (key, value, user_id)
SELECT DISTINCT ON (key) key, value, (SELECT id FROM target) FROM import.settings
ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value;

SELECT 'Перенесено' AS "✓",
  (SELECT count(*) FROM import.food_entries) AS питание,
  (SELECT count(*) FROM import.workouts) AS тренировки,
  (SELECT count(*) FROM import.tasks) AS задачи,
  (SELECT count(*) FROM import.study_topics) AS темы,
  (SELECT count(*) FROM import.study_sessions) AS занятия,
  (SELECT count(*) FROM import.books) AS книги;

DROP SCHEMA import CASCADE;
COMMIT;
