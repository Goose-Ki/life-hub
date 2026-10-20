-- Область знаний: определяет, какая зона «мозга» растёт.
--   logic      — технологии, программирование, наука, математика (теменная доля)
--   humanities — языки, история, гуманитарное (височная доля)
--   creative   — творчество, дизайн, искусство (затылочная доля)
--   self       — саморазвитие, продуктивность, бизнес (лобная доля)
ALTER TABLE study_topics ADD COLUMN area TEXT NOT NULL DEFAULT 'logic'
    CHECK (area IN ('logic', 'humanities', 'creative', 'self'));

-- Книги
CREATE TABLE books (
    id           SERIAL PRIMARY KEY,
    title        TEXT        NOT NULL,
    author       TEXT        NOT NULL DEFAULT '',
    area         TEXT        NOT NULL DEFAULT 'logic'
                 CHECK (area IN ('logic', 'humanities', 'creative', 'self')),
    status       TEXT        NOT NULL DEFAULT 'want' CHECK (status IN ('want', 'reading', 'done')),
    pages        INTEGER     CHECK (pages IS NULL OR pages > 0),
    pages_read   INTEGER     NOT NULL DEFAULT 0 CHECK (pages_read >= 0),
    finished_on  DATE,
    rating       SMALLINT    CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    notes        TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Когда тема отмечена «Готово» — для ленты достижений.
ALTER TABLE study_topics ADD COLUMN done_at TIMESTAMPTZ;
UPDATE study_topics SET done_at = now() WHERE status = 'done';
