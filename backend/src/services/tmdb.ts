import type { MediaDetail, MediaItem, MediaType, SearchType } from '../types.js';
import { UpstreamError } from '../types.js';
import { fetchWithRetry } from '../lib/http.js';

export const DISCOVER_SECTIONS = ['trending-week', 'best-movies', 'best-tv'] as const;

export type DiscoverSection = (typeof DISCOVER_SECTIONS)[number];

export interface TmdbClient {
  searchMulti(q: string, type: SearchType): Promise<MediaItem[]>;
  details(id: number, type: MediaType): Promise<MediaDetail>;
  browse(section: DiscoverSection): Promise<MediaItem[]>;
}

export interface TmdbClientConfig {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

interface TmdbSearchResult {
  id: number;
  media_type?: string;
  title?: string | null;
  name?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string | null;
  vote_average?: number;
}

interface TmdbDetails {
  id: number;
  title?: string | null;
  name?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string | null;
  vote_average?: number;
  runtime?: number | null;
  episode_run_time?: number[];
  genres?: { name?: string }[];
}

function yearFromDate(date: string | null | undefined): number | null {
  if (!date) return null;
  const year = parseInt(date.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

export function createTmdbClient(config: TmdbClientConfig): TmdbClient {
  const fetchImpl = config.fetchImpl ?? fetch;

  async function searchMulti(q: string, type: SearchType): Promise<MediaItem[]> {
    const url = `${config.baseUrl}/search/multi?query=${encodeURIComponent(q)}&language=en-US&api_key=${encodeURIComponent(config.apiKey)}`;
    let res: Response;
    try {
      res = await fetchWithRetry(fetchImpl, url, {}, { retries: 2, baseBackoffMs: 500, timeoutMs: 10000 });
    } catch {
      throw new UpstreamError(502, 'TMDB unreachable');
    }
    if (!res.ok) throw new UpstreamError(502, `TMDB search failed (HTTP ${res.status})`);
    const data = (await res.json()) as { results?: TmdbSearchResult[] };
    return (data.results ?? [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .filter((r) => type === 'all' || r.media_type === type)
      .map<TmdbSearchResult>((r) => r)
      .map((r) => ({
        tmdbId: r.id,
        mediaType: r.media_type as MediaType,
        title: r.title ?? r.name ?? '',
        year: yearFromDate(r.release_date ?? r.first_air_date),
        posterPath: r.poster_path ?? null,
        backdropPath: r.backdrop_path ?? null,
        overview: r.overview ?? '',
        voteAverage: r.vote_average ?? 0,
      }));
  }

  async function details(id: number, type: MediaType): Promise<MediaDetail> {
    const url = `${config.baseUrl}/${type}/${id}?language=en-US&api_key=${encodeURIComponent(config.apiKey)}`;
    let res: Response;
    try {
      res = await fetchWithRetry(fetchImpl, url, {}, { retries: 2, baseBackoffMs: 500, timeoutMs: 10000 });
    } catch {
      throw new UpstreamError(502, 'TMDB unreachable');
    }
    if (!res.ok) throw new UpstreamError(502, `TMDB ${type} ${id} failed (HTTP ${res.status})`);
    const d = (await res.json()) as TmdbDetails;
    return {
      tmdbId: d.id,
      mediaType: type,
      title: d.title ?? d.name ?? '',
      year: yearFromDate(d.release_date ?? d.first_air_date),
      overview: d.overview ?? '',
      posterPath: d.poster_path ?? null,
      backdropPath: d.backdrop_path ?? null,
      voteAverage: d.vote_average ?? 0,
      genres: (d.genres ?? []).map((g) => g.name ?? '').filter(Boolean),
      runtime: type === 'movie' ? (d.runtime ?? null) : (d.episode_run_time?.[0] ?? null),
    };
  }

  async function browse(section: DiscoverSection): Promise<MediaItem[]> {
    const paths = sectionPaths(section);
    const results = await Promise.all(
      paths.map(async (path) => {
        const sep = path.includes('?') ? '&' : '?';
        const url = `${config.baseUrl}${path}${sep}language=en-US&api_key=${encodeURIComponent(config.apiKey)}`;
        let res: Response;
        try {
          res = await fetchWithRetry(fetchImpl, url, {}, { retries: 2, baseBackoffMs: 500, timeoutMs: 10000 });
        } catch {
          throw new UpstreamError(502, 'TMDB unreachable');
        }
        if (!res.ok) throw new UpstreamError(502, `TMDB browse failed (HTTP ${res.status})`);
        const data = (await res.json()) as { results?: TmdbSearchResult[] };
        return (data.results ?? []).map<TmdbSearchResult>((r) => r);
      }),
    );
    const seen = new Set<number>();
    return results.flat().reduce<MediaItem[]>((acc, r) => {
      if (seen.has(r.id)) return acc;
      const mt = (r.media_type ?? (paths[0]?.includes('/tv/') ? 'tv' : 'movie')) as MediaType;
      if (mt !== 'movie' && mt !== 'tv') return acc;
      seen.add(r.id);
      acc.push({
        tmdbId: r.id,
        mediaType: mt,
        title: r.title ?? r.name ?? '',
        year: yearFromDate(r.release_date ?? r.first_air_date),
        posterPath: r.poster_path ?? null,
        backdropPath: r.backdrop_path ?? null,
        overview: r.overview ?? '',
        voteAverage: r.vote_average ?? 0,
      });
      return acc;
    }, []);
  }

  return { searchMulti, details, browse };
}

function sectionPaths(section: DiscoverSection): string[] {
  switch (section) {
    case 'trending-week':
      return ['/trending/movie/week', '/trending/tv/week'];
    case 'best-movies':
      return ['/discover/movie?sort_by=vote_average.desc&vote_count.gte=2000'];
    case 'best-tv':
      return ['/discover/tv?sort_by=vote_average.desc&vote_count.gte=500'];
  }
}
