import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { Router } from 'express';
import type { AppDeps } from '../deps.js';

const TMDB_IMAGE_PATH_RE = /^[a-zA-Z0-9/_.-]+$/;
const ALLOWED_SIZES = new Set(['w500', 'w1280']);

export function createImagesRouter(deps: AppDeps): Router {
  const router = Router();

  router.get('/images/tmdb/*', async (req, res) => {
    const imagePath = (req.params as Record<string, string>)['0'] ?? '';
    if (!TMDB_IMAGE_PATH_RE.test(imagePath)) {
      res.status(400).json({ error: 'invalid path' });
      return;
    }
    const segments = imagePath.split('/');
    const size = segments[0] ?? 'w500';
    const rest = segments.slice(1).join('/');
    if (!ALLOWED_SIZES.has(size) || !rest) {
      res.status(400).json({ error: 'invalid path' });
      return;
    }
    const url = `${deps.config.tmdbImageBaseUrl}/t/p/${size}/${rest}`;
    try {
      const upstream = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!upstream.ok) {
        console.error(`image proxy upstream error: ${url} -> HTTP ${upstream.status}`);
        res.status(502).json({ error: 'upstream error' });
        return;
      }
      res.set('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      const body = Readable.fromWeb(upstream.body as ReadableStream);
      body.pipe(res);
    } catch (error) {
      console.error(`image proxy fetch failed: ${url}`, error);
      res.status(502).json({ error: 'upstream error' });
    }
  });

  return router;
}
