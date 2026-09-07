<div align="center">

# noAir

**Your library. No airtime.**

A self-hosted, open-source movie downloader. Search movies & TV through **TMDB**,
find torrent and magnet sources with **Prowlarr**, download them via **qBittorrent**,
watch live progress, and play the finished video in your browser — or in your own
desktop player. Nothing is streamed. Everything stays on your hardware.

</div>

---

## Why noAir

Most services push movies to you over the air — noAir does the opposite. The
name reads both ways:

- **no air** — nothing is streamed or broadcast. Downloads live on your machine, on your network.
- **noir** — a black & white interface over full-color artwork, with a cinematic feel to match.

Discover with rich metadata, grab the best available source, download at full
speed, and watch from your own library whenever you want.

## Features

| | |
|---|---|
| **Discover** | Browse and search movies & TV via the TMDB catalog — titles, posters, backdrops, trailers, seasons and episodes. |
| **Find** | Tracker-agnostic torrent search through Prowlarr. Public trackers like 1337x, The Pirate Bay and YTS are configured by you, never hard-coded. |
| **Download** | Pull the best-matching, most-seeded source with qBittorrent. Sequential download starts playback-ready pieces early. |
| **Track** | Live download progress pushed over Socket.IO — state, speed, ETA, pause, resume, remove. |
| **Watch** | In-browser playback for fully downloaded files, with automatic codec handling — audio remux, H.264 transcode and HLS packaging when the browser needs it. |
| **Open in your player** | 4K/HEVC or exotic audio? One click hands the file to VLC, MPV, MPC-HC or PotPlayer via a one-time `movie://` registration. |
| **Black & white chrome** | A monochrome UI over full-color artwork — Netflix-style cards, hover-trailer previews, and a clean cinematic aesthetic. |

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript (nginx proxy) |
| Backend | Node.js + Express + Socket.IO + TypeScript |
| Database | PostgreSQL 16 |
| Indexer | Prowlarr |
| Downloader | qBittorrent |
| Metadata & art | TMDB (optional Fanart.tv key) |
| Cloudflare bypass (optional) | FlareSolverr |

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
open. The setup is **platform-aware** — you get the right installer for the OS you're on.

- Open **Settings → Local player**. The card explains exactly what the installer will do and what
  output to expect (`Found: …` → `Verified: movie:// links now open …`). Pick your player (VLC / MPV;
  MPC-HC / PotPlayer on Windows), then **Download installer** (or **Copy installer**).
- **Windows** — run the downloaded `.cmd` once on this computer (double-click is fine). It auto-locates
  the player (preference first), registers the `movie://` handler for your user under HKCU (no admin),
  and prints the result.
- **Linux** — run the downloaded `.sh` once in a terminal: `bash ~/Downloads/install-movie-player.sh`.
  It auto-detects your installed player (`vlc`/`mpv`, including flatpak), writes a small launcher +
  desktop entry, registers the handler via `xdg-mime`, and verifies the registration.
- Back in the app, mark **“I ran it — movie:// works”**. The **Player** buttons on the Watch,
  Downloads and Detail pages then open the file directly in your local player. Until you confirm,
  those buttons route you to Settings instead of failing silently.
- Re-running the installer is harmless (it just overwrites its two files). To remove the handler,
  download and run the matching **uninstaller**. Switching players in Settings only takes effect
  after you re-run the installer once.

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

## Documentation & notes

- Full design and build plan: `docs/plan/`.
- Agent working rules: `AGENTS.md`.
- Branding & metadata (TMDB, Fanart.tv): the API terms of each service apply. Download content you
  have the right to.

<div align="center">

**noAir** — a self-hosted, open-source movie downloader. Built with React, Node, PostgreSQL, Prowlarr & qBittorrent.

</div>
