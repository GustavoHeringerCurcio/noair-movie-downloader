import type { AppDeps } from '../deps.js';
import { resolveImageProvider } from './enrich.js';
import { DISCOVER_SECTIONS } from '../services/tmdb.js';
import { artKey } from './artService.js';
import type { ArtSubject } from '../types.js';

/**
 * Background artwork warmer.
 *
 * After boot (and then every `intervalMs`) it walks the browse rails plus the
 * existing download rows, fetches whatever `media_art` is missing through the
 * rate-limited Fanart gateway, and refreshes long-stale `empty` rows so art
 * uploaded later is picked up. Runs only while Fanart mode is active so a TMDB
 * user never burns Fanart quota.
 */
export function startArtWarmLoop(deps: AppDeps, intervalMs: number, emptyRetryMs: number): NodeJS.Timeout {
  let running = false;

  async function run(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await warmOnce(deps, emptyRetryMs);
    } catch (error) {
      console.error('[art-warm] warm pass failed', error);
    } finally {
      running = false;
    }
  }

  void run();
  return setInterval(() => void run(), intervalMs);
}

async function warmOnce(deps: AppDeps, emptyRetryMs: number): Promise<void> {
  if (!deps.fanart) return;
  if ((await resolveImageProvider(deps)) !== 'fanart') return;

  const seen = new Map<string, ArtSubject>();
  const add = (subject: ArtSubject | null): void => {
    if (!subject) return;
    seen.set(artKey(subject), subject);
  };

  for (const section of DISCOVER_SECTIONS) {
    try {
      const items = await deps.tmdb.browse(section);
      items.forEach((item) => add({ tmdbId: item.tmdbId, mediaType: item.mediaType }));
    } catch (error) {
      console.warn(`[art-warm] browse ${section} failed`, error);
    }
  }
  try {
    const downloads = await deps.downloads.list();
    downloads.forEach((record) => {
      if (record.tmdbId != null && record.mediaType != null) {
        add({ tmdbId: record.tmdbId, mediaType: record.mediaType });
      }
    });
  } catch (error) {
    console.warn('[art-warm] downloads list failed', error);
  }

  const subjects = Array.from(seen.values());
  if (subjects.length === 0) return;

  await deps.art.resolveManyCached(subjects);
  deps.art.enqueueMissing(subjects);
  await deps.art.drain();

  const refreshed = await deps.art.refreshExpired(subjects, emptyRetryMs);
  if (refreshed > 0) await deps.art.drain();
  // One-time-ish backfill: rows cached before the poster_url column existed (or
  // any thumbless row fetched > 1 day ago) get refetched so portrait posters
  // appear. Fresh truly-empty rows are untouched until emptyRetryMs elapses.
  const thumbless = await deps.art.refreshThumbless(subjects, 24 * 60 * 60 * 1000);
  if (thumbless > 0) await deps.art.drain();
  console.log(`[art-warm] cached ${subjects.length} rail/download titles (refreshed ${refreshed} empty, ${thumbless} thumbless)`);
}
