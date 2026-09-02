import type { MediaDetail, MediaItem, MediaType, SearchType } from '../types.js';
import { UpstreamError } from '../types.js';
import { fetchWithRetry } from '../lib/http.js';

export interface TmdbClient {
  searchMulti(q: string, type: SearchType): Promise<MediaItem[]>;
  details(id: number, type: MediaType): Promise<MediaDetail>;
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

  return { searchMulti, details };
}
