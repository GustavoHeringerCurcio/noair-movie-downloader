import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { AppDeps } from './deps.js';
import { UpstreamError } from './types.js';
import { createSearchRouter } from './routes/search.js';
import { createMediaRouter } from './routes/media.js';
import { createDownloadsRouter } from './routes/downloads.js';
import { createStreamRouter } from './routes/stream.js';
import { createImagesRouter } from './routes/images.js';
import { createBrowseRouter } from './routes/browse.js';
import { createSettingsRouter } from './routes/settings.js';

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', createSearchRouter(deps));
  app.use('/api', createMediaRouter(deps));
  app.use('/api', createDownloadsRouter(deps));
  app.use('/api', createStreamRouter(deps));
  app.use('/api', createImagesRouter(deps));
  app.use('/api', createBrowseRouter(deps));
  app.use('/api', createSettingsRouter(deps));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof UpstreamError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('unhandled error', err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
