import { spawn } from 'node:child_process';
import { Router } from 'express';
import type { AppDeps } from '../deps.js';
import { isInsideDirectory, resolveInside, resolveStreamForServing } from '../lib/streaming.js';
import { buildCompatCommand } from '../lib/transcode.js';

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

  // ffmpeg remux: video copied, first audio track re-encoded to AAC so browsers
  // that can't decode AC3/E-AC3/DTS get sound. No seeking (progressive).
  router.get('/stream/:infoHash/compat', async (req, res) => {
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

    const { args } = buildCompatCommand(absolutePath);
    let proc;
    try {
      proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      res.status(500).json({ error: 'ffmpeg not available' });
      return;
    }

    let settled = false;
    const finish = (status: number): void => {
      if (settled) return;
      settled = true;
      if (!res.headersSent) {
        res.status(status).end();
      } else if (!res.writableEnded) {
        res.end();
      }
    };

    req.on('close', () => {
      proc?.kill('SIGKILL');
    });

    proc.on('error', (error) => {
      console.error(`ffmpeg spawn failed for ${infoHash}`, error);
      finish(500);
    });

    proc.on('exit', (code) => {
      if (code !== 0) {
        console.error(`ffmpeg exited ${code} for ${infoHash}`);
      }
      finish(200);
    });

    res.set('Content-Type', 'video/mp4');
    res.set('Cache-Control', 'no-store');
    proc.stdout.pipe(res);
  });

  return router;
}
