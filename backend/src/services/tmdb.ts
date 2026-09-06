import type { MediaDetail, MediaItem, MediaType, SearchType, TvEpisode, TvSeasonSummary } from '../types.js';
import { UpstreamError } from '../types.js';
import { fetchWithRetry } from '../lib/http.js';

export const DISCOVER_SECTIONS = ['trending-week', 'best-movies', 'best-tv'] as const;

export type DiscoverSection = (typeof DISCOVER_SECTIONS)[number];

/** Normalized TMDB `/videos` result (S15). `site` stays verbatim ("YouTube"/"Vimeo"). */
export interface TmdbVideo {
  /** Video display name from TMDB. */
  name: string | null;
  /** Platform video id — for YouTube this is directly embeddable. */
  key: string;
  /** Upstream `site` field, verbatim. */
  site: string;
  /** Upstream `type` field (e.g. "Trailer", "Teaser", "Clip"). */
  kind: string;
  official: boolean;
  language: string | null;
  publishedAt: string | null;
}

export interface TmdbClient {
  searchMulti(q: string, type: SearchType): Promise<MediaItem[]>;
  details(id: number, type: MediaType, language?: string): Promise<MediaDetail>;
  browse(section: DiscoverSection): Promise<MediaItem[]>;
  seasonEpisodes(id: number, seasonNumber: number): Promise<TvEpisode[]>;
  tvdbId(id: number): Promise<number | null>;
  /** Raw `/movie|tv/{id}/videos` results (S15); a 404 (unknown id) maps to `[]`. */
  videos(id: number, type: MediaType): Promise<TmdbVideo[]>;
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
  seasons?: TmdbSeasonDto[];
}

interface TmdbSeasonDto {
  season_number?: number;
  name?: string | null;
  episode_count?: number;
  poster_path?: string | null;
}

interface TmdbEpisodeDto {
  season_number?: number;
  episode_number?: number;
  name?: string | null;
  overview?: string | null;
  still_path?: string | null;
  runtime?: number | null;
  air_date?: string | null;
}

interface TmdbExternalIds {
  tvdb_id?: number | null;
}

interface TmdbVideoDto {
  name?: string | null;
  key?: string;
  site?: string;
  type?: string;
  official?: boolean;
  iso_639_1?: string | null;
  published_at?: string | null;
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

  async function details(id: number, type: MediaType, language = 'en-US'): Promise<MediaDetail> {
    const url = `${config.baseUrl}/${type}/${id}?language=${encodeURIComponent(language)}&api_key=${encodeURIComponent(config.apiKey)}`;
    let res: Response;
    try {
      res = await fetchWithRetry(fetchImpl, url, {}, { retries: 2, baseBackoffMs: 500, timeoutMs: 10000 });
    } catch {
      throw new UpstreamError(502, 'TMDB unreachable');
    }
    if (!res.ok) throw new UpstreamError(502, `TMDB ${type} ${id} failed (HTTP ${res.status})`);
    const d = (await res.json()) as TmdbDetails;
    const seasons: TvSeasonSummary[] | undefined =
      type === 'tv'
        ? (d.seasons ?? [])
            .filter((s) => (s.season_number ?? 0) > 0 && (s.episode_count ?? 0) > 0)
            .map((s) => ({
              seasonNumber: s.season_number as number,
              name: s.name || `Season ${s.season_number}`,
              episodeCount: s.episode_count as number,
            }))
            .sort((a, b) => a.seasonNumber - b.seasonNumber)
        : undefined;
    const detail: MediaDetail = {
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
    if (seasons !== undefined) detail.seasons = seasons;
    return detail;
  }

  async function seasonEpisodes(id: number, seasonNumber: number): Promise<TvEpisode[]> {
    const url = `${config.baseUrl}/tv/${id}/season/${seasonNumber}?language=en-US&api_key=${encodeURIComponent(config.apiKey)}`;
    let res: Response;
    try {
      res = await fetchWithRetry(fetchImpl, url, {}, { retries: 2, baseBackoffMs: 500, timeoutMs: 10000 });
    } catch {
      throw new UpstreamError(502, 'TMDB unreachable');
    }
    if (res.status === 404) throw new UpstreamError(404, 'season not found');
    if (!res.ok) throw new UpstreamError(502, `TMDB season ${seasonNumber} failed (HTTP ${res.status})`);
    const data = (await res.json()) as { episodes?: TmdbEpisodeDto[] };
    return (data.episodes ?? [])
      .filter((e) => (e.episode_number ?? 0) > 0)
      .map((e) => ({
        seasonNumber: Number(e.season_number ?? seasonNumber),
        episodeNumber: e.episode_number as number,
        name: e.name ?? '',
        overview: e.overview ?? '',
        stillPath: e.still_path ?? null,
        runtime: e.runtime ?? null,
        airDate: e.air_date ?? null,
      }));
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

  async function tvdbId(id: number): Promise<number | null> {
    const url = `${config.baseUrl}/tv/${id}/external_ids?language=en-US&api_key=${encodeURIComponent(config.apiKey)}`;
    let res: Response;
    try {
      res = await fetchWithRetry(fetchImpl, url, {}, { retries: 1, baseBackoffMs: 300, timeoutMs: 8000 });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as TmdbExternalIds;
    const tvdb = data.tvdb_id;
    return Number.isInteger(tvdb) && (tvdb as number) > 0 ? (tvdb as number) : null;
  }

  async function videos(id: number, type: MediaType): Promise<TmdbVideo[]> {
    const url = `${config.baseUrl}/${type}/${id}/videos?language=en-US&api_key=${encodeURIComponent(config.apiKey)}`;
    let res: Response;
    try {
      res = await fetchWithRetry(fetchImpl, url, {}, { retries: 1, baseBackoffMs: 300, timeoutMs: 8000 });
    } catch {
      throw new UpstreamError(502, 'TMDB unreachable');
    }
    // An unknown id has no videos — not an error for the trailer feature.
    if (res.status === 404) return [];
    if (!res.ok) throw new UpstreamError(502, `TMDB videos failed (HTTP ${res.status})`);
    const data = (await res.json()) as { results?: TmdbVideoDto[] };
    return (data.results ?? [])
      .filter((v) => typeof v.key === 'string' && v.key.length > 0)
      .map((v) => ({
        name: v.name ?? null,
        key: v.key as string,
        site: v.site ?? '',
        kind: v.type ?? '',
        official: v.official ?? false,
        language: v.iso_639_1 ? v.iso_639_1 : null,
        publishedAt: v.published_at ?? null,
      }));
  }

  return { searchMulti, details, browse, seasonEpisodes, tvdbId, videos };
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
