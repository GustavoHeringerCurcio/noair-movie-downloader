import { Router } from 'express';
import type { MediaType } from '../types.js';
import { UpstreamError } from '../types.js';
import type { AppDeps } from '../deps.js';

function parseType(value: unknown): MediaType | null {
  return value === 'movie' || value === 'tv' ? value : null;
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
      res.json(detail);
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
    try {
      const detail = await deps.tmdb.details(id, type);
      const query = `${detail.title}${detail.year ? ` ${detail.year}` : ''}`.trim();
      const category: 2000 | 5000 = type === 'movie' ? 2000 : 5000;
      const sources = await deps.prowlarr.search(query, category);
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
