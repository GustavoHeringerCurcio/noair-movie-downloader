import { spawn, type ChildProcessByStdio } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { MediaInfo, SidecarSubtitle } from './mediaInfo.js';
import type { SubtitleInfo } from './mediaInfo.js';
import { listStreamableFiles } from './streaming.js';
import { killPackageWriters, pickEncodeThreads } from './engine.js';
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
  type AudioRendition,
  type CompatVideoEncoder,
  type PackageLayout,
  type SubtitleRendition,
} from './hls.js';

export type PackagePhase = 'idle' | 'packaging' | 'ready' | 'failed';

export interface PackageState {
  key: string;
  infoHash: string;
  relative: string;
  absolutePath: string;
  phase: PackagePhase;
  progress: number;
  /**
   * True as soon as the earliest video (and default-audio) segments exist, so a
   * browser can start streaming the package while the rest of the copy is still
   * being built (W-001). The Watch page mounts the player on `playable`, not
   * only on `ready`.
   */
  playable: boolean;
  /** Seconds of contiguous video available from the start (the conversion frontier). */
  frontierSeconds: number | null;
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

export interface CommandPromise extends Promise<number> {
  /** Kill the underlying ffmpeg process. Optional — fake runners used in tests may omit it. */
  cancel?: () => void;
}

/**
 * Run one ffmpeg-style command. `onProgress` (when given) receives the parsed
 * `out_time_us` from ffmpeg's `-progress pipe:1` so the manager can surface
 * in-flight progress instead of coarse per-command jumps.
 */
export type CommandRunner = (args: string[], onProgress?: (outTimeUs: number | null) => void) => CommandPromise;

function realRunner(): CommandRunner {
  return (args, onProgress) => {
    let proc: ChildProcessByStdio<null, Readable, Readable> | null = null;
    let settled = false;
    const promise = new Promise<number>((resolve) => {
      const progressArgs = onProgress ? ['-progress', 'pipe:1', '-nostats'] : [];
      proc = spawn('ffmpeg', [...progressArgs, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
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
      proc.on('error', () => {
        settled = true;
        resolve(1);
      });
      proc.on('exit', (code) => {
        settled = true;
        if (code !== 0) console.error(`[packages] ffmpeg exited ${code}: ${stderr.split('\n').slice(-6).join('\n')}`);
        resolve(code ?? 1);
      });
    }) as CommandPromise;
    promise.cancel = () => {
      if (!settled && proc) proc.kill('SIGKILL');
    };
    return promise;
  };
}

export interface PackageManagerOptions {
  packageRoot: string;
  maxBytes?: number | null;
  /** Abort the video pass (compat re-encode) if it makes no progress for this long. */
  stallTimeoutMs?: number;
  /** Encoder for compat re-encodes (engine-detected at boot; defaults to libx264). */
  encoder?: CompatVideoEncoder;
  /** Hardware device for hardware encoders (e.g. /dev/dri/renderD128). */
  hwDevice?: string | null;
  /** Thread cap for software (libx264) compat encodes; 0/undefined = auto. */
  threads?: number;
}

export function createPackageManager(
  config: PackageManagerOptions,
  runCommand: CommandRunner = realRunner(),
): PackageManager {
  const stallTimeoutMs = config.stallTimeoutMs ?? 90_000;
  const compatEncoder = config.encoder ?? 'libx264';
  const hwDevice = config.hwDevice ?? null;
  // Explicit thread cap (resolved from CONVERSION_THREADS at boot); 0 = pick
  // per job from the live free memory so a low-RAM host stays usable.
  const threadOverride = config.threads ?? 0;
  const store = new Map<string, PackageState>();
  const running = new Set<string>();

  // RAM-friendly conversion budget (default 2 = one background job + the movie
  // you're currently watching; the rest queue). Combined with per-job threads
  // derived from live free RAM, this keeps peak memory predictable on a shared
  // machine instead of stacking every conversion at full core count.
  const maxActive = (() => {
    const parsed = Number.parseInt(process.env.CONVERSION_MAX_ACTIVE ?? '', 10);
    return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 4) : 2;
  })();
  let activeJobs = 0;
  const waiters: Array<() => void> = [];
  function acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (activeJobs < maxActive) {
        activeJobs += 1;
        resolve();
      } else {
        waiters.push(resolve);
      }
    });
  }
  function release(): void {
    const next = waiters.shift();
    if (next) next();
    else activeJobs -= 1;
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
        playable: true,
        frontierSeconds: null,
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
      playable: false,
      frontierSeconds: null,
      error: null,
    };
    store.set(s.key, s);
    return s;
  }

  function update(key: string, patch: Partial<PackageState>): void {
    const current = store.get(key);
    if (current) store.set(key, { ...current, ...patch });
  }

  interface Step {
    kind: 'video' | 'audio' | 'sub';
    ref: string;
    weight: number;
    args: string[];
    note: string;
  }

  async function runPackage(request: PackageRequest): Promise<void> {
    const key = packageKey(request.infoHash, request.relative, request.variant);
    const layout = layoutFor(config.packageRoot, key);
    const media = request.media;
    const compat = request.variant === 'compat';
    const duration = media.durationSeconds;
    const durationUs = duration && duration > 0 ? duration * 1_000_000 : null;

    // Threads for this job: an explicit override (CONVERSION_THREADS) wins,
    // otherwise derived from cores + *live* free RAM so peak memory stays
    // bounded even when the machine is already under load.
    const threads =
      threadOverride > 0
        ? threadOverride
        : pickEncodeThreads(os.cpus().length, os.freemem(), process.env.CONVERSION_THREADS);

    const audioRenditions = pickAudioRenditions(media);
    const subs = pickSubtitleRenditions(media.subtitleTracks, request.sidecars);

    const defaultAudio = audioRenditions.find((a) => a.default) ?? audioRenditions[0];
    const defaultAudioStreamIndex = defaultAudio?.streamIndex ?? null;

    const videoStep: Step = {
      kind: 'video',
      ref: 'video',
      weight: 0.5,
      args: compat
        ? videoCompatSegmentArgs(request.absolutePath, layout.videoDir, {
            targetHeight: request.targetHeight ?? null,
            encoder: compatEncoder,
            hwDevice,
            threads: compatEncoder === 'libx264' ? threads : undefined,
          })
        : videoSegmentArgs(request.absolutePath, layout.videoDir),
      note: compat ? `video (compat ${compatEncoder})` : 'video',
    };
    const audioSteps: Step[] = media.audioTracks.map((track) => ({
      kind: 'audio',
      ref: `audio:${track.index}`,
      weight: 0.45 / Math.max(media.audioTracks.length, 1),
      args: audioSegmentArgs(request.absolutePath, track.index, layout.audioDir(track.index), {
        copy: canCopyAudioTrack(track),
      }),
      note: `audio ${track.index}`,
    }));
    const subSteps: Step[] = [];
    if (subs.length > 0) {
      const embedded: Array<{ sub: SubtitleInfo; index: number }> = media.subtitleTracks
        .filter((s) => s.kind === 'text')
        .map((s, i) => ({ sub: s, index: i }));
      const sidecarEntries = request.sidecars.map((sidecar, i) => ({ sidecar, id: `sidecar-${i}` }));
      embedded.forEach(({ sub, index }) => {
        const rendition = subs.find((r) => r.id === `track-${index}`);
        const id = rendition?.id ?? `track-${index}`;
        const out = path.join(layout.subsDir, `${id}.vtt`);
        subSteps.push({
          kind: 'sub',
          ref: `sub:${id}`,
          weight: 0.05 / Math.max(embedded.length + sidecarEntries.length, 1),
          args: embeddedSubtitleArgs(request.absolutePath, sub.index, out),
          note: `subtitle ${sub.index}`,
        });
      });
      const sourceDir = path.dirname(request.absolutePath);
      sidecarEntries.forEach(({ sidecar, id }) => {
        const out = path.join(layout.subsDir, `${id}.vtt`);
        subSteps.push({
          kind: 'sub',
          ref: `sub:${id}`,
          weight: 0.05 / Math.max(embedded.length + sidecarEntries.length, 1),
          args: sidecarSubtitleArgs(path.join(sourceDir, sidecar.name), out),
          note: `sidecar ${sidecar.name}`,
        });
      });
    }

    // A fresh run always starts from a clean directory: kill any orphaned ffmpeg
    // still writing into this package (a dev/hot-reload restart leaves children
    // behind) and wipe stale segments so playlist and segments can never diverge.
    killPackageWriters(layout.root);
    try {
      fs.rmSync(layout.root, { recursive: true, force: true });
    } catch {
      // best effort — the mkdir below recreates it
    }
    const startedAt = Date.now();
    fs.mkdirSync(layout.root, { recursive: true });
    fs.mkdirSync(layout.videoDir, { recursive: true });
    for (const r of audioRenditions) fs.mkdirSync(layout.audioDir(r.streamIndex), { recursive: true });
    if (subSteps.length > 0) fs.mkdirSync(layout.subsDir, { recursive: true });

    const succeeded = new Set<string>();
    const fracs = new Map<Step, number>();

    // On-disk progress (progress.json) so the Downloads UI and dashboard can show
    // "Optimizing 34% · ~18 min left" without probing the file, and so a package
    // mid-build after a restart still reports where it got to.
    let lastMetaWrite = 0;
    const metaFile = path.join(layout.root, 'progress.json');
    const persistProgress = (force = false): void => {
      const now = Date.now();
      if (!force && now - lastMetaWrite < 1500) return;
      lastMetaWrite = now;
      const st = store.get(key);
      if (!st) return;
      let etaSeconds: number | null = null;
      if (duration && duration > 0 && st.frontierSeconds && st.frontierSeconds > 0) {
        const elapsedSec = Math.max(1, (now - startedAt) / 1000);
        const movieSecondsPerWallSecond = st.frontierSeconds / elapsedSec;
        if (movieSecondsPerWallSecond > 0) {
          etaSeconds = Math.max(0, Math.round((duration - st.frontierSeconds) / movieSecondsPerWallSecond));
        }
      }
      try {
        fs.writeFileSync(
          metaFile,
          JSON.stringify({
            infoHash: request.infoHash,
            relative: request.relative,
            variant: request.variant ?? 'web',
            phase: st.phase,
            progress: st.progress,
            playable: st.playable,
            frontierSeconds: st.frontierSeconds,
            encoder: compatEncoder,
            threads,
            startedAt,
            etaSeconds,
            updatedAt: now,
          }),
        );
      } catch {
        // best effort
      }
    };

    const publish = (): void => {
      let done = 0;
      for (const step of [...audioSteps, videoStep, ...subSteps]) {
        const frac = fracs.get(step) ?? 0;
        done += step.weight * Math.min(Math.max(frac, 0), 1);
      }
      const videoFrac = fracs.get(videoStep) ?? 0;
      const frontier = durationUs && videoFrac > 0 ? Math.min((durationUs * Math.min(Math.max(videoFrac, 0), 1)) / 1_000_000, duration ?? 0) : null;
      update(key, {
        progress: Math.min(0.05 + 0.95 * done, 1),
        frontierSeconds: frontier,
      });
      persistProgress();
    };

    const recordProgress = (step: Step, outTimeUs: number | null): void => {
      const frac = durationUs && outTimeUs != null ? outTimeUs / durationUs : 0;
      fracs.set(step, Math.max(fracs.get(step) ?? 0, frac));
      publish();
    };

    const runStep = async (step: Step): Promise<void> => {
      const code = await runCommand(step.args, (outTimeUs) => recordProgress(step, outTimeUs));
      if (code !== 0) throw new Error(`ffmpeg ${step.note} failed (exit ${code})`);
      succeeded.add(step.ref);
      fracs.set(step, 1);
      publish();
    };

    /**
     * The video pass is the critical path for "watchable early" (W-001): it must
     * keep producing segments to stay ahead of the player. Watch it for liveness
     * and abort with a clear error when it makes no progress for `stallTimeoutMs`
     * (a real symptom on broken/corrupt inputs that would otherwise sit forever
     * near the progress floor).
     */
    const runVideoStep = async (step: Step): Promise<void> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let progressCb: ((outTimeUs: number | null) => void) | undefined = undefined;
      let stalled = false;
      const clearTimer = (): void => {
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
      };
      const arm = (): void => {
        clearTimer();
        if (stallTimeoutMs > 0) {
          timer = setTimeout(() => {
            stalled = true;
            p.cancel?.();
          }, stallTimeoutMs);
        }
      };
      const p = runCommand(step.args, (outTimeUs) => progressCb?.(outTimeUs));
      progressCb = (outTimeUs) => {
        arm(); // any progress resets the stall window
        recordProgress(step, outTimeUs);
      };
      arm();
      let code: number;
      try {
        code = await p;
      } finally {
        clearTimer();
      }
      if (code !== 0) {
        throw new Error(
          stalled
            ? `video encode stalled — no progress for ${Math.max(1, Math.round(stallTimeoutMs / 1000))}s; aborting`
            : `ffmpeg ${step.note} failed (exit ${code})`,
        );
      }
      succeeded.add(step.ref);
      fracs.set(step, 1);
      publish();
    };

    const launch = (step: Step): Promise<void> => (step.kind === 'video' ? runVideoStep(step) : runStep(step));

    function writeMasterFile(audio: AudioRendition[], subtitleRenditions: SubtitleRendition[]): void {
      const size = fileSize(request.absolutePath);
      const bandwidth = size > 0 && duration ? Math.round((size * 8) / duration) : 4_000_000;
      // A compat build re-encodes to H.264 (8-bit), so the CODECS hint must say
      // avc1 — not the source's hevc/vp9/… The RESOLUTION hint is dropped when the
      // compat build downscales (we don't know the scaled width up-front).
      const scaled = compat && request.targetHeight && request.targetHeight > 0;
      const master = buildMasterPlaylist({
        durationSeconds: duration,
        audio,
        subtitles: subtitleRenditions,
        bandwidth,
        videoCodec: compat ? 'h264' : media.video?.codec ?? null,
        resolution:
          compat || scaled
            ? null
            : { width: media.video?.width ?? null, height: media.video?.height ?? null },
      });
      fs.writeFileSync(path.join(layout.root, 'master.m3u8'), master);
    }

    try {
      // Staged waves: the video + default audio renditions run first at full
      // CPU so the conversion frontier (and therefore "you can watch now")
      // advances as fast as possible. Optional audio tracks and subtitles run
      // afterwards — they'd only steal cores from the critical video pass.
      const criticalPromises: Promise<void>[] = [launch(videoStep)];
      if (defaultAudioStreamIndex != null) {
        const def = audioSteps.find((s) => s.ref === `audio:${defaultAudioStreamIndex}`);
        if (def) criticalPromises.push(launch(def));
      }
      const criticalSettled = Promise.allSettled(criticalPromises);

      // Provision the package as playable the moment the earliest segments land,
      // without waiting for the video pass to finish. The provisional master
      // advertises only the default audio rendition; the final master (all
      // tracks + subtitles) is written when the whole copy is done.
      const canProvision = (): boolean =>
        countSegments(layout.videoDir) >= 1 &&
        (defaultAudioStreamIndex == null || countSegments(layout.audioDir(defaultAudioStreamIndex)) >= 1);
      let provisioned = false;
      const provision = (): void => {
        if (provisioned || !canProvision()) return;
        provisioned = true;
        writeMasterFile(defaultAudio ? [defaultAudio] : [], []);
        update(key, { playable: true });
        publish();
      };

      while (!provisioned) {
        const winner = await Promise.race([criticalSettled.then(() => true), delay(400).then(() => false)]);
        if (winner) break;
        if (canProvision()) {
          provision();
          break;
        }
      }
      provision(); // last chance if the passes finished just after a poll

      const criticalResults = await criticalSettled;
      const criticalFailure = criticalResults.find((r) => r.status === 'rejected');
      if (criticalFailure) throw criticalFailure.reason;

      // Optional renditions: never fail the whole package — the user is already
      // watching the default rendition; just log and keep the successful ones.
      const optionalPromises = audioSteps
        .filter((s) => s.ref !== `audio:${defaultAudioStreamIndex}`)
        .map((s) => launch(s));
      const optionalResults = await Promise.allSettled(optionalPromises);
      for (const r of optionalResults) {
        if (r.status === 'rejected') console.error(`[packages] non-critical step failed: ${String(r.reason)}`);
      }
      const subResults = await Promise.allSettled(subSteps.map((s) => launch(s)));
      for (const r of subResults) {
        if (r.status === 'rejected') console.error(`[packages] subtitle step failed: ${String(r.reason)}`);
      }

      const finishedAudio = audioRenditions.filter((r) => succeeded.has(`audio:${r.streamIndex}`));
      const finishedSubs = subs.filter((s) => succeeded.has(`sub:${s.id}`));
      writeSubtitlePlaylists(subs, duration, layout);
      writeMasterFile(finishedAudio, finishedSubs);
      fs.writeFileSync(path.join(layout.root, 'DONE'), String(Date.now()));
      update(key, { phase: 'ready', progress: 1, playable: true, frontierSeconds: duration ?? null, error: null });
      persistProgress(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'packaging failed';
      console.error(`[packages] package failed (${key}): ${message}`);
      update(key, { phase: 'failed', error: message });
      persistProgress(true);
    } finally {
      running.delete(key);
    }
  }

  function writeSubtitlePlaylists(
    subtitleRenditions: SubtitleRendition[],
    duration: number | null,
    layout: PackageLayout,
  ): void {
    for (const sub of subtitleRenditions) {
      const vtt = path.join(layout.subsDir, `${sub.id}.vtt`);
      const m3u8 = path.join(layout.subsDir, `${sub.id}.m3u8`);
      if (!fs.existsSync(vtt)) continue;
      fs.writeFileSync(m3u8, subtitleMediaPlaylist(duration, `${sub.id}.vtt`));
    }
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
      void (async () => {
        await acquire();
        try {
          if (!running.has(key)) return; // package was deleted while queued
          await runPackage(request);
        } finally {
          release();
        }
      })();
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

function countSegments(dir: string): number {
  let count = 0;
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith('seg_') && entry.endsWith('.m4s')) count += 1;
    }
  } catch {
    // dir not created yet
  }
  return count;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
