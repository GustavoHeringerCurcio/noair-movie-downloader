import { Router } from 'express';
import type { AppDeps } from '../deps.js';
import type { DownloadRecord } from '../types.js';
import {
  isInsideDirectory,
  resolveInside,
  resolvePlaybackFile,
} from '../lib/streaming.js';
import { probeMediaInfo, listSidecarSubtitles } from '../lib/mediaInfo.js';
import { packageKey } from '../lib/hls.js';
import { createPackageManager, type PackageState } from '../lib/packages.js';

interface ResolvedFile {
  relative: string;
  absolutePath: string;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

const PACKAGE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function createPlaybackRouter(deps: AppDeps): Router {
  const manager = createPackageManager({
    packageRoot: deps.config.packageDir,
    maxBytes: deps.config.packageMaxBytes,
  });
  const router = Router();

  function resolveFile(record: DownloadRecord, file: string | null): ResolvedFile | null {
    const resolved = resolvePlaybackFile(deps.config.downloadDir, record.contentPath, record.streamFilePath, file || null);
    if (!resolved) return null;
    const absolutePath = resolveInside(deps.config.downloadDir, resolved.relative);
    if (!isInsideDirectory(deps.config.downloadDir, absolutePath)) return null;
    return { relative: resolved.relative, absolutePath };
  }

  async function loadPackage(
    infoHash: string,
    file: string | null,
    variant: 'web' | 'compat',
  ): Promise<
    { record: DownloadRecord; resolved: ResolvedFile; state: PackageState } | { error: { status: number; message: string } }
  > {
    const record = await deps.downloads.findByInfoHash(infoHash.toLowerCase());
    if (!record) return { error: { status: 404, message: 'not found' } };
    const resolved = resolveFile(record, file);
    if (!resolved) return { error: { status: 404, message: 'not ready — wait for the download to finish' } };
    const media = await probeMediaInfo(resolved.absolutePath);
    if (!media) return { error: { status: 500, message: 'could not probe media' } };
    const sidecars = listSidecarSubtitles(resolved.absolutePath);
    // 4K compat renditions are downscaled to 1080p (D27); ≤1080p compat keeps
    // the source resolution. Derived server-side so the package key and the
    // built rendition always match.
    const targetHeight = variant === 'compat' && (media.height ?? 0) >= 2160 ? 1080 : null;
    const state = await manager.ensurePackage({
      infoHash: record.infoHash,
      relative: resolved.relative,
      absolutePath: resolved.absolutePath,
      media,
      sidecars,
      variant,
      targetHeight,
    });
    return { record, resolved, state };
  }

  function packageStatusBody(state: PackageState) {
    return { phase: state.phase, progress: state.progress, error: state.error };
  }

  function variantFrom(value: unknown): 'web' | 'compat' {
    return value === 'compat' ? 'compat' : 'web';
  }

  router.get('/playback/:infoHash/hls/status', async (req, res) => {
    const infoHash = toText(req.params.infoHash).trim().toLowerCase();
    const file = toText(req.query.file) || null;
    const loaded = await loadPackage(infoHash, file, variantFrom(req.query.variant));
    if ('error' in loaded) {
      res.status(loaded.error.status).json({ error: loaded.error.message });
      return;
    }
    res.json(packageStatusBody(loaded.state));
  });

  router.get('/playback/:infoHash/hls/master.m3u8', async (req, res) => {
    const infoHash = toText(req.params.infoHash).trim().toLowerCase();
    const file = toText(req.query.file) || null;
    const variant = variantFrom(req.query.variant);
    const loaded = await loadPackage(infoHash, file, variant);
    if ('error' in loaded) {
      res.status(loaded.error.status).json({ error: loaded.error.message });
      return;
    }
    if (loaded.state.phase !== 'ready') {
      res.status(202).json(packageStatusBody(loaded.state));
      return;
    }
    const key = packageKey(loaded.record.infoHash, loaded.resolved.relative, variant);
    const master = manager.masterPlaylistPath(key);
    if (!master) {
      res.status(500).json({ error: 'package manifest missing' });
      return;
    }
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(master);
  });

  // Clears a failed/stale package so the next status call repackages.
  router.delete('/playback/:infoHash/hls', async (req, res) => {
    const infoHash = toText(req.params.infoHash).trim().toLowerCase();
    const file = toText(req.query.file) || null;
    const variant = variantFrom(req.query.variant);
    const record = await deps.downloads.findByInfoHash(infoHash);
    if (!record) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const resolved = resolveFile(record, file);
    if (!resolved) {
      res.status(404).json({ error: 'not ready' });
      return;
    }
    manager.deletePackage(packageKey(record.infoHash, resolved.relative, variant));
    res.status(204).end();
  });

  // Serves segments / init / subtitle media inside a package directory.
  router.get('/playback/pkg/:key/*', (req, res) => {
    const key = toText(req.params.key);
    if (!PACKAGE_KEY_RE.test(key)) {
      res.status(400).json({ error: 'invalid package key' });
      return;
    }
    const subPath = ((req.params as Record<string, string | undefined>)['0'] ?? '').replace(/\\/g, '/');
    if (!subPath || subPath.includes('..')) {
      res.status(400).json({ error: 'invalid path' });
      return;
    }
    const file = manager.filePathInPackage(key, subPath);
    if (!file) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (subPath.toLowerCase().endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
    }
    res.sendFile(file);
  });

  return router;
}
