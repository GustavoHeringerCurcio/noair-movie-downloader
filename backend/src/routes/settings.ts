import { Router } from 'express';
import type { AppDeps } from '../deps.js';
import {
  resolveImageProvider,
  setImageProvider,
  type ImageProvider,
} from '../lib/enrich.js';

function toProvider(value: unknown): ImageProvider | null {
  return value === 'tmdb' || value === 'fanart' ? value : null;
}

export function createSettingsRouter(deps: AppDeps): Router {
  const router = Router();

  router.get('/settings', async (_req, res) => {
    const provider = await resolveImageProvider(deps);
    res.json({ artwork: { provider, fanartConfigured: deps.fanart != null } });
  });

  router.put('/settings', async (req, res) => {
    const body = (req.body ?? {}) as { artwork?: { provider?: unknown } };
    const provider = toProvider(body?.artwork?.provider);
    if (!provider) {
      res.status(400).json({ error: 'artwork.provider must be "tmdb" or "fanart"' });
      return;
    }
    if (provider === 'fanart' && deps.fanart == null) {
      res.status(400).json({ error: 'FanArt.tv is not configured — set FANART_API_KEY in .env' });
      return;
    }
    await setImageProvider(deps, provider);
    res.json({ artwork: { provider, fanartConfigured: deps.fanart != null } });
  });

  return router;
}
