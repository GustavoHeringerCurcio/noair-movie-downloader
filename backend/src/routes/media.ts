import { Router } from 'express';
import type { AudioLang, Coverage, MediaDetail, MediaType, Source } from '../types.js';
import { UpstreamError } from '../types.js';
import { filterSourcesToMedia } from '../lib/releaseFilter.js';
import { coverageCovers, isWholeSeriesTitle, seasonQueryToken } from '../lib/releaseParser.js';
import { audioProfile, isAudioLang, loadAudioPreference, titleMatchesAudio } from '../lib/language.js';
import { enrichDetail } from '../lib/enrich.js';
import { pickTrailer } from '../lib/trailer.js';
import type { AppDeps } from '../deps.js';

function parseType(value: unknown): MediaType | null {
  return value === 'movie' || value === 'tv' ? value : null;
}

function parsePosInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function padEpisode(episode: number): string {
  return String(episode).padStart(2, '0');
}

function expandWholeSeries(coverage: Coverage[] | null, sourceTitle: string, detailSeasons: Coverage[] | null): Coverage[] | null {
  if (coverage !== null) return coverage;
  if (!isWholeSeriesTitle(sourceTitle) || !detailSeasons || detailSeasons.length === 0) return coverage;
  return detailSeasons;
}

/** Expands whole-series coverage and keeps only releases that cover the requested season/episode. */
function gateTvSources(sources: Source[], detail: MediaDetail, season: number, episode: number | null): Source[] {
  const detailSeasons: Coverage[] | null =
    detail.seasons && detail.seasons.length > 0
      ? detail.seasons.map((s) => ({ season: s.seasonNumber, episodes: null }))
      : null;
  return sources
    .map((source) => ({ ...source, coverage: expandWholeSeries(source.coverage, source.title, detailSeasons) }))
    .filter((source) => {
      if (source.coverage === null) return true;
      if (episode !== null) return coverageCovers(source.coverage, season, episode);
      return source.coverage.some((c) => c.season === season);
    });
}

/** Builds the Prowlarr query for a title (movies) or season/episode (TV). */
function buildQuery(title: string, year: number | null, season: number | null, episode: number | null): string {
  if (season !== null) {
    const token = `${seasonQueryToken(season)}${episode !== null ? `E${padEpisode(episode)}` : ''}`;
    return `${title} ${token}`.trim();
  }
  return `${title}${year ? ` ${year}` : ''}`.trim();
}

/** Live `indexerId → language` map; empty when Prowlarr admin is unavailable. Never throws. */
async function indexerLanguageMap(deps: AppDeps): Promise<Map<number, string>> {
  if (!deps.prowlarrAdmin) return new Map();
  try {
    const list = await deps.prowlarrAdmin.listIndexers();
    const map = new Map<number, string>();
    for (const item of list) {
      if (item.language) map.set(item.id, item.language.toLowerCase());
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Indexer language tags that guarantee the *preference's* audio is present on a
 * release regardless of its title. Only Brazilian PT trackers (which exclusively
 * host PT-dubbed movies/TV) qualify today; pt-PT and other regions mix original
 * audio, so those releases must be verified from the title instead.
 */
const AUDIO_GUARANTEED_INDEXER_LANGS: Partial<Record<AudioLang, string[]>> = {
  pt: ['pt-br'],
};

/** True when results from an indexer should be included in a strict search for `pref`. */
function isTargetIndexer(lang: string | undefined, pref: AudioLang): boolean {
  return typeof lang === 'string' && lang.startsWith(pref);
}

/** True when an indexer's content itself guarantees the requested audio. */
function indexerQualifiesRelease(lang: string | undefined, pref: AudioLang): boolean {
  if (!lang) return false;
  return (AUDIO_GUARANTEED_INDEXER_LANGS[pref] ?? []).includes(lang);
}

type MatchReason = 'title' | 'indexer';

function matchReason(source: Source, pref: AudioLang, langById: Map<number, string>): MatchReason | null {
  const flags = { lang: source.audioLang ?? null, mode: source.audioMode ?? null };
  // A language explicitly named in the title is authoritative.
  if (flags.lang !== null && flags.lang !== pref) return null;
  if (titleMatchesAudio(flags, pref)) return 'title';
  return indexerQualifiesRelease(langById.get(source.indexerId), pref) ? 'indexer' : null;
}

/**
 * Keeps only sources that match `pref` and, when a source matched purely because
 * its indexer guarantees the audio (no title tag), tags it with the preference so
 * the UI can surface it as a match.
 */
function matchedSources(sources: Source[], pref: AudioLang, langById: Map<number, string>): Source[] {
  const out: Source[] = [];
  for (const source of sources) {
    const reason = matchReason(source, pref, langById);
    if (reason === null) continue;
    out.push(reason === 'indexer' && source.audioLang == null ? { ...source, audioLang: pref } : source);
  }
  return out;
}

export function createMediaRouter(deps: AppDeps): Router {
  const router = Router();

  router.get('/media/:id', async (req, res) => {
    const id = parseInt(req.params.id ?? '', 10);
    const type = parseType(req.query.type);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: 'invalid media id' });
      return;
    }
    if (!type) {
      res.status(400).json({ error: 'missing or invalid type (movie|tv)' });
      return;
    }
    try {
      const detail = await deps.tmdb.details(id, type);
      const enriched = await enrichDetail(detail, deps);
      res.json(enriched);
    } catch (error) {
      if (error instanceof UpstreamError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  // TV episode metadata for a single season (S12).
  router.get('/media/:id/season/:seasonNumber', async (req, res) => {
    const id = parseInt(req.params.id ?? '', 10);
    const season = parsePosInt(req.params.seasonNumber);
    const type = parseType(req.query.type);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: 'invalid media id' });
      return;
    }
    if (type !== 'tv') {
      res.status(400).json({ error: 'missing or invalid type (tv)' });
      return;
    }
    if (season === null) {
      res.status(400).json({ error: 'invalid seasonNumber' });
      return;
    }
    try {
      const detail = await deps.tmdb.details(id, 'tv');
      const seasonSummary = (detail.seasons ?? []).find((s) => s.seasonNumber === season);
      if (!seasonSummary) {
        res.status(404).json({ error: 'season not found' });
        return;
      }
      const episodes = await deps.tmdb.seasonEpisodes(id, season);
      res.json({ season: seasonSummary, episodes });
    } catch (error) {
      if (error instanceof UpstreamError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  // S15 — best hover-trailer for a title (never blocks the UI; failures → null client-side).
  router.get('/media/:id/trailer', async (req, res) => {
    const id = parseInt(req.params.id ?? '', 10);
    const type = parseType(req.query.type);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: 'invalid media id' });
      return;
    }
    if (!type) {
      res.status(400).json({ error: 'missing or invalid type (movie|tv)' });
      return;
    }
    try {
      const videos = await deps.tmdb.videos(id, type);
      res.json({ trailer: pickTrailer(videos) });
    } catch (error) {
      if (error instanceof UpstreamError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  // S16 — everything the expanded Netflix-style hover card needs, in one call:
  // best trailer + genres/duration/seasons/certification (D20). The certification
  // and trailer lookups degrade to null so one missing extra never blanks the card.
  router.get('/media/:id/hover', async (req, res) => {
    const id = parseInt(req.params.id ?? '', 10);
    const type = parseType(req.query.type);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: 'invalid media id' });
      return;
    }
    if (!type) {
      res.status(400).json({ error: 'missing or invalid type (movie|tv)' });
      return;
    }
    try {
      const detail = await deps.tmdb.details(id, type);
      const [trailer, certification] = await Promise.all([
        deps.tmdb.videos(id, type).then(pickTrailer).catch(() => null),
        deps.tmdb.certification(id, type).catch(() => null),
      ]);
      res.json({
        trailer,
        genres: detail.genres,
        runtime: type === 'movie' ? detail.runtime : null,
        seasons: type === 'tv' ? (detail.seasons?.length ?? null) : null,
        certification,
      });
    } catch (error) {
      if (error instanceof UpstreamError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  router.get('/media/:id/sources', async (req, res) => {
    const id = parseInt(req.params.id ?? '', 10);
    const type = parseType(req.query.type);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: 'invalid media id' });
      return;
    }
    if (!type) {
      res.status(400).json({ error: 'missing or invalid type (movie|tv)' });
      return;
    }
    const season = parsePosInt(req.query.season);
    const episode = parsePosInt(req.query.episode);
    if (type === 'movie' && season !== null) {
      res.status(400).json({ error: 'season is only valid for tv' });
      return;
    }
    if (episode !== null && season === null) {
      res.status(400).json({ error: 'episode requires a season' });
      return;
    }
    const audioOverride = isAudioLang(req.query.audio) ? req.query.audio : null;
    let pref: AudioLang;
    try {
      pref = audioOverride ?? (await loadAudioPreference(deps));
    } catch {
      pref = 'en';
    }
    const strict = pref !== 'en';
    try {
      const detail = await deps.tmdb.details(id, type);
      const query = buildQuery(detail.title, detail.year, season, episode);
      const category: 2000 | 5000 = type === 'movie' ? 2000 : 5000;
      const all = await deps.prowlarr.search(query, category);
      const filtered = filterSourcesToMedia(all, { title: detail.title, year: detail.year });

      let sources = filtered;
      if (type === 'tv' && season !== null) {
        sources = gateTvSources(filtered, detail, season, episode);
      }

      // English (default): return everything, tagged. Other languages: strict.
      if (!strict) {
        res.json({ sources });
        return;
      }

      const langById = await indexerLanguageMap(deps);
      let matches = matchedSources(sources, pref, langById);
      // Rescue: matching indexers may only index releases under the localized
      // title (which the English query above could not find at all).
      if (matches.length === 0) {
        matches = await targetedLanguageSearch({
          deps,
          detail,
          query,
          category,
          season,
          episode,
          pref,
          langById,
        });
      }
      if (matches.length > 0) {
        res.json({ sources: matches });
        return;
      }
      // No releases were found anywhere — show the plain empty state, not the
      // "no <language> audio — search English?" prompt (English would be empty too).
      if (filtered.length === 0) {
        res.json({ sources: [] });
        return;
      }
      res.json({ sources: [], noMatchForAudio: pref });
    } catch (error) {
      if (error instanceof UpstreamError) {
        if (error.status === 401) {
          res.json({ sources: [], authError: true });
          return;
        }
        if (error.status === 502) {
          res.json({ sources: [], unreachable: true });
          return;
        }
      }
      throw error;
    }
  });

  return router;
}

interface LanguageSearchContext {
  deps: AppDeps;
  detail: MediaDetail;
  query: string;
  category: 2000 | 5000;
  season: number | null;
  episode: number | null;
  pref: AudioLang;
  langById: Map<number, string>;
}

/**
 * Strict fallback: re-searches only indexers whose language matches the
 * preference, using that language's localized TMDB title (private BR/PT
 * trackers often name releases in Portuguese). Results are still run through
 * the same match rules — a pt-PT indexer hosting original-audio releases is not
 * assumed to be a match; only pt-BR trackers guarantee the audio.
 */
async function targetedLanguageSearch(ctx: LanguageSearchContext): Promise<Source[]> {
  const { deps, detail, category, season, episode, pref, langById } = ctx;
  const targetIds = [...langById.entries()]
    .filter(([, lang]) => isTargetIndexer(lang, pref))
    .map(([id]) => id);
  if (targetIds.length === 0) return [];

  const profile = audioProfile(pref);
  let query = ctx.query;
  let filterTitle = detail.title;
  let filterYear = detail.year;
  try {
    const localized = await deps.tmdb.details(detail.tmdbId, detail.mediaType, profile.tmdb);
    const localizedTitle = localized?.title?.trim();
    if (localizedTitle && localizedTitle.toLowerCase() !== detail.title.toLowerCase()) {
      query = buildQuery(localizedTitle, localized.year ?? detail.year, season, episode);
      filterTitle = localizedTitle;
      filterYear = localized.year ?? detail.year;
    }
  } catch {
    // Keep the original (English) query; the retry on matching indexers alone
    // still covers cases where the combined search skipped or timed them out.
  }

  try {
    const extra = await deps.prowlarr.search(query, category, { indexerIds: targetIds });
    let extraSources = filterSourcesToMedia(extra, { title: filterTitle, year: filterYear });
    if (detail.mediaType === 'tv' && season !== null) {
      extraSources = gateTvSources(extraSources, detail, season, episode);
    }
    return matchedSources(extraSources, pref, langById);
  } catch {
    return [];
  }
}
