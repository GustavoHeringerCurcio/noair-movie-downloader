import type { AppDeps } from '../deps.js';
import type { MediaItem } from '../types.js';

/**
 * Attach the true IMDb score stored on each subject's `art_files` poster row
 * (T-004) to a list of titles. One batched `getMany` read per call — never an
 * OMDb request — so /browse and /search items can show their cached rating
 * without a per-title round trip. A title the pipeline has not resolved (or
 * one with no stored score) reads `null`, and a DB hiccup degrades to all-null
 * so a listing never fails over the ratings.
 */
export async function attachImdbRatings(deps: AppDeps, items: MediaItem[]): Promise<MediaItem[]> {
  const attached = items.map((item) => ({ ...item, imdbRating: null }));
  if (!deps.artFiles || items.length === 0) return attached;
  try {
    const rows = await deps.artFiles.getMany(
      items.map((item) => ({ mediaType: item.mediaType, tmdbId: item.tmdbId })),
    );
    const ratingBySubject = new Map<string, number | null>();
    for (const row of rows) {
      if (row.kind !== 'poster' || row.imdbRating == null) continue;
      ratingBySubject.set(`${row.mediaType}:${row.tmdbId}`, row.imdbRating);
    }
    return items.map((item) => ({
      ...item,
      imdbRating: ratingBySubject.get(`${item.mediaType}:${item.tmdbId}`) ?? null,
    }));
  } catch {
    return attached;
  }
}
