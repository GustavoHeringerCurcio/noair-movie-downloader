/**
 * Fanart.tv webservice client.
 *
 * Every call resolves to a status-aware result — it never throws:
 * - `ok`    → usable artwork found (thumb/logo are the most-liked picks)
 * - `empty` → the title exists on Fanart.tv but has no matching art
 * - `error` → transient failure (network, HTTP 429/5xx) that MUST NOT be cached
 *
 * Callers (the artwork cache) treat only `ok`/`empty` as storable and back off
 * on `error` so a Fanart outage can never be mistaken for "no art".
 */

export type FanartStatus = 'ok' | 'empty' | 'error';

export interface FanartResult {
  status: FanartStatus;
  thumbUrl: string | null;
  logoUrl: string | null;
}

export interface FanartClient {
  /** Movie artwork by TMDB id. */
  getMovieArt(tmdbId: number): Promise<FanartResult>;
  /** TV artwork by TVDB id (resolve via TMDB external_ids first). */
  getTvArt(tvdbId: number): Promise<FanartResult>;
}

export interface FanartClientConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface FanartFile {
  url?: string;
  likes?: number;
}

function pickBest(files: FanartFile[] | undefined): string | null {
  if (!files || files.length === 0) return null;
  const sorted = [...files].sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
  const url = sorted[0]?.url;
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

interface FanartResponse {
  moviethumb?: FanartFile[];
  movieposter?: FanartFile[];
  hdmovielogo?: FanartFile[];
  movielogo?: FanartFile[];
  tvthumb?: FanartFile[];
  tvposter?: FanartFile[];
  hdtvlogo?: FanartFile[];
  clearlogo?: FanartFile[];
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

function firstNonEmpty(a: FanartFile[] | undefined, b: FanartFile[] | undefined): FanartFile[] | undefined {
  if (a && a.length > 0) return a;
  return b;
}

export function createFanartClient(config: FanartClientConfig): FanartClient {
  const fetchImpl = config.fetchImpl ?? fetch;
  const base = (config.baseUrl ?? 'https://webservice.fanart.tv/v3').replace(/\/+$/, '');
  const cache = new Map<string, { value: FanartResult; expires: number }>();

  async function request(kind: 'movies' | 'tv', id: number): Promise<FanartResult> {
    const cacheKey = `${kind}:${id}`;
    const hit = cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.value;

    const url = `${base}/${kind}/${id}?api_key=${encodeURIComponent(config.apiKey)}&format=json`;
    let result: FanartResult;
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (res.status === 404) {
        result = { status: 'empty', thumbUrl: null, logoUrl: null };
      } else if (!res.ok) {
        // 429 / 5xx / anything unexpected — transient, never cached.
        return { status: 'error', thumbUrl: null, logoUrl: null };
      }
      const data = (await res.json()) as FanartResponse;
      const image: FanartResult =
        kind === 'movies'
          ? {
              status: 'ok',
              thumbUrl: pickBest(data.moviethumb),
              logoUrl: pickBest(firstNonEmpty(data.hdmovielogo, data.movielogo)),
            }
          : {
              status: 'ok',
              thumbUrl: pickBest(data.tvthumb),
              logoUrl: pickBest(firstNonEmpty(data.hdtvlogo, data.clearlogo)),
            };
      result =
        image.thumbUrl != null || image.logoUrl != null
          ? image
          : { status: 'empty', thumbUrl: null, logoUrl: null };
    } catch {
      return { status: 'error', thumbUrl: null, logoUrl: null };
    }

    cache.set(cacheKey, { value: result, expires: Date.now() + (result.status === 'ok' ? CACHE_TTL_MS : EMPTY_TTL_MS) });
    return result;
  }

  return {
    getMovieArt: (tmdbId) => request('movies', tmdbId),
    getTvArt: (tvdbId) => request('tv', tvdbId),
  };
}
