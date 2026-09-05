import type { AppDeps } from '../deps.js';
import type { MediaArt, MediaDetail, MediaItem, MediaType } from '../types.js';

interface ArtSubject {
  tmdbId: number;
  mediaType: MediaType;
}

async function artFor(subject: ArtSubject, deps: AppDeps): Promise<MediaArt | null> {
  if (!deps.fanart) return null;
  try {
    if (subject.mediaType === 'movie') return await deps.fanart.getMovieArt(subject.tmdbId);
    const tvdb = await deps.tmdb.tvdbId(subject.tmdbId);
    if (tvdb == null) return null;
    return await deps.fanart.getTvArt(tvdb);
  } catch {
    return null;
  }
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

/** Best-effort, parallel Fanart enrichment for browse/search lists. Never throws. */
export async function enrichItems(items: MediaItem[], deps: AppDeps): Promise<MediaItem[]> {
  if (!deps.fanart || items.length === 0) return items;
  const arts = await poolMap(items, 5, (item) => artFor(item, deps));
  return items.map((item, index) => (arts[index] ? { ...item, art: arts[index] } : item));
}

/** Best-effort Fanart enrichment for a single title page. Never throws. */
export async function enrichDetail(detail: MediaDetail, deps: AppDeps): Promise<MediaDetail> {
  if (!deps.fanart) return detail;
  const art = await artFor({ tmdbId: detail.tmdbId, mediaType: detail.mediaType }, deps);
  return art ? { ...detail, art } : detail;
}
