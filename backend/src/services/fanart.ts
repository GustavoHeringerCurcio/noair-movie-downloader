/**
 * fanart.tv webservice client (16:9 "thumbnail with baked-in title" key-art).
 *
 * Part A of T-002 needs a *wide* art that genuinely reads as a horizontal
 * poster. fanart.tv's `moviethumb` (movie) / `tvthumb` (TV) arrays are exactly
 * that — landscape fan art with the title baked in. The client resolves the
 * best URL for a subject; the download-once cache (`artCache`, kind `thumb`)
 * mirrors the OMDb portrait pipeline and serves it from `/api/images/fanart/*`.
 *
 * Results are status-aware and never throw:
 * - `ok`    → usable key-art URL
 * - `empty` → the title has no fanart record/thumb — storable
 * - `error` → transient failure (unreachable, bad key) — NOT storable
 */

import type { MediaType } from '../types.js';

export type FanartStatus = 'ok' | 'empty' | 'error';

export interface FanartKeyArtResult {
  status: FanartStatus;
  url: string | null;
}

export interface FanartClient {
  /** Resolve the best 16:9 key-art thumb URL for a TMDB subject (movie/tv). */
  keyArt(mediaType: MediaType, tmdbId: number): Promise<FanartKeyArtResult>;
}

export interface FanartClientConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const REQUEST_TIMEOUT_MS = 8000;

/** One fanart.tv artwork entry; `likes` is a numeric string in the API. */
export interface FanartArtworkEntry {
  url?: string | null;
  lang?: string | null;
  likes?: string | number | null;
}

/**
 * Pure pick of the "best" thumb from a fanart.tv artwork array: entries are
 * ranked by (en language first, then most likes). Returns the URL of the top
 * entry with a non-empty `url`, or null when the list is empty/useless.
 */
export function pickBestThumbUrl(entries: FanartArtworkEntry[] | undefined | null): string | null {
  if (!entries || entries.length === 0) return null;
  const ranked = entries
    .filter((entry) => typeof entry.url === 'string' && entry.url.length > 0)
    .sort((a, b) => {
      const aEn = a.lang === 'en' ? 1 : 0;
      const bEn = b.lang === 'en' ? 1 : 0;
      if (aEn !== bEn) return bEn - aEn;
      const likesA = Number(a.likes ?? 0);
      const likesB = Number(b.likes ?? 0);
      return likesB - likesA;
    });
  return ranked[0]?.url ?? null;
}

export function createFanartClient(config: FanartClientConfig): FanartClient {
  const fetchImpl = config.fetchImpl ?? fetch;
  const base = (config.baseUrl ?? 'https://webservice.fanart.tv/v3').replace(/\/+$/, '');

  async function keyArt(mediaType: MediaType, tmdbId: number): Promise<FanartKeyArtResult> {
    const url = `${base}/${mediaType}/${tmdbId}?api_key=${encodeURIComponent(config.apiKey)}`;
    let res: Response;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      return { status: 'error', url: null };
    }
    // A title with no fanart record is a definitive "no art" (storable).
    if (res.status === 404) return { status: 'empty', url: null };
    // 401/403 (bad/revoked key) and 5xx are transient — never cache as empty.
    if (!res.ok) return { status: 'error', url: null };
    let data: Record<string, unknown>;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      return { status: 'error', url: null };
    }
    const field = mediaType === 'movie' ? 'moviethumb' : 'tvthumb';
    const entries = data[field];
    const thumbUrl = Array.isArray(entries) ? pickBestThumbUrl(entries as FanartArtworkEntry[]) : null;
    return thumbUrl ? { status: 'ok', url: thumbUrl } : { status: 'empty', url: null };
  }

  return { keyArt };
}
