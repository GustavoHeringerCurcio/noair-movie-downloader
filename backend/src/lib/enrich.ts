import type { AppDeps } from '../deps.js';
import type { DownloadRecord, MediaArt, MediaDetail, MediaItem, MediaType } from '../types.js';

export type ImageProvider = 'tmdb' | 'fanart';

export const IMAGE_PROVIDER_KEY = 'imageProvider';

interface ProviderSetting {
  provider?: unknown;
}

const ART_HIT_TTL_MS = 24 * 60 * 60 * 1000;
const ART_EMPTY_TTL_MS = 5 * 60 * 1000;

interface ArtCacheEntry {
  value: MediaArt | null;
  expires: number;
}

/**
 * Process-wide art memo keyed by `mediaType:tmdbId`. Without it, Fanart/TMDB
 * would be re-queried for every download-list snapshot (socket emit every 2s)
 * and for every TV title needing a TVDB id resolution.
 */
const artCache = new Map<string, ArtCacheEntry>();

/** Exposed for tests (and provider flips) so stale art never leaks between runs. */
export function clearArtCache(): void {
  artCache.clear();
}

function hasArt(value: MediaArt | null): value is MediaArt {
  return value != null && (value.thumbUrl != null || value.logoUrl != null);
}

function cacheKey(subject: ArtSubject): string {
  return `${subject.mediaType}:${subject.tmdbId}`;
}

/** Resolve the active artwork provider. TMDB is the hard fallback when no Fanart key is configured. */
export async function resolveImageProvider(deps: AppDeps): Promise<ImageProvider> {
  const setting = await deps.settings.get<ProviderSetting>(IMAGE_PROVIDER_KEY);
  if (setting?.provider === 'fanart' && deps.fanart) return 'fanart';
  if (setting?.provider === 'tmdb') return 'tmdb';
  return deps.fanart ? 'fanart' : 'tmdb';
}

/** Persist the artwork provider choice. */
export async function setImageProvider(deps: AppDeps, provider: ImageProvider): Promise<void> {
  await deps.settings.set(IMAGE_PROVIDER_KEY, { provider });
  clearArtCache();
}

interface ArtSubject {
  tmdbId: number;
  mediaType: MediaType;
}

async function artFor(subject: ArtSubject, deps: AppDeps): Promise<MediaArt | null> {
  const key = cacheKey(subject);
  const hit = artCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value: MediaArt | null = null;
  try {
    if (subject.mediaType === 'movie') {
      value = await deps.fanart!.getMovieArt(subject.tmdbId);
    } else {
      const tvdb = await deps.tmdb.tvdbId(subject.tmdbId);
      value = tvdb == null ? null : await deps.fanart!.getTvArt(tvdb);
    }
  } catch {
    value = null;
  }

  const ttl = hasArt(value) ? ART_HIT_TTL_MS : ART_EMPTY_TTL_MS;
  artCache.set(key, { value, expires: Date.now() + ttl });
  return value;
}

async function poolMap<T>(items: T[], workers: number, fn: (item: T) => Promise<MediaArt | null>): Promise<Array<MediaArt | null>> {
  const results = new Array<MediaArt | null>(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  }
  const queue = Array.from({ length: Math.min(workers, items.length) }, () => run());
  await Promise.all(queue);
  return results;
}

function isFanartActive(deps: AppDeps): Promise<boolean> {
  return deps.fanart ? resolveImageProvider(deps).then((p) => p === 'fanart') : Promise.resolve(false);
}

/**
 * Best-effort, parallel Fanart enrichment for browse/search lists. Never throws.
 * In TMDB mode (or without a key) items are returned untouched — no `art`, no calls.
 */
export async function enrichItems(items: MediaItem[], deps: AppDeps): Promise<MediaItem[]> {
  if (items.length === 0 || !(await isFanartActive(deps))) return items;
  const arts = await poolMap(items, 5, (item) => artFor(item, deps));
  return items.map((item, index) => (arts[index] ? { ...item, art: arts[index] } : item));
}

/** Best-effort Fanart enrichment for a single title page. Never throws. */
export async function enrichDetail(detail: MediaDetail, deps: AppDeps): Promise<MediaDetail> {
  if (!(await isFanartActive(deps))) return detail;
  const art = await artFor({ tmdbId: detail.tmdbId, mediaType: detail.mediaType }, deps);
  return art ? { ...detail, art } : detail;
}

/**
 * Attach Fanart `art` to download rows so My Downloads / DownloadsPage tiles
 * keep the selected provider's imagery. Fanart mode only; otherwise returns
 * the records untouched (rows that lack a tmdb identity are never enriched).
 */
export async function enrichDownloads(records: DownloadRecord[], deps: AppDeps): Promise<DownloadRecord[]> {
  if (records.length === 0 || !(await isFanartActive(deps))) return records;
  const arts = await poolMap(records, 5, (record) => {
    if (record.tmdbId == null || record.mediaType == null) return Promise.resolve(null);
    return artFor({ tmdbId: record.tmdbId, mediaType: record.mediaType }, deps);
  });
  return records.map((record, index) => (arts[index] ? { ...record, art: arts[index] } : record));
}
