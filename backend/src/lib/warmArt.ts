import type { AppDeps } from '../deps.js';
import { DISCOVER_SECTIONS } from '../services/tmdb.js';
import type { ArtSubject } from '../types.js';
import type { ArtFileRow } from '../db/artFilesRepo.js';

/**
 * Poster warmer (D21) + fanart key-art warmer (T-002) + IMDb-rating backfill
 * (T-004).
 *
 * After boot (and then every `intervalMs`) it walks the browse rails plus the
 * existing download rows and makes sure a portrait `poster` file exists on the
 * `art` volume for each title (IMDb id via TMDB → OMDb → Amazon, downloaded by
 * the `artCache` pipeline and served from `/api/images/art/*`), and — when a
 * fanart.tv key is configured — that the 16:9 key-art `thumb` files exist too
 * (served from `/api/images/fanart/*`) so Horizontal cards paint instantly
 * instead of warming on each first request. Titles with no art or no key are
 * recorded as empty and not retried aggressively; the image route also lazily
 * warms on first render, so rails just get filled ahead of time.
 *
 * The same OMDb response now carries `imdbRating`, so freshly-warmed rows store
 * it inline. Rows warmed *before* this feature shipped have no rating yet and
 * would only gain one after the ~30-day poster refresh — the one-time backfill
 * pass below re-resolves them inside the same daily OMDb budget (it stalls when
 * the day's slice is exhausted and resumes on a later pass) so the existing
 * library shows ratings immediately.
 */
export function startArtWarmLoop(deps: AppDeps, intervalMs: number): NodeJS.Timeout {
  let running = false;

  async function run(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await warmOnce(deps);
      await backfillMissingRatings(deps);
    } catch (error) {
      console.error('[poster-warm] warm pass failed', error);
    } finally {
      running = false;
    }
  }

  void run();
  return setInterval(() => void run(), intervalMs);
}

async function collectEntries(deps: AppDeps): Promise<ArtSubject[]> {
  const seen = new Map<string, ArtSubject>();
  const add = (subject: ArtSubject): void => {
    seen.set(`${subject.mediaType}:${subject.tmdbId}`, subject);
  };

  for (const section of DISCOVER_SECTIONS) {
    try {
      const items = await deps.tmdb.browse(section);
      items.forEach((item) => add({ tmdbId: item.tmdbId, mediaType: item.mediaType }));
    } catch (error) {
      console.warn(`[poster-warm] browse ${section} failed`, error);
    }
  }
  try {
    const downloads = await deps.downloads.list();
    downloads.forEach((record) => {
      if (record.tmdbId != null && record.mediaType != null) {
        add({ tmdbId: record.tmdbId, mediaType: record.mediaType as ArtSubject['mediaType'] });
      }
    });
  } catch (error) {
    console.warn('[poster-warm] downloads list failed', error);
  }
  return Array.from(seen.values());
}

async function warmOnce(deps: AppDeps): Promise<void> {
  const subjects = await collectEntries(deps);
  if (subjects.length === 0) return;

  if (deps.artCache) {
    const downloaded = await deps.artCache.warm(subjects);
    if (downloaded > 0) console.log(`[poster-warm] downloaded ${downloaded} poster file(s)`);
  }
  // Horizontal-poster key-art (T-002): warm the same titles' `thumb` files when
  // a fanart.tv key is wired, so an opt-in Horizontal card never waits on a
  // first-request fetch.
  if (deps.fanartCache) {
    const downloaded = await deps.fanartCache.warm(subjects);
    if (downloaded > 0) console.log(`[poster-warm] downloaded ${downloaded} key-art thumb(s)`);
  }
  console.log(`[poster-warm] ensured posters for ${subjects.length} rail/download titles`);
}

const BACKFILL_CONCURRENCY = 4;

/**
 * One rating-backfill pass (T-004). Re-resolves every stored poster row whose
 * `imdb_rating` is still NULL and persists any score OMDb returns. Runs inside
 * the OMDb client's shared daily budget: once the slice is exhausted the pass
 * stalls (no further TMDB/OMDb calls) and the next pass on a later day resumes
 * where it left off. Rows OMDb genuinely has no score for stay NULL and are
 * retried on a later pass. Never throws. Returns the number of ratings stored.
 */
export async function backfillMissingRatings(deps: AppDeps): Promise<number> {
  if (!deps.omdb || !deps.artFiles) return 0;
  let rows: ArtFileRow[];
  try {
    rows = await deps.artFiles.listPosterRowsMissingRating();
  } catch (error) {
    console.warn('[rating-backfill] could not list rows missing a rating', error);
    return 0;
  }
  if (rows.length === 0) return 0;

  const updates: Array<{ mediaType: ArtSubject['mediaType']; tmdbId: number; imdbRating: number }> = [];
  let stopped = false;
  let index = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= rows.length || stopped) return;
      const row = rows[current]!;
      if (deps.omdb!.isBudgetExhausted()) {
        stopped = true;
        return;
      }
      try {
        const imdbId = await deps.tmdb.imdbId(row.tmdbId, row.mediaType);
        if (!imdbId) continue;
        const result = await deps.omdb!.fetchPoster(imdbId);
        if (result.status === 'error') {
          if (deps.omdb!.isBudgetExhausted()) stopped = true;
          continue;
        }
        if (result.imdbRating != null) {
          updates.push({ mediaType: row.mediaType, tmdbId: row.tmdbId, imdbRating: result.imdbRating });
        }
      } catch {
        if (deps.omdb!.isBudgetExhausted()) stopped = true;
        // Otherwise a transient TMDB/OMDb blip — skip this row, try the next.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(BACKFILL_CONCURRENCY, rows.length) }, () => worker()));

  if (updates.length > 0) {
    try {
      await deps.artFiles.updateImdbRatings(updates);
    } catch (error) {
      console.warn(`[rating-backfill] failed to persist ${updates.length} rating(s)`, error);
      return 0;
    }
  }
  if (stopped) console.warn('[rating-backfill] OMDb daily slice exhausted — pausing until a later pass');
  return updates.length;
}
