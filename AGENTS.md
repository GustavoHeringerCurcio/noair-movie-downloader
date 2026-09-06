# AGENTS.md — Project Rules

Entry point for any agent working in this repo. Read this file first.

## Project
- Product name: `noAir` (GitHub repo: `noair-movie-downloader`)
- One-line purpose: Self-hosted web app that searches movies/TV via TMDB, finds torrent/magnet sources via Prowlarr, downloads them with qBittorrent (Docker), shows live download progress, and streams the video in-browser.
- Full plan lives in `docs/plan/00-index.md`.

## Commands
- Install deps: `cd backend && npm install` · `cd frontend && npm install`
- Run app: `docker compose up -d --build` (or `npm run dev` in `backend/` and `frontend/`)
- Test: `cd backend && npm test` · `cd frontend && npm test`
- Lint: `npm run lint` (each package)
- Typecheck: `npm run typecheck` (each package)

## Conventions
- TypeScript strict in both packages. Tests are Vitest (backend) with mocked external providers.
- API field names are camelCase; DB columns snake_case (see `docs/plan/02-specs.md` §5).
- External providers (TMDB, Prowlarr, qBittorrent) are always behind an interface in `backend/src/services/`.
- Secrets live only in `.env` (gitignored). Never commit keys. The TMDB key must never reach the browser — images go through `/api/images/tmdb/*`.
- Credentials setup is documented in `docs/credentials.md` (template) and `docs/credentials.local.md` (gitignored local notes).
- qBittorrent is polled at exactly 2s intervals; never faster.

## Editing rules
- Design decisions belong in `docs/plan/00-index.md` — never invent them in code.
- Keep `docs/plan/` up to date when a design or spec changes; you are allowed (and expected) to edit these files when necessary.
- Follow the execution protocol in `docs/plan/00-index.md`.

## Do not touch
- `.env` (user secrets)
