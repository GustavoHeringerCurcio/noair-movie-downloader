# Credentials — what you need and where it goes

This file is a **template**. Never paste real secrets here — real values live only in `.env` (gitignored) and in the local-only `docs/credentials.local.md` (gitignored). If you accidentally commit a real key, rotate it immediately.

## Credentials checklist

| Service | What | Where to get it | `.env` variable |
|---------|------|-----------------|-----------------|
| TMDB | API key (v3) | themoviedb.org → Settings → API (free account) | `TMDB_API_KEY` |
| Prowlarr | API key | Prowlarr UI → Settings → General → API Key (auto-generated) | `PROWLARR_API_KEY` |
| Prowlarr | Base URL | Compose-internal service name; only change if self-hosting elsewhere | `PROWLARR_URL` |
| qBittorrent | Web UI username | First qBittorrent Web UI login | `QBITTORRENT_USER` |
| qBittorrent | Web UI password | Set during first login — use a strong value (UI is LAN-exposed, D13) | `QBITTORRENT_PASS` |
| qBittorrent | Base URL | Compose-internal service name | `QBITTORRENT_URL` |
| PostgreSQL | `DATABASE_URL` | Self-contained in docker-compose (user `app`, no external account) | `DATABASE_URL` |
| Trackers (TPB, 1337x, …) | None — no keys | Configured in Prowlarr UI (Settings → Indexers), not in code | — |

Only external account required: **free TMDB API key**. Everything else is self-hosted and free.

## Boot order (Prowlarr chicken-and-egg)

1. `docker compose up -d prowlarr qbittorrent postgres`
2. Open Prowlarr UI → add trackers/indexers.
3. Copy the Prowlarr API key → paste into `.env` as `PROWLARR_API_KEY`.
4. Open qBittorrent Web UI once → set username/password → paste into `.env`.
5. Fill the remaining `.env` values, then `docker compose up -d --build`.

## Security rules

- Never commit `.env`. It is gitignored.
- Never paste real keys into `docs/credentials.md` (committed). Use `docs/credentials.local.md` instead.
- The TMDB key must never reach the browser — images are proxied via `/api/images/tmdb/*`.
- qBittorrent and Prowlarr are published on your LAN (decision D13). qBittorrent has its own login; **Prowlarr has no auth** — keep it on a trusted network.
- If any key is ever leaked, rotate it (TMDB: revoke/regenerate in account settings; Prowlarr: regenerate API key).
