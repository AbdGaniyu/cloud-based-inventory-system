-- When cash-up started: a drawer with no cash-up yet covers every payment since then, so someone who
-- never cashes up shows as overdue instead of starting fresh each morning.
INSERT INTO "settings" ("id", "key", "value", "is_secret", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'cashup.startedAt', to_jsonb(to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), false, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
