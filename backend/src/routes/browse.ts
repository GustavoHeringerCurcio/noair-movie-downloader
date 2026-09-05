import { Router } from 'express';
import { DISCOVER_SECTIONS, type DiscoverSection } from '../services/tmdb.js';
import { UpstreamError } from '../types.js';
import { enrichItems } from '../lib/enrich.js';
import type { AppDeps } from '../deps.js';

function parseSection(value: unknown): DiscoverSection | null {
  const s = typeof value === 'string' ? value : null;
  return s && (DISCOVER_SECTIONS as readonly string[]).includes(s) ? (s as DiscoverSection) : null;
}

export function createBrowseRouter(deps: AppDeps): Router {
  const router = Router();

  router.get('/browse', async (req, res) => {
    const section = parseSection(req.query.section);
    if (!section) {
      res.status(400).json({ error: 'missing or invalid section' });
      return;
    }
    try {
      const items = await deps.tmdb.browse(section);
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
