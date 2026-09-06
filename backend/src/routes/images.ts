import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { Router } from 'express';
import type { AppDeps } from '../deps.js';

const TMDB_IMAGE_PATH_RE = /^[a-zA-Z0-9/_.-]+$/;
const ALLOWED_SIZES = new Set(['w500', 'w780', 'w1280']);
const POSTER_KIND = 'poster';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

export function createImagesRouter(deps: AppDeps): Router {
  const router = Router();

  // S8 — TMDB image proxy (key never reaches the browser). Still used for TV
  // episode stills; card/poster art is served from the art volume instead (D21).
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

  // Locally cached OMDb portrait poster (D21). The file name always comes from
  // the `art_files` row — never from the request — so traversal is impossible;
  // `root` containment is an extra guard. A title that isn't cached yet is
  // warmed on demand (one OMDb fetch max) so newly-rendered cards resolve fast.
  router.get('/images/art/:mediaType/:tmdbId/:kind', async (req, res) => {
    const { mediaType, tmdbId: tmdbIdRaw, kind } = req.params as Record<string, string>;
    if (mediaType !== 'movie' && mediaType !== 'tv') {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const tmdbId = Number(tmdbIdRaw);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || kind !== POSTER_KIND) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (!deps.artFiles) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const subject = { mediaType, tmdbId } as { mediaType: 'movie' | 'tv'; tmdbId: number };
    let rows = await deps.artFiles.getMany([subject]);
    let row = rows.find((r) => r.kind === POSTER_KIND);
    if (!row || row.status !== 'ok' || !row.filePath) {
      if (deps.artCache) {
        await deps.artCache.warm([subject]);
        rows = await deps.artFiles.getMany([subject]);
        row = rows.find((r) => r.kind === POSTER_KIND);
      }
    }
    if (!row || row.status !== 'ok' || !row.filePath) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const fileName = row.filePath;
    if (!/^[a-zA-Z0-9_.-]+$/.test(fileName)) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const ext = fileName.slice(fileName.lastIndexOf('.'));
    res.set('Content-Type', MIME_BY_EXT[ext] ?? 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(fileName, { root: deps.config.artDir }, (error) => {
      if (!error) return;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        res.status(404).json({ error: 'not found' });
        return;
      }
      console.error('art file serve failed', error);
      if (!res.headersSent) res.status(500).json({ error: 'internal error' });
    });
  });

  return router;
}
