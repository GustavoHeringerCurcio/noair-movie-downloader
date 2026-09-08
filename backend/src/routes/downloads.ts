import path from 'node:path';
import { rm } from 'node:fs/promises';
import { Router, type Response } from 'express';
import type { AudioLang, AudioMode, MediaType } from '../types.js';
import { UpstreamError } from '../types.js';
import type { AppDeps } from '../deps.js';
import {
  isInsideDirectory,
  listStreamableFiles,
  resolveInside,
  resolvePlaybackFile,
} from '../lib/streaming.js';
import { probeMedia } from '../lib/probe.js';
import { probeMediaInfo, listSidecarSubtitles } from '../lib/mediaInfo.js';
import { decidePlaybackMode, decideStreamMode } from '../lib/streamPlan.js';
import { cleanupTorrentPackages } from '../lib/packages.js';
import { packageKey, mseProbeTypes } from '../lib/hls.js';
import { optimizeDownload, readOptimizeJob } from '../lib/autoConvert.js';
import { episodeKeyFromFilename } from '../lib/releaseParser.js';

function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function toQueryString(params: Record<string, string>): string {
  const search = new URLSearchParams(params).toString();
  return search ? `?${search}` : '';
}

const RESOLUTIONS = ['2160p', '1080p', '720p', '480p'] as const;
const SOURCES = ['REMUX', 'BluRay', 'WEB-DL', 'WEBRip', 'BDRip', 'BRRip', 'HDTV', 'DVDRip'] as const;
const CODECS = ['x264', 'x265', 'AV1', 'XviD', 'DivX'] as const;
const AUDIO_LANGS: readonly AudioLang[] = ['en', 'pt', 'es', 'fr', 'de', 'it'];
const AUDIO_MODES: readonly AudioMode[] = ['dub', 'dual', 'multi'];

function qualityField<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const v = toText(value);
  return (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function toBool(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

/**
 * Best-effort disk sweep of a torrent's content once qBittorrent no longer
 * tracks it. `deleteFiles=true` already asks qBittorrent to remove the data,
 * but a torrent deleted out-of-band (or a partially-completed removal) can
 * leave the directory behind — this guarantees "remove" frees the disk.
 * Path-guarded: content outside the download root is never touched.
 */
async function deleteContentTree(downloadDir: string, contentPath: string): Promise<void> {
  const absolute = path.isAbsolute(contentPath) ? path.resolve(contentPath) : path.resolve(downloadDir, contentPath);
  if (!isInsideDirectory(downloadDir, absolute)) {
    console.warn(`[downloads] refusing to delete content outside download dir: ${contentPath}`);
    return;
  }
  try {
    await rm(absolute, { recursive: true, force: true });
  } catch (error) {
    console.error(`[downloads] failed to delete leftover content ${absolute}`, error);
  }
}

export function createDownloadsRouter(deps: AppDeps): Router {
  const router = Router();

  router.get('/downloads', async (_req, res) => {
    const downloads = await deps.downloads.list();
    res.json({ downloads: downloads.map((d) => ({ ...d, optimize: readOptimizeJob(deps, d) })) });
  });

  // Start (or resume) the background browser-copy for a finished title now.
  // Used by the "Optimize now" affordance and by the auto-convert completion hook.
  router.post('/downloads/:infoHash/optimize', async (req, res) => {
    const infoHash = toText(req.params.infoHash).trim().toLowerCase();
    const result = await optimizeDownload(deps, infoHash);
    if (result === 'not-found') {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ status: result });
  });

  // Lists the playable video files inside a torrent so the UI can offer an
  // episode/file picker for season packs (and multi-file releases). Each file
  // is tagged with its season/episode (parsed server-side, S13) so the client
  // never re-implements episode parsing.
  router.get('/downloads/:infoHash/files', async (req, res) => {
    const infoHash = toText(req.params.infoHash).trim().toLowerCase();
    const record = await deps.downloads.findByInfoHash(infoHash);
    if (!record) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (!record.contentPath) {
      res.status(404).json({ error: 'not ready' });
      return;
    }
    const files = listStreamableFiles(deps.config.downloadDir, record.contentPath).map((file) => {
      const key = episodeKeyFromFilename(path.basename(file.relative));
      return {
        ...file,
        seasonNumber: key ? key.season : null,
        episodeNumber: key ? key.episode : null,
      };
    });
    res.json({ files });
  });

  router.post('/downloads', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const infoHash = toText(body.infoHash).trim().toLowerCase();
    const magnetUri = toText(body.magnetUri).trim();
    const torrentName = toText(body.torrentName).trim();
    if (!infoHash || !magnetUri || !torrentName) {
      res.status(400).json({ error: 'missing required fields: infoHash, magnetUri, torrentName' });
      return;
    }

    const existing = await deps.downloads.findByInfoHash(infoHash);
    if (existing) {
      res.status(409).json({ error: 'Already downloading' });
      return;
    }

    const mediaType: MediaType | null =
      body.mediaType === 'movie' || body.mediaType === 'tv' ? body.mediaType : null;

    try {
      await deps.qbittorrent.addTorrent(magnetUri, { rename: torrentName });
    } catch (error) {
      if (error instanceof UpstreamError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }

    const record = await deps.downloads.insert({
      tmdbId: toIntOrNull(body.tmdbId),
      mediaType,
      title: toText(body.title) || null,
      year: toIntOrNull(body.year),
      posterPath: toText(body.posterPath) || null,
      backdropPath: toText(body.backdropPath) || null,
      seasonNumber: toIntOrNull(body.seasonNumber),
      episodeNumber: toIntOrNull(body.episodeNumber),
      infoHash,
      magnetUri,
      torrentName,
      indexer: toText(body.indexer) || null,
      resolution: qualityField(body.resolution, RESOLUTIONS),
      source: qualityField(body.source, SOURCES),
      codec: qualityField(body.codec, CODECS),
      hdr: toBool(body.hdr),
      isDolbyVision: toBool(body.isDolbyVision),
      audioLang: qualityField(body.audioLang, AUDIO_LANGS),
      audioMode: qualityField(body.audioMode, AUDIO_MODES),
    });
    res.status(201).json(record);
  });

  router.delete('/downloads/:infoHash', async (req, res) => {
    const infoHash = toText(req.params.infoHash).trim().toLowerCase();
    const record = await deps.downloads.findByInfoHash(infoHash);
    if (!record) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const deleteFiles = req.query.deleteFiles === 'true';

    // Playback packages are keyed per content file, so they must be enumerated
    // while the files are still on disk — before qBittorrent drops the torrent.
    cleanupTorrentPackages(deps.config.packageDir, infoHash, deps.config.downloadDir, record.contentPath);

    // The torrent (and, with deleteFiles, its data on disk) is owned by
    // qBittorrent — ask it to remove both. On failure we keep the DB row and
    // surface the error instead of silently dropping it: a row removed here
    // would orphan a still-seeding torrent the UI could never retry, and the
    // files would stay on disk.
    try {
      await deps.qbittorrent.deleteTorrent(infoHash, deleteFiles);
    } catch (error) {
      const message = error instanceof UpstreamError ? error.message : 'qBittorrent unreachable';
      console.error(`qBittorrent delete failed for ${infoHash}`, error);
      res.status(error instanceof UpstreamError ? error.status : 502).json({
        error: `Removal from qBittorrent failed (${message}). The download was kept so you can try again.`,
      });
      return;
    }

    // qBittorrent removes the data when deleteFiles=true; sweep anything it
    // left behind (e.g. a torrent already deleted out-of-band whose files were
    // orphaned) so "remove" really frees the disk. The DB record is removed
    // regardless — a contentPath that is gone or unwritable must not strand a
    // download row the poller can no longer update.
    if (deleteFiles && record.contentPath) {
      await deleteContentTree(deps.config.downloadDir, record.contentPath);
    }

    await deps.downloads.remove(infoHash);
    res.status(204).end();
  });

  router.get('/downloads/:infoHash/file', async (req, res) => {
    const infoHash = toText(req.params.infoHash).trim().toLowerCase();
    const file = toText(req.query.file);
    const record = await deps.downloads.findByInfoHash(infoHash);
    if (!record) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const resolved = resolvePlaybackFile(deps.config.downloadDir, record.contentPath, record.streamFilePath, file || null);
    if (!resolved) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const absolutePath = resolveInside(deps.config.downloadDir, resolved.relative);
    if (!isInsideDirectory(deps.config.downloadDir, absolutePath)) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.download(absolutePath, path.basename(absolutePath), {
      headers: { 'Content-Type': resolved.mime },
    });
  });

  // Playback info: codec probe + serving strategy so the UI can pick the right
  // player before mounting <video> (direct / remux / transcode / player-required).
  // An optional ?file=<relative> selects a specific episode inside a season pack.
  router.get('/downloads/:infoHash/playinfo', async (req, res) => {
    const infoHash = toText(req.params.infoHash).trim().toLowerCase();
    const file = toText(req.query.file);
    const record = await deps.downloads.findByInfoHash(infoHash);
    if (!record) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const resolved = resolvePlaybackFile(deps.config.downloadDir, record.contentPath, record.streamFilePath, file || null);
    if (!resolved) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const absolutePath = resolveInside(deps.config.downloadDir, resolved.relative);
    if (!isInsideDirectory(deps.config.downloadDir, absolutePath)) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const probe = await probeMedia(absolutePath);
    const probeInfo = probe ?? { videoCodec: null, audioCodec: null, height: null };
    const media = await probeMediaInfo(absolutePath);
    const sidecars = absolutePath ? listSidecarSubtitles(absolutePath) : [];
    const mode = media ? decidePlaybackMode(media, { sidecarSubtitles: sidecars.length }) : decideStreamMode(probeInfo);
    const qs = file ? toQueryString({ file }) : '';
    // A cached H.264 "compatibility" package can be built for anything that
    // isn't already natively playable (hls/player-required). The browser picks
    // it up when its MSE can't decode the file's own video (D26), or for 4K
    // when the user opts in to a 1080p rendition (D27).
    const compatWanted =
      (mode === 'hls' || mode === 'player-required') && media?.video != null && (media.height ?? 0) > 0;
    const compatTargetHeight = compatWanted && (media.height ?? 0) >= 2160 ? 1080 : null;
    res.json({
      mode,
      videoCodec: probeInfo.videoCodec,
      audioCodec: probeInfo.audioCodec,
      height: probeInfo.height,
      container: media?.container ?? null,
      durationSeconds: media?.durationSeconds ?? null,
      video: media?.video ?? null,
      audioTracks: media?.audioTracks ?? [],
      subtitleTracks: media?.subtitleTracks ?? [],
      sidecarSubtitles: sidecars,
      streamUrl: `/api/stream/${infoHash}/watch${qs}`,
      playUrl: `/api/stream/${infoHash}${qs}`,
      fileUrl: `/api/downloads/${infoHash}/file${qs}`,
      manifestUrl: mode === 'hls' ? `/api/playback/pkg/${packageKey(infoHash, resolved.relative)}/master.m3u8` : null,
      // Codec type strings the browser can probe before starting any packaging:
      // when none are supported the UI shows the external-player screen instead
      // of waiting on a package the browser could never decode (e.g. HEVC Main10).
      mseProbe: mode === 'hls' ? mseProbeTypes(media?.video ?? null) : null,
      compat: compatWanted
        ? {
            manifestUrl: `/api/playback/pkg/${packageKey(infoHash, resolved.relative, 'compat')}/master.m3u8`,
            targetHeight: compatTargetHeight,
          }
        : null,
    });
  });

  async function requireTorrent(res: Response, infoHash: string): Promise<boolean> {
    const record = await deps.downloads.findByInfoHash(infoHash);
    if (!record) {
      res.status(404).json({ error: 'not found' });
      return false;
    }
    return true;
  }

  router.post('/downloads/:infoHash/pause', async (req, res) => {
    const infoHash = toText(req.params.infoHash).trim().toLowerCase();
    if (!(await requireTorrent(res, infoHash))) return;
    try {
      await deps.qbittorrent.pauseTorrent(infoHash);
      res.status(204).end();
    } catch (error) {
      if (error instanceof UpstreamError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  router.post('/downloads/:infoHash/resume', async (req, res) => {
    const infoHash = toText(req.params.infoHash).trim().toLowerCase();
    if (!(await requireTorrent(res, infoHash))) return;
    try {
      await deps.qbittorrent.resumeTorrent(infoHash);
      res.status(204).end();
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
