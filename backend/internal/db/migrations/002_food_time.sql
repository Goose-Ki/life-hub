-- Дневник питания: вместо приёма пищи (завтрак/обед/…) храним время еды.
ALTER TABLE food_entries ADD COLUMN eaten_at TIME;

-- Перенос старых записей: типовое время для приёма пищи, для «другое» — время создания записи.
UPDATE food_entries SET eaten_at = CASE meal
    WHEN 'breakfast' THEN TIME '08:00'
    WHEN 'lunch'     THEN TIME '13:00'
    WHEN 'snack'     THEN TIME '16:00'
    WHEN 'dinner'    THEN TIME '19:00'
    ELSE date_trunc('minute', created_at)::time
END;

ALTER TABLE food_entries ALTER COLUMN eaten_at SET NOT NULL;
ALTER TABLE food_entries DROP COLUMN meal;

DROP INDEX IF EXISTS food_entries_date_idx;
CREATE INDEX food_entries_date_time_idx ON food_entries (entry_date, eaten_at);
