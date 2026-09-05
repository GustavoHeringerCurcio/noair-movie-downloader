import { spawn } from 'node:child_process';
import { Router, type Response } from 'express';
import type { AppDeps } from '../deps.js';
import { isInsideDirectory, resolveInside, resolvePlaybackFile } from '../lib/streaming.js';
import { probeMedia } from '../lib/probe.js';
import { decideStreamMode } from '../lib/streamPlan.js';
import { buildRemuxCommand, buildTranscodeCommand } from '../lib/transcode.js';
import type { DownloadRecord } from '../types.js';

function resolveFile(deps: AppDeps, record: DownloadRecord, chosenFile: string | null): string | null {
  const resolved = resolvePlaybackFile(deps.config.downloadDir, record.contentPath, record.streamFilePath, chosenFile);
  if (!resolved) return null;
  const absolutePath = resolveInside(deps.config.downloadDir, resolved.relative);
  if (!isInsideDirectory(deps.config.downloadDir, absolutePath)) return null;
  return absolutePath;
}

function mimeFor(deps: AppDeps, record: DownloadRecord, chosenFile: string | null): string {
  const resolved = resolvePlaybackFile(deps.config.downloadDir, record.contentPath, record.streamFilePath, chosenFile);
  return resolved?.mime ?? 'application/octet-stream';
}

function serveFfmpeg(
  res: Response,
  absolutePath: string,
  mode: 'remux-audio' | 'transcode',
): void {
  const { args } =
    mode === 'remux-audio'
      ? buildRemuxCommand(absolutePath)
      : buildTranscodeCommand(absolutePath);
  let proc;
  try {
    proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    res.status(500).json({ error: 'ffmpeg not available' });
    return;
  }

  let settled = false;
  const finish = (): void => {
    if (settled) return;
    settled = true;
    if (!res.headersSent) {
      res.status(200).end();
    } else if (!res.writableEnded) {
      res.end();
    }
  };

  const clientClose = (): void => {
    proc?.kill('SIGKILL');
  };
  res.req.on('close', clientClose);

  proc.on('error', (error) => {
    console.error(`ffmpeg spawn failed (${mode}) for ${absolutePath}`, error);
    settled = true;
    if (!res.headersSent) res.status(500).json({ error: 'ffmpeg not available' });
  });

  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`ffmpeg exited ${code} (${mode}) for ${absolutePath}`);
    }
    finish();
  });

  res.set('Content-Type', 'video/mp4');
  res.set('Cache-Control', 'no-store');
  proc.stdout.pipe(res);
}

export function createStreamRouter(deps: AppDeps): Router {
  const router = Router();

  // Native stream — original file with Range/seek (for browsers that can decode it,
  // and for external players). Codecs are NOT normalized.
  // Optional ?file=<relative> selects a specific episode inside a season pack.
  router.get('/stream/:infoHash', async (req, res) => {
    const infoHash = (req.params.infoHash ?? '').trim().toLowerCase();
    const file = typeof req.query.file === 'string' ? req.query.file : null;
    const record = await deps.downloads.findByInfoHash(infoHash);
    if (!record) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const absolutePath = resolveFile(deps, record, file);
    if (!absolutePath) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.sendFile(absolutePath, { headers: { 'Content-Type': mimeFor(deps, record, file) } });
  });

  // Browser watch stream — probes the file and serves whatever the browser can play:
  // direct (Range), audio remux (video copy + AAC), or H.264 transcode. 4K/UHD HEVC
  // is not transcoded; the client should route to the player-required flow instead.
  router.get('/stream/:infoHash/watch', async (req, res) => {
    const infoHash = (req.params.infoHash ?? '').trim().toLowerCase();
    const file = typeof req.query.file === 'string' ? req.query.file : null;
    const record = await deps.downloads.findByInfoHash(infoHash);
    if (!record) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const absolutePath = resolveFile(deps, record, file);
    if (!absolutePath) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const probe = await probeMedia(absolutePath);
    const mode = decideStreamMode(probe ?? { videoCodec: null, audioCodec: null, height: null });

    if (mode === 'direct') {
      res.sendFile(absolutePath, { headers: { 'Content-Type': mimeFor(deps, record, file) } });
      return;
    }
    if (mode === 'player-required') {
      res.status(415).json({ error: 'player-required' });
      return;
    }
    serveFfmpeg(res, absolutePath, mode);
  });

  return router;
}
