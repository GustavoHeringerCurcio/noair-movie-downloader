CREATE TABLE IF NOT EXISTS downloads (
  id serial PRIMARY KEY,
  tmdb_id integer,
  media_type text,
  title text,
  year integer,
  poster_path text,
  backdrop_path text,
  season_number integer,
  episode_number integer,
  info_hash text UNIQUE NOT NULL,
  torrent_name text NOT NULL,
  indexer text,
  size_bytes bigint NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'queued',
  progress double precision NOT NULL DEFAULT 0,
  download_speed bigint NOT NULL DEFAULT 0,
  upload_speed bigint NOT NULL DEFAULT 0,
  eta_seconds integer NOT NULL DEFAULT 0,
  ratio double precision NOT NULL DEFAULT 0,
  content_path text,
  stream_file_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE downloads ADD COLUMN IF NOT EXISTS resolution text;
ALTER TABLE downloads ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE downloads ADD COLUMN IF NOT EXISTS codec text;
ALTER TABLE downloads ADD COLUMN IF NOT EXISTS hdr boolean NOT NULL DEFAULT false;
ALTER TABLE downloads ADD COLUMN IF NOT EXISTS is_dolby_vision boolean NOT NULL DEFAULT false;
ALTER TABLE downloads ADD COLUMN IF NOT EXISTS backdrop_path text;
ALTER TABLE downloads ADD COLUMN IF NOT EXISTS season_number integer;
ALTER TABLE downloads ADD COLUMN IF NOT EXISTS episode_number integer;

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS media_art (
  media_type text NOT NULL CHECK (media_type IN ('movie', 'tv')),
  tmdb_id integer NOT NULL,
  tvdb_id integer,
  thumb_url text,
  logo_url text,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'empty')),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (media_type, tmdb_id)
);
