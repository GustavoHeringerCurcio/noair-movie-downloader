import { Router } from 'express';
import type { SearchType } from '../types.js';
import { UpstreamError } from '../types.js';
import { attachImdbRatings } from '../lib/mediaRatings.js';
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
      const items = await attachImdbRatings(deps, await deps.tmdb.searchMulti(q, type));
      res.json({ items });
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
