# T-006 — Web-streaming decision (spike output)

Date: 2026-09-07. Status: **approved by spike (T-006)**. Implementation lives in the
follow-up ticket T-007. This document records the spike's verification and costing,
compares the candidate strategies, and states the decision. No production code was
changed by the spike itself.

## 1. Problem restated

Some fully-downloaded movies cannot be watched in the in-browser player. Real cases in
this install: **The Dark Knight ("Batman")** and **Blade Runner 2049** are unplayable;
**X-Men '97** plays fine. The author remembered that "before [the Shaka player],
ffmpeg-based playback seemed to play more video types", and asked whether Shaka is the
right choice and whether it is well configured.

The spike verified the root-cause hypothesis on the real files, measured the CPU/disk
cost of the candidate strategies on this host, and picked one.

## 2. Real-file verification (acceptance criterion 1)

All three problem files were probed with the app's own pipeline: `ffprobe` full
stream dump (identical args to `lib/mediaInfo.ts`) plus the live `playinfo` response
(`S7b`) from the running backend, and the frontend gating decision was traced in code.

| File (download row) | ffprobe video | audio / subs | `playinfo` mode | `mseProbe` | In-browser result |
|---|---|---|---|---|---|
| The Dark Knight (tmdb 155, row 9) `1080p.BluRay.x265.10bit-GalaxyRG265.mkv` | **hevc · Main 10 · yuv420p10le · level 120 · 1920×1080** · bt709, 2h32m, 4.0 GB | eac3 5.1; 1 subrip | `hls` | `[]` | **player screen** (`hls && !canPlayHls`) |
| Blade Runner 2049 (tmdb 335984, row 8) `1080p...x265.10bit-KONTRAST.mp4` | **hevc · Main 10 · yuv420p10le · level 120 · 1920×1080** · bt709, 2h44m, 4.8 GB | aac-lc 5.1; none | `hls` | `[]` | **player screen** |
| X-Men '97 S01E01 (tmdb 138502, row 10) | h264 · High · yuv420p · 1280×720 · level 31 | aac-lc 2ch; 24 text subs | `hls` | `[avc1.640028…, avc1.4d401f…]` | **plays** (fast copy package) |

Extra real data points found on the same volume (no DB rows): The Dark Knight 4K REMUX
`2160p...HDR10 DV...REMUX` = hevc · Main 10 · yuv420p10le · **3840×2160** · smpte2084
(59 GB) — the 4K-class file; The Odyssey 1080p TELESYNC = hevc · Main 10 ·
yuv420p10le · 1920×1000 — another ≤1080p 10-bit file; Oppenheimer 4K = hevc 2160p HDR.

### Verdict on the hypothesis: **confirmed**

1. Every unplayable file is **HEVC (x265) 10-bit at ≤1080p** (Main 10 /
   yuv420p10le). For these, `lib/hls.ts` `hevcBeyondBrowserSupport()` returns true, so
   `mseProbeTypes()` yields `[]` and the live `playinfo` answers `mseProbe: []`.
2. `WatchPage.tsx:31-39` (`canPlayHlsInBrowser`) → `codecUnsupported` → the
   `hls && codecUnsupported` branch at `WatchPage.tsx:219-220` renders the "Open in
   your player" screen (`:340`). The ffmpeg transcode fallback that existed pre-Shaka
   is **never offered** for these files.
3. Pre-Shaka behavior (`docs/plan/00-index.md` D8 / `lib/streamPlan.ts`
   `decideStreamMode`) had a catch-all `transcode` branch for **sub-2160p** non-safe
   video (`:30-31`), live re-encoding HEVC ≤1080p to H.264 via `/api/stream/:hash/watch`
   (`stream.ts:99-125`, `lib/transcode.ts`). **4K/UHD HEVC was `player-required` in
   both eras** (`decideStreamMode :30`, and `decidePlaybackMode :59` for 4K), so 4K
   never played in-browser either way.
4. The author's memory is correct: the pre-Shaka path played 1080p/720p HEVC by live
   re-encode — at the cost of per-play CPU, no seeking, and one generic audio stream.

X-Men '97 confirms the good path: h264 video is packaged by stream-copy in seconds and
plays through Shaka with its full language/subtitle menus.

Additional note for the follow-up: on Linux Chrome/Firefox the MSE probe also fails for
**plain 8-bit HEVC** (no HEVC decode at all, `MediaSource.isTypeSupported` false), so
the compatibility path must be gated on the browser probe, not on bit depth alone. The
existing frontend probe (`mseProbe` strings) already implements exactly that check.

## 3. Host and benchmark setup

- Host: **AMD Ryzen 7 5700U** (8 cores / 16 threads), 14 GB RAM, normal single-user
  home box running the whole Docker stack plus desktop load. Backend container = the
  app's own image (Alpine ffmpeg 8.0.1, **software decode/encode only** — no GPU
  passthrough in `docker-compose.yml`). ffprobe/ffmpeg confirmed able to decode
  10-bit HEVC Main 10 (`yuv420p10le`) — required for any transcode strategy.
- The host was shared during the spike (other agents/tooling at load ~19-37), so each
  number is reported with the load at measurement; low-load runs are the fair ones.

### Measured cost of H.264 re-encode on the real files

Command: the app's exact encoder profile — `libx264 -preset veryfast -crf 21
-pix_fmt yuv420p`, audio `aac 192k` (`lib/transcode.ts`, `lib/hls.ts` audio args).

| Measure | Run | Result |
|---|---|---|
| 1080p HEVC-Main10 → H.264, first 120 s (host busy, load ≈30) | The Dark Knight | 120 s content in **70.6 s wall ≈ 1.7× realtime** |
| Same, first 60 s (load ≈19) | The Dark Knight | 60 s in **21 s wall ≈ 2.9× realtime** |
| Same, full-file background fMP4 package build (load ≈24-27) | The Dark Knight | sustained ≈2.2× realtime (81 segs/218 s before stop); full 2h32m extrapolates to **≈70 min wall** |
| 2160p HEVC-Main10 → scaled 1080p H.264, 45 s (load ≈24, one package build running) | Dark Knight 4K REMUX | 45 s in 49 s wall ≈ **0.9× realtime**; full 2h32m ≈ **>2.5 h wall** |
| 4K decode at ≤2 GB free RAM, uncapped threads | Dark Knight 4K REMUX | **OOM-killed** (frame-threaded 2160p decode balloons RAM); thread-capped/paced runs are fine |

Pure decode-only runs of 1080p 10-bit measured 0.4-0.6× realtime while the host was
swapping — an artifact of the frame-threaded decoder ballooning memory into a
fast sink, not a representative number; the encode pipeline (which paces the decoder)
is the authoritative figure above.

### Measured disk cost (CRF21 veryfast, 1080p)

- Pipe to fragmented mp4 (the `/watch` live command): ≈3.95 Mb/s total.
- Full-file fMP4 HLS package (strategy A layout): 0.44-0.50 MB/s measured (214 MB per
  486 s of content) ≈ 4.3 Mb/s. For a 2h32m film: **≈4.0-4.7 GB** package vs **4.3 GB**
  source (x265 10-bit CRF≈source size). A compat package therefore roughly **adds
  ~1.0× the source file's size** to the `packages` volume. Audio renditions add only
  ~90 MB/h each (192 kb/s AAC ≈ 220 MB for a 2h32m film); WebVTT subs are negligible.
- 2160p→1080p capped rendition output: ≈3.5 Mb/s → ≈4.0 GB per 2h32m 4K film.

## 4. Candidate strategies — costed comparison

Key: **CPU** is the scarce resource (8 real cores, software codecs). Seekability,
latency, and menu quality are the user-visible differentiators.

### A. Keep Shaka/HLS; add a background H.264 "compatibility package" with auto-fallback

For any completed file the browser cannot decode whose video is ≤1080p (real case:
HEVC Main10 1080p/720p), build a **cached HLS package whose video rendition is
H.264** (same layout/pipeline as today's S14 packages — video step swapped from
`-c:v copy` to the measured libx264 encode; audio/subtitles unchanged). The MSE
preflight that today short-circuits to the player screen instead offers/starts the
compat package automatically; a cancel/bit-perfect path stays.

- **CPU**: one burst of ~70-80 min wall on this host per 2h32m 1080p HEVC file
  (~1.7-2.9× realtime, whole box), then **zero per replay** (cached, `DONE` marker,
  deleted with the torrent today). One build at a time + never during a live `/watch`
  stream keeps the box usable; the 2 s qBittorrent poll is unaffected (negligible CPU).
- **Disk**: ~+4.0-4.7 GB per such film on the existing `packages` volume (≈1.0× source).
  Needs an eviction/size budget beyond today's delete-on-torrent-delete.
- **Seek**: full VOD seeking via Shaka — same as today's good packages. No seeking
  regression.
- **Latency**: first watch pays the build (visible progress bar, as today — but ~1 h,
  not ~8 s, so the UI must be honest and cancellable to the local player); later
  watches are near-instant.
- **Quality**: one lossy encode (H.264 CRF21 — visually near-transparent for typical
  1080p; 10-bit→8-bit banding is the theoretical edge). All original audio tracks and
  text subtitles are preserved with per-language menus (Shaka).
- **Compatibility width**: restores the pre-Shaka universality for ≤1080p (HEVC 8/10
  bit, and incidentally any other non-browser-decodable ≤1080p codec that today hits
  the legacy live `transcode` branch).

### B. Drop Shaka; route everything through live `/watch` ffmpeg (the old behavior)

- **CPU**: identical encoder, but **per play** — every watch of a 2h32m HEVC film
  burns ~50-90 min of box CPU at ~1.7-2.9× realtime headroom. Two concurrent watches
  (or a watch + a background task) risk falling below realtime → stalls.
- **Disk**: none.
- **Seek**: none for transcoded files (progressive pipe, restart-to-seek) — a
  regression versus today's *seekable* direct/HLS good path.
- **Latency**: lowest start for the currently-unplayable class (no build), but no seek
  and restart-from-zero.
- **Quality**: same single lossy encode as A, plus only the first audio track and no
  subtitle menus — loses Shaka's per-language/subtitle UI on every file it touches.
  To avoid regressing the good h264 path you must keep Shaka anyway, which reduces B
  to "A without the cache" — strictly worse CPU and UX for the same code.

### C. Keep as-is; make the player-required screen the experience (depends on T-001)

- **CPU/disk**: zero new cost. **Result**: the in-browser player stays unable to play
  the most common movie encodes on this install (HEVC-Main10 1080p — the default
  release tier for films), and in-browser playback keeps depending on T-001 for every
  such file. X-Men-class files keep working.

## 5. Decision

**Adopt A** — keep Shaka/HLS as the player, and add an **on-demand, cached H.264
"compatibility package"** that auto-falls-back for completed ≤1080p files the
browser's MSE cannot decode (HEVC Main/Main10 and other non-decodable ≤1080p video),
with the external-player "Open in your player" flow retained as a first-class cancel
path.

The optional **4K → capped-1080p web rendition is deferred (out of the core
implementation, recorded as a possible later extension)**: 4K never played in-browser
in any era (bit-perfect external playback is the existing answer); on this host it
costs >2.5 h of CPU and ~4 GB per film with realtime-only headroom and OOM risk on a
low-RAM box. Not worth it for a single-user LAN app while T-001 covers 4K.

Rationale tied to this repo's constraints:

1. **Single-user self-host**: a one-time background cost (A) is affordable; the
   per-play live cost of B is the same CPU spent over and over. On 8 real cores,
   B's realtime headroom is the thing that breaks first.
2. **PACKAGE_DIR volume + S14 pipeline already exist**: A reuses the package manager,
   caching, `DONE`-marker, concurrency-aware progress, and delete-on-torrent-delete
   with a video-step change and a codec/browser gate. No new storage architecture.
3. **ffmpeg in the app image already decodes 10-bit HEVC** (software) — verified; no
   image change, no GPU dependency.
4. **No regression to the good path**: h264/vp9/av1 direct/HLS, AAC stream-copy, and
   per-language/subtitle menus are untouched; only files today condemned to the
   player screen gain a new in-browser route. A also shrinks the urgency of T-001/T-003
   without removing them.
5. **Codec normalization out of scope**: browsers on Linux cannot gain HEVC decode, so
   the compat package encodes *to* what browsers decode rather than fixing HEVC.

### Consequence for the follow-up ticket (T-007)

- New route/flag that asks the package manager for a **compat variant** of a package
  (video rendition re-encoded to H.264 CRF21 veryfast) triggered when the browser's
  MSE cannot decode the file's own video and height < 2160.
- WatchPage: the `hls && codecUnsupported` branch becomes a **"building a web-compatible
  copy"** state (progress, cancel → local player), never a dead end.
- Guardrails: at most one compat build at a time, and it must not starve a live
  `/watch` stream or the 2 s qBittorrent poll (poll CPU is negligible either way).
- Disk: eviction/size policy for the `packages` volume (compat packages are ~1.0× the
  source's size).
- 4K (>2160p or 2160p non-decodable): unchanged, stays on the external-player flow.
- External-player + Download-file stay reachable from every Watch state.

## 6. What was NOT changed

No production code (backend or frontend) was modified by this spike. Benchmark artifacts
lived in the backend container's `/tmp` and were removed.
