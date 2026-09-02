# 02 — Specs

Concrete, verifiable contracts. Owns: API, data model, UI, provider behavior. No rationale, no alternatives. Naming is canonical (see §5); reuse verbatim.

All JSON fields are `camelCase` in API payloads; DB columns are `snake_case` (mapped in the backend service layer).

## 1. API contract

Prefix: all REST routes are served under `/api`. Errors use `{ error: string }` with the stated HTTP codes.

### S0 `GET /api/health`
- Auth: none
- Response: `200` → `{ ok: true }`
- Errors: none (always 200 while process is up).

### S1 `GET /api/search`
- Auth: none
- Request: query `q: string` (required), `type: "movie" | "tv" | "all"` (default `all`).
- Response: `200` → `{ items: MediaItem[] }`
  - `MediaItem`: `{ tmdbId: number, mediaType: "movie"|"tv", title: string, year: number|null, posterPath: string|null, backdropPath: string|null, overview: string, voteAverage: number }`
- Errors: `400` missing `q`.

### S2 `GET /api/media/:id`
- Auth: none
- Request: query `type: "movie" | "tv"` (required).
- Response: `200` → `{ tmdbId: number, mediaType: string, title: string, year: number|null, overview: string, posterPath: string|null, backdropPath: string|null, voteAverage: number, genres: string[], runtime: number|null }`
- Errors: `400` missing/invalid `type`; `502` TMDB unreachable.

### S3 `GET /api/media/:id/sources`
- Auth: none
- Request: query `type: "movie" | "tv"` (required).
- Behavior: builds query `"<title> <year>"` from the media record; calls Prowlarr with category `2000` (movie) or `5000` (tv); dedupes by `infoHash`; sorts seeders desc; guarantees every result has `magnetUri` (Prowlarr magnet if present, else built — §4.3).
- Response: `200` → `{ sources: Source[] }`
  - `Source`: `{ indexerId: number, indexer: string, title: string, sizeBytes: number, seeders: number, leechers: number, infoHash: string, magnetUri: string }`
- Errors: `502` Prowlarr unreachable (return `{ sources: [], unreachable: true }` and log if only empty).

### S4 `POST /api/downloads`
- Auth: none
- Request body: `{ tmdbId: number, mediaType: "movie"|"tv", title: string, year: number|null, posterPath: string|null, infoHash: string, magnetUri: string, torrentName: string, indexer: string }`
- Behavior: adds the source to qBittorrent (category `stream`, savepath `/downloads`, `sequentialDownload=true`, `firstLastPiecePriority=true`, `rename=<torrentName>` — required for playback-before-complete and for hash adoption, §4.2), then inserts a `downloads` row keyed by `info_hash`. `magnetUri` may be a real magnet **or a Prowlarr torrent-download URL** (§4.3); `infoHash` may be a `url-` placeholder in the latter case — the poll adopts qBittorrent's real hash by torrent name (S9).
- Response: `201` → `DownloadRecord` (shape below).
- Errors: `409` if `info_hash` already exists; `502` qBittorrent unreachable/add failed.

### S5 `GET /api/downloads`
- Auth: none
- Response: `200` → `{ downloads: DownloadRecord[] }`
- `DownloadRecord`: `{ id: number, tmdbId: number|null, mediaType: string|null, title: string|null, year: number|null, posterPath: string|null, infoHash: string, torrentName: string, indexer: string|null, sizeBytes: number, state: string, progress: number, downloadSpeed: number, uploadSpeed: number, etaSeconds: number|null, ratio: number, contentPath: string|null, streamFilePath: string|null, streamable: boolean, createdAt: string, completedAt: string|null }`
  - `state` values: one of `queued | fetching-metadata | downloading | stalled | paused | checking | seeding | error | unknown` (see §4.2 mapping).
  - `progress`: `0.0–1.0`. `streamable`: true iff a streamable file is resolvable (§4.4).

### S6 `DELETE /api/downloads/:infoHash`
- Auth: none
- Request: query `deleteFiles: "true" | "false"` (default `"false"`).
- Behavior: deletes torrent in qBittorrent (with files if requested), deletes the `downloads` row.
- Response: `204` on success.
- Errors: `404` unknown `infoHash`.

### S7 `GET /api/stream/:infoHash`
- Auth: none
- Behavior: resolves `streamFilePath` (§4.4), serves the file via `res.sendFile` with automatic Range/`Accept-Ranges` support and correct `Content-Type`. Incomplete `.!qb` files are served with the type of their stripped extension. Resolved path must resolve inside `/downloads` (NFR9).
- Response: `200` video stream; `206` partial (Range); `404` no streamable file / unknown torrent.
- Errors: `404` → `{ error: "not found" }`.

### S8 `GET /api/images/tmdb/*path`
- Auth: none
- Behavior: proxies `https://image.tmdb.org/t/p/w500/<path>` (poster) / `w1280` (backdrop) server-side. Never exposes the TMDB key. `path` must match `^[a-zA-Z0-9/_.-]+$` (reject anything else with `400`).
- Response: `200` image bytes; `502` TMDB unreachable.

### S9 Socket.IO events
- Namespace: default (`/`).
- On connect, server emits `downloads:initial` with `{ downloads: DownloadRecord[] }`.
- Every 2s, server emits `downloads:update` with `{ downloads: DownloadRecord[] }`.
- Client never sends messages (subscribe-only).
- During each poll cycle the server: syncs `torrent_name`/`size_bytes` from qBittorrent, **adopts the real qBittorrent `hash` for any `downloads` row keyed by a `url-` placeholder by matching `torrent_name`** (torrents added via a Prowlarr download URL have no infohash up-front), resolves `stream_file_path`/`streamable` whenever `content_path` is known and the stored `stream_file_path` is null **or no longer exists on disk**, sets `completed_at` on `progress == 1` transition, and maps `eta == -1` to null before emitting.

### S10 `GET /api/downloads/:infoHash/file`
- Auth: none
- Behavior: resolves the same media file as `S7` but streams it as an attachment (`Content-Disposition: attachment; filename="<basename>"`). Used for external playback when the browser can't play the codec. Path containment per NFR9.
- Response: `200` file download (no Range guarantee needed).
- Errors: `404` unknown `infoHash` / no resolvable file.

### S11 `POST /api/downloads/:infoHash/pause` · `POST /api/downloads/:infoHash/resume`
- Auth: none
- Behavior: pauses/resumes the torrent in qBittorrent (`/api/v2/torrents/stop|start`). State updates arrive on the next Socket.IO snapshot.
- Response: `204`.
- Errors: `404` unknown `infoHash`; `502` qBittorrent unreachable/failed.

## 2. Data model

Database: PostgreSQL 16. Schema is created on backend boot (idempotent). Driver: `pg`.

### Table: `downloads`
| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | serial PK | yes | |
| `tmdb_id` | int | no | null for manual/manual adds |
| `media_type` | text | no | `movie` \| `tv`, null if unknown |
| `title` | text | no | display title |
| `year` | int | no | |
| `poster_path` | text | no | TMDB poster path |
| `info_hash` | text UNIQUE NOT NULL | yes | torrent infohash (lowercase hex); a `url-…` placeholder for URL-added torrents until the poll adopts the real hash (S9) |
| `torrent_name` | text NOT NULL | yes | from qBittorrent / source |
| `indexer` | text | no | Prowlarr indexer name |
| `size_bytes` | bigint | no | total torrent size |
| `state` | text NOT NULL DEFAULT 'queued' | yes | canonical UI state (§4.2) |
| `progress` | double precision NOT NULL DEFAULT 0 | yes | 0–1 |
| `download_speed` | bigint NOT NULL DEFAULT 0 | yes | bytes/s |
| `upload_speed` | bigint NOT NULL DEFAULT 0 | yes | bytes/s |
| `eta_seconds` | int NOT NULL DEFAULT 0 | yes | qBittorrent ETA |
| `ratio` | double precision NOT NULL DEFAULT 0 | yes | |
| `content_path` | text | no | qBittorrent `content_path` (dir or single file) |
| `stream_file_path` | text | no | resolved video file path, relative to `/downloads` |
| `created_at` | timestamptz NOT NULL DEFAULT now() | yes | |
| `completed_at` | timestamptz | no | |

### Table: `settings`
| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `key` | text PK | yes | e.g. `stream_dir`, `poll_interval_ms` |
| `value` | jsonb NOT NULL | yes | |

- Migration strategy: run `docs/../backend/src/db/schema.sql` on every boot inside a transaction (`CREATE TABLE IF NOT EXISTS`); no versioned migrations in v1.

## 3. UI / CLI

Routes (React Router): `/` (Search), `/media/:id?type=` (Detail), `/watch/:infoHash` (Player). The Downloads panel is a persistent right-hand slide-over reachable from the header on every page.

### Screen: Search (`/`)
- Entry: app root.
- Elements:
  - Search input — debounced 300ms, submits on Enter.
  - Media type filter — `All | Movies | TV`.
  - Poster grid — `PosterCard` (poster image, title, year). Image src = `/api/images/tmdb/<posterPath>`.
  - Loading skeleton while `GET /api/search` is in flight.
- Actions:
  - Submit → fetch `S1` → render grid; on error show inline message, keep last results.
  - Click card → navigate `/media/:id?type=<mediaType>`.
  - Empty results → "No results for '<q>'".

### Screen: Media Detail (`/media/:id`)
- Entry: click from Search.
- Elements:
  - Hero — backdrop image (`w1280`), title, year, genres, vote, overview, runtime.
  - "Sources" section — list of `SourceRow`: indexer badge, title, size (humanized), seeders/leechers, "Download" button.
  - Regex filter input above the source list — matches against `Source.title` (e.g. `1080p|x264`, `-CAM`, `REMUX`). Invalid regex → treated as no filter with a subtle inline warning. Filtering is client-side only.
  - Source list capped at **30 visible rows** with a "Load more" button revealing the next 30 (from the full fetched list, after filtering).
  - Loading spinner while `S3` in flight; empty state "No sources found" (distinct from "no results match your filter").
- Actions:
  - Download → `POST S4` → on `201`, open Downloads panel and navigate to `/watch/:infoHash`? No — stay on page; toast "Added to downloads" and open the panel. On `409` toast "Already downloading".
  - If the current media already has an active download, show a "Watch" button first (links to `/watch/:infoHash`).

### Screen: Player (`/watch/:infoHash`)
- Entry: "Watch" button from Downloads panel or Detail.
- Elements:
  - Full-page `<video>` with `src="/api/stream/:infoHash"`, controls, autoplay.
  - Overlay showing torrent state + progress while streamable but incomplete ("Buffering — download in progress").
  - Back button.
- Actions:
  - Seek during download → works via Range.
  - If `streamable` is false → error state "No playable file yet".

### Component: DownloadsPanel (persistent slide-over)
- Elements: list of `DownloadRecord` rows — poster thumb, title, state badge, progress bar, speed, ETA, actions (Watch, Download file, Remove).
- State badges (§4.2): `queued`=gray, `fetching-metadata`=blue, `downloading`=blue spinner, `stalled`=amber, `paused`=orange, `checking`=purple, `seeding`=green, `error`=red, `unknown`=gray.
- Actions:
  - Watch → navigate `/watch/:infoHash` (only when `streamable`; disabled otherwise).
  - Download file → `S10` attachment download, for codecs the browser can't play (external player).
  - Remove → confirm dialog → `DELETE S6?deleteFiles=true`.
- Data: fed by Socket.IO `downloads:initial`/`downloads:update`; updates mutate Zustand store.

## 4. Provider / integration behavior

### 4.1 TMDB
- Base URL: `https://api.themoviedb.org/3`
- Auth: `api_key` query param (v3), key from `TMDB_API_KEY`.
- Endpoints: `GET /search/multi?query=<q>&language=en-US`; `GET /movie/{id}`; `GET /tv/{id}`.
- Images: `https://image.tmdb.org/t/p/{w500|w1280}/{path}` (proxied, S8).
- Timeouts: 10s connect/read. Retries: 2, exponential backoff (0.5s, 1s).
- Error mapping: non-2xx or network → throw `UpstreamError` → routes respond `502`.
- Quirks: TV dates → `first_air_date`; movies → `release_date`. Normalize both to `year` (int) or null.

### 4.2 qBittorrent
- Base URL (compose): `http://qbittorrent:8080`
- Auth: `POST /api/v2/auth/login` (`username`, `password`) → cookie session (`SID`); re-login on `403` from any call. Every API request must send `Referer: <QBITTORRENT_URL>` (Web API CSRF check). Login success may be either `200` with body `Ok.` (≤ 4.x) **or `204 No Content` (5.x)** — the client must accept both. Host-header validation: verify the container allows the internal service-name `Host` (`qbittorrent:8080`); if not, set `WebUI\HostHeaderValidationEnabled=false` in `/config/qBittorrent/qBittorrent.conf` — otherwise all API calls return `403`.
- Auth-bruteforce guard: `web_ui_max_auth_fail_count` (default 5) triggers an IP ban for `web_ui_ban_duration` (default 3600s). A backend polling with wrong credentials self-bans its container IP — clear it by restarting the qBittorrent container.
- Endpoints:
  - `POST /api/v2/torrents/add` — form `urls=<magnet|http>&category=stream&savepath=/downloads&sequentialDownload=true&firstLastPiecePriority=true&rename=<sourceTitle>`; success response is text `Ok.` (≤ 4.x) **or structured JSON** `{added_torrent_ids, failure_count, pending_count, success_count, error?}` (5.x) — success iff `success_count ≥ 1` **or `pending_count ≥ 1`** (URL-based adds are fetched asynchronously and return `pending_count: 1` until the `.torrent` is parsed) or `added_torrent_ids` non-empty; a duplicate yields `failure_count ≥ 1` with `error` containing `already`/`duplicate`/`conflict`, or HTTP `409` → map to `409`. `rename` is set to the source title so the poll can adopt the real infoHash by torrent name for URL-based adds (S9).
  - `GET /api/v2/torrents/info?category=stream` — poll every 2s
  - `POST /api/v2/torrents/delete?hashes=<h>&deleteFiles=true|false`
- State mapping (qBittorrent `state` → canonical UI `state`):

| qBittorrent state | UI state |
|-------------------|----------|
| `queuedDL`, `queuedUP` | `queued` |
| `metaDL`, `forcedMetaDL` | `fetching-metadata` |
| `downloading`, `forcedDL` | `downloading` |
| `stalledDL`, `stalledUP` | `stalled` |
| `pausedDL`, `pausedUP` | `paused` |
| `checkingDL`, `checkingUP`, `checkingResumeData` | `checking` |
| `uploading` | `seeding` |
| `error`, `missingFiles` | `error` |
| anything else | `unknown` |

- Fields consumed from info: `hash`, `name`, `state`, `progress` (0–1), `dlspeed`, `upspeed`, `eta`, `ratio`, `size`, `content_path`.
- Normalization: `eta == -1` → null (`etaSeconds: null`); `ratio` missing → 0; `torrent_name`/`size_bytes` overwrite the values captured at add time (qBittorrent metadata is authoritative); `completed_at` set on `progress == 1` transition (only once).
- Error mapping: login fail / network → `UpstreamError` → `502`; add duplicate → `409`.
- Quirks: `content_path` points at the torrent folder; incomplete files carry `.!qb` suffix.

### 4.3 Prowlarr
- Base URL (compose): `http://prowlarr:9696`
- Auth: header `X-Api-Key: <PROWLARR_API_KEY>`.
- Endpoint: `GET /api/v1/search?query=<q>&categories=<2000|5000>&type=search`.
- Timeouts: 60s (indexers are slow, and FlareSolverr-solved indexers push searches past 20s). Retries: 0 (Prowlarr aggregates/retries internally).
- Field mapping: Prowlarr returns **camelCase** keys: `title`, `size`, `seeders`, `leechers`, `infoHash`, `indexerId`, `indexer`, `magnetUrl`, `downloadUrl` (read PascalCase variants as a fallback). Map to `sizeBytes`, `seeders`, `leechers`, `infoHash` (lowercase), `indexerId`, `indexer`.
- `magnetUri` resolution, in order of preference:
  1. `infoHash` present → use a real `magnetUrl` if it starts with `magnet:`, else build a magnet from `infoHash` (§4.3 magnet builder).
  2. no `infoHash` but `magnetUrl` is a real magnet → extract the hash from it.
  3. no `infoHash`/magnet but `downloadUrl` present (Prowlarr's torrent download proxy, typical for Cardigann-scraped indexers like 1337x/Lime/TD) → set `magnetUri` to that URL (host normalized to `PROWLARR_URL` so qBittorrent can reach it) and set `infoHash` to a **placeholder** `url-<sha256(downloadUrl) first 40 hex>` — the poll adopts the real qBittorrent hash by torrent name (S9).
  4. otherwise drop the result.
- Magnet fallback builder (used when no real magnet):
  `magnet:?xt=urn:btih:<infoHash>&dn=<urlencode(title)>` then append trackers:
  1. `udp://tracker.opentrackr.org:1337/announce`
  2. `udp://open.stealth.si:80/announce`
  3. `udp://tracker.torrent.eu.org:451/announce`
  4. `udp://exodus.desync.com:6969/announce`
  5. `udp://open.demonii.com:1337/announce`
  6. `udp://tracker.openbittorrent.com:6969/announce`
  7. `udp://tracker.tiny-vps.com:6969/announce`
  8. `udp://tracker.moeking.me:6969/announce`
  9. `udp://explodie.org:6969/announce`
  Format: `&tr=<urlencode(tracker)>` for each.
- Error mapping: `401` → `UpstreamError(401)` (invalid key); non-200/network → `UpstreamError` → `502`; empty array → `{ sources: [] }`.
- Quirks: category `5000` covers episodes; a TV source's `title` may be an episode pack — UI must display it as-is; no season/episode parsing in v1. Only indexers that expose `infoHash` in search results (e.g. YTS API) populate it; others rely on the `downloadUrl` proxy path above.

### 4.4 Streaming file resolver
- Input: `infoHash` + `contentPath`.
- `contentPath` may be a directory (multi-file torrent) **or a single file** (single-file torrent): if it is a directory, scan it recursively; if it is a file, consider it directly.
- Find the largest file whose name ends with one of: `.mkv`, `.mp4`, `.avi`, `.webm`, `.mov`, `.m4v`, `.ts`, OR those same names with a trailing `.!qb`.
- If both `x.mkv` and `x.mkv.!qb` exist and `x.mkv` size > 0, prefer `x.mkv`.
- Selection priority when sizes are equal: `.mkv` > `.webm` > `.ts` > `.mp4` > `.mov` > `.m4v` > `.avi` (MKV/WebM/TS stream while downloading; MP4 may not be seekable until complete because `moov` can be at file end).
- Store result as `stream_file_path` (relative to `/downloads`); recompute whenever it is `null` **or the stored path no longer exists on disk** (qBittorrent renames `x.mkv.!qb` → `x.mkv` on completion). Recompute in the poll loop (S9) and again at serve time in `S7`/`S10` before serving.
- MIME: map by extension (`.mkv`→`video/x-matroska`, `.mp4`→`video/mp4`, `.webm`→`video/webm`, `.ts`→`video/mp2t`, others→`application/octet-stream`); strip `.!qb` before mapping.
- Path containment: resolve against `/downloads` and verify the absolute path stays inside it; reject with `404` otherwise (NFR9).
- Serve with `res.sendFile` (native Range support).

## 5. Canonical naming (single source of truth)
| Term | Canonical name |
|------|----------------|
| TMDB media id | `tmdbId` |
| Media type | `mediaType` (`movie` \| `tv`) |
| Torrent id | `infoHash` (lowercase hex) |
| Downloadable torrent result | `source` |
| Stored torrent metadata row | `download` / table `downloads` |
| Magnet URI | `magnetUri` |
| UI torrent phase | `state` (values §4.2) |
| Completion 0–1 | `progress` |
| qBittorrent folder path | `contentPath` |
| Resolved streamable file | `streamFilePath` |
| Is file streamable | `streamable` |
| Shared volume | `/downloads` |
| Backend stream route | `/api/stream/:infoHash` |
| Backend file-download route | `/api/downloads/:infoHash/file` |
| Realtime channel | Socket.IO events `downloads:initial` / `downloads:update` |
