-- Аккаунты: у каждого пользователя свои данные. Регистрация — по приглашению
-- (первый пользователь регистрируется без приглашения и становится админом).
CREATE TABLE users (
    id             SERIAL PRIMARY KEY,
    username       TEXT        NOT NULL UNIQUE CHECK (username = lower(username)),
    name           TEXT        NOT NULL,
    password_hash  TEXT        NOT NULL,
    is_admin       BOOLEAN     NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Сессии: в базе хранится только SHA-256 от токена из cookie.
CREATE TABLE sessions (
    token_hash  TEXT        PRIMARY KEY,
    user_id     INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE invites (
    code        TEXT        PRIMARY KEY,
    created_by  INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_by     INTEGER     REFERENCES users (id) ON DELETE SET NULL,
    used_at     TIMESTAMPTZ
);

-- Текущий пользователь запроса: сервер выставляет его в начале транзакции
-- (set_config('app.user_id', …, true)). Не выставлен → NULL → запросы ничего не видят.
CREATE FUNCTION app_uid() RETURNS INTEGER LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.user_id', true), '')::INTEGER $$;

-- Владелец у всех данных. Новые строки получают его автоматически.
-- Строки, созданные до появления аккаунтов (user_id IS NULL), забирает первый зарегистрированный.
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['food_entries', 'workouts', 'tasks', 'classes',
                             'study_topics', 'study_sessions', 'books', 'settings']
    LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN user_id INTEGER DEFAULT app_uid()
                        REFERENCES users (id) ON DELETE CASCADE', t);
        EXECUTE format('CREATE INDEX %I ON %I (user_id)', t || '_user_idx', t);
    END LOOP;
END $$;

-- Настройки теперь у каждого свои
ALTER TABLE settings DROP CONSTRAINT settings_pkey;
CREATE UNIQUE INDEX settings_user_key ON settings (user_id, key);
