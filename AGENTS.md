# AGENTS.md — Project Rules

Entry point for any agent working in this repo. Read this file first.

## Project
- Product name: `noAir` (GitHub repo: `noair-movie-downloader`)
- One-line purpose: Self-hosted web app that searches movies/TV via TMDB, finds torrent/magnet sources via Prowlarr, downloads them with qBittorrent (Docker), and **streams ~90% of titles in-browser** so the user can watch from any device (TV/PC/phone) via a Cloudflare tunnel or their own domain. External players are a fallback, never the norm.

## Commands
- Install deps: `cd backend && npm install` · `cd frontend && npm install`
- Run app (prod images): `npm run prod` (= `docker compose up -d --build`)
- Dev (hot reload — use this while building features): `npm run dev` —
  runs infra as-is but replaces `backend`/`frontend` with dev containers
  (`tsx watch` + Vite HMR) whose `src` is bind-mounted, via
  `docker-compose.dev.yml`. Open http://localhost:5173. Source edits apply in
  seconds; never rebuild. After adding an npm dependency run `npm run dev:rebuild`.
  Extra (root `package.json`): `dev:start` (no rebuild) · `dev:logs` · `dev:down`.
  PowerShell alias with the same subcommands: `scripts/dev.ps1`.
- Test: `cd backend && npm test` · `cd frontend && npm test`
- Lint: `npm run lint` (each package)
- Typecheck: `npm run typecheck` (each package)

## Conventions
- TypeScript strict in both packages. Tests are Vitest (backend) with mocked external providers.
- API field names are camelCase; DB columns snake_case.
- External providers (TMDB, fanart.tv, Prowlarr, qBittorrent) are always behind an interface in `backend/src/services/`.
- Secrets live only in `.env` (gitignored). Never commit keys. The TMDB and fanart.tv keys must never reach the browser — TMDB images go through `/api/images/tmdb/*`; fanart key-art is cached server-side and served from `/api/images/fanart/*`; portrait posters and transparent logos are downloaded once by the backend to the `art` volume and served from `/api/images/art/*` (D21/D22/T-002).
- Credentials setup is documented in `docs/credentials.md` (template) and `docs/credentials.local.md` (gitignored local notes).
- qBittorrent is polled at exactly 2s intervals; never faster.

## Documentation
- No separate plan/spec docs. `README.md`, this file, and code comments are the source of truth — do not recreate `docs/plan/`.

## Do not touch
- `.env` (user secrets)
