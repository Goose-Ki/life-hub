#!/bin/sh
# Перенос данных из локальной базы (docker compose) в свой аккаунт на сайте.
# Переменные: SOURCE_URL — локальная база, TARGET_URL — база сайта (Neon), USERNAME — логин на сайте.
set -eu
TABLES="food_entries workouts tasks classes study_topics study_sessions books settings"

echo "1/3 Готовлю временные таблицы на сайте…"
SQL="DROP SCHEMA IF EXISTS import CASCADE; CREATE SCHEMA import;"
for t in $TABLES; do SQL="$SQL CREATE TABLE import.$t (LIKE public.$t);"; done
psql "$TARGET_URL" -q -v ON_ERROR_STOP=1 -c "$SQL"

echo "2/3 Копирую данные с компьютера…"
ARGS=""
for t in $TABLES; do ARGS="$ARGS -t public.$t"; done
# shellcheck disable=SC2086
pg_dump "$SOURCE_URL" --data-only --no-owner --no-privileges $ARGS \
  | grep -v -e "setval(" -e "transaction_timeout" \
  | sed -E 's/^COPY public\./COPY import./' \
  | psql "$TARGET_URL" -q -v ON_ERROR_STOP=1 >/dev/null

echo "3/3 Добавляю в аккаунт «$USERNAME»…"
psql "$TARGET_URL" -q -v uname="$USERNAME" -f "$(dirname "$0")/merge-import.sql"
echo "Готово."
