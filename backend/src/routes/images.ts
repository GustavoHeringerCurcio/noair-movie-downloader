import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { Router } from 'express';
import type { Response } from 'express';
import type { AppDeps } from '../deps.js';
import type { ArtCache } from '../lib/artCache.js';
import type { ArtKind } from '../db/artFilesRepo.js';
import type { ArtSubject } from '../types.js';

const TMDB_IMAGE_PATH_RE = /^[a-zA-Z0-9/_.-]+$/;
const ALLOWED_SIZES = new Set(['w500', 'w780', 'w1280']);

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

function mediaTypeOrNull(value: string | undefined): 'movie' | 'tv' | null {
  return value === 'movie' || value === 'tv' ? value : null;
}

export function createImagesRouter(deps: AppDeps): Router {
  const router = Router();

  /**
   * Serve a locally-cached artwork file for a subject. The file name always
   * comes from the `art_files` row — never from the request — so traversal is
   * impossible; `root` containment is an extra guard. A subject that isn't
   * cached yet is warmed on demand (one provider fetch max) via `cache` so a
   * freshly-rendered card resolves its own art without waiting for a loop.
   * Missing art (a `404`/no key/transient warm failure) is answered `404` and
   * the frontend falls back to the next art tier.
   */
  async function serveCachedArt(
    res: Response,
    subject: ArtSubject,
    kind: ArtKind,
    cache: ArtCache | null | undefined,
  ): Promise<void> {
    if (!deps.artFiles || !cache) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    let rows = await deps.artFiles.getMany([subject]);
    let row = rows.find((r) => r.kind === kind);
    if (!row || row.status !== 'ok' || !row.filePath) {
      await cache.warm([subject]);
      rows = await deps.artFiles.getMany([subject]);
      row = rows.find((r) => r.kind === kind);
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
  }

  // S8 — TMDB image proxy (key never reaches the browser). Still used for TV
  // episode stills and the vertical poster cards (`w780` posters, T-002);
  // card art is served from the art volume / fanart route instead (D21/T-002).
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

  // S8b — locally cached artwork (OMDb portrait `poster`, D21; TMDB transparent
  // `logo`, T-002). The route warms on first miss exactly like the poster did.
  router.get('/images/art/:mediaType/:tmdbId/:kind', async (req, res) => {
    const { mediaType: mediaTypeRaw, tmdbId: tmdbIdRaw, kind } = req.params as Record<string, string>;
    const mediaType = mediaTypeOrNull(mediaTypeRaw);
    const tmdbId = Number(tmdbIdRaw);
    if (!mediaType || !Number.isInteger(tmdbId) || tmdbId <= 0) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (kind !== 'poster' && kind !== 'logo') {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const subject = { mediaType, tmdbId } as ArtSubject;
    const cache = kind === 'logo' ? deps.logoCache : deps.artCache;
    await serveCachedArt(res, subject, kind, cache);
  });

  // S8c — fanart.tv 16:9 key-art thumb (kind `thumb`, T-002). Mirrors S8b:
  // cached file on the `art` volume, warm-on-miss, key never reaches the browser.
  router.get('/images/fanart/:mediaType/:tmdbId/thumb', async (req, res) => {
    const { mediaType: mediaTypeRaw, tmdbId: tmdbIdRaw } = req.params as Record<string, string>;
    const mediaType = mediaTypeOrNull(mediaTypeRaw);
    const tmdbId = Number(tmdbIdRaw);
    if (!mediaType || !Number.isInteger(tmdbId) || tmdbId <= 0) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    await serveCachedArt(res, { mediaType, tmdbId }, 'thumb', deps.fanartCache);
  });

  return router;
}
