import { Router } from 'express';
import type { AppDeps } from '../deps.js';
import { isInsideDirectory, resolveInside, resolveStreamForServing } from '../lib/streaming.js';

export function createStreamRouter(deps: AppDeps): Router {
  const router = Router();

  router.get('/stream/:infoHash', async (req, res) => {
    const infoHash = (req.params.infoHash ?? '').trim().toLowerCase();
    const record = await deps.downloads.findByInfoHash(infoHash);
    if (!record) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const resolved = resolveStreamForServing(deps.config.downloadDir, record.contentPath, record.streamFilePath);
    if (!resolved) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const absolutePath = resolveInside(deps.config.downloadDir, resolved.relative);
    if (!isInsideDirectory(deps.config.downloadDir, absolutePath)) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.sendFile(absolutePath, { headers: { 'Content-Type': resolved.mime } });
  });

  return router;
}
