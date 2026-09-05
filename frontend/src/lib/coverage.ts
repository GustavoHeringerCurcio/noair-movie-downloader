import type { Coverage, Source } from '../types';

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
 * Picks the best friendly source for downloading a season: the most-seeded
 * release that is a full, unbroken pack of that season.
 */
export function chooseSeasonPick(sources: Source[], season: number): Source | null {
  return sources.find((s) => coversWholeSeason(s.coverage, season)) ?? null;
}

/**
 * Picks the best friendly source for a single episode, preferring an exact
 * single-episode release over a partial pack that contains it. Full-season
 * packs are never auto-picked for an episode (the UI would be silently
 * downloading a whole season otherwise).
 */
export function chooseEpisodePick(sources: Source[], season: number, episode: number): Source | null {
  const exact = sources.find((s) => isExactEpisode(s.coverage, season, episode));
  if (exact) return exact;
  return (
    sources.find(
      (s) => !coversWholeSeason(s.coverage, season) && coversEpisode(s.coverage, season, episode),
    ) ?? null
  );
}

/** Sources that plausibly contain an episode (incl. whole-season packs). */
export function hasEpisodeCover(sources: Source[], season: number, episode: number): boolean {
  return sources.some((s) => coversEpisode(s.coverage, season, episode));
}
