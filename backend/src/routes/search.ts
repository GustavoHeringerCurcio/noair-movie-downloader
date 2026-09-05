import { Router } from 'express';
import type { SearchType } from '../types.js';
import { UpstreamError } from '../types.js';
import { enrichItems } from '../lib/enrich.js';
import type { AppDeps } from '../deps.js';

export function createSearchRouter(deps: AppDeps): Router {
  const router = Router();

  router.get('/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      res.status(400).json({ error: 'missing query parameter q' });
      return;
    }
    const rawType = typeof req.query.type === 'string' ? req.query.type : 'all';
    const type: SearchType = rawType === 'movie' || rawType === 'tv' ? rawType : 'all';
    try {
      const items = await deps.tmdb.searchMulti(q, type);
      const enriched = await enrichItems(items, deps);
      res.json({ items: enriched });
    } catch (error) {
      if (error instanceof UpstreamError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  return router;
}
