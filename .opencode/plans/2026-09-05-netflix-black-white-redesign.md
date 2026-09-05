# Netflix-style Black & White Redesign + TV Seasons/Episodes Download UX

Date: 2026-09-05
Status: **Locked v4** — GA-1..GA-18 + second-pass fixes (NB-1..NB-18) resolved; **PART C UX layer added** (confirm-download sheet C-DL1, local resume C-DL2, inline first-run guidance C-DL3); findings appended in § Second-pass analysis (v3).
Scope: Full frontend visual refactor (all routes) + backend TV season/episode support.

## Goal

Clone the Netflix look & feel in **strict black & white** branding for an app whose core loop is
*download before you watch*:

- Transparent top header that fades to a black gradient on scroll (replaces the left sidebar).
- Static cinematic brand hero (looping monochrome `.gif` asset, user-supplied) for now.
- All rails use **landscape 16:9 title cards** (wide, not tall), rightmost card clipped/peeking to invite horizontal scroll.
- TV shows map TMDB seasons → episodes with per-season and per-episode **friendly downloads** (most-seeded default), **delete**, and an **Advanced picker** exposing every Prowlarr option.

## Locked decisions (v4)

| # | Decision |
|---|----------|
| L1 | TV depth = "Episode search + season pack". No qBittorrent file-priority cherry-picking inside a pack. (GA-13 partial packs are allowed *as content coverage*, not per-file selection.) |
| L2 | All pages get the Netflix treatment (Home, Detail, Downloads, Watch, Settings). |
| L3 | Hero = static brand GIF for now (GA-14); auto "last-watched" hero deferred. Last-watched surfaces via **My Downloads** + **Recently Viewed**. |
| L4 | Search = full-screen dark overlay (focus-trap + Esc + focus restore — GA-16). |
| L5 | Strict grayscale; state/progress/seeders mapped to luminance. |
| L6 | Rows = 16:9 landscape backdrops (`w1280` proxy); clipped right edge; layout is full-bleed (GA-1). |
| L7 | Friendly downloads pick the **most-seeded matching source**; 409 "already downloading" is surfaced (GA-18). |
| L8 | A per-episode download never silently downloads a whole season → toast + Advanced picker pre-scoped (GA-12). |
| L9 | Header nav = **Home · Downloads · Settings** + search; "Movies/TV Shows" links deferred (GA-7). |
| L10 | Top rail named **"My Downloads"** (not "Continue Watching") until per-file resume positions exist (GA-9). |
| L11 | TV downloads store `season_number`/`episode_number`; all downloads store `backdrop_path` (GA-2). |
| L12 | Null-coverage TV sources are **Advanced-only**; never auto-picked for friendly downloads (GA-4). |
| L13 | New metadata endpoint `GET /api/media/:id/season/:n?type=tv` (S12) and `/watch/:hash?episode=SxxExx` auto-select (GA-6). |
| C-DL1 | Every friendly download opens a **ConfirmDownloadSheet** naming the exact pick (release title, quality, size, seeders, indexer) → `[Start]` `[Advanced…]`. Sources resolve in the background so the sheet is instant; no blind auto-start (resolves NB-2 by consent). |
| C-DL2 | **Local-only playback resume**: per-file position persisted to `localStorage` (~5s cadence); player offers `Resume from 12:34` / `Restart`; the rail keeps the "My Downloads" name (no backend change). |
| C-DL3 | First-run guidance is **inline** (empty-state 3-step copy in My Downloads, trending suggestions in the search overlay); no overlay tour. |

> docs/plan updated in lock-step (00-index D14/D15/D16 + 02-specs S2/S3/S4/S5/S12, §2, §3, §4.1, §4.3). See §0.

## §0 docs/plan delta (Task 0 — applied 2026-09-05)
- `00-index.md`: D14 amended to v2 semantics; **D15** (Netflix B&W visual language), **D16** (TV metadata + episode columns/migration) added; changelog row appended.
- `02-specs.md`: S2 detail payload gains `seasons`; S3 gains `season/episode` params + `coverage`; S4/S5 gain `seasonNumber/episodeNumber/backdropPath`; new **S12**; §2 downloads columns + idempotent-ALTER migration rule; §3 UI screens rewritten; §4.1 adds `/tv/{id}/season/{n}`; §4.3 drops "no season/episode parsing".

---

## PART A — Netflix visual shell (frontend)

### A1. Grayscale design tokens (`frontend/src/styles.css`)
- Replace violet/blue palette with strict grayscale: `--bg:#000`, surfaces `#0a0a0a/#141414/#1f1f1f/#262626`, borders `rgba(255,255,255,.12/.2/.35)`, text `#fff/#e5e5e5/#b3b3b3/#808080`, white CTAs.
- Layout tokens: `--nav-h:68px`, `--gutter:4%`, `--card-w` formula (`clamp(160px,16vw,300px)`), rail spacing.
- **GA-1**: delete centered `max-width:1280px` `.app-main`, the page padding model, and the violet body radial gradients; body flat `#000`. Each page owns its gutter; hero/rails bleed full width.
- Drop `--accent/--glow`; update `:focus-visible` to white outline.
- `index.css`: remove shadcn tokens + Tailwind if stripped (see A6 / GA-17).

### A2. Top header replaces sidebar (`components/AppHeader.tsx`, `components/BrandMark.tsx`)
- Fixed full-width 68px; content padded `0 var(--gutter)`.
- Transparent at `scrollY≈0`; rAF-throttled scroll listener fades to `linear-gradient(#000, rgba(0,0,0,.6), transparent)` then solid `#000`.
- **NB-6**: pages whose artwork reaches y=0 (Home hero, Detail hero) render a persistent top scrim (black → transparent downward) behind the header so white nav stays legible over light/mid-tone monochrome artwork before the scroll state kicks in.
- Left: monochrome wordmark → `/`. Nav (L9): **Home · Downloads · Settings** (`NavLink`, 14px, `#e5e5e5`, active white).
- Right: connection dot, Downloads count badge, search icon (overlay), settings gear.
- **GA-8**: mobile hamburger → bottom-sheet with the same links + search. Not desktop-only.
- `App.tsx`: drop `SidebarProvider/AppSidebar/SidebarTrigger`; render `<AppHeader/>` above `<main>`.

### A3. Static brand hero (`components/HeroBillboard.tsx`)
- Full-bleed ~`min(78vh, 56vw·0.7)`, `overflow:hidden`.
- **GA-14**: background = `frontend/public/hero.gif` (user-supplied, ≤ ~2–3 MB; CSS `filter:grayscale(1)`); fallback chain → TMDB `w1280` backdrop → black gradient; disable motion under `prefers-reduced-motion`. No copyrighted footage bundled by us.
- Overlays `to right #000 15%→transparent 60%` + bottom `to top #000 8%→transparent 50%`.
- Copy bottom-left + white **Search/Explore** button + ghost **Downloads** button.

### A4. Landscape title-card rails (`components/TitleCard.tsx`, rework `components/SectionRail.tsx`)
- Card = 16:9 landscape, backdrop `w1280`, `object-fit:cover`; grayscale placeholder; `--card-w`.
- **Peeking**: edge-to-edge scroller starting at `var(--gutter)`, `overflow-x:hidden`, content wider than viewport → rightmost card clipped. Hover chevrons overlay the edges (Netflix arrows). **Chevrons and the peek apply only when the row actually overflows; arrows hide when scrolled to either end** (canScroll check, NB-7).
- Hover: `scale(1.15)` + z-index + 1px white ring + dark panel with lucide actions **Play** (streamable), **Download**, **More Info**; white progress bar when downloading.
- Rail order on `/`: Hero → **My Downloads** (L10) → **Recently Viewed** → **Trending This Week** → **Best Movies** → **Best Series**.
- `TitleCard` fallback (GA-2): if no backdrop, crop `posterUrl` cover so legacy rows stay 16:9.

### A5. Full-screen search overlay (`components/SearchOverlay.tsx`, `store/searchStore.ts`)
- Fixed `#000` overlay; big input; `All|Movies|TV`; debounced 300ms → existing `search()`; results landscape grid in `var(--gutter)`.
- **GA-16**: `role="dialog"`, `aria-modal`, focus trap, Esc + × close, focus restore, `prefers-reduced-motion`.
- Replaces HomePage inline search; rails remain mounted underneath.

### A6. Other pages + cleanup (GA-17)
- Downloads/Settings/Watch restyled monochrome (see B6 for labels/icons).
- Delete dead code: `components/ui/*`, `AppSidebar.tsx`, `AppSidebar.test.tsx`, `hooks/use-mobile.tsx`; drop `@radix-ui/*`, `cva`, `tailwind-merge`; remove Tailwind/`index.css` only if fully unused (check `postcss.config.js`, `main.tsx`). Keep `lucide-react`.
- Icons (white/gray): `Play Download ArrowDownToLine SlidersHorizontal Trash2 Search X ArrowLeft Pause MoreHorizontal`.
- **GA-15** test updates listed in § Build order.

---

## PART B — TV seasons/episodes + download actions

### B1. Backend types & parser
`backend/src/types.ts`:
- `Source.coverage: Coverage[]`; `Coverage = { season: number; episodes: [number, number] | null }` (`null` = whole season). Whole-series packs use sentinel entries `{ season: <each aired season from TMDB>, episodes: null }` resolved at serve time from S12/S2; raw unknown → `coverage: null` (GA-4/GA-12).
- `TvSeasonSummary { seasonNumber; name; episodeCount }`; `TvEpisode { seasonNumber; episodeNumber; name; overview; stillPath; runtime; airDate }`.
- `MediaDetail.seasons?: TvSeasonSummary[]` (TV only).
- `DownloadRecord`/`CreateDownloadInput` gain optional `seasonNumber`, `episodeNumber`, and required-ish `backdropPath` (nullable) (GA-2).

`backend/src/lib/releaseParser.ts`: add `coverage` extraction for `S01`, `S01E01`, `S01E01-E05`, `Season 1`, `S01-S02`, `01x03`, "Complete/Series". Pure helpers:
- `parseCoverage(title): Coverage[] | null`
- `coverageCovers(coverage, season, episode?): boolean` — season-scope: covers whole season; episode-scope: covers episode.
- `isFullSeason(coverage, season)` — any `episodes === null`.
The S/E **filename** regex lives only in the backend and powers the S13 file-list tags (`seasonNumber`/`episodeNumber`); a minimal frontend `lib/episode.ts` fallback is allowed only when a file has no tag (NB-1).

### B2. TMDB client (`services/tmdb.ts`)
- `details(tv)` maps `seasons` from `/tv/{id}`; **filter `episodeCount>0` and `seasonNumber>0` (drop specials/unaired — GA-11)**; expose raw list too for later "specials" toggle.
- New `seasonEpisodes(id, seasonNumber)` → `/tv/{id}/season/{n}` → `TvEpisode[]`.

### B3. Sources route (`routes/media.ts`)
`GET /api/media/:id/sources?type=tv[&season=N][&episode=M]`
- `season=N` → Prowlarr `"<title> S0N"` (packs + episode releases), filtered by `filterSourcesToMedia`, each tagged with parsed `coverage`.
- `season=N&episode=M` → `"<title> S0N E0M"`.
- no params → current whole-title search (movie / all-seasons context).
- **GA-5 search policy (backend is stateless; enforced in UI §B4)**: at most one in-flight context per title; caller-side cache + AbortController; no auto-search-all-seasons.
- TV source filtering keeps the `filterSourcesToMedia` title-token check; add **null-coverage passthrough** (returned, but flagged `coverage:null` so the UI treats it Advanced-only).
- **NB-4 season gating**: when `season=N` is requested, drop results whose parsed `coverage` lists seasons that do not include `N` (e.g. a `S02` pack must never appear under the S01 tab). Only `coverage:null` results bypass the gate (they may be relevant but unparseable).

### B4. Detail page Netflix title page
**Movie**: hero + actions → **▶ Download** (friendly = most-seeded movie source; enabled when the on-mount sources fetch resolves, else disabled + spinner — GA-5), **Advanced** (`SourcePickerModal`, reuses today's filter/sort/group/pagination UI), and if a download exists → **Watch** + **Trash2** (S6 `deleteFiles=true`, confirm dialog).

**TV** (`pages/DetailPage.tsx`, `components/TvSeasonBrowser.tsx`, `components/SourcePickerModal.tsx`):
- Hero + season count + overview.
- **Season dropdown**: default = season with an active download else first `episodeCount>0` season (GA-11). Changing season triggers one lazy `S3?season=N` search, cached per `title|season` (GA-5); stale responses dropped via request id; skeleton rows.
- Episode list (Netflix layout): still-thumb (`w500` proxy), big episode number, title, runtime, overview, availability chip, hover highlight.
  - **Friendly (ArrowDownToLine)**: most-seeded source where `coverageCovers(s, N, M)`; **prefer exact single-episode**; partial-pack allowed but chip labels `E01–E05` and confirm text shows release title (GA-13/GA-11). Disabled if the episode is already inside an active full-season download → **Play** instead (opens `/watch/:hash?episode=SxxExx`, GA-6/GA-18).
  - No exact source (GA-12): toast "No single-episode source for S01E03" (normal, not error) + open Advanced pre-scoped `?season=N&episode=M`.
- Season header: **Download season** → most-seeded full-season pack **for exactly this season**; a whole-series (`Complete Series`) pack is only a fallback and needs an explicit confirm that it downloads every season (NB-3). If active → progress + **Watch** + **Trash2**.
- **Advanced (SlidersHorizontal)** opens `SourcePickerModal` scoped to the current season/episode context (all Prowlarr options incl. null-coverage rows).

### B5. Downloads DB & repo (`schema.sql`, `downloadsRepo.ts`)
- **GA-10**: bake new columns into fresh `CREATE TABLE` **and** add idempotent
  `ALTER TABLE downloads ADD COLUMN IF NOT EXISTS season_number int, episode_number int, backdrop_path text;`
  Verify against the live Postgres volume during E2E.
- Insert/row-map + `CreateDownloadInput` carry `seasonNumber`, `episodeNumber`, `backdropPath` (backdrop from `detail.backdropPath`). Old rows stay `null` → labeled only when known; cards fall back to poster crop.
- **NB-11 legacy self-heal**: the poll/hub (S9) backfills TV rows — when `media_type='tv'` and `season_number` is null, infer it once from `torrent_name` (parser) or from the resolved `stream_file_path` basename and write it back, so pre-upgrade season packs still drive default-season and Play-from-pack logic.

### B6. Downloads/Watch integration
- My Downloads cards + Downloads rows label `Fallout · S01E01 · The End` when S/E known.
- **GA-6/NB-1**: the files endpoint (S13) returns every file tagged with server-parsed `seasonNumber`/`episodeNumber`; Watch auto-selects the file whose tags match the `episode=SxxExx` param — **no client-side parser duplication**. `frontend/src/lib/episode.ts` remains only as a fallback if a file has no server tag.
- Delete via **Trash2** → `DELETE /downloads/:hash?deleteFiles=true` + `removeLocal` (confirm; warns pack delete removes all its episode files).

---

## PART C — UX layer (frontend)

Locked: **C-DL1** confirm sheet · **C-DL2** local resume · **C-DL3** inline guidance.

### C0. Principles
- **P1** CTA always = the next useful action: *not owned → downloading → streamable → complete*; never a dead label.
- **P2** Slow sources feel fast: cached, backgrounded, non-blocking; CTAs show progress, never silence.
- **P3** Informed consent before bytes hit disk (release, size, quality always visible first).
- **P4** Motion means meaning; disabled under `prefers-reduced-motion`.
- **P5** No dead ends: every empty/error/offline state has a next step or Retry.

### C1. Global feedback & resilience
- Grayscale toasts (bottom-center, `aria-live="polite"`) + **long-action** variant: `Searching sources…` → `Starting Fallout S01 · 1080p WEB-DL · 7.2 GB` → success.
- Socket-drop **StatusBanner** (`Reconnecting… · Retry now`) while keeping the last snapshot — rails never flash empty.
- Global keys: `/` opens search, `Esc` closes the top layer, arrows scroll a focused rail; skip-to-content link.
- Aria-live region announces download started/finished without stealing focus.

### C2. Home & rails
- Hero stays static (L3): CTAs **Search** + **My Downloads**; height capped so rows stay reachable.
- My Downloads rail re-sorts live on socket updates; thin white progress bar + `%` on hover; cards keyed by `infoHash`.
- Card primary action via C4 state machine; hover action panel (desktop); mobile = native snap scroll + tap→detail (no hover-only controls, NB-16).
- Chevrons/peek only when the rail overflows (NB-7); rail errors get inline `Retry`.

### C3. Search overlay
- Open → autofocus + **Trending placeholder grid** (reuse `browse('trending-week')`) so the overlay never feels empty.
- **Recent searches** chips (localStorage `searchStore`), persistent `All | Movies | TV` segment, 300ms debounce + stale-request guard.
- Landscape cards reuse rail hover actions (downloadable straight from results).
- Distinguish *backend offline* (banner + Retry) from *no matches*.

### C4. Detail / title page
- `usePrimaryAction(detail, downloads)` — single source of truth for CTAs across rails/search/detail.
- **ConfirmDownloadSheet (C-DL1)**: friendly download resolves sources in the background; on tap show `Fallout · S01 · 1080p WEB-DL · 7.2 GB · 1337x · 12.3k seeds` with `[Start]` `[Advanced…]`; while unresolved the button reads `Looking for best source…` (spinner, never a dead click).
- TV sticky sub-bar while scrolling the episode list: ← back · compact title · **Season ▾** · **Download season N** · **Advanced**.
- Episode-row state machine: not owned → Download · exact source downloading → inline progress · covered by an active pack → **Watch** + `Included in S01 pack` · complete → Play. Right-side icons on hover/focus.
- Localized "no source" (GA-12): per-episode CTA → `No single-episode source` + `Pick from all results` (pre-scoped Advanced). Never auto-whole-season (L8).
- Advanced picker = right-side sheet with a context header (`Fallout · S01E03`), v1 filters/sort/group; selection → confirm sheet → S4.

### C5. Downloads page
- Tabs `All · Downloading · Ready to watch`; arrival context preserved (came from a downloading card → Downloading tab).
- Tabular-numeral speed/ETA so the 2s tick doesn't shift layout; ratio only while seeding.
- State-aware actions: downloading → **Watch (streaming)** when `streamable` + Pause; paused → Resume; complete → Watch · Download file · Remove; error → guidance + Remove.
- Delete confirm states file impact (pack delete warns it removes every episode file); grayscale danger = white-on-black inverse.

### C6. Watch / player
- Buffering overlay → `Ready to stream · 38%`; ~20s stall guard → **Retry stream** (re-probe S7b).
- `player-required` → 3-step VLC sheet + copy-URL.
- **Resume (C-DL2)**: `store/playbackStore.ts` persists `{infoHash, file, seconds}` to localStorage every ~5s; on return show `Resume from 12:34` / `Restart`; mark recents on play start.
- **Next/prev within a pack**: compact `Next: S01E04` → `/watch/:hash?episode=…` (S13) for season bingeing.

### C7. First-run, empty, error
- **Inline guidance (C-DL3)**: empty My Downloads card → `1 Search · 2 Download · 3 Watch`; search overlay shows trending suggestions. No modal tour.
- One broken rail never blanks the page; Settings gains **Copy diagnostics** (grayscale) for one-line status export.

### C8. New frontend modules (no backend changes beyond locked contracts)
`hooks/usePrimaryAction.ts` · `hooks/useSourceSearch.ts` (context cache + AbortController) · `components/ConfirmDownloadSheet.tsx` · `components/EpisodeRow.tsx` · `components/SeasonToolbar.tsx` · `components/StatusBanner.tsx` · `store/searchStore.ts` (history) · `store/playbackStore.ts` (resume). Reuse toast a11y, empty/error components, `TitleCard` actions.

### C9. Acceptance (manual QA matrix)
Slow-Prowlarr search shows no dead UI → confirm sheet names the real pick → Start → card in My Downloads with live % → stream before complete → downloaded-pack episode deep-links and resumes → no-source episode offers Advanced only → delete confirms file impact → backend-down shows banner and retains the list → reduced-motion + keyboard-only pass over rails/overlay/player.

---

## § Contracts (authoritative in docs/plan/02-specs.md after Task 0)
Backend endpoints changed/added: S2 (seasons), S3 (season/episode params + coverage + season gating), S4 (S/E/backdrop), S5 (record fields), **S12** (`/api/media/:id/season/:n`), **S13** (file list with per-file `seasonNumber`/`episodeNumber` tags). Types mirrored 1:1 across `backend/src/types.ts` and `frontend/src/types.ts` (no shared package).

## Build order & verification
0. Applied (docs/plan Task 0).
1. Backend: B1 parser+helpers+coverage tests; B2 tmdb season tests (mocked fetch); B3 route tests (query→prowlarr call, coverage passthrough); B5 repo/schema test. `cd backend && npm test && npm run typecheck && npm run lint`.
2. Frontend shell + UX foundations: A1→A6 **and** PART C cross-cutting modules (`usePrimaryAction`, `useSourceSearch`, `StatusBanner`, `store/searchStore`, `store/playbackStore` + resume UI). Tests (GA-15): delete `AppSidebar.test.tsx`; rewrite `HomePage.test.tsx` for the overlay model + rail titles ("My Downloads", "Recently Viewed", three browse rails); add `SearchOverlay` open/close + Esc test; header scroll-state unit test; playback-resume store test. `cd frontend && npm run typecheck && npm run lint && npm test && npm run build`.
3. Frontend TV + download flow: B4/B6 wiring **with PART C** (`ConfirmDownloadSheet`, `EpisodeRow`, `SeasonToolbar`, Downloads tabs) + `lib/episode.ts` fallback tests; add `DetailPage` TV test (mock S2/S3/S12) asserting season/episode mapping + friendly-vs-advanced behavior and the confirm-sheet path, and a Watch `?episode=` test with an S13-tagged file list. Rerun typecheck/lint/tests.
4. E2E `docker compose up -d --build`: full-bleed hero + peeking rails; header→black on scroll; overlay; TV (e.g. Fallout) seasons/episodes; friendly season → **confirm sheet** → progress + Watch; episode w/o source → Advanced modal; `/watch?episode=` auto-select + resume; Trash2 deletes. Run the **C9 manual QA matrix** (incl. backend-down banner, reduced-motion + keyboard pass). Confirm `ALTER` applied to live volume. Tune Netflix CSS metrics vs reference screenshots (visual step).

## Resolved gaps (v1 analysis)
| Gap | Resolution |
|-----|-----------|
| GA-1 full-bleed layout | A1/A4 layout tokens; `.app-main` box removed |
| GA-2 no backdrop on downloads | A4 fallback + L11/B5 `backdrop_path` column |
| GA-3 docs conflict | §0 Task 0 applied (00-index + 02-specs) |
| GA-4 unknown coverage | L12 + B1 `coverage:null` semantics, Advanced-only |
| GA-5 Prowlarr latency | B3/B4 lazy per-season, cache, request-id, skeletons |
| GA-6 episode deep-link | L13 + S13 file tags; Watch `/watch?episode=` auto-select; client parser fallback only |
| GA-7 nav targets | L9 Home·Downloads·Settings; categories deferred |
| GA-8 mobile nav | A2 bottom-sheet |
| GA-9 "Continue Watching" | L10 rename My Downloads; resume tracking deferred |
| GA-10 DB migration | B5 idempotent ALTER + fresh CREATE; live-volume check |
| GA-11 TMDB numbering | B2 filter specials/empty; B4 default season; confirm text w/ release title |
| GA-12 episode scarcity | L8 + B4 normal-toast → Advanced pre-scope |
| GA-13 partial packs/dupes | B1 `isFullSeason`; B4 partial chips + confirm; 409/grouping in Advanced |
| GA-14 hero asset | A3 budget/fallback/reduced-motion; user supplies asset |
| GA-15 tests | Build-order test inventory |
| GA-16 overlay a11y | A5 focus trap/Esc/restore |
| GA-17 stale CSS | A6 + cleanup verification |
| GA-18 dup friendly across indexers | L7/L8 + B4 disabled-when-covered + 409 toast |

## Deferred (explicit, not gaps)
- Movies/TV Shows category nav routes (L9) — needs a browse-filter model.
- Renaming "My Downloads"→"Continue Watching" is deferred; resume positions now ship (C-DL2) but the rail keeps the "My Downloads" name for v1 (GA-9/L10).
- Auto "last-watched" billboard hero (L3).
- qBittorrent file-priority cherry-picking inside packs (L1).
- TMDB specials/season-0 browsing toggle (GA-11).

## Change log
| Date | Change |
|------|--------|
| 2026-09-05 | v1 plan captured from Q&A. |
| 2026-09-05 | v1 gap analysis GA-1..GA-18 added. |
| 2026-09-05 | v2: all gaps resolved (see table); docs/plan Task 0 applied; new contracts (S12, columns, episode deep-link). |
| 2026-09-05 | v3 (second pass): S13 file tags kill parser duplication (NB-1); season gating (NB-4); whole-series pack fallback+confirm (NB-3); legacy TV backfill in poll (NB-11); header top scrim (NB-6); conditional chevrons/peek (NB-7); docs/plan 02-specs S13 + 00-index updated. |
| 2026-09-05 | v4 (UX): PART C added — ConfirmDownloadSheet (C-DL1), local playback resume (C-DL2), inline first-run guidance (C-DL3); change-log duplicates removed. |

## Second-pass analysis (v3) — findings after the GA-1..GA-18 fixes

Severity: 🔴 blocking · 🟠 high · 🟡 medium · 🟢 low.

### Fixed in v3
| # | Finding | Fix |
|---|---------|-----|
| NB-1 | 🟠 Episode→file matching needed duplicate S/E parsers (frontend `lib/episode.ts` + backend regex) that could drift, and the file-list endpoint wasn't spec'd at all. | New **S13** spec: `GET /api/downloads/:infoHash/files` returns `StreamFileInfo[]` each tagged with server-parsed `seasonNumber`/`episodeNumber`; Watch auto-selects from tags. Client parser is fallback only. |
| NB-3 | 🟠 "Download season" could auto-pick a *Complete Series* pack (most-seeded) and silently grab every season. | Prefer a full-season pack for exactly that season; whole-series pack only as explicit-confirm fallback. |
| NB-4 | 🟠 Season searches can return other seasons (indexer token tolerance) — e.g. S02 pack under the S01 tab. | Season-gate results server-side: drop parsed coverage that doesn't include the requested season; `coverage:null` bypasses. |
| NB-6 | 🟡 White header nav is unreadable over light monochrome hero artwork before the scroll state. | Persistent top black scrim behind header on pages with top-of-page artwork. |
| NB-7 | 🟢 Chevrons/peek would render for short rows with no overflow. | Show arrows + peek only when `canScroll`; hide at row ends. |
| NB-11 | 🟡 Pre-upgrade TV downloads (null `season_number`) can't drive default-season or Play-from-pack. | Poll/hub self-heal: backfill season from `torrent_name` / resolved `stream_file_path` once per legacy row. |

### Open (product/scope decisions — resolved in implementation or by user)
| # | Finding | Recommendation |
|---|---------|----------------|
| NB-2 | 🟠 Friendly = raw most-seeded may select a 2160p REMUX or a 100 GB pack as "default". | User locked "most seeded". Ship raw most-seeded (L7) but surface the exact chosen release in the toast/confirm; add an optional "prefer ≤1080p/x264" toggle later. **Ask user before changing the default.**
| NB-5 | 🟡 Same release re-added via another indexer (different hash) isn't deduped at the DB level. | Keep 409-by-hash; Advanced shows disabled "Already added" for hashes in the store; friendly path surfaces 409 toast. No DB change.
| NB-8 | 🟡 TMDB vs scene episode numbering can disagree (air-date splits, recaps). | Confirm text shows the real release title; deep-link falls back to the manual file picker on no tag match. Accepted.
| NB-10 | 🟢 2s full-snapshot socket updates re-render rails/cards; hover transitions could restart. | Fine at 2s cadence; key card elements by stable `infoHash`; keep CSS transitions on transforms only.
| NB-16 | 🟢 Hover-only card action panels must stay keyboard-operable. | Cards remain focusable buttons (Enter = primary); action panel reachable via Tab; white `:focus-visible` ring.
| NB-17 | 🟢 Watch tests currently assert the manual file picker; S13 tags + `?episode=` path need new cases. | Extend `WatchPage.test.tsx`; add S13 mock with tagged files.
| NB-18 | 🟢 "1:1 pixel clone" cannot be automated; metrics must be tunable centrally. | All Netflix metrics (header height, gutters, card width, hover scale, rail height) live as CSS tokens in `styles.css` for one-file tuning.

### Watch-outs worth restating (no change)
- Prowlarr 60s ceiling still bounds per-season search UX; cache keyed `title|season` + AbortController is mandatory (GA-5).
- `filterSourcesToMedia` year-conflict tolerance (±1 yr) still applies to episode queries; verify a "foreign year" episode search can't self-hide — add a route test with an episode carrying a different year.

