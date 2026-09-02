# Plan — Master Index & Doc Architecture

This document defines **how this planning set is structured** and how it will be executed. It is the entry point for any human or agent reading this repo.

## Project

- **Name:** `movie-downloader-qbitorrent`
- **One-line purpose:** Self-hosted web app that searches movies/TV via TMDB, finds torrent/magnet sources via Prowlarr, downloads them with qBittorrent (Docker), shows live download progress, and streams the video in-browser.

## Goal of this doc set

Produce a complete, unambiguous blueprint so that:

- A human can review the entire plan in under 15 minutes.
- An agent can execute the whole build top-to-bottom **without making design decisions**.
- Every task has a verifiable "done" condition.

## Doc layout

```
AGENTS.md                        # Project rules, commands, conventions — always read first
docs/plan/
  00-index.md                    # THIS FILE — overview, build order, locked decisions
  01-architecture.md             # System design: components, data flow, boundaries
  02-specs.md                    # Concrete contracts: API, data model, UI, providers
  03-tasks.md                    # Ordered, numbered milestones w/ acceptance criteria
```

## What each doc is FOR (and what it is NOT for)

| File | Contains | Must NOT contain |
|------|----------|------------------|
| `AGENTS.md` | Repo-level rules, run commands, edit conventions, pointer to this index | Project design decisions |
| `00-index.md` | Scope, goals, **locked decisions**, build order, conventions for the docs themselves | Implementation detail |
| `01-architecture.md` | Components, responsibilities, data flow diagrams, tech boundaries, what talks to what | Line-by-line implementation |
| `02-specs.md` | Concrete contracts: endpoints + payloads, schema, UI screens/flows, provider interfaces | Rationale, alternatives, opinions |
| `03-tasks.md` | Numbered tasks in build order; each with inputs, outputs, acceptance criteria | Design discussion |

## Rules for writing every doc

1. **Decisions, not options.** Every "we could use X or Y" becomes "we use X." No open choices left for the executor.
2. **Requirements + acceptance criteria, not prose.** Facts an agent can verify. No ambiguous adjectives.
3. **One fact lives in one place.** If two docs disagree, the doc that "owns" it wins (ownership table below). Cross-reference instead of duplicating.
4. **Precise naming.** All names are written exactly once in `02-specs.md` and reused verbatim everywhere else.
5. **No "later"/"TBD" in a doc that the executor reads.** Anything unknown is recorded in this file under Open Questions, resolved, then moved into the relevant doc.

## Ownership table (single source of truth)

| Topic | Owned by |
|-------|----------|
| Tech stack, scope, build order | `00-index.md` |
| Components and data flow | `01-architecture.md` |
| API contracts, data model, UI, provider behavior | `02-specs.md` |
| Milestones, task order, acceptance criteria | `03-tasks.md` |

## Locked decisions

| # | Decision |
|---|----------|
| D1 | Backend: **Node.js + Express 4 + TypeScript**. Single-user app, no auth. |
| D2 | Frontend: **React 18 + Vite + TypeScript**, React Router, **Zustand** for client state, plain CSS (no UI framework). |
| D3 | Database: **PostgreSQL 16 as a Docker service** (named volume), `pg` driver, schema run on backend boot. |
| D4 | Torrent indexer: **Prowlarr (Docker)**. One normalized search API; trackers (TPB, 1337x, etc.) configured in Prowlarr, not in code. |
| D5 | Downloader: **qBittorrent (Docker)** via its Web API v2. Backend polls it every 2s. |
| D6 | Metadata + imagery: **TMDB API** (free key). All poster/backdrop images proxied by the backend so the key never reaches the browser. |
| D7 | Realtime UI updates: **Socket.IO**. Server pushes a full downloads snapshot every 2s. |
| D8 | Streaming: backend and qBittorrent share a Docker volume `/downloads`. Backend streams the largest video file of a torrent (including incomplete `.!qb` files) with HTTP Range support so playback starts before the download finishes. Resolver ranks `.mkv`/`.webm`/`.ts` ahead of `.mp4` (MP4 `moov` is often at file end → not seekable until complete). Browser playback is limited to browser-supported codecs (H.264/VP9/AV1; **no HEVC/x265, no `.avi`**); unplayable files get a "Download file" fallback via `S10` so the user can open them externally. |
| D9 | Deployment: single `docker-compose.yml` with services `postgres`, `qbittorrent`, `prowlarr`, `backend`, `frontend`. Frontend served by nginx that proxies `/api` and `/socket.io` to the backend. |
| D10 | Cost: everything is free/open-source. Only external account required is a free TMDB API key. |
| D11 | Testing: **Vitest** on the backend (unit tests with mocked providers); frontend smoke test via manual run in M4. |
| D12 | Magnet links: prefer Prowlarr-provided magnet; otherwise build from `infoHash` + 9 public trackers (list in `02-specs.md` §4.3). |
| D13 | LAN exposure: `frontend`, `qbittorrent` (Web UI), and `prowlarr` are all published on host ports (`0.0.0.0`). qBittorrent must have strong credentials (it has its own login); Prowlarr has no auth — documented risk accepted for a home LAN. `postgres` and `backend` stay internal-only. |
| D14 | TV sources: show all Prowlarr results capped at 30 with a "Load more" control, plus a client-side **regex filter** over source titles (e.g. `1080p|x264`, exclude `CAM`). No season/episode parsing in v1. |

## Build order (how 03-tasks.md is sequenced)

Every milestone must be independently runnable and verifiable before the next starts:

1. Project scaffold (repo layout, tooling, config, docker-compose, CI if any).
2. Core domain logic that has no external dependencies (unit-testable first).
3. External integrations one at a time, each behind an interface (TMDB, Prowlarr, qBittorrent).
4. API layer over the domain logic (REST + Socket.IO).
5. UI layer.
6. End-to-end wiring, polish, and verification.

## Execution protocol

1. Agent reads `AGENTS.md`, then this file, then `03-tasks.md`.
2. Agent works through tasks **in order**. Each task names exactly which of the other docs to read.
3. After each task, the agent reports what it did and how the acceptance criteria were verified.
4. A human confirms each milestone before the next begins.

## Open Questions

- `Q1` Which trackers to enable in Prowlarr → resolved at runtime by the user in Prowlarr UI; code must not depend on any specific tracker. (Resolved by design, see D4.)
- `Q2` Pause/resume + delete-files options → nice-to-have, scheduled in `03-tasks.md` T5.3.

## Change log

| Date | Change |
|------|--------|
| 2026-09-01 | Created doc architecture and conventions. |
| 2026-09-01 | Full plan: locked stack (Node/Express + React + PostgreSQL + Prowlarr + qBittorrent + Socket.IO), streaming via shared volume + Range requests, docker-compose with 5 services. |
| 2026-09-01 | Senior review pass: fixed spec cross-refs, S4 insert/409, added S0 health + S10 file-download, codec-aware streaming priority, LAN exposure (D13), TV source cap+regex filter (D14), credentials docs task, .gitignore + .env.example. |
| 2026-09-01 | Implementation pass (senior review): fixed S8 image-path regex (`[a-zA-Z0-9/_.-]`), `stream_file_path` recompute on rename/staleness, single-file torrent `content_path` handling, `.ts`→`video/mp2t` MIME, qBittorrent sequential-download flags + `Referer`/host-header-validation/`Ok.` gotchas, Docker-first dev workflow. |
| 2026-09-01 | Live compose verification: confirmed qBittorrent 5.x login returns `204` (not `Ok.`), `torrents/add` returns structured JSON, add flags verified in-session (`seq_dl:true`, category `stream`), `stream` returns `206` Range through nginx, Socket.IO `downloads:initial` works, IP-ban guard documented (§4.2). |
