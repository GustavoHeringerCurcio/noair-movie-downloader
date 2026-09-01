# 03 — Tasks

Ordered build list. This is the only doc the executor runs. Every task is independently verifiable.

Execution protocol: work through tasks in order. Read the referenced docs before each task. Report done + how the acceptance criteria were verified.

## Milestone 0 — Scaffold

- [ ] **T0.1** Monorepo layout + tooling + credentials — Read: `00-index.md`, `01-architecture.md`
  - Create `backend/` (npm package, `tsconfig.json` strict, `package.json` scripts `dev`/`build`/`test`/`lint`/`typecheck`), `frontend/` (Vite React-TS scaffold), root `.gitignore` (node_modules, dist, .env, pgdata, docs/credentials.local.md), `.env.example` (placeholders per `docs/credentials.md`), root `README.md` quickstart.
  - Create `docs/credentials.md` (committed template: what's needed, where to get it, `.env` mapping, security rules) and `docs/credentials.local.md` (gitignored, "paste real values here").
  - **Acceptance:** `cd backend && npm run typecheck` passes on an empty entry file; `cd frontend && npm run dev` serves the default Vite page; `.env` and `docs/credentials.local.md` are gitignored (verify `git status` shows them untracked-but-ignored, `git check-ignore -v .env` matches).

- [ ] **T0.2** docker-compose with all 5 services — Read: `01-architecture.md`, `02-specs.md` §4, `00-index.md` D9/D13
  - `docker-compose.yml`: `postgres` (16-alpine, volume `pgdata`, healthcheck `pg_isready`), `qbittorrent` (linuxserver/qbittorrent, env PUID/PGID/TZ **set to 1000:1000**, volume `qbconfig` + `downloads:/downloads`, host port for Web UI), `prowlarr` (linuxserver/prowlarr, volume `prowlarr-config`, host port for UI), `backend` (depends_on postgres healthy, volume `downloads:/downloads`, env from `.env`, internal-only), `frontend` (nginx serving built assets, proxies `/api` and `/socket.io` with WebSocket `Upgrade`/`Connection` headers, host port).
  - Wire `.env.example` for `TMDB_API_KEY`, `PROWLARR_API_KEY`, `PROWLARR_URL`, `QBITTORRENT_URL`, `QBITTORRENT_USER`, `QBITTORRENT_PASS`, `DATABASE_URL`, `DOWNLOAD_DIR`.
  - Document boot order in README: start `prowlarr` first → configure trackers → copy its API key into `.env` → then start backend/frontend.
  - **Acceptance:** `docker compose up -d postgres qbittorrent prowlarr` starts all three healthy; `docker compose ps` shows healthy; `downloads` volume shared; backend (running locally) can `read` a file the qbittorrent container created in `/downloads` (PUID/PGID permission check); qBittorrent + Prowlarr UIs reachable on the host.

- [ ] **T0.3** Backend skeleton boots — Read: `00-index.md` D1, `02-specs.md` S1/S9
  - Express app with `/api/health` returning `{ ok: true }`; env parsing in `config.ts` that fails fast on missing vars; Socket.IO server attached; Vitest configured with one smoke test hitting `/api/health`.
  - **Acceptance:** `npm test` green; `npm run typecheck` clean; curl `/api/health` → `{ ok: true }`.

- [ ] **T0.4** Frontend skeleton + proxy — Read: `00-index.md` D2, `02-specs.md` §3
  - Vite app with React Router (`/`, `/media/:id`, `/watch/:infoHash` placeholders), `vite.config.ts` dev proxy for `/api` and `/socket.io` → `localhost:3000`.
  - **Acceptance:** `npm run dev` renders the route placeholders; dev-server proxies to backend (verify with backend running and fetching `/api/health` from the browser console).

## Milestone 1 — Core domain (no external deps)

- [ ] **T1.1** PostgreSQL schema + boot migration — Read: `02-specs.md` §2
  - `backend/src/db/schema.sql` (tables `downloads`, `settings`), `pool.ts` (pg, `DATABASE_URL`), idempotent runner executing schema on boot with `CREATE TABLE IF NOT EXISTS`.
  - **Acceptance:** with compose `postgres` up, `npm run dev` logs "schema ready"; `psql` shows both tables with exact columns from `02-specs.md` §2.

- [ ] **T1.2** Magnet builder — Read: `02-specs.md` §4.3
  - `magnet.ts` builds magnet from infoHash + name + the 9 trackers (exact list in spec). Vitest cases: valid `xt`/`dn`; all 9 `tr` present; round-trip infoHash extraction.
  - **Acceptance:** `npm test` green for magnet cases; generated string matches spec format.

- [ ] **T1.3** Stream resolver + Range serving — Read: `02-specs.md` §4.4
  - `streaming.ts`: `resolveStreamFile(contentPath)` finds largest video file incl. `.!qb` twin, applies extension priority (`.mkv` > `.webm` > `.ts` > `.mp4` > `.mov` > `.m4v` > `.avi`), returns `{ path, mime }`, enforces path containment inside `/downloads`; route `GET /api/stream/:infoHash` serves via `res.sendFile`. Vitest uses temp dirs with mixed files (mkv, mp4, `.!qb`) and a path-escape case.
  - **Acceptance:** `npm test` green; curl a temp file with `Range: bytes=0-99` returns `206` + `Accept-Ranges`; equal-size mkv beats mp4; a `../`-escape path returns `404`.

## Milestone 2 — External integrations (each behind an interface)

- [ ] **T2.1** TMDB client — Read: `02-specs.md` §4.1
  - `services/tmdb.ts` with `searchMulti(q, type)` and `details(id, type)`; normalizes to `MediaItem`/detail shape; image base exported. Vitest with mocked `fetch`.
  - **Acceptance:** `npm test` green; `searchMulti("inception","movie")` returns normalized items (mocked); network-failure path throws `UpstreamError`.

- [ ] **T2.2** Prowlarr client — Read: `02-specs.md` §4.3
  - `services/prowlarr.ts` with `search(query, category)`; maps fields, lowercases infoHash, dedupes, fills `magnetUri` via `magnet.ts` when empty. Vitest with mocked `fetch` (with and without `MagnetUrl`).
  - **Acceptance:** `npm test` green; results always have `magnetUri`; seeders-sorted; dedupe by infoHash verified.

- [ ] **T2.3** qBittorrent client — Read: `02-specs.md` §4.2
  - `services/qbittorrent.ts`: `login()`, `addTorrent(magnetUri)`, `listTorrents()`, `deleteTorrent(infoHash, deleteFiles)`, `toCanonicalState()` mapping table. Vitest with mocked fetch; re-login-on-403 behavior tested.
  - **Acceptance:** `npm test` green; canonical state mapping matches table in spec for all listed qBittorrent states.

## Milestone 3 — API layer

- [ ] **T3.1** Search + media + sources routes — Read: `02-specs.md` S1–S3
  - Wire `/api/search`, `/api/media/:id`, `/api/media/:id/sources` using T2.1/T2.2. Handles `400`/`502`.
  - **Acceptance:** manual curl with real TMDB key returns search items; `/sources` with Prowlarr running returns sorted sources with magnetUri.

- [ ] **T3.2** Downloads CRUD + stream + images + file download — Read: `02-specs.md` S4–S6, S8, S10
  - Wire `POST/GET/DELETE /api/downloads` (persists to Postgres, calls qBittorrent, maps state), `/api/stream/:infoHash` (via T1.3), `/api/images/tmdb/*` proxy (with path validation), `/api/downloads/:infoHash/file` (attachment download).
  - **Acceptance:** add a real magnet via API → row appears in `GET /api/downloads` with live qBittorrent state; delete removes torrent + row; image proxy returns a poster; `GET /api/downloads/:infoHash/file` returns an `attachment` download once a file exists.

- [ ] **T3.3** Socket.IO hub — Read: `02-specs.md` S9, `01-architecture.md` NFR1
  - 2s poll of qBittorrent list → merge+persist into `downloads` (sync `torrent_name`/`size_bytes`, set `completed_at` on `progress == 1`, map `eta == -1` → null, resolve `stream_file_path`/`streamable` when `content_path` known) → emit `downloads:initial` on connect and `downloads:update` every 2s.
  - **Acceptance:** a Node Socket.IO test client receives `downloads:initial` then periodic `downloads:update`; poll interval verified ≥ 2s; a torrent that completes in a test gets `completedAt` set once.

## Milestone 4 — UI

- [ ] **T4.1** Downloads store + panel — Read: `02-specs.md` §3
  - Zustand store bound to Socket.IO (`downloads:initial`, `downloads:update`); `DownloadsPanel` slide-over rendering records, state badges, progress bars, speeds, Watch/Remove actions (`DELETE S6` with confirm).
  - **Acceptance:** with backend running, panel updates live when a torrent progresses; state badge colors match spec.

- [ ] **T4.2** Search page — Read: `02-specs.md` §3, S1
  - Search input + type filter + poster grid via `/api/search`; loading skeleton; empty/error states.
  - **Acceptance:** typing "inception" + Enter renders a poster grid from real TMDB data; clicking a card routes to Detail.

- [ ] **T4.3** Detail page — Read: `02-specs.md` §3, S3, S4, D14
  - Hero (backdrop/title/year/genres/overview), Sources list (`SourceRow`) capped at 30 with "Load more", regex filter input (client-side, invalid regex → no filter + inline warning), Download button → `POST S4`; toast on `201`/`409`; "Watch" link if already downloading.
  - **Acceptance:** real Prowlarr sources render sorted by seeders; typing `1080p|x264` filters the list live; a filter that hides everything shows the "no match" empty state; >30 sources paginate with Load more; clicking Download adds a torrent and it appears in the Downloads panel.

- [ ] **T4.4** Player page — Read: `02-specs.md` §3, S7, S10
  - `/watch/:infoHash` full-page `<video>` with `src=/api/stream/:infoHash`, autoplay, buffering overlay while `state` is not complete but `streamable`; "Download file" button (S10) for codecs the browser can't play; "No playable file yet" when `streamable` is false.
  - **Acceptance:** with a partially or fully downloaded torrent, video plays and seeks in the browser; an `.mkv` (H.264) torrent plays; a "Download file" click downloads the file as an attachment for external playback.

## Milestone 5 — Wiring & polish

- [ ] **T5.1** Docker Compose end-to-end — Read: `00-index.md` D9, `01-architecture.md` §3
  - Full `docker compose up --build`; backend + frontend build; verify search → download → progress → watch in one run.
  - **Acceptance:** from the browser: search a movie, pick a source, see live progress in panel, stream it while downloading, remove it. All 5 services healthy.

- [ ] **T5.2** Empty/error/loading states + branding — Read: `02-specs.md` §3
  - Add all specified empty states, error toasts, loading skeletons, page title/favicon, responsive Downloads panel.
  - **Acceptance:** every state defined in `02-specs.md` §3 renders (verified manually: no sources, no results, qBittorrent down → clean errors, not crashes).

- [ ] **T5.3** Hardening (nice-to-haves) — Read: `02-specs.md` §4
  - Confirm delete with files; pause/resume torrent; source dedupe already present; Prowlarr unavailable → `sources: []` with banner.
  - **Acceptance:** each implemented item has a manual verification note; app still boots and works with Prowlarr offline.
