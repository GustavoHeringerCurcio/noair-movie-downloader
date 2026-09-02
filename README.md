# Movie Downloader

Self-hosted web app that searches movies/TV via **TMDB**, finds torrent/magnet sources via **Prowlarr**, downloads them with **qBittorrent**, shows live progress, and streams the video in-browser while it downloads.

The full plan lives in `docs/plan/`. Agent rules: `AGENTS.md`.

## Stack

| Service | Image | Host port |
|---------|-------|-----------|
| frontend (React + nginx proxy) | built | `5173` |
| backend (Node + Express + Socket.IO) | built | internal only |
| postgres | `postgres:16-alpine` | internal only |
| qbittorrent | `linuxserver/qbittorrent` | `8080` |
| prowlarr | `linuxserver/prowlarr` | `9696` |

## Quickstart

1. Copy the env template and fill in credentials (see `docs/credentials.md`):

   ```
   cp .env.example .env
   ```

2. Start Prowlarr + qBittorrent first (Prowlarr has no API key until you configure it):

   ```
   docker compose up -d prowlarr qbittorrent postgres
   ```

3. Open the Prowlarr UI at `http://localhost:9696`, add trackers/indexers, then copy its API key
   (Settings → General → API Key) into `.env` as `PROWLARR_API_KEY`.

4. Open the qBittorrent Web UI at `http://localhost:8080` once, set a strong username/password,
   and put them in `.env` as `QBITTORRENT_USER` / `QBITTORRENT_PASS`.

5. Fill in your free TMDB key (`TMDB_API_KEY`) in `.env`, then:

   ```
   docker compose up -d --build
   ```

6. Open `http://localhost:5173`.

## Development (outside Docker)

```
cd backend && npm install && npm run dev      # API + Socket.IO on :3000
cd frontend && npm install && npm run dev     # Vite dev server on :5173, proxies /api + /socket.io to :3000
```

Tests / checks: `npm test`, `npm run lint`, `npm run typecheck` in each package.

## Ports & LAN exposure

`frontend` (5173), `qbittorrent` (8080), and `prowlarr` (9696) are published on the host.
`postgres` and `backend` are internal-only. qBittorrent requires its own login; **Prowlarr has no
auth** — keep it on a trusted network.

## Troubleshooting

- **Backend logs `qBittorrent ... 403`**: two likely causes. (1) qBittorrent's Web UI host-header
  validation rejects the internal `qbittorrent` Host — open its Web UI → Tools → Options → Web UI →
  *Host header validation* → **Disabled** (or set `WebUI\HostHeaderValidationEnabled=false` in
  `/config/qBittorrent/qBittorrent.conf`), then restart the backend. (2) Repeated failed logins have
  triggered qBittorrent's **IP ban** (`web_ui_max_auth_fail_count`, default 5) — the backend polled
  with wrong credentials and banned its own container IP; restart the qBittorrent container to clear
  it, then fix the credentials in `.env`.
- **No sources in the Detail page**: check `.env` `PROWLARR_API_KEY`, that trackers are configured,
  and that Prowlarr can reach them (Prowlarr → Indexers → *Test*).
- **Playback stalls on a partially-downloaded torrent**: torrents are added with sequential
  download enabled; if a torrent was added elsewhere without it, playback starts once enough of the
  start of the file is present.
- **HEVC/x265 or `.avi` won't play in-browser**: use the *Download file* action and open in a native
  player (browser codec limitation, not a bug).

## Security notes

- Secrets live only in `.env` (gitignored) — never commit them.
- The TMDB key never reaches the browser; images are proxied through `/api/images/tmdb/*`.
- See `docs/credentials.md` for where each credential comes from and rotation steps.
