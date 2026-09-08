import fs from 'node:fs';
import path from 'node:path';
import type { AppDeps } from '../deps.js';
import type { DownloadRecord } from '../types.js';
import { isInsideDirectory, resolveInside, resolvePlaybackFile } from './streaming.js';
import { listSidecarSubtitles, probeMediaInfo } from './mediaInfo.js';
import { decidePlaybackMode } from './streamPlan.js';
import { layoutFor, mseProbeTypes, packageKey } from './hls.js';

/**
 * Background optimization on download completion (Option C). When a movie's
 * torrent reaches 100% the backend converts it in the background — normally the
 * browser-decoded H.264 "web" copy (a fast repackage) or, for files browsers
 * can't decode (HEVC/x265 …), the H.264 compat copy (a re-encode). By the time
 * the user presses Watch the copy usually exists → instant, scrubbable playback
 * with no loading state.
 *
 * Movies only. TV episodes are optimized lazily when opened (a season pack
 * would otherwise serialize hours of encodes). Guarded by the site-wide
 * `autoConvertMovies` preference (default on).
 */

export const AUTO_CONVERT_KEY = 'autoConvertMovies';

export async function loadAutoConvertPreference(deps: AppDeps): Promise<boolean> {
  try {
    const stored = await deps.settings.get<{ enabled?: unknown }>(AUTO_CONVERT_KEY);
    return stored?.enabled !== false;
  } catch {
    return true;
  }
}

export async function saveAutoConvertPreference(deps: AppDeps, enabled: boolean): Promise<void> {
  await deps.settings.set(AUTO_CONVERT_KEY, { enabled });
}

interface ResolvedDefaultFile {
  relative: string;
  absolutePath: string;
}

function resolveDefaultFile(deps: AppDeps, record: DownloadRecord): ResolvedDefaultFile | null {
  if (!record.contentPath) return null;
  try {
    const resolved = resolvePlaybackFile(deps.config.downloadDir, record.contentPath, record.streamFilePath, null);
    if (!resolved) return null;
    const absolutePath = resolveInside(deps.config.downloadDir, resolved.relative);
    if (!isInsideDirectory(deps.config.downloadDir, absolutePath)) return null;
    return { relative: resolved.relative, absolutePath };
  } catch {
    return null;
  }
}

/**
 * Start a background package for a completed movie's default file, returning a
 * short status for the caller. `'skipped'` means this title doesn't need a
 * package (direct/remux native playback, or no playable file yet).
 */
export async function optimizeDownload(
  deps: AppDeps,
  infoHash: string,
): Promise<'started' | 'already-ready' | 'running' | 'skipped' | 'not-found'> {
  const manager = deps.packageManager;
  if (!manager) return 'skipped';
  const record = await deps.downloads.findByInfoHash(infoHash.toLowerCase());
  if (!record) return 'not-found';
  if (record.mediaType !== 'movie') return 'skipped';
  const file = resolveDefaultFile(deps, record);
  if (!file) return 'skipped';
  const media = await probeMediaInfo(file.absolutePath);
  if (!media?.video) return 'skipped';
  const sidecars = listSidecarSubtitles(file.absolutePath);
  const mode = decidePlaybackMode(media, { sidecarSubtitles: sidecars.length });
  // Only files the watch page routes through the package cache get optimized;
  // direct/remux/transcode titles already have instant browser paths.
  if (mode !== 'hls') return 'skipped';

  // The variant the frontend asks for on a browser that can't decode the
  // source: browser-safe codecs (H.264/VP9/AV1/HEVC≤8) → stream-copy "web";
  // HEVC Main10 and friends (empty MSE probe) → re-encode "compat".
  const variant: 'web' | 'compat' = mseProbeTypes(media.video).length === 0 ? 'compat' : 'web';
  const targetHeight = variant === 'compat' && (media.height ?? 0) >= 2160 ? 1080 : null;
  const key = packageKey(record.infoHash, file.relative, variant);

  const existing = manager.status(key);
  if (existing?.phase === 'ready') return 'already-ready';
  if (existing?.phase === 'packaging') return 'running';

  const state = await manager.ensurePackage({
    infoHash: record.infoHash,
    relative: file.relative,
    absolutePath: file.absolutePath,
    media,
    sidecars,
    variant,
    targetHeight,
  });
  return state.phase === 'packaging' ? 'started' : 'skipped';
}

interface PackageMeta {
  phase?: string;
  progress?: number;
  playable?: boolean;
  frontierSeconds?: number | null;
  encoder?: string;
  etaSeconds?: number | null;
  error?: string | null;
  updatedAt?: number;
}

function readPackageMeta(file: string): PackageMeta | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as PackageMeta;
  } catch {
    return null;
  }
}

export interface OptimizeJob {
  status: 'ready' | 'converting' | 'failed';
  progress: number;
  etaSeconds: number | null;
  error: string | null;
}

/**
 * Cheap per-download optimize state for list payloads — no probing. Reads the
 * DONE marker / progress.json written by the package manager, preferring live
 * in-memory state when a build is running right now.
 */
export function readOptimizeJob(deps: AppDeps, record: DownloadRecord): OptimizeJob | null {
  if (!record.contentPath || !record.streamFilePath) return null;
  const root = deps.config.packageDir;
  const merged = new Map<'web' | 'compat', PackageMeta>();

  for (const variant of ['web', 'compat'] as const) {
    const key = packageKey(record.infoHash, record.streamFilePath, variant);
    const layout = layoutFor(root, key);
    const meta = readPackageMeta(path.join(layout.root, 'progress.json')) ?? {};
    const live = deps.packageManager?.status(key);
    if (live) {
      meta.phase = live.phase;
      meta.progress = live.progress;
      meta.playable = live.playable;
      meta.frontierSeconds = live.frontierSeconds;
      meta.error = live.error;
      // A live build is by definition not stale.
      meta.updatedAt = Date.now();
    }
    if (fs.existsSync(path.join(layout.root, 'DONE'))) meta.phase = 'ready';
    merged.set(variant, meta);
  }

  const ready = [...merged.values()].find((m) => m.phase === 'ready');
  if (ready) return { status: 'ready', progress: 1, etaSeconds: 0, error: null };

  // A "packaging" state whose progress.json went quiet means the build was
  // interrupted (backend restart/OOM) and no ffmpeg is running — surface it as
  // failed so the UI offers "Retry optimize" instead of a frozen progress bar.
  const isStale = (m: PackageMeta): boolean =>
    m.phase === 'packaging' &&
    (typeof m.updatedAt !== 'number' || Date.now() - m.updatedAt > 90_000);
  const active = [...merged.entries()].find(([, m]) => m.phase === 'packaging' && !isStale(m));
  if (active) {
    const [, meta] = active;
    return {
      status: 'converting',
      progress: meta.progress ?? 0,
      etaSeconds: meta.etaSeconds ?? null,
      error: null,
    };
  }
  const stale = [...merged.values()].find(isStale);
  if (stale) return { status: 'failed', progress: 0, etaSeconds: null, error: 'Interrupted — retry to finish the copy' };
  const failed = [...merged.values()].find((m) => m.phase === 'failed');
  if (failed) return { status: 'failed', progress: 0, etaSeconds: null, error: failed.error ?? null };
  return null;
}
