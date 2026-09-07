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
  /** IMDb id (`tt1234567`) resolved from TMDB external ids (feeds the OMDb poster pipeline). */
  imdbId(id: number, type: MediaType): Promise<string | null>;
  /** Raw `/movie|tv/{id}/videos` results (S15); a 404 (unknown id) maps to `[]`. */
  videos(id: number, type: MediaType): Promise<TmdbVideo[]>;
  /** US age rating (`R`, `PG-13`, `TV-MA`, …) for the hover card (S16); null when the title has no US certification. */
  certification(id: number, type: MediaType): Promise<string | null>;
  /** Transparent-logo `file_path` from `/movie|tv/{id}/images` (T-002); null when the title has no usable logo. */
  logoPath(id: number, type: MediaType): Promise<string | null>;
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
  imdb_id?: string | null;
}

interface TmdbReleaseDatesResult {
  iso_3166_1?: string;
  release_dates?: { certification?: string }[];
}

interface TmdbContentRatingsResult {
  iso_3166_1?: string;
  rating?: string;
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

interface TmdbLogoDto {
  file_path?: string | null;
  iso_639_1?: string | null;
  vote_average?: number;
}

function yearFromDate(date: string | null | undefined): number | null {
  if (!date) return null;
  const year = parseInt(date.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

/**
 * Pure pick of the best transparent logo from TMDB `/images` `logos` (T-002).
 * Logos are the studio wordmark/lockup used as a poster overlay. English (or
 * language-agnostic) art wins, then the community's highest `vote_average`;
 * entries without a `file_path` are ignored.
 */
export function pickBestLogoPath(logos: TmdbLogoDto[] | undefined | null): string | null {
  if (!logos || logos.length === 0) return null;
  const ranked = logos
    .filter((logo) => typeof logo.file_path === 'string' && (logo.file_path as string).length > 0)
    .sort((a, b) => {
      const aLang = a.iso_639_1 ?? '';
      const bLang = b.iso_639_1 ?? '';
      const aEn = aLang === 'en' || aLang === '' ? 1 : 0;
      const bEn = bLang === 'en' || bLang === '' ? 1 : 0;
      if (aEn !== bEn) return bEn - aEn;
      return (b.vote_average ?? 0) - (a.vote_average ?? 0);
    });
  return ranked[0]?.file_path ?? null;
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
    // TMDB only sets `media_type` on search/trending results — discover
    // endpoints omit it, so each path contributes its own fallback type
    // (movie and TV share one numeric id space). `/trending|discover/tv…`
    // always carries a `tv` path segment; movie endpoints never do.
    const typeOfPath = (path: string): MediaType =>
      path.split('?')[0]!.split('/').includes('tv') ? 'tv' : 'movie';
    const batches = await Promise.all(
      sectionPaths(section).map(async (path) => {
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
        const fallbackType = typeOfPath(path);
        return (data.results ?? []).map((r) => {
          const mt = r.media_type === 'movie' || r.media_type === 'tv' ? r.media_type : fallbackType;
          return { mt, r };
        });
      }),
    );
    const seen = new Set<string>();
    return batches.flat().reduce<MediaItem[]>((acc, { mt, r }) => {
      const key = `${mt}:${r.id}`;
      if (seen.has(key)) return acc;
      seen.add(key);
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

  async function imdbId(id: number, type: MediaType): Promise<string | null> {
    const url = `${config.baseUrl}/${type}/${id}/external_ids?language=en-US&api_key=${encodeURIComponent(config.apiKey)}`;
    let res: Response;
    try {
      res = await fetchWithRetry(fetchImpl, url, {}, { retries: 1, baseBackoffMs: 300, timeoutMs: 8000 });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as TmdbExternalIds;
    const imdb = data.imdb_id;
    return typeof imdb === 'string' && /^tt\d+$/.test(imdb) ? imdb : null;
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

  async function certification(id: number, type: MediaType): Promise<string | null> {
    const path = type === 'movie' ? `/movie/${id}/release_dates` : `/tv/${id}/content_ratings`;
    const url = `${config.baseUrl}${path}?language=en-US&api_key=${encodeURIComponent(config.apiKey)}`;
    let res: Response;
    try {
      res = await fetchWithRetry(fetchImpl, url, {}, { retries: 1, baseBackoffMs: 300, timeoutMs: 8000 });
    } catch {
      throw new UpstreamError(502, 'TMDB unreachable');
    }
    // An unknown id (or a title with no age ratings) is not an error for the hover card.
    if (res.status === 404) return null;
    if (!res.ok) throw new UpstreamError(502, `TMDB certification failed (HTTP ${res.status})`);
    const data = (await res.json()) as { results?: (TmdbReleaseDatesResult | TmdbContentRatingsResult)[] };
    const us = (data.results ?? []).find((r) => r.iso_3166_1 === 'US');
    if (!us) return null;
    if (type === 'movie') {
      const dates = (us as TmdbReleaseDatesResult).release_dates ?? [];
      const cert = dates.map((d) => d.certification ?? '').find((c) => c.trim().length > 0);
      return cert ? cert.trim() : null;
    }
    const rating = (us as TmdbContentRatingsResult).rating ?? '';
    return rating.trim().length > 0 ? rating.trim() : null;
  }

  async function logoPath(id: number, type: MediaType): Promise<string | null> {
    const url = `${config.baseUrl}/${type}/${id}/images?api_key=${encodeURIComponent(config.apiKey)}`;
    let res: Response;
    try {
      res = await fetchWithRetry(fetchImpl, url, {}, { retries: 1, baseBackoffMs: 300, timeoutMs: 8000 });
    } catch {
      throw new UpstreamError(502, 'TMDB unreachable');
    }
    // Unknown id / no image record is not an error for the logo overlay.
    if (res.status === 404) return null;
    if (!res.ok) throw new UpstreamError(502, `TMDB images failed (HTTP ${res.status})`);
    const data = (await res.json()) as { logos?: TmdbLogoDto[] };
    return pickBestLogoPath(data.logos ?? []);
  }

  return { searchMulti, details, browse, seasonEpisodes, imdbId, videos, certification, logoPath };
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
