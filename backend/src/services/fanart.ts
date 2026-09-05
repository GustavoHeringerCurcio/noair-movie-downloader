export interface FanartImage {
  thumbUrl: string | null;
  logoUrl: string | null;
}

export interface FanartClient {
  /** Movie artwork by TMDB id. */
  getMovieArt(tmdbId: number): Promise<FanartImage>;
  /** TV artwork by TVDB id (resolve via TMDB external_ids first). */
  getTvArt(tvdbId: number): Promise<FanartImage>;
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

function firstNonEmpty(a: FanartFile[] | undefined, b: FanartFile[] | undefined): FanartFile[] | undefined {
  if (a && a.length > 0) return a;
  return b;
}

export function createFanartClient(config: FanartClientConfig): FanartClient {
  const fetchImpl = config.fetchImpl ?? fetch;
  const base = (config.baseUrl ?? 'https://webservice.fanart.tv/v3').replace(/\/+$/, '');
  const cache = new Map<string, { value: FanartImage; expires: number }>();

  async function request(kind: 'movies' | 'tv', id: number): Promise<FanartImage> {
    const cacheKey = `${kind}:${id}`;
    const hit = cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.value;

    const url = `${base}/${kind}/${id}?api_key=${encodeURIComponent(config.apiKey)}&format=json`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      return { thumbUrl: null, logoUrl: null };
    }
    const data = (await res.json()) as FanartResponse;
    const value: FanartImage =
      kind === 'movies'
        ? { thumbUrl: pickBest(data.moviethumb), logoUrl: pickBest(firstNonEmpty(data.hdmovielogo, data.movielogo)) }
        : { thumbUrl: pickBest(data.tvthumb), logoUrl: pickBest(firstNonEmpty(data.hdtvlogo, data.clearlogo)) };
    cache.set(cacheKey, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  }

  return {
    getMovieArt: (tmdbId) => request('movies', tmdbId),
    getTvArt: (tvdbId) => request('tv', tvdbId),
  };
}
