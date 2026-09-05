import type { AppDeps } from '../deps.js';
import type { ArtSubject, DownloadRecord, MediaArt, MediaDetail, MediaItem } from '../types.js';
import { artKey } from './artService.js';

export type ImageProvider = 'tmdb' | 'fanart';

export const IMAGE_PROVIDER_KEY = 'imageProvider';

interface ProviderSetting {
  provider?: unknown;
}

/** Resolve the active artwork provider. TMDB is the hard fallback when no Fanart key is configured. */
export async function resolveImageProvider(deps: AppDeps): Promise<ImageProvider> {
  const setting = await deps.settings.get<ProviderSetting>(IMAGE_PROVIDER_KEY);
  if (setting?.provider === 'fanart' && deps.fanart) return 'fanart';
  if (setting?.provider === 'tmdb') return 'tmdb';
  return deps.fanart ? 'fanart' : 'tmdb';
}

/** Persist the artwork provider choice and drop in-memory art knowledge. */
export async function setImageProvider(deps: AppDeps, provider: ImageProvider): Promise<void> {
  await deps.settings.set(IMAGE_PROVIDER_KEY, { provider });
  deps.art.clear();
}

function isFanartActive(deps: AppDeps): Promise<boolean> {
  return deps.fanart ? resolveImageProvider(deps).then((p) => p === 'fanart') : Promise.resolve(false);
}

function subjectsOf(items: Array<{ tmdbId: number; mediaType: string }>): ArtSubject[] {
  return items.map((item) => ({ tmdbId: item.tmdbId, mediaType: item.mediaType as ArtSubject['mediaType'] }));
}

/**
 * Attach cached Fanart `art` to browse/search lists. Resolves from memory + the
 * `media_art` table only — never blocks on Fanart. Titles not yet cached are
 * enqueued for a background, rate-limited fetch and show a placeholder until
 * the cache fills. In TMDB mode items are returned untouched.
 */
export async function enrichItems(items: MediaItem[], deps: AppDeps): Promise<MediaItem[]> {
  if (items.length === 0 || !(await isFanartActive(deps))) return items;
  const subjects = subjectsOf(items);
  const artMap = await deps.art.resolveManyCached(subjects);
  deps.art.enqueueMissing(subjects);
  return items.map((item) => {
    const art = artMap.get(artKey({ tmdbId: item.tmdbId, mediaType: item.mediaType }));
    return art ? { ...item, art } : item;
  });
}

/** Resolve Fanart art for a single title page, fetching (rate-limited) if needed. */
export async function enrichDetail(detail: MediaDetail, deps: AppDeps): Promise<MediaDetail> {
  if (!(await isFanartActive(deps))) return detail;
  const art = await deps.art.resolveOne({ tmdbId: detail.tmdbId, mediaType: detail.mediaType });
  return art ? { ...detail, art } : detail;
}

/**
 * Attach cached Fanart `art` to download rows so My Downloads / DownloadsPage
 * tiles keep the selected provider's imagery. Never blocks; uncached rows are
 * fetched in the background and appear on the next snapshot.
 */
export async function enrichDownloads(records: DownloadRecord[], deps: AppDeps): Promise<DownloadRecord[]> {
  const withIdentity = records.filter(
    (record): record is DownloadRecord & { tmdbId: number; mediaType: 'movie' | 'tv' } =>
      record.tmdbId != null && record.mediaType != null,
  );
  if (withIdentity.length === 0 || !(await isFanartActive(deps))) return records;

  const subjects = withIdentity.map((record) => ({ tmdbId: record.tmdbId, mediaType: record.mediaType }));
  const artMap = await deps.art.resolveManyCached(subjects);
  deps.art.enqueueMissing(subjects);
  const artByInfoHash = new Map(
    withIdentity.map((record) => {
      const key = `${record.mediaType}:${record.tmdbId}`;
      const art: MediaArt | null | undefined = artMap.get(key);
      return [record.infoHash, art ?? null] as const;
    }),
  );
  return records.map((record) => {
    const art = artByInfoHash.get(record.infoHash);
    return art ? { ...record, art } : record;
  });
}
