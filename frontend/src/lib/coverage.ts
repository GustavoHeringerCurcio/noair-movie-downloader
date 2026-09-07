import type { Coverage, FriendlyPickMode, Source } from '../types';

/** Whether a coverage includes a full (unbroken) release of a season. */
export function coversWholeSeason(coverage: Coverage[] | null, season: number): boolean {
  return coverage != null && coverage.some((c) => c.season === season && c.episodes === null);
}

/** Whether a coverage contains a given episode (full seasons included). */
export function coversEpisode(coverage: Coverage[] | null, season: number, episode: number): boolean {
  if (coverage == null) return false;
  return coverage.some((c) => {
    if (c.season !== season) return false;
    if (c.episodes === null) return true;
    return episode >= c.episodes[0] && episode <= c.episodes[1];
  });
}

/** Whether a coverage points at exactly one episode of a season. */
export function isExactEpisode(coverage: Coverage[] | null, season: number, episode: number): boolean {
  return (
    coverage != null &&
    coverage.some((c) => c.season === season && c.episodes !== null && c.episodes[0] === episode && c.episodes[1] === episode)
  );
}

/**
 * Strict web-exhibitability from release-title hints only (T-003): the in-browser
 * player can reliably decode x264 and AV1 in SDR up to 1080p. x265/HEVC is never
 * browser-safe here, HDR/DoVi almost always implies HEVC 10-bit, and an unknown
 * codec must not be trusted. Resolution `null` is fine — only 2160p is excluded.
 */
export function isWebExhibitable(source: Source): boolean {
  return (
    (source.codec === 'x264' || source.codec === 'AV1') &&
    !source.hdr &&
    !source.isDolbyVision &&
    source.resolution !== '2160p'
  );
}

/**
 * Reorders `sources` for a friendly pick. In `web-playable` mode the
 * web-exhibitable releases come first (best-seeded first within that subset),
 * then the rest (best-seeded first), so the shared pickers below keep their
 * coverage rules (exact episode > partial pack, whole-season packs never
 * auto-picked for an episode) while still preferring a playable source when one
 * exists. `most-seeded` leaves the caller's seeders-desc ordering untouched.
 */
function orderForPick(sources: Source[], mode: FriendlyPickMode): Source[] {
  if (mode === 'most-seeded') return sources;
  const bySeeders = (a: Source, b: Source) => b.seeders - a.seeders;
  const web: Source[] = [];
  const rest: Source[] = [];
  for (const source of sources) (isWebExhibitable(source) ? web : rest).push(source);
  return [...web.sort(bySeeders), ...rest.sort(bySeeders)];
}

/**
 * Best friendly source for a movie: `movieSources[0]` when it exists. In
 * `web-playable` mode the best-seeded web-exhibitable release wins, with the
 * overall most-seeded one as the fallback when nothing qualifies.
 */
export function chooseMoviePick(sources: Source[], mode: FriendlyPickMode = 'most-seeded'): Source | null {
  return orderForPick(sources, mode)[0] ?? null;
}

/**
 * Picks the best friendly source for downloading a season: the most-seeded
 * release that is a full, unbroken pack of that season. In `web-playable` mode
 * the most-seeded web-exhibitable full-season pack wins (fallback: most-seeded).
 */
export function chooseSeasonPick(
  sources: Source[],
  season: number,
  mode: FriendlyPickMode = 'most-seeded',
): Source | null {
  const ordered = orderForPick(sources, mode);
  return ordered.find((s) => coversWholeSeason(s.coverage, season)) ?? null;
}

/**
 * Picks the best friendly source for a single episode, preferring an exact
 * single-episode release over a partial pack that contains it. Full-season
 * packs are never auto-picked for an episode (the UI would be silently
 * downloading a whole season otherwise). In `web-playable` mode the pick
 * prefers a web-exhibitable release within the same coverage rules — an exact
 * episode always beats a partial pack, even when the exact one is not
 * web-exhibitable.
 */
export function chooseEpisodePick(
  sources: Source[],
  season: number,
  episode: number,
  mode: FriendlyPickMode = 'most-seeded',
): Source | null {
  const ordered = orderForPick(sources, mode);
  const exact = ordered.find((s) => isExactEpisode(s.coverage, season, episode));
  if (exact) return exact;
  return (
    ordered.find(
      (s) => !coversWholeSeason(s.coverage, season) && coversEpisode(s.coverage, season, episode),
    ) ?? null
  );
}

/** Sources that plausibly contain an episode (incl. whole-season packs). */
export function hasEpisodeCover(sources: Source[], season: number, episode: number): boolean {
  return sources.some((s) => coversEpisode(s.coverage, season, episode));
}
