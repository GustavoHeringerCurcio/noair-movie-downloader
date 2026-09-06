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

export function createPackageManager(config: { packageRoot: string }, runCommand: CommandRunner = realRunner()): PackageManager {
  const store = new Map<string, PackageState>();
  const running = new Set<string>();

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
      key: packageKey(request.infoHash, request.relative),
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
    const key = packageKey(request.infoHash, request.relative);
    const layout = layoutFor(config.packageRoot, key);
    const media = request.media;
    const audio = pickAudioRenditions(media);
    const subs = pickSubtitleRenditions(media.subtitleTracks, request.sidecars);
    const duration = media.durationSeconds;

    fs.mkdirSync(layout.root, { recursive: true });
    fs.mkdirSync(layout.videoDir, { recursive: true });
    audio.forEach((a) => fs.mkdirSync(layout.audioDir(a.streamIndex), { recursive: true }));
    if (subs.length > 0) fs.mkdirSync(layout.subsDir, { recursive: true });

    try {
      const steps: Array<{ weight: number; args: string[]; note: string }> = [];
      steps.push({ weight: 0.5, args: videoSegmentArgs(request.absolutePath, layout.videoDir), note: 'video' });
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
    const master = buildMasterPlaylist({
      durationSeconds: duration,
      audio,
      subtitles: subs,
      bandwidth,
      videoCodec: media.video?.codec ?? null,
      resolution: { width: media.video?.width ?? null, height: media.video?.height ?? null },
    });
    fs.writeFileSync(path.join(layout.root, 'master.m3u8'), master);
  }

  return {
    status: (key) => stateFor(key) ?? null,
    async ensurePackage(request: PackageRequest): Promise<PackageState> {
      const key = packageKey(request.infoHash, request.relative);
      const existing = stateFor(key);
      if (existing?.phase === 'ready') return existing;
      if (existing?.phase === 'packaging' || running.has(key)) {
        return existing ?? snapshot(request);
      }
      const s = snapshot(request);
      running.add(key);
      void runPackage(request);
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

/** Removes the cached packages of every streamable file of a torrent. */
export function cleanupTorrentPackages(
  packageRoot: string,
  infoHash: string,
  downloadDir: string,
  contentPath: string | null,
): void {
  if (!contentPath) return;
  const files = listStreamableFiles(downloadDir, contentPath);
  for (const file of files) {
    const key = packageKey(infoHash, file.relative);
    const layout = layoutFor(packageRoot, key);
    try {
      fs.rmSync(layout.root, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}
