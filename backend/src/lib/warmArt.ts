import type { AppDeps } from '../deps.js';
import { resolveImageProvider } from './enrich.js';
import { DISCOVER_SECTIONS } from '../services/tmdb.js';
import { artKey } from './artService.js';
import type { ArtSubject, MediaItem, MediaType } from '../types.js';

/**
 * Background artwork warmer.
 *
 * After boot (and then every `intervalMs`) it walks the browse rails plus the
 * existing download rows and runs two phases:
 *
 * 1. Fanart metadata (`media_art`) — fetches whatever is missing through the
 *    rate-limited Fanart gateway and refreshes long-stale `empty` rows.
 *    Runs whenever a Fanart key is configured. NOTE (temporary, D17): the old
 *    guard only ran this in Fanart provider mode; it now runs in both so the
 *    poster-first tiles can use Fanart key art while TMDB provider is active.
 * 2. Downloaded artwork files (`art_files` + `ART_DIR`) — downloads the
 *    poster/background/logo set for the same titles so cards can be served
 *    locally (S8b) instead of proxying on every request.
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

interface Entry {
  subject: ArtSubject;
  posterPath: string | null;
}

async function collectEntries(deps: AppDeps): Promise<Entry[]> {
  const seen = new Map<string, Entry>();
  const add = (subject: ArtSubject, posterPath: string | null): void => {
    seen.set(artKey(subject), { subject, posterPath });
  };

  for (const section of DISCOVER_SECTIONS) {
    try {
      const items = await deps.tmdb.browse(section);
      items.forEach((item: MediaItem) => add({ tmdbId: item.tmdbId, mediaType: item.mediaType }, item.posterPath));
    } catch (error) {
      console.warn(`[art-warm] browse ${section} failed`, error);
    }
  }
  try {
    const downloads = await deps.downloads.list();
    downloads.forEach((record) => {
      if (record.tmdbId != null && record.mediaType != null) {
        add({ tmdbId: record.tmdbId, mediaType: record.mediaType as MediaType }, record.posterPath);
      }
    });
  } catch (error) {
    console.warn('[art-warm] downloads list failed', error);
  }
  return Array.from(seen.values());
}

async function warmFanartMetadata(deps: AppDeps, entries: Entry[], emptyRetryMs: number): Promise<void> {
  if (!deps.fanart) return;
  const subjects = entries.map((e) => e.subject);
  if (subjects.length === 0) return;

  await deps.art.resolveManyCached(subjects);
  deps.art.enqueueMissing(subjects);
  await deps.art.drain();

  const refreshed = await deps.art.refreshExpired(subjects, emptyRetryMs);
  if (refreshed > 0) await deps.art.drain();
  // Backfill rows cached before the poster_url column existed (or any thumbless
  // row fetched > 1 day ago) so portrait posters appear.
  const thumbless = await deps.art.refreshThumbless(subjects, 24 * 60 * 60 * 1000);
  if (thumbless > 0) await deps.art.drain();
  if (refreshed > 0 || thumbless > 0) {
    console.log(`[art-warm] fanart pass refreshed ${refreshed} empty, ${thumbless} thumbless`);
  }
}

async function warmArtFiles(deps: AppDeps, entries: Entry[]): Promise<void> {
  if (!deps.artCache) return;
  const downloaded = await deps.artCache.warm(entries.map((e) => ({ ...e.subject, posterPath: e.posterPath })));
  if (downloaded > 0) console.log(`[art-warm] downloaded ${downloaded} art file(s)`);
}

async function warmOnce(deps: AppDeps, emptyRetryMs: number): Promise<void> {
  const entries = await collectEntries(deps);
  if (entries.length === 0) return;

  await warmFanartMetadata(deps, entries, emptyRetryMs);
  await warmArtFiles(deps, entries);

  const provider = await resolveImageProvider(deps);
  console.log(`[art-warm] cached ${entries.length} rail/download titles (provider=${provider})`);
}
