# Movie Downloader

Self-hosted web app that searches movies/TV via **TMDB**, finds torrent/magnet sources via **Prowlarr**, downloads them with **qBittorrent**, shows live progress, and plays the finished video in the browser (or in your own desktop player).

The full plan lives in `docs/plan/`. Agent rules: `AGENTS.md`.

## Stack

| Service | Image | Host port |
|---------|-------|-----------|
| frontend (React + nginx proxy) | built | `5173` |
| backend (Node + Express + Socket.IO) | built | internal only |
| postgres | `postgres:16-alpine` | internal only |
| qbittorrent | `linuxserver/qbittorrent` | `8080` |
| prowlarr | `linuxserver/prowlarr` | `9696` |
| flaresolverr (Cloudflare bypass, optional) | `ghcr.io/flaresolverr/flaresolverr` | `8191` |

## Quickstart

1. Copy the env template and fill in credentials (see `docs/credentials.md`):

   ```
   cp .env.example .env
   ```

2. Start Prowlarr + qBittorrent first (Prowlarr has no API key until you configure it):

   ```
   docker compose up -d prowlarr qbittorrent postgres
   ```

3. Open the Prowlarr UI at `http://localhost:9696` and **add at least one indexer**
   (Settings → Indexers → Add Indexer, e.g. 1337x, The Pirate Bay, YTS). Then copy its API key
   (Settings → General → API Key) into `.env` as `PROWLARR_API_KEY`. See *Adding indexers* below.

4. Open the qBittorrent Web UI at `http://localhost:8080` once, set a strong username/password,
   and put them in `.env` as `QBITTORRENT_USER` / `QBITTORRENT_PASS`.

5. Fill in your free TMDB key (`TMDB_API_KEY`) in `.env`, then:

   ```
   docker compose up -d --build
   ```

6. Open `http://localhost:5173`.

## Adding indexers to Prowlarr

The app is tracker-agnostic — sources come from whatever indexers you enable in Prowlarr.
Without at least one, the Detail page will show an empty Sources list (the app isn't bundled with any).

1. Prowlarr UI → **Settings → Indexers → Add Indexer** → pick public trackers (1337x, TPB, YTS, …).
2. For each: pick a **Base Url**, click **Test**, then **Save**.
3. Many public trackers (notably 1337x) sit behind Cloudflare. If an indexer's Test fails with
   *"blocked by CloudFlare Protection"*, either pick a different indexer, or set up FlareSolverr:
   - Start it: `docker compose up -d flaresolverr`
   - Prowlarr UI → **Tools → FlareSolverr → Add** → URL `http://flaresolverr:8191`, give it a
     **Tag** (e.g. `fs`), Save.
   - On the blocked indexer, set the same **Tag** (`fs`), then Test again.

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

## Open movies in your local player (one-time setup)

Downloads play in the browser as soon as the file is fully downloaded. Codecs the browser can't
decode (4K/HEVC, exotic audio) show an **"Open in your player"** button instead. Browsers can't
launch desktop apps on their own, so the app uses a `movie://` link your machine must be told how to
open.

- Open **Settings → Local player**, pick your player (VLC / MPV / MPC-HC / PotPlayer), and click
  **Download installer (.cmd)**.
- Run the downloaded `.cmd` once **on the machine where that player is installed** (Windows). It
  auto-locates the player, writes a small wrapper, and registers the `movie://` handler for your
  user.
- The **Player** buttons on the Watch and Downloads pages then open the file directly in your local
  player. Use the **Download uninstaller** button anytime to remove the handler.

Until it's registered, the **Download file** button is the fallback.

## Troubleshooting

- **Poster/backdrop images broken (HTTP 502 in the browser console)**: the backend proxies images
  from `image.tmdb.org`, but some ISP/host DNS servers return a dead BunnyCDN edge for that host
  (TCP connections time out). `docker-compose.yml` pins a reachable edge via
  `backend.extra_hosts.image.tmdb.org` — if images break again, that edge may have rotated, so
  resolve the host with a public resolver (e.g. `Resolve-DnsName image.tmdb.org -Server 1.1.1.1`)
  and update the pinned IP. Check `docker compose logs backend` for
  `image proxy fetch failed` lines.
- **Detail page shows "Prowlarr API key invalid"**: `PROWLARR_API_KEY` in `.env` is wrong or
  missing. Copy it from Prowlarr UI → Settings → General → API Key, then `docker compose up -d`.
- **Detail page shows "Prowlarr unreachable"**: the backend can't reach Prowlarr — check that the
  `prowlarr` container is up.
- **No sources in the Detail page**: the API key is valid but no indexer returned results — add/enable
  indexers in Prowlarr (see *Adding indexers*) and test them.
- **Backend logs `qBittorrent ... 403`**: two likely causes. (1) qBittorrent's Web UI host-header
  validation rejects the internal `qbittorrent` Host — open its Web UI → Tools → Options → Web UI →
  *Host header validation* → **Disabled** (or set `WebUI\HostHeaderValidationEnabled=false` in
  `/config/qBittorrent/qBittorrent.conf`), then restart the backend. (2) Repeated failed logins have
  triggered qBittorrent's **IP ban** (`web_ui_max_auth_fail_count`, default 5) — the backend polled
  with wrong credentials and banned its own container IP; restart the qBittorrent container to clear
  it, then fix the credentials in `.env`.
- **Playback stalls on a partially-downloaded torrent**: torrents are added with sequential
  download enabled; if a torrent was added elsewhere without it, playback starts once enough of the
  start of the file is present.
- **HEVC/x265 or `.avi` won't play in-browser**: use the *Download file* action and open in a native
  player (browser codec limitation, not a bug).

## Security notes

- Secrets live only in `.env` (gitignored) — never commit them.
- The TMDB key never reaches the browser; images are proxied through `/api/images/tmdb/*`.
- See `docs/credentials.md` for where each credential comes from and rotation steps.
