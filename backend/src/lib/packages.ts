import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { MediaInfo, SidecarSubtitle } from './mediaInfo.js';
import type { SubtitleInfo } from './mediaInfo.js';
import { listStreamableFiles } from './streaming.js';
import {
  audioSegmentArgs,
  buildMasterPlaylist,
  canCopyAudioTrack,
  embeddedSubtitleArgs,
  layoutFor,
  packageKey,
  pickAudioRenditions,
  pickSubtitleRenditions,
  sidecarSubtitleArgs,
  subtitleMediaPlaylist,
  videoCompatSegmentArgs,
  videoSegmentArgs,
  type PackageLayout,
} from './hls.js';

export type PackagePhase = 'idle' | 'packaging' | 'ready' | 'failed';

export interface PackageState {
  key: string;
  infoHash: string;
  relative: string;
  absolutePath: string;
  phase: PackagePhase;
  progress: number;
  error: string | null;
}

export interface PackageRequest {
  infoHash: string;
  relative: string;
  absolutePath: string;
  media: MediaInfo;
  sidecars: SidecarSubtitle[];
  /** 'web' (default) stream-copies the video; 'compat' re-encodes it to H.264. */
  variant?: 'web' | 'compat';
  /** Scale target for compat builds (e.g. 1080 for 4K sources); null keeps source resolution. */
  targetHeight?: number | null;
}

export interface PackageManager {
  status(key: string): PackageState | null;
  ensurePackage(request: PackageRequest): Promise<PackageState>;
  masterPlaylistPath(key: string): string | null;
  filePathInPackage(key: string, subPath: string): string | null;
  deletePackage(key: string): void;
}

/**
 * Run one ffmpeg-style command. `onProgress` (when given) receives the parsed
 * `out_time_us` from ffmpeg's `-progress pipe:1` so the manager can surface
 * in-flight progress instead of coarse per-command jumps.
 */
export type CommandRunner = (args: string[], onProgress?: (outTimeUs: number | null) => void) => Promise<number>;

function realRunner(): CommandRunner {
  return (args, onProgress) =>
    new Promise((resolve) => {
      const progressArgs = onProgress ? ['-progress', 'pipe:1', '-nostats'] : [];
      const proc = spawn('ffmpeg', [...progressArgs, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-4000);
      });
      if (onProgress) {
        let buf = '';
        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (chunk: string) => {
          buf += chunk;
          let newline: number;
          while ((newline = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, newline).trim();
            buf = buf.slice(newline + 1);
            const eq = line.indexOf('=');
            if (eq !== -1 && line.slice(0, eq).trim() === 'out_time_us') {
              const value = Number(line.slice(eq + 1).trim());
              onProgress(Number.isFinite(value) ? value : null);
            }
          }
        });
      } else {
        proc.stdout.resume();
      }
      proc.on('error', () => resolve(1));
      proc.on('exit', (code) => {
        if (code !== 0) console.error(`[packages] ffmpeg exited ${code}: ${stderr.split('\n').slice(-6).join('\n')}`);
        resolve(code ?? 1);
      });
    });
}

export function createPackageManager(
  config: { packageRoot: string; maxBytes?: number | null },
  runCommand: CommandRunner = realRunner(),
): PackageManager {
  const store = new Map<string, PackageState>();
  const running = new Set<string>();

  // Compat builds re-encode video (H.264) and are expensive on CPU; run at most
  // one across the whole box at a time so a burst of HEVC titles can't starve a
  // live /watch stream or the qBittorrent poll. Stream-copy (web) packages stay
  // unthrottled — they're near-free.
  let compatLock: Promise<unknown> = Promise.resolve();
  function withCompatLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = compatLock.then(fn, fn);
    compatLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // Best-effort eviction for the `packages` volume: compat packages are ~1.0×
  // the source size, so when `maxBytes` is set the oldest completed (DONE)
  // packages are removed until the volume is back under budget. In-progress
  // builds are never evicted.
  function evictIfOverBudget(): void {
    const max = config.maxBytes;
    if (!max || max <= 0) return;
    let total = totalPackageBytes(config.packageRoot);
    if (total <= max) return;
    for (const entry of donePackageDirs(config.packageRoot)) {
      if (total <= max) break;
      if (running.has(entry.key)) continue;
      try {
        fs.rmSync(entry.root, { recursive: true, force: true });
        store.delete(entry.key);
      } catch {
        // best effort
      }
      total = totalPackageBytes(config.packageRoot);
    }
  }

  function stateFor(key: string): PackageState | null {
    const hit = store.get(key);
    if (hit) return hit;
    const layout = layoutFor(config.packageRoot, key);
    if (fs.existsSync(path.join(layout.root, 'DONE'))) {
      const s: PackageState = {
        key,
        infoHash: '',
        relative: '',
        absolutePath: '',
        phase: 'ready',
        progress: 1,
        error: null,
      };
      store.set(key, s);
      return s;
    }
    return null;
  }

  function snapshot(request: PackageRequest): PackageState {
    const s: PackageState = {
      key: packageKey(request.infoHash, request.relative, request.variant),
      infoHash: request.infoHash,
      relative: request.relative,
      absolutePath: request.absolutePath,
      phase: 'packaging',
      progress: 0,
      error: null,
    };
    store.set(s.key, s);
    return s;
  }

  function update(key: string, patch: Partial<PackageState>): void {
    const current = store.get(key);
    if (current) store.set(key, { ...current, ...patch });
  }

  async function runPackage(request: PackageRequest): Promise<void> {
    const key = packageKey(request.infoHash, request.relative, request.variant);
    const layout = layoutFor(config.packageRoot, key);
    const media = request.media;
    const audio = pickAudioRenditions(media);
    const subs = pickSubtitleRenditions(media.subtitleTracks, request.sidecars);
    const duration = media.durationSeconds;
    const compat = request.variant === 'compat';

    fs.mkdirSync(layout.root, { recursive: true });
    fs.mkdirSync(layout.videoDir, { recursive: true });
    audio.forEach((a) => fs.mkdirSync(layout.audioDir(a.streamIndex), { recursive: true }));
    if (subs.length > 0) fs.mkdirSync(layout.subsDir, { recursive: true });

    try {
      const steps: Array<{ weight: number; args: string[]; note: string }> = [];
      const videoArgs = compat
        ? videoCompatSegmentArgs(request.absolutePath, layout.videoDir, { targetHeight: request.targetHeight ?? null })
        : videoSegmentArgs(request.absolutePath, layout.videoDir);
      steps.push({ weight: 0.5, args: videoArgs, note: compat ? 'video (compat H.264)' : 'video' });
      media.audioTracks.forEach((track) => {
        const copy = canCopyAudioTrack(track);
        steps.push({
          weight: 0.45 / Math.max(media.audioTracks.length, 1),
          args: audioSegmentArgs(request.absolutePath, track.index, layout.audioDir(track.index), { copy }),
          note: `audio ${track.index}${copy ? ' (copy)' : ''}`,
        });
      });
      if (subs.length > 0) {
        const embedded: Array<{ sub: SubtitleInfo; index: number }> = media.subtitleTracks
          .filter((s) => s.kind === 'text')
          .map((s, i) => ({ sub: s, index: i }));
        const sidecarEntries = request.sidecars.map((sidecar, i) => ({ sidecar, id: `sidecar-${i}` }));
        const subtitleCount = Math.max(embedded.length + sidecarEntries.length, 1);
        embedded.forEach(({ sub, index }) => {
          const rendition = subs.find((r) => r.id === `track-${index}`);
          const out = path.join(layout.subsDir, `${rendition?.id ?? `track-${index}`}.vtt`);
          steps.push({
            weight: 0.05 / subtitleCount,
            args: embeddedSubtitleArgs(request.absolutePath, sub.index, out),
            note: `subtitle ${sub.index}`,
          });
        });
        const sourceDir = path.dirname(request.absolutePath);
        sidecarEntries.forEach(({ sidecar, id }) => {
          const out = path.join(layout.subsDir, `${id}.vtt`);
          steps.push({
            weight: 0.05 / subtitleCount,
            args: sidecarSubtitleArgs(path.join(sourceDir, sidecar.name), out),
            note: `sidecar ${sidecar.name}`,
          });
        });
      }

      // Media renditions are independent ffmpeg runs against the same input, so
      // run them concurrently (each on its own core) instead of as serialized
      // full-file passes. In-flight progress comes from ffmpeg's -progress.
      const durationUs = duration && duration > 0 ? duration * 1_000_000 : null;
      const fracs = new Map<(typeof steps)[number], number>();
      const publish = (): void => {
        let done = 0;
        for (const step of steps) {
          const frac = fracs.get(step) ?? 0;
          done += step.weight * Math.min(Math.max(frac, 0), 1);
        }
        update(key, { progress: Math.min(0.05 + 0.95 * done, 1) });
      };
      const results = await Promise.allSettled(
        steps.map((step) =>
          runCommand(step.args, (outTimeUs) => {
            const frac = durationUs && outTimeUs != null ? outTimeUs / durationUs : 0;
            fracs.set(step, frac);
            publish();
          }).then((code) => {
            if (code !== 0) throw new Error(`ffmpeg ${step.note} failed (exit ${code})`);
            fracs.set(step, 1);
            publish();
          }),
        ),
      );
      const failure = results.find((r) => r.status === 'rejected');
      if (failure) throw failure.reason;

      writeSubtitlePlaylists(subs, duration, layout);
      writeMaster(key, request, audio, subs, duration, media, layout);
      fs.writeFileSync(path.join(layout.root, 'DONE'), String(Date.now()));
      update(key, { phase: 'ready', progress: 1, error: null });
    } catch (error) {
      update(key, {
        phase: 'failed',
        error: error instanceof Error ? error.message : 'packaging failed',
      });
    } finally {
      running.delete(key);
    }
  }

  function writeSubtitlePlaylists(
    subs: Array<{ id: string; language: string | null; label: string }>,
    duration: number | null,
    layout: PackageLayout,
  ): void {
    for (const sub of subs) {
      const vtt = path.join(layout.subsDir, `${sub.id}.vtt`);
      const m3u8 = path.join(layout.subsDir, `${sub.id}.m3u8`);
      if (!fs.existsSync(vtt)) continue;
      fs.writeFileSync(m3u8, subtitleMediaPlaylist(duration, `${sub.id}.vtt`));
    }
  }

  function writeMaster(
    key: string,
    request: PackageRequest,
    audio: ReturnType<typeof pickAudioRenditions>,
    subs: ReturnType<typeof pickSubtitleRenditions>,
    duration: number | null,
    media: MediaInfo,
    layout: PackageLayout,
  ): void {
    const size = fileSize(request.absolutePath);
    const bandwidth = size > 0 && duration ? Math.round((size * 8) / duration) : 4_000_000;
    // A compat build re-encodes to H.264 (8-bit), so the CODECS hint must say
    // avc1 — not the source's hevc/vp9/… The RESOLUTION hint is dropped when the
    // compat build downscales (we don't know the scaled width up-front).
    const compat = request.variant === 'compat';
    const scaled = compat && request.targetHeight && request.targetHeight > 0;
    const master = buildMasterPlaylist({
      durationSeconds: duration,
      audio,
      subtitles: subs,
      bandwidth,
      videoCodec: compat ? 'h264' : media.video?.codec ?? null,
      resolution:
        compat || scaled
          ? null
          : { width: media.video?.width ?? null, height: media.video?.height ?? null },
    });
    fs.writeFileSync(path.join(layout.root, 'master.m3u8'), master);
  }

  return {
    status: (key) => stateFor(key) ?? null,
    async ensurePackage(request: PackageRequest): Promise<PackageState> {
      const key = packageKey(request.infoHash, request.relative, request.variant);
      const existing = stateFor(key);
      if (existing?.phase === 'ready') return existing;
      if (existing?.phase === 'packaging' || running.has(key)) {
        return existing ?? snapshot(request);
      }
      evictIfOverBudget();
      const s = snapshot(request);
      running.add(key);
      void (request.variant === 'compat' ? withCompatLock(() => runPackage(request)) : runPackage(request));
      return s;
    },
    masterPlaylistPath: (key) => {
      const layout = layoutFor(config.packageRoot, key);
      const master = path.join(layout.root, 'master.m3u8');
      return fs.existsSync(master) ? master : null;
    },
    filePathInPackage: (key, subPath) => {
      const layout = layoutFor(config.packageRoot, key);
      const resolved = path.resolve(layout.root, subPath);
      const root = path.resolve(layout.root) + path.sep;
      if (!resolved.startsWith(root)) return null;
      return fs.existsSync(resolved) ? resolved : null;
    },
    deletePackage: (key) => {
      running.delete(key);
      store.delete(key);
      const layout = layoutFor(config.packageRoot, key);
      try {
        fs.rmSync(layout.root, { recursive: true, force: true });
      } catch {
        // best effort
      }
    },
  };
}

function fileSize(absolutePath: string): number {
  try {
    return fs.statSync(absolutePath).size;
  } catch {
    return 0;
  }
}

function totalPackageBytes(packageRoot: string): number {
  let total = 0;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          // ignore
        }
      }
    }
  };
  walk(packageRoot);
  return total;
}

function donePackageDirs(packageRoot: string): Array<{ key: string; root: string; mtimeMs: number }> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(packageRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: Array<{ key: string; root: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = path.join(packageRoot, entry.name);
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(path.join(root, 'DONE')).mtimeMs;
    } catch {
      continue; // no DONE marker → not a completed package
    }
    result.push({ key: entry.name, root, mtimeMs });
  }
  return result.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

/** Removes the cached packages of every streamable file of a torrent (both variants). */
export function cleanupTorrentPackages(
  packageRoot: string,
  infoHash: string,
  downloadDir: string,
  contentPath: string | null,
): void {
  if (!contentPath) return;
  const files = listStreamableFiles(downloadDir, contentPath);
  for (const file of files) {
    for (const variant of ['web', 'compat'] as const) {
      const key = packageKey(infoHash, file.relative, variant);
      const layout = layoutFor(packageRoot, key);
      try {
        fs.rmSync(layout.root, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  }
}
