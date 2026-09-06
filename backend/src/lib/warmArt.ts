import type { AppDeps } from '../deps.js';
import { DISCOVER_SECTIONS } from '../services/tmdb.js';
import type { ArtSubject } from '../types.js';

/**
 * Poster warmer (D21).
 *
 * After boot (and then every `intervalMs`) it walks the browse rails plus the
 * existing download rows and makes sure a portrait `poster` file exists on the
 * `art` volume for each title (IMDb id via TMDB → OMDb → Amazon, downloaded by
 * the `artCache` pipeline and served from `/api/images/art/*`). Titles with no
 * poster or no key are recorded as empty and not retried aggressively; the
 * image route also lazily warms on first render, so rails just get filled
 * ahead of time.
 */
export function startArtWarmLoop(deps: AppDeps, intervalMs: number): NodeJS.Timeout {
  let running = false;

  async function run(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await warmOnce(deps);
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
  if (!deps.artCache) return;
  const subjects = await collectEntries(deps);
  if (subjects.length === 0) return;

  const downloaded = await deps.artCache.warm(subjects);
  if (downloaded > 0) console.log(`[poster-warm] downloaded ${downloaded} poster file(s)`);
  console.log(`[poster-warm] ensured posters for ${subjects.length} rail/download titles`);
}
