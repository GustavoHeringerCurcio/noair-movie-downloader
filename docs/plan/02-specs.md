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
  - `MediaItem`: `{ tmdbId: number, mediaType: "movie"|"tv", title: string, year: number|null, posterPath: string|null, backdropPath: string|null, overview: string, voteAverage: number, art?: MediaArt|null }` — `art` present only when Fanart enrichment succeeded (§4.6); `MediaArt = { thumbUrl: string|null, logoUrl: string|null }`.
- Errors: `400` missing `q`.

### S2 `GET /api/media/:id`
- Auth: none
- Request: query `type: "movie" | "tv"` (required).
- Response: `200` → `{ tmdbId: number, mediaType: string, title: string, year: number|null, overview: string, posterPath: string|null, backdropPath: string|null, voteAverage: number, genres: string[], runtime: number|null, art?: MediaArt|null }`. For `type=tv`, additionally `seasons: TvSeasonSummary[]` where `TvSeasonSummary = { seasonNumber: number, name: string, episodeCount: number }` — excludes season `0` (specials) and any season with `episodeCount <= 0`.
- Errors: `400` missing/invalid `type`; `502` TMDB unreachable.

### S3 `GET /api/media/:id/sources`
- Auth: none
- Request: query `type: "movie" | "tv"` (required). For TV, optional `season: int` and `episode: int`.
- Behavior: builds the Prowlarr query from the media record per context, calls Prowlarr with category `2000` (movie) or `5000` (tv), dedupes by `infoHash`, sorts seeders desc, guarantees every result has `magnetUri` (§4.3).
  - no `season` → `"<title> <year>"` (movies, and whole-show/TV fallback).
  - `season=N` (TV) → `"<title> S<NN>"` (returns season packs and episode releases together).
  - `season=N&episode=M` (TV) → `"<title> S<NN>E<MM>"` (single-episode search / Advanced scoping).
  - **Season gating**: when `season=N` is present, drop results whose parsed `coverage` is non-null and does not include season `N` (prevents e.g. a S02 pack appearing under the S01 tab); `coverage: null` results pass through.
- Response: `200` → `{ sources: Source[] }`
  - `Source`: `{ indexerId: number, indexer: string, title: string, sizeBytes: number, seeders: number, leechers: number, infoHash: string, magnetUri: string, ageHours: number|null, resolution: "2160p"|"1080p"|"720p"|"480p"|null, source: "REMUX"|"BluRay"|"WEB-DL"|"WEBRip"|"BDRip"|"BRRip"|"HDTV"|"DVDRip"|null, codec: "x264"|"x265"|"AV1"|"XviD"|"DivX"|null, hdr: boolean, isDolbyVision: boolean, group: string|null, cleanTitle: string, audioCodec: "AAC"|"AC3"|"E-AC3"|"DTS"|"TrueHD"|"FLAC"|"Opus"|"MP3"|"Atmos"|null }` — quality fields parsed from the release title by `lib/releaseParser.ts` (Prowlarr returns only `age`) — **plus `coverage: Coverage[] | null`** where `Coverage = { season: number, episodes: [number, number] | null }`; `episodes === null` means the release covers a whole season; `null` coverage means the title was unparseable (UI: Advanced-picker only, never auto-selected). Parsed per §4.5. Files inside a downloaded torrent are matched to episodes by the S13 file-list tags (no client-side parser).
- Errors: `502` Prowlarr unreachable (return `{ sources: [], unreachable: true }` and log if only empty).

### S4 `POST /api/downloads`
- Auth: none
- Request body: `{ tmdbId: number, mediaType: "movie"|"tv", title: string, year: number|null, posterPath: string|null, backdropPath: string|null, infoHash: string, magnetUri: string, torrentName: string, indexer: string, seasonNumber?: number|null, episodeNumber?: number|null }`
- Behavior: adds the source to qBittorrent (category `stream`, savepath `/downloads`, `sequentialDownload=true`, `firstLastPiecePriority=true`, `rename=<torrentName>` — required for playback-before-complete and for hash adoption, §4.2), then inserts a `downloads` row keyed by `info_hash`. `magnetUri` may be a real magnet **or a Prowlarr torrent-download URL** (§4.3); `infoHash` may be a `url-` placeholder in the latter case — the poll adopts qBittorrent's real hash by torrent name (S9). `seasonNumber`/`episodeNumber` label the download (episode-level friendly downloads); `backdropPath` is stored so 16:9 cards have a landscape image.
- Response: `201` → `DownloadRecord` (shape below).
- Errors: `409` if `info_hash` already exists; `502` qBittorrent unreachable/add failed.

### S5 `GET /api/downloads`
- Auth: none
- Response: `200` → `{ downloads: DownloadRecord[] }`
- `DownloadRecord`: `{ id: number, tmdbId: number|null, mediaType: string|null, title: string|null, year: number|null, posterPath: string|null, backdropPath: string|null, seasonNumber: number|null, episodeNumber: number|null, infoHash: string, torrentName: string, indexer: string|null, sizeBytes: number, state: string, progress: number, downloadSpeed: number, uploadSpeed: number, etaSeconds: number|null, ratio: number, contentPath: string|null, streamFilePath: string|null, streamable: boolean, createdAt: string, completedAt: string|null }`
  - `state` values: one of `queued | fetching-metadata | downloading | stalled | paused | checking | seeding | error | unknown` (see §4.2 mapping).
  - `progress`: `0.0–1.0`. `streamable`: true iff a streamable file is resolvable (§4.4).

### S6 `DELETE /api/downloads/:infoHash`
- Auth: none
- Request: query `deleteFiles: "true" | "false"` (default `"false"`).
- Behavior: deletes torrent in qBittorrent (with files if requested), deletes the `downloads` row.
- Response: `204` on success.
- Errors: `404` unknown `infoHash`.

### S7 `GET /api/stream/:infoHash` · `GET /api/stream/:infoHash/watch`
- Auth: none
- Behavior (`:infoHash`): resolves `streamFilePath` (§4.4) and serves the original file via `res.sendFile` (Range/`Accept-Ranges`, correct `Content-Type`). Used for external players and browsers that can already decode the codecs. Playback is gated on completion: **incomplete `.!qb` files are never resolved or served** — only fully-downloaded video is playable (§4.4 resolver ignores `.!qb`). Path containment per NFR9.
- Behavior (`/watch`): probes the complete file with `ffprobe` (`lib/probe.ts`, cached by path+size+mtime) and chooses the serving mode (`lib/streamPlan.ts`):
  - `direct` (video h264/vp9/av1 **and** audio aac/mp3/opus/flac/none) → `sendFile` (seekable).
  - `remux-audio` (video safe, audio ac3/eac3/dts/truehd…) → ffmpeg `-c:v copy -c:a aac` fragmented mp4.
  - `transcode` (video hevc/x265/other at height < 2160) → ffmpeg `-c:v libx264 -preset veryfast -crf 21 -c:a aac` fragmented mp4. Transcoded streams are **progressive (no seeking)**.
  - `player-required` (height ≥ 2160 non-browser-safe) → responds `415 { error: "player-required" }`; the UI shows the external-player flow instead.
  - ffmpeg is killed on client disconnect.
- Response: `200` video stream; `206` partial (direct only); `404` unknown torrent / no complete streamable file; `415` player-required; `500` ffmpeg unavailable.

### S7b `GET /api/downloads/:infoHash/playinfo`
- Auth: none
- Behavior: resolves a fully-downloaded streamable file, runs the shallow probe + a full `lib/mediaInfo.ts` probe (video/height/HDR, every audio track with language/channels/default, every subtitle track text-vs-bitmap, duration, container) and scans for sidecar subtitle files next to the video. Returns the serving decision + track metadata + URLs.
- Response: `200` → `{ mode: "direct"|"hls"|"remux-audio"|"transcode"|"player-required", videoCodec: string|null, audioCodec: string|null, height: number|null, container: string|null, durationSeconds: number|null, video: {codec,width,height,hdr}|null, audioTracks: [{index,codec,language,title,channels,default}], subtitleTracks: [{index,codec,kind:"text"|"bitmap",language,title,default}], sidecarSubtitles: [{name,language}], streamUrl: "/api/stream/<hash>/watch", playUrl: "/api/stream/<hash>", fileUrl: "/api/downloads/<hash>/file", manifestUrl: string|null }` (`manifestUrl` set when `mode === "hls"` → `/api/playback/<hash>/hls/master.m3u8`, see S14).
- Errors: `404` unknown torrent / no complete streamable file.

### S8 `GET /api/images/tmdb/*path`
- Auth: none
- Behavior: proxies `https://image.tmdb.org/t/p/{w500|w780|w1280}/<path>` server-side (`w500`/`w780` posters, `w1280` backdrops). Never exposes the TMDB key. `path` must match `^[a-zA-Z0-9/_.-]+$` (reject anything else with `400`).
- Response: `200` image bytes; `502` TMDB unreachable.

### S8b `GET /api/images/art/:mediaType/:tmdbId/:kind`
- Auth: none. Serves artwork that the pipeline (§4.8) downloaded to the `art` volume.
- Request: params `mediaType: "movie" | "tv"`, `tmdbId: int`, `kind: "poster" | "background" | "logo"`.
- Behavior: looks up the matching `art_files` row, resolves `file_path` inside `ART_DIR` (path comes from the DB — never from the request; containment-checked), and streams the file with `Content-Type` from its extension and `Cache-Control: public, max-age=31536000, immutable`.
- Response: `200` image bytes; `404` unknown subject/kind or file missing from disk.
- Fallback contract: the frontend treats this route as primary in `poster` card style; an `onError`/missing 404 falls back to the S8 TMDB proxy URLs.

### S9 Socket.IO events
- Namespace: default (`/`).
- On connect, server emits `downloads:initial` with `{ downloads: DownloadRecord[] }`.
- Every 2s, server emits `downloads:update` with `{ downloads: DownloadRecord[] }`.
- Client never sends messages (subscribe-only).
- During each poll cycle the server: syncs `torrent_name`/`size_bytes` from qBittorrent, **adopts the real qBittorrent `hash` for any `downloads` row keyed by a `url-` placeholder by matching `torrent_name`** (torrents added via a Prowlarr download URL have no infohash up-front), resolves `stream_file_path`/`streamable` only when a **fully-downloaded (non-`.!qb`) video file** exists under `content_path` (never for partials), sets `completed_at` on `progress == 1` transition, and maps `eta == -1` to null before emitting.

### S10 `GET /api/downloads/:infoHash/file`
- Auth: none
- Behavior: resolves the same fully-downloaded media file as `S7` but streams it as an attachment (`Content-Disposition: attachment; filename="<basename>"`). Used as the fallback for external playback when the browser can't decode a codec or no `movie://` handler is registered. Path containment per NFR9.
- Response: `200` file download (no Range guarantee needed).
- Errors: `404` unknown `infoHash` / no complete resolvable file.

### S11 `POST /api/downloads/:infoHash/pause` · `POST /api/downloads/:infoHash/resume`
- Auth: none
- Behavior: pauses/resumes the torrent in qBittorrent (`/api/v2/torrents/stop|start`). State updates arrive on the next Socket.IO snapshot.
- Response: `204`.
- Errors: `404` unknown `infoHash`; `502` qBittorrent unreachable/failed.

### S12 `GET /api/media/:id/season/:seasonNumber`
- Auth: none
- Request: params `id`, `seasonNumber`; query `type=tv` (required).
- Behavior: fetches `/tv/{id}/season/{n}` from TMDB and maps each episode to `TvEpisode`.
- Response: `200` → `{ season: TvSeasonSummary, episodes: TvEpisode[] }` where `TvEpisode = { seasonNumber: number, episodeNumber: number, name: string, overview: string, stillPath: string|null, runtime: number|null, airDate: string|null }`. Empty season → `episodes: []`.
- Errors: `400` missing/invalid `type` or `seasonNumber`; `404` season not found; `502` TMDB unreachable.

### S13 `GET /api/downloads/:infoHash/files`
- Auth: none
- Behavior: resolves the torrent's `content_path` and lists its playable video files (same resolver as §4.4). Each file's basename is parsed server-side with the §4.5 regex so the UI never re-implements episode parsing.
- Response: `200` → `{ files: StreamFileInfo[] }` where `StreamFileInfo = { relative: string, mime: string, size: number, complete: boolean, seasonNumber: number|null, episodeNumber: number|null }`.
- Errors: `404` unknown `infoHash` or `content_path` not ready.

### S14 HLS web package (browser-player upgrade, Shaka)
- Auth: none. Only complete files resolve.
- `GET /api/playback/:infoHash/hls/status` (`?file=` optional): resolves the file, ensures a package run is started (idempotent, one ffmpeg job per file), returns `{ phase: "packaging"|"ready"|"failed", progress: 0–1, error: string|null }`.
- `GET /api/playback/:infoHash/hls/master.m3u8`: when ready → the authored master playlist (`application/vnd.apple.mpegurl`); while packaging → `202` + status body; failed → the failed status.
- `DELETE /api/playback/:infoHash/hls`: deletes the cached package (used for a failed-package retry).
- `GET /api/playback/pkg/:key/*`: serves the package's segments/init/subtitle files. `key` must match a package key (hash + slug); paths are containment-checked.
- Packaging (`lib/hls.ts` + `lib/packages.ts`, cache root `PACKAGE_DIR` default `/packages` on a `packages` compose volume): ffmpeg stream-copies video, re-encodes each audio track to AAC into a separate HLS audio rendition, converts embedded text + sidecar subtitles to WebVTT, then writes `video/main.m3u8`, `audio/<idx>/main.m3u8`, `subs/<id>.{vtt,m3u8}` and a `master.m3u8` with EXT-X-MEDIA AUDIO/SUBTITLES groups. Done marker makes cached packages reusable across restarts. Packages are removed on torrent delete (S6).
- Watch plays `mode:"hls"` through **Shaka Player** (lazy-loaded `shaka-player`, its own controls overlay with audio-language/subtitle menus) after polling `status`; packaging/failure states show progress or external-player/Download-file fallbacks.

### S15 `GET /api/media/:id/trailer`
- Auth: none.
- Request: query `type: "movie" | "tv"` (required).
- Behavior: fetches TMDB `GET /{movie|tv}/{id}/videos` (`language=en-US`), normalizes each video to `{ site, key, kind, official, language, publishedAt }`, then picks the best one with `lib/trailer.ts`. Pick rule (pure, unit-tested): keep only embeddable sites (`YouTube` > `Vimeo`, others dropped); prefer the `en` subset when it has ≥ 1 candidate, else any language; rank by kind `Trailer` → `Teaser` → other, then `official` first, then newest `published_at`, then YouTube over Vimeo.
- Response: `200` → `{ trailer: Trailer | null }` where `Trailer = { provider: "youtube" | "vimeo", videoId: string, name: string | null }`. `trailer: null` when no usable video exists.
- Errors: `400` missing/invalid `type`; `502` TMDB unreachable. The frontend treats any failure (HTTP error included) as `null` — a trailer is never allowed to block or break the card.

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
| `backdrop_path` | text | no | TMDB backdrop path (16:9 cards); null for legacy rows |
| `season_number` | int | no | TV only; null for movies/legacy |
| `episode_number` | int | no | TV only; null for movies/legacy and whole-season downloads |

### Table: `settings`
| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `key` | text PK | yes | e.g. `stream_dir`, `poll_interval_ms` |
| `value` | jsonb NOT NULL | yes | |

- Migration strategy: run `docs/../backend/src/db/schema.sql` on every boot inside a transaction (`CREATE TABLE IF NOT EXISTS`); no versioned migrations in v1. The schema file must **also** run idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` statements for any column added after first release (`backdrop_path`, `season_number`, `episode_number`) so existing named volumes upgrade on boot.

### Table: `art_files`
| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `media_type` | text | yes | `movie` \| `tv`; PK part |
| `tmdb_id` | int | yes | PK part |
| `kind` | text | yes | `poster` \| `background` \| `logo`; PK part |
| `origin_url` | text | no | upstream URL the file was downloaded from |
| `file_path` | text | no | file name relative to `ART_DIR` |
| `status` | text NOT NULL DEFAULT 'ok' | yes | `ok` \| `empty` (no source found) |
| `fetched_at` | timestamptz NOT NULL DEFAULT now() | yes | |

- `ART_DIR` is a named compose volume (like `/downloads`, `/packages`) mounted at the backend's configured `ART_DIR` (default `/art`). Files are named `{mediaType}_{tmdbId}_{kind}.{ext}`.

## 3. UI / CLI

Visual language (D15): **strict black & white, Netflix-style**. Fixed top header 68px that is transparent at the top of the page and fades to a black gradient (then solid `#000`) on scroll. Layout is full-bleed (no centered max-width column); content gutters are `4%`. Cards are **16:9 landscape title cards** sourcing `/api/images/tmdb/w1280<backdropPath>`; rails bleed to the viewport edge so the rightmost card is clipped mid-card to invite horizontal scroll; hover scales the card and reveals a white-ringed action panel. All colors are grayscale tokens (`--bg #000`, surfaces, `#fff/#e5e5e5/#b3b3b3/#808080`); state chips/progress/seeders map to luminance, never hue.

Routes: `/` (Home), `/media/:id?type=` (Detail), `/watch/:infoHash` (Player), `/downloads`, `/settings`.

### Shell: AppHeader (replaces the sidebar)
- Fixed 68px, content padded `0 4%`; transparent at `scrollY≈0`, fades to `linear-gradient(#000, rgba(0,0,0,.6), transparent)` then solid `#000` while scrolling (rAF-throttled).
- Left: wordmark → `/`. Nav links: **Home · Downloads · Settings** (`NavLink`, 14px, `#e5e5e5`, active white).
- Right: backend connection dot, live download-count badge, search toggle (opens overlay), settings gear.
- Mobile: hamburger → bottom-sheet with the same links + search.

### Screen: Home (`/`)
- Sections top→bottom: **Hero** (static brand GIF, grayscaled via CSS; fallback TMDB `w1280` backdrop → black gradient) → **My Downloads** (named so because resume positions are deferred, D15) → **Recently Viewed** → **Trending This Week** → **Best Movies** → **Best Series**.
- Rail card = `TitleCard` (16:9 landscape backdrop; hover `scale(1.15)` + 1px white ring + dark panel with lucide Play/Download/More Info; white progress bar when downloading).
- My Downloads sources `DownloadRecord` (progress + quality chip when known); Recently Viewed sources the recents store.

### Screen: Search overlay (all pages)
- Trigger: header search icon. Fixed `#000` overlay, `role="dialog"`, focus trap, Esc/× closes, focus restored to trigger.
- Big input (debounced 300ms → S1), `All | Movies | TV` segmented control, landscape-card result grid.
- Empty: "No results for '<q>'".
- **Result selection**: activating a result (click/Enter) navigates to `/media/:id?type=…`; the overlay closes on any route change committed beneath it (so the destination is never hidden behind the full-screen layer). Closing resets query/results; no auto-save of the typed term into recent searches.

- **Hover-trailer previews (D18, on every `TitleCard`)**: any card in a rail, the My Downloads rail, the landscape result grid, or the search overlay shows a **muted, looping trailer embed** on hover. Trigger: sustained hover (debounced ~600ms) → `trailerFor(item)` (S15, in-memory cache keyed `tmdbId:mediaType`, ~1h TTL) → an absolutely-positioned `<iframe>` overlay fills the card above the artwork but below the action overlay/progress (z 4). Embeds: YouTube `https://www.youtube-nocookie.com/embed/{videoId}?autoplay=1&mute=1&controls=0&playsinline=1&loop=1&playlist={videoId}&modestbranding=1`; Vimeo `https://player.vimeo.com/video/{videoId}?autoplay=1&muted=1&loop=1&controls=0`. The iframe is `pointer-events: none` (the whole card stays one click target), mounts only while hovered (unmounts on mouse leave / route change), and the still art remains beneath until playback begins. `trailer: null`, a fetch failure, or any HTTP error → static card, no layout shift, no toast. TV cards play the series trailer.

### Screen: Media Detail (`/media/:id`)
- Hero: `w1280` backdrop, title, meta row (year · genres · runtime · rating; TV adds "N Seasons"), overview, grayscale overlays.
- **Movie**: primary ▶ **Download** (friendly: most-seeded S3 movie source; disabled + spinner until the on-mount S3 fetch resolves) · **Advanced** (opens `SourcePickerModal`) · if an active download exists → **Watch** + trash.
- **TV**:
  - Season dropdown — default = season with an active download, else the lowest `seasonNumber` with `episodeCount > 0` (S2). Season change → one lazy `S3?season=N` search (cached per `title|season`, request-id guarded, skeleton rows) + `S12` episodes.
  - Episode rows: still thumb (`w500`), big episode number, title, runtime, overview, availability chip; hover highlight.
    - **Friendly download** (`ArrowDownToLine`): most-seeded source whose `coverage` covers the episode — exact single-episode releases preferred; a partial pack is allowed and labeled `E0X–E0Y`; **never** auto-downloads a whole season. No exact source → info toast + Advanced pre-scoped `season=N&episode=M`.
    - Episode inside an active full-season download → **Play** (→ `/watch/:hash?episode=SxxExx`) instead of download.
  - Season header: **Download season** → most-seeded full-season pack (`coverage … episodes === null`); if active → progress + Watch + trash.
  - **Advanced** (`SlidersHorizontal`): `SourcePickerModal` listing **all** Prowlarr results for the current season/episode scope, including `coverage: null` releases (never auto-picked; shown with their release title). Reuses v1 structured filters (resolution/source/codec/indexer/min-seeders/size/regex), sort, cross-indexer grouping + "Show duplicates", count line, and 30-row "Load more".
- Actions (both types): friendly/advanced download → `POST S4`; `201` toast "Added to downloads"; `409` toast "Already downloading". Trash → confirm → `DELETE S6?deleteFiles=true`.

### Screen: Player (`/watch/:infoHash`[`?episode=SxxExx`])
- Optional `?episode=SxxExx` (TV, season-pack downloads): after the S13 file list loads, auto-select the first file whose server-parsed `seasonNumber`/`episodeNumber` matches; no match → normal file-picker state.
- Playback is gated on completion (D8): a torrent that has no fully-downloaded video yet shows a *waiting* state with download % that reloads automatically once `streamable` flips true. `S7b` mode decision; `direct`/`remux-audio`/`transcode` `<video>`; `player-required` → "Open in your player" (`movie://`), "Download file", back; an always-visible **Player** topbar icon opens the current file in the local player; multi-file picker for packs (only completed files are listed).
- `playinfo` 404 → "No playable file yet" (or the waiting state above while the download runs).

### Pages: Downloads (`/downloads`) and Settings (`/settings`)
- Downloads rows: 16:9 thumb, title (+ `S0NE0M` label when `seasonNumber/episodeNumber` set), grayscale quality chip, progress bar, speed/ETA, actions **Watch · Player (S7 native, `movie://`) · Pause/Resume · Download file (S10) · Remove** (confirm → S6 `?deleteFiles=true`). Watch/Player are disabled until `streamable` (a fully-downloaded file exists).
- Settings: existing System/Configuration/About cards + **Local player** card — platform-aware (`detectOs`): choose VLC/MPV/MPC-HC/PotPlayer on Windows, VLC/MPV on Linux (localStorage hint, `readPlayerPreference`); download the matching installer/uninstaller — `.cmd` (PowerShell, registers `movie://` under HKCU) on Windows, `.sh` (writes `movie-open.sh` + a `x-scheme-handler/movie` `.desktop` entry, registers via `xdg-mime`, auto-detects installed player via `command -v`/snap/flatpak) on Linux. The Artwork source card gains a **temporary** "Card style" A/B control (`backdrop` = current full-bleed tile vs `poster` = poster-first layered tile, D17) persisted as `artwork.style` so both looks can be compared live; both this toggle and the provider-agnostic warm guard (§4.8) are removed once the winning source is chosen.
- Data for both: Socket.IO `downloads:initial` / `downloads:update` → Zustand store.

### Grayscale state mapping (replaces §4.2 colors)
Monochrome chips only: `queued` #808080 outline, `fetching-metadata` #b3b3b3, `downloading` #fff + spinner, `stalled` #808080, `paused` #e5e5e5 outline, `checking` #b3b3b3, `seeding` #fff, `error` #fff on #000 border, `unknown` #555. No hue in any state.

### UX layer (client-side, no new endpoints — PART C of the 2026-09-05 plan)
- **ConfirmDownloadSheet (C-DL1):** every friendly download (movie / season / episode) first shows a sheet naming the exact pick — release title, resolution/source/codec, size, seeders, indexer — with `[Start]` and `[Advanced…]`. Sources resolve in the background (cache keyed `title|season|episode`, AbortController); while unresolved the CTA reads `Looking for best source…`. No silent auto-start.
- **Resume (C-DL2):** `store/playbackStore` persists `{infoHash, file, seconds}` to `localStorage` every ~5s of playback. On return to the same file the player offers `Resume from mm:ss` / `Restart`. Local only; no server round-trip. Recents are marked on play start.
- **Downloads tabs:** `All | Downloading | Ready to watch`, preserving arrival context; tabular numerals for speed/ETA; delete confirm states file impact (pack deletes warn they remove all contained episode files).
- **TV sticky sub-bar:** while the episode list scrolls, a toolbar under the header shows back, compact title, season selector, **Download season N**, **Advanced**.
- **Resilience:** socket-drop banner (`Reconnecting… · Retry now`) with the last snapshot retained; rail errors get inline Retry; Settings gains **Copy diagnostics**.
- **First-run (C-DL3):** empty My Downloads shows `1 Search · 2 Download · 3 Watch`; search overlay opens with a Trending suggestion grid and recent-search chips.
- **Player:** buffering overlay `Ready to stream · NN%`; ~20s stall guard offers **Retry stream** (re-probe S7b); `player-required` → 3-step VLC sheet + copy-URL; `Next: S0NE0M` deep-link when watching inside a downloaded pack.
- **Accessibility:** `/` opens search, `Esc` closes top layer, arrows scroll a focused rail, skip-to-content, `aria-live` toast region, `prefers-reduced-motion` respected.

## 4. Provider / integration behavior

### 4.1 TMDB
- Base URL: `https://api.themoviedb.org/3`
- Auth: `api_key` query param (v3), key from `TMDB_API_KEY`.
- Endpoints: `GET /search/multi?query=<q>&language=en-US`; `GET /movie/{id}`; `GET /tv/{id}`; `GET /tv/{id}/season/{n}` (S12); `GET /{movie|tv}/{id}/videos` (S15).
- TV seasons: from `GET /tv/{id}` map `seasons` to `TvSeasonSummary[]`, dropping `season_number === 0` and `episode_count <= 0` (S2). Episodes from `/tv/{id}/season/{n}` map `still_path` → `stillPath`, `runtime`, `air_date` → `airDate`.
- Videos (S15): map `GET /{movie|tv}/{id}/videos` results to `{ site, key, kind, official, language, publishedAt }` — `site` kept verbatim (`"YouTube"`/`"Vimeo"`), `key` = the platform video id (YouTube key is directly embeddable; no YouTube Data API needed), `iso_639_1` → `language` (empty → `null`), `published_at` → `publishedAt` (empty → `null`). Ranking lives in the pure `lib/trailer.ts`, not in the TMDB client.
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
- Quirks: category `5000` covers episodes; a TV source's `title` may be a season pack, a partial pack, or a single episode — the parser (§4.5) derives `coverage` so the UI can label it; `coverage: null` releases are shown in the Advanced picker only. Only indexers that expose `infoHash` in search results (e.g. YTS API) populate it; others rely on the `downloadUrl` proxy path above.

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

### 4.5 Season/episode coverage parsing
- `lib/releaseParser.ts` parses a release `title` into `coverage: Coverage[] | null`:
  - Tokens handled: `S01`, `S01E01`, `S01E01-E05`, `S01E01-05`, `S01-S02`, `Season 1`, `01x03`, `Complete` / `Complete Series`. A whole-series pack is normalized to one entry per aired season (resolved from S2 at serve time); anything unparseable returns `null` (Advanced-only in the UI).
  - `Coverage = { season: number, episodes: [number, number] | null }`; `episodes === null` means a whole season.
- Pure predicates (single source of truth, unit-tested in `backend/src/lib/releaseParser.test.ts`):
  - `coverageCovers(coverage, season, episode?)` — season scope matches `episodes === null`; episode scope matches a contained episode.
  - `isFullSeason(coverage, season)` — any entry with `episodes === null`.
- Downloaded-torrent file matching: the S13 file-list endpoint tags every `StreamFileInfo` with `seasonNumber`/`episodeNumber` parsed server-side from the file basename via the same `SxxExx` regex — the UI reads tags for `/watch?episode=` auto-select and episode→file mapping. No client-side parser duplication; a minimal `frontend/src/lib/episode.ts` fallback is allowed only when a file has no server tag.

### 4.6 Fanart.tv key art (optional enrichment)
- Purpose: Netflix-style **16:9 key art** (`moviethumb`/`tvthumb`) + transparent logos (`movielogo`/`hdmovielogo`, `hdtvlogo`/`clearlogo`) for colored title tiles and the Detail hero logo. **Fanart art is community-curated, not official studio art** — best-effort enhancement only.
- Config: optional `FANART_API_KEY` in `.env` (`services/fanart.ts`). When absent or unset, enrichment is skipped entirely and TMDB artwork is used.
- Endpoints: `GET https://webservice.fanart.tv/v3/movies/{tmdbId}?api_key=…`; TV requires TVDB id → resolve via TMDB `GET /tv/{id}/external_ids` (`tmdb.tvdbId`), then `GET https://webservice.fanart.tv/v3/tv/{tvdbId}?api_key=…`.
- Selection: pick the most-liked `url` per type; only `https:` URLs accepted; `hdmovielogo`→`movielogo` and `hdtvlogo`→`clearlogo` fallback chains (empty arrays are treated as absent).
- Caching: in-memory TTL 24h per `(movies|tv):id`. Failures (non-2xx, network) return nulls — never throw into API responses.
- Enrichment (`lib/enrich.ts`): `enrichItems` (search/browse) and `enrichDetail` (`/media/:id`) run **best-effort, parallel (5 workers), `Promise.allSettled`** and attach `art?: MediaArt` only on success. No enrichment on `/sources` or `/season/:n`.
- `MediaArt = { thumbUrl: string|null, logoUrl: string|null }`. UI card image priority: `art.thumbUrl` → TMDB `w1280` backdrop → poster crop → monogram.

### 4.7 Hi-res poster sourcing (movies + TV) — resolved
- iTunes Store artwork was evaluated as the hi-res poster source but **rejected**: the public `itunes.apple.com/search` API is deprecated and returns empty results (Apple Developer Forums); the replacement requires an affiliate token. No iTunes integration.
- Hi-res poster ladder (used by §4.8): Fanart.tv `movieposter`/`tvposter` (`posterUrl`, most-liked, only for titles Fanart has) → TMDB poster `w780`. TMDB posters cover ~every title.

### 4.8 Artwork download pipeline (poster-first tiles) — TEMPORARY v2, D17
- Problem: Fanart.tv coverage is sparse and TMDB backdrops are generic scene frames, so landscape cards fail the "user must know the movie" test. v2 makes the **poster** the card identity.
- Per-title art set (`lib/artCache.ts`, `art_files` table, disk under `ART_DIR`):
  - `poster` source ladder: Fanart `posterUrl` (§4.6/§4.7) → TMDB poster `w780` (via S8 proxy fetch).
  - `background` source ladder: Fanart.tv `thumbUrl` (§4.6) when the title has one → none (UI falls back to a CSS-blurred poster).
  - `logo` (optional): Fanart.tv `logoUrl`.
- The cache downloads each missing file once (`file_path` recorded), skips fresh rows within the refetch TTL, retries transient failures, and never serves stale/missing files (S8b `404`).
- The warm loop (`lib/warmArt.ts`) now runs in **both** provider modes (guard relaxed — temporary) and, after the Fanart pass, warms the art set for the same subject set (rails + downloads). The old provider-only early-return and the `cardStyle` A/B toggle are temporary until a single winning horizontal-poster source is chosen, after which one source wins and the relaxed guard is re-tightened.
- DB `media_art` remains the metadata cache of best origin URLs (Fanart); `art_files` records what is actually on disk.

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
| Season/episode coverage of a release | `coverage` (`Coverage[] \| null`, §4.5) |
| TV download label | `seasonNumber` / `episodeNumber` |
| Landscape image path stored on downloads | `backdropPath` |
| Episode-deep-link param on Watch | `/watch/:infoHash?episode=SxxExx` |
| Locally cached artwork file set | table `art_files`; disk root `ART_DIR` |
| Art file kind (S8b) | `poster` \| `background` \| `logo` |
| Local artwork route | `/api/images/art/:mediaType/:tmdbId/:kind` |
| Temporary card A/B setting | `artwork.style`: `backdrop` (default) \| `poster` (D17) |
| Trailer pick (S15) | `Trailer = { provider, videoId, name }` (`provider`: `youtube` \| `vimeo`) |
| Trailer lookup route | `GET /api/media/:id/trailer` |
| Trailer player | YouTube `youtube-nocookie.com/embed/{videoId}` · Vimeo `player.vimeo.com/video/{videoId}` (muted autoplay loop) |
