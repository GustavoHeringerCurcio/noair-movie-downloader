<div align="center">

# noAir

**Self-hosted movie & TV downloader.**

Search the TMDB catalog, find the best release with Prowlarr, download it with qBittorrent,
and stream it straight from your own library — nothing leaves your hardware.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)
![qBittorrent](https://img.shields.io/badge/qBittorrent-2A6D9D?style=flat-square&logo=qbittorrent&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?style=flat-square&logo=socketdotio&logoColor=white)

![noAir home](assets/screenshots/home-hero.png)

</div>

## Features

| | |
|---|---|
| **Discover** | Browse and search movies & TV through the TMDB catalog — titles, posters, backdrops, trailers, seasons and episodes. |
| **Find** | Tracker-agnostic torrent search through Prowlarr. Enable any indexer (1337x, The Pirate Bay, YTS, …) — nothing is hard-coded. |
| **Download** | Best-matching, most-seeded release goes to qBittorrent. Sequential download pulls playback-ready pieces first. |
| **Track** | Live progress over Socket.IO — state, speed, ETA, pause, resume, remove. |
| **Watch** | In-browser playback of finished files with automatic codec handling — audio remux, H.264 transcode and HLS packaging when the browser needs it. |
| **Open in your player** | 4K/HEVC or exotic audio? One click hands the file to VLC, MPV, MPC-HC or PotPlayer via a one-time `movie://` registration. |
| **Cinematic UI** | A black & white chrome over full-color artwork — hover-trailer previews, IMDb ratings, quality-filtered release lists, and per-title version grouping. |

## Screenshots

| | |
|---|---|
| ![Title detail](assets/screenshots/detail.png) | ![Downloads](assets/screenshots/downloads.png) |
| Title detail — metadata, versions, watch | Downloads — grouped versions & status |
| ![In-browser playback](assets/screenshots/watch.png) | ![Discover](assets/screenshots/home-hero.png) |
| Watch — in-browser playback | Discover — trending rails |

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript (served through nginx) |
| Backend | Node.js + Express + Socket.IO + TypeScript |
| Database | PostgreSQL 16 |
| Indexer | Prowlarr |
| Downloader | qBittorrent |
| Metadata & art | TMDB (optional OMDb, fanart.tv) |
| Cloudflare bypass (optional) | FlareSolverr |

## Quickstart

Requires **Docker + Docker Compose**.

1. Copy the environment template and fill in your credentials — see `docs/credentials.md`
   for where each one comes from:

   ```
   cp .env.example .env
   ```

2. Start the backing services first:

   ```
   docker compose up -d prowlarr qbittorrent postgres
   ```

3. Configure each service once:

   - **Prowlarr** → open `http://localhost:9696`, add at least one indexer
     (Settings → Indexers → Add Indexer) and copy the API key
     (Settings → General → API Key) into `.env` as `PROWLARR_API_KEY`. The app is
     tracker-agnostic and ships with none — an empty Sources list on the Detail page
     means no indexer is enabled yet (see *Indexers* below).
   - **qBittorrent** → open `http://localhost:8080`, set a strong username/password and
     put them in `.env` as `QBITTORRENT_USER` / `QBITTORRENT_PASS`.
   - **TMDB** → get your free key from the TMDB API settings and put it in `.env` as
     `TMDB_API_KEY`.

4. Build and start everything:

   ```
   docker compose up -d --build
   ```

5. Open [http://localhost:5173](http://localhost:5173).

<details>
<summary><b>Adding indexers to Prowlarr</b></summary>

1. Prowlarr UI → **Settings → Indexers → Add Indexer** → pick public trackers (1337x, TPB, YTS, …).
2. For each: pick a **Base Url**, click **Test**, then **Save**.
3. Many public trackers (notably 1337x) sit behind Cloudflare. If an indexer's Test fails with
   *"blocked by CloudFlare Protection"*, either pick a different indexer or set up FlareSolverr:

   - Start it: `docker compose up -d flaresolverr`
   - Prowlarr UI → **Tools → FlareSolverr → Add** → URL `http://flaresolverr:8191`, give it a
     **Tag** (e.g. `fs`), Save.
   - On the blocked indexer, set the same **Tag** (`fs`), then Test again.

</details>

## Open in your player (one-time setup)

Downloads play in the browser as soon as the file is complete. Codecs the browser can't decode
(4K/HEVC, exotic audio) show an **"Open in your player"** button instead. Browsers can't launch
desktop apps on their own, so the app registers a `movie://` handler for you — the setup is
**platform-aware**, so you get the right installer for the OS you're on.

- Open **Settings → Local player**, pick your player (VLC / MPV; MPC-HC / PotPlayer on Windows) and
  download the installer.
- **Windows** — run the downloaded `.cmd` once (double-click is fine). It auto-locates the player,
  registers the `movie://` handler for your user under HKCU (no admin) and prints the result.
- **Linux** — run the downloaded `.sh` once: `bash ~/Downloads/install-movie-player.sh`. It
  auto-detects your player (`vlc`/`mpv`, incl. flatpak), registers the handler via `xdg-mime` and
  verifies it.
- Mark **"I ran it — movie:// works"** in Settings. Until then, the **Player** buttons on the Watch,
  Downloads and Detail pages route you to Settings instead of failing silently.

Re-running the installer is harmless. Switch players by re-running it once. To remove the handler,
run the matching uninstaller.

## Development

Run the API and Vite dev server locally (without Docker):

```
cd backend && npm install && npm run dev      # API + Socket.IO on :3000
cd frontend && npm install && npm run dev     # Vite on :5173, proxies /api + /socket.io to :3000
```

Checks in each package: `npm test`, `npm run lint`, `npm run typecheck`.

## Ports & LAN exposure

`frontend` (5173), `qbittorrent` (8080) and `prowlarr` (9696) are published on the host.
`postgres` and `backend` are internal-only. qBittorrent requires its own login; **Prowlarr has no
auth** — keep it on a trusted network.

## Troubleshooting

<details>
<summary><b>Common issues</b></summary>

- **Broken poster/backdrop images (HTTP 502)**: the backend proxies images from `image.tmdb.org`,
  and some ISP/DNS servers return a dead BunnyCDN edge for that host. `docker-compose.yml` pins a
  reachable edge via `backend.extra_hosts.image.tmdb.org` — if images break again, resolve the host
  with a public resolver (e.g. `Resolve-DnsName image.tmdb.org -Server 1.1.1.1`) and update the
  pinned IP. Check `docker compose logs backend` for `image proxy fetch failed`.
- **Detail page shows "Prowlarr API key invalid"**: `PROWLARR_API_KEY` in `.env` is wrong or missing.
  Copy it from Prowlarr UI → Settings → General → API Key, then `docker compose up -d`.
- **Detail page shows "Prowlarr unreachable"**: the backend can't reach Prowlarr — check the
  `prowlarr` container is up.
- **No sources in the Detail page**: the API key is valid but no indexer returned results — add or
  enable indexers in Prowlarr (see *Indexers* above) and test them.
- **Backend logs `qBittorrent ... 403`**:
  1. qBittorrent's Web UI host-header validation rejects the internal `qbittorrent` Host — open its
     Web UI → Tools → Options → Web UI → *Host header validation* → **Disabled** (or set
     `WebUI\HostHeaderValidationEnabled=false` in `/config/qBittorrent/qBittorrent.conf`), then
     restart the backend.
  2. Repeated failed logins triggered qBittorrent's **IP ban** — the backend polled with wrong
     credentials and banned its own container IP. Restart the qBittorrent container to clear it,
     then fix the credentials in `.env`.
- **HEVC/x265 or `.avi` won't play in-browser**: use *Download file* and open in a native player
  (browser codec limitation, not a bug).

</details>

## Security

- Secrets live only in `.env` (gitignored) — never commit them.
- API keys never reach the browser. TMDB images are proxied through `/api/images/tmdb/*`; key-art
  and posters are cached server-side and served from `/api/images/art/*`.
- See `docs/credentials.md` for where each credential comes from and rotation steps.

## Documentation

- `docs/credentials.md` — credential setup and rotation.
- `docs/plan/` — design and build notes.
- `AGENTS.md` — repository working rules.

Download content you have the right to. Respect the terms of the services you use.
