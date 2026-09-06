# 01 — Architecture

System design for `movie-downloader-qbitorrent`. Owns: components, data flow, boundaries. Does NOT contain implementation detail. See `00-index.md` for locked decisions (D1–D12).

## 1. High-level diagram

```
                            +---------------------+    TMDB API (free key)
                            |   prowlarr (docker) |  <-------------------+
  +--------+  /api, /socket.io    |   indexer aggregator  |                  |
  | frontend| <================>  +---------------------+                  |
  | (nginx) |        |            +---------------------+                  |
  +--------+         |            |   backend (express) | <----------------+
                     |            |  - tmdb client      |
                     |            |  - prowlarr client  |
                     |            |  - qbit client      |
                     |            |  - streamer (range) |
                     |            |  - socket.io hub    |
                     |            |  - pg pool          |
                     |            +---------+-----------+
                     |                      |             ^
                     |                      | poll 2s     | push /downloads
                     |                      v             |
                     |            +---------------------+ |
                     |            |   qbittorrent (docker)| |
                     |            +----------+----------+ |
                     |                       | writes     |
                     |                       v            |
                     |            +---------------------+ |
                     |            |  /downloads volume  | |
                     |            |  (shared, streamed) | |
                     |            +---------------------+ |
                     |                      ^            |
                     +----------------------+------------+  Range reads
                                      (backend serves files)
```

## 2. Components

### 2.1 Frontend (React SPA, served by nginx)
- Responsibility: search UI, media detail + source list, live downloads panel, in-browser video player.
- Talks to: Backend via `/api` (REST) and `/socket.io` (realtime).
- Boundary/constraints: never holds TMDB/Prowlarr/qBittorrent credentials; gets all data and images from the backend. Card/hero `<img>` src point to `/api/images/art/*` (locally-cached OMDb portraits); TV episode stills use `/api/images/tmdb/*`.

### 2.2 Backend (Express + TypeScript)
- Responsibility: single entry point for the UI. Owns TMDB client, Prowlarr client, qBittorrent client, magnet builder, media-file finder + range streamer, PostgreSQL access, Socket.IO hub.
- Talks to: Prowlarr, qBittorrent, TMDB, PostgreSQL, Frontend.
- Boundary/constraints: no UI rendering; JSON REST + Socket.IO only. Polls qBittorrent every 2s (D7). Rejects requests when a required env var is missing (fail fast at boot).

### 2.3 qBittorrent (Docker container)
- Responsibility: downloads magnets/`.torrent`, exposes state via Web API v2.
- Talks to: Backend (API), writes files into `/downloads`.
- Boundary/constraints: Web UI port only reachable on the internal compose network (not published to host for production). `savepath` = `/downloads`. Torrents are added with `sequentialDownload=true` + `firstLastPiecePriority=true` (streaming-before-complete, D8). Host-header validation must permit the internal `qbittorrent:8080` Host; API calls must send the `Referer` header (§4.2).

### 2.4 Prowlarr (Docker container)
- Responsibility: aggregates configured trackers and returns normalized search results (title, size, seeders, leechers, infoHash).
- Talks to: Backend (API), public/private trackers (outbound).
- Boundary/constraints: categories are Prowlarr canonical values: `2000` = movies, `5000` = TV. Trackers configured by the user in Prowlarr UI; code is tracker-agnostic.

### 2.5 PostgreSQL (Docker container)
- Responsibility: stores `downloads` records and `settings`.
- Talks to: Backend only.
- Boundary/constraints: private network; named volume `pgdata`; healthcheck required before backend starts.

### 2.6 TMDB (external)
- Responsibility: movie/TV metadata + imagery.
- Talks to: Backend only (API key never in the browser).
- Boundary/constraints: free tier; backend caches nothing initially (rate is low for single user).

## 3. Data flow

### Flow: Search
1. User types a query in the frontend.
2. Frontend calls `GET /api/search?q=...&type=...` (spec `S1`).
3. Backend queries TMDB `GET /search/multi`.
4. Backend normalizes results and returns items (id, title, year, poster/backdrop paths, overview).
5. Frontend renders a poster grid.

### Flow: List sources
1. User clicks a media item.
2. Frontend calls `GET /api/media/:id?type=...` (spec `S2`) then `GET /api/media/:id/sources?type=...` (spec `S3`).
3. Backend builds a search string `"<title> <year>"` and queries Prowlarr with the matching category (`2000` movie, `5000` tv).
4. Backend normalizes results, dedupes by `infoHash`, sorts by seeders desc, and (if Prowlarr returned no magnet) builds a magnet from `infoHash` (spec §4.3).
5. Frontend renders the source list (title, size, seeders, indexer) with a "Download" button each.

### Flow: Start download
1. User clicks "Download" on a source.
2. Frontend calls `POST /api/downloads` (spec `S4`) with tmdbId, title, infoHash, magnetUri, etc.
3. Backend adds the magnet to qBittorrent (`POST /api/v2/torrents/add`, category `stream`), creates a `downloads` row keyed by `info_hash`.
4. Backend returns the created record; the row appears in the next Socket.IO snapshot.

### Flow: Live progress
1. Backend polls `GET /api/v2/torrents/info?category=stream` every 2s.
2. Backend merges qBittorrent fields (state, progress, speeds, eta, ratio, content_path) into `downloads` rows and persists.
3. Backend resolves `streamFilePath`/`streamable` once `contentPath` is known; sets `completed_at` on `progress == 1`; syncs `torrent_name`/`size_bytes` from qBittorrent's authoritative metadata.
4. Backend emits `downloads:update` snapshot over Socket.IO (spec `S9`).
5. Frontend updates the Downloads panel in real time (progress bar, speed, state badge).

### Flow: Stream
1. User clicks "Watch" on a download.
2. Frontend loads the player with `src = /api/stream/:infoHash` (spec `S7`).
3. Backend resolves the torrent's `content_path`, finds the largest video file (or its incomplete `.!qb` twin), and serves it with HTTP Range support via `res.sendFile`. Extension priority and codec caveats per `02-specs.md` §4.4.
4. The HTML5 `<video>` streams/seekas immediately, including while the torrent is still downloading — for codecs the browser supports.

### Flow: Open externally
1. User clicks "Download file" on a download whose codec the browser can't play.
2. Frontend navigates to `GET /api/downloads/:infoHash/file` (spec `S10`).
3. Backend streams the resolved media file with `Content-Disposition: attachment`, so the user saves and opens it in a native player.

### Flow: Remove download
1. User clicks "Remove" on a download.
2. Frontend calls `DELETE /api/downloads/:infoHash?deleteFiles=true` (spec `S5`).
3. Backend tells qBittorrent to delete the torrent (+ files if requested) and deletes the row.

## 4. Tech boundaries
- Language/runtime: **Node.js 20** (backend), **React 18 + Vite 5** (frontend). Both TypeScript strict.
- Frameworks: **Express 4**, **Socket.IO 4**, **pg** (PostgreSQL), **Zustand**, **React Router 6**.
- Storage: **PostgreSQL 16** in Docker (D3).
- External services: **TMDB**, **Prowlarr**, **qBittorrent** (D4–D6).
- Deployment: **docker-compose** with nginx frontend proxy (D9).
- Streaming: shared `/downloads` volume; Range requests (D8).
- Testing: **Vitest** backend unit tests with mocked providers (D11).

## 5. Non-functional requirements
- NFR1: qBittorrent poll interval is exactly 2s; never poll faster.
- NFR2: Playback is gated on full download: files are served (Range) only once they are complete — `.!qb` partials are never exposed. Completed files support seeking (Range).
- NFR3: Backend must not crash if Prowlarr, qBittorrent, or TMDB is unreachable — return a clean HTTP error, keep serving other routes.
- NFR4: Backend boots only after Postgres is healthy (compose healthcheck + connection retry).
- NFR5: Secrets (TMDB key, qBittorrent creds, Prowlarr key) exist only in `.env` (gitignored) and are never sent to the browser.
- NFR6: `frontend`, `qbittorrent`, and `prowlarr` are published on host ports (`0.0.0.0`). `postgres` and `backend` are internal-only (D13). qBittorrent requires strong credentials; Prowlarr has no auth (accepted LAN risk).
- NFR7: Single-user scale; a handful of concurrent torrents and 1–2 concurrent streams is the expected ceiling.
- NFR8: Stream resolver ranks `.mkv`/`.webm`/`.ts` above `.mp4`; files in browser-unsupported codecs (HEVC/x265, `.avi`) are still downloadable via `S10` but not promised to play in-browser (D8).
- NFR9: The resolved stream/file path is validated to stay inside `/downloads` before serving (prevents path escape from qBittorrent-supplied `content_path`).
