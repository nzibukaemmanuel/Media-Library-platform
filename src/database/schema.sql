-- Media Library Platform: PostgreSQL schema for media assets.
-- Safe to run repeatedly (idempotent).

-- Allowed kinds of media
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'media_type') THEN
    CREATE TYPE media_type AS ENUM ('image', 'video', 'audio', 'document');
  END IF;
END
$$;

-- Categories a media item can belong to (keep in sync with CATEGORIES in
-- src/config/constants.js)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'media_category') THEN
    CREATE TYPE media_category AS ENUM
      ('general', 'marketing', 'design', 'documentation', 'reports', 'other');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS media_assets (
  id             SERIAL PRIMARY KEY,
  title          VARCHAR(255)  NOT NULL,
  description    TEXT,
  category       media_category NOT NULL DEFAULT 'general',
  media_type     media_type    NOT NULL,
  file_name      VARCHAR(255)  NOT NULL,          -- name stored on disk
  original_name  VARCHAR(255)  NOT NULL,          -- name the user uploaded
  file_path      TEXT          NOT NULL,          -- where the file is stored
  mime_type      VARCHAR(127)  NOT NULL,          -- e.g. image/png
  file_size      BIGINT        NOT NULL CHECK (file_size >= 0),  -- bytes
  width          INTEGER       CHECK (width > 0),            -- images/video
  height         INTEGER       CHECK (height > 0),           -- images/video
  duration       NUMERIC(10,2) CHECK (duration >= 0),        -- audio/video, seconds
  tags           TEXT[]        NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Upgrade: databases created before categories existed get the column here
-- (a no-op on a fresh database, where CREATE TABLE already added it)
ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS category media_category NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS idx_media_assets_media_type ON media_assets (media_type);
CREATE INDEX IF NOT EXISTS idx_media_assets_category   ON media_assets (category);
CREATE INDEX IF NOT EXISTS idx_media_assets_created_at ON media_assets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_tags       ON media_assets USING GIN (tags);

-- Keep updated_at current on every update
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_media_assets_updated_at ON media_assets;
CREATE TRIGGER trg_media_assets_updated_at
  BEFORE UPDATE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
