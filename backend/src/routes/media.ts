import { Router } from 'express';
import type { Coverage, MediaType } from '../types.js';
import { UpstreamError } from '../types.js';
import { filterSourcesToMedia } from '../lib/releaseFilter.js';
import { coverageCovers, isWholeSeriesTitle, seasonQueryToken } from '../lib/releaseParser.js';
import { enrichDetail } from '../lib/enrich.js';
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
    try {
      const detail = await deps.tmdb.details(id, type);
      const baseQuery = `${detail.title}${detail.year ? ` ${detail.year}` : ''}`.trim();
      let query = baseQuery;
      if (season !== null) {
        const token = `${seasonQueryToken(season)}${episode !== null ? `E${padEpisode(episode)}` : ''}`;
        query = `${detail.title} ${token}`.trim();
      }
      const category: 2000 | 5000 = type === 'movie' ? 2000 : 5000;
      const all = await deps.prowlarr.search(query, category);
      const filtered = filterSourcesToMedia(all, { title: detail.title, year: detail.year });

      let sources = filtered;
      if (type === 'tv' && season !== null) {
        const detailSeasons: Coverage[] | null =
          detail.seasons && detail.seasons.length > 0
            ? detail.seasons.map((s) => ({ season: s.seasonNumber, episodes: null }))
            : null;
        sources = filtered.map((source) => ({
          ...source,
          coverage: expandWholeSeries(source.coverage, source.title, detailSeasons),
        }));
        sources = sources.filter((source) => {
          if (source.coverage === null) return true;
          if (episode !== null) return coverageCovers(source.coverage, season, episode);
          return source.coverage.some((c) => c.season === season);
        });
      }
      res.json({ sources });
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
