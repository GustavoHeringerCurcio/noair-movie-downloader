import path from 'node:path';
import { Router, type Response } from 'express';
import type { MediaType } from '../types.js';
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
import { packageKey } from '../lib/hls.js';
import { episodeKeyFromFilename } from '../lib/releaseParser.js';
import { enrichDownloads } from '../lib/enrich.js';

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

function qualityField<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const v = toText(value);
  return (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function toBool(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

export function createDownloadsRouter(deps: AppDeps): Router {
  const router = Router();

  router.get('/downloads', async (_req, res) => {
    const records = await deps.downloads.list();
    const downloads = await enrichDownloads(records, deps);
    res.json({ downloads });
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
    try {
      await deps.qbittorrent.deleteTorrent(infoHash, deleteFiles);
    } catch (error) {
      console.error(`qBittorrent delete failed for ${infoHash}`, error);
    }
    cleanupTorrentPackages(deps.config.packageDir, infoHash, deps.config.downloadDir, record.contentPath);
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
