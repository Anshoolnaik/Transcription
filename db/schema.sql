-- Speech to Text: transcription history
-- Applied automatically on server start (idempotent); can also be run by hand:
--   psql "$DATABASE_URL" -f db/schema.sql

CREATE TABLE IF NOT EXISTS transcriptions (
    id               SERIAL PRIMARY KEY,
    title            VARCHAR(200)  NOT NULL,
    content          TEXT          NOT NULL,
    language         VARCHAR(50)   NOT NULL DEFAULT 'auto',
    engine           VARCHAR(40)   NOT NULL DEFAULT 'gemini-live',
    duration_seconds NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
    word_count       INTEGER       NOT NULL DEFAULT 0 CHECK (word_count >= 0),
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at ON transcriptions (created_at DESC);
