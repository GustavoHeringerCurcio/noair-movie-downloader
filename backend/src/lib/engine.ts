import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { CompatVideoEncoder } from './hls.js';

/**
 * Engine detection (Phase 2): at boot we discover what this host can actually
 * do — CPU cores, free RAM, a usable /dev/dri (VAAPI) render node, NVIDIA, and
 * which H.264 encoders the installed ffmpeg exposes — and pick the best
 * software-or-hardware path. Everything degrades to `libx264` (universal), so
 * low-end and GPU-less boxes just work, and a host that later gains a GPU picks
 * it up automatically on the next boot.
 */
export interface EngineProfile {
  /** Effective encoder for the compat (re-encode) video pass. */
  encoder: CompatVideoEncoder;
  hardware: boolean;
  cores: number;
  threads: number;
  memoryTotalBytes: number;
  memoryFreeBytes: number;
  /** Detected VAAPI render node (e.g. /dev/dri/renderD128) or null. */
  driDevice: string | null;
  availableEncoders: string[];
  /** Software 1080p encode speed as × real-time (null when it couldn't be measured). */
  speedX: number | null;
  note: string;
}

const ENCODER_NAMES: CompatVideoEncoder[] = ['libx264', 'h264_vaapi', 'h264_qsv', 'h264_nvenc'];

/**
 * How many threads a software re-encode may use. Falls back to fewer threads on
 * low-memory hosts (keeps the box usable while converting) and honors an
 * explicit `CONVERSION_THREADS` override. Pure + unit-testable.
 */
export function pickEncodeThreads(
  cores: number,
  memAvailableBytes: number | null,
  envOverride: string | undefined,
): number {
  const parsed = envOverride ? Number.parseInt(envOverride, 10) : NaN;
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 64) return parsed;
  const gib = memAvailableBytes == null ? Infinity : memAvailableBytes / 1024 ** 3;
  if (gib < 4) return Math.max(1, Math.min(cores, 4));
  if (gib < 8) return Math.max(1, Math.min(cores, 8));
  return Math.max(1, Math.min(cores, 16));
}

/** Encoders this ffmpeg build exposes (parsed from `ffmpeg -encoders`). */
export function listFfmpegEncoders(): string[] {
  try {
    const out = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    return ENCODER_NAMES.filter((name) => name === 'libx264' || out.includes(`${name} `) || out.includes(`${name}\n`));
  } catch {
    return [];
  }
}

function detectDriDevice(): string | null {
  try {
    const entries = fs.readdirSync('/dev/dri');
    const render = entries.find((e) => e.startsWith('renderD'));
    return render ? `/dev/dri/${render}` : null;
  } catch {
    return null;
  }
}

/**
 * Pure selection (unit-testable): prefer a validated hardware encoder, else
 * universal software libx264. `available` comes from `listFfmpegEncoders`.
 */
export function selectEncoder(available: string[], driDevice: string | null): { encoder: CompatVideoEncoder; hardware: boolean; note: string } {
  if (driDevice && available.includes('h264_vaapi')) {
    return { encoder: 'h264_vaapi', hardware: true, note: 'VAAPI /dev/dri detected' };
  }
  if (driDevice && available.includes('h264_qsv')) {
    return { encoder: 'h264_qsv', hardware: true, note: 'Intel QuickSync detected' };
  }
  if (available.includes('h264_nvenc')) {
    return { encoder: 'h264_nvenc', hardware: true, note: 'NVIDIA NVENC detected' };
  }
  return { encoder: 'libx264', hardware: false, note: 'software libx264 (no usable hardware encoder)' };
}

/** Confirms the VAAPI driver actually encodes (guards against broken device mounts). */
function vaapiSelfTest(device: string): boolean {
  try {
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error',
        '-init_hw_device', `vaapi=va:${device}`,
        '-f', 'lavfi', '-i', 'testsrc2=duration=1:size=320x240:rate=24',
        '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-global_quality', '30',
        '-f', 'null', '-',
      ],
      { stdio: 'ignore', timeout: 20_000 },
    );
    return true;
  } catch {
    return false;
  }
}

/** Software 1080p encode speed as × real-time (CPU benchmark). Null when it can't run. */
let cachedSpeedX: number | null | undefined;
export function benchmarkCpuSpeed(): number | null {
  if (cachedSpeedX !== undefined) return cachedSpeedX;
  const DURATION_SECONDS = 8;
  try {
    const started = Date.now();
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `testsrc2=duration=${DURATION_SECONDS}:size=1280x720:rate=30`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-f', 'null', '-',
      ],
      { stdio: 'ignore', timeout: 60_000 },
    );
    const elapsed = (Date.now() - started) / 1000;
    cachedSpeedX = elapsed > 0 ? DURATION_SECONDS / elapsed : null;
  } catch {
    cachedSpeedX = null;
  }
  return cachedSpeedX;
}

/** Full runtime profile. Cheap enough to run at boot and cache. */
let cached: EngineProfile | null = null;
export function probeEngineProfile(): EngineProfile {
  if (cached) return cached;
  const cores = Math.max(1, os.cpus().length);
  const available = listFfmpegEncoders();
  const driDevice = detectDriDevice();

  const candidates = selectEncoder(available, driDevice);
  // Only trust hardware when the driver self-test actually encodes.
  let encoder = candidates.encoder;
  let hardware = candidates.hardware;
  let note = candidates.note;
  if (hardware) {
    if (encoder === 'h264_vaapi' && driDevice && !vaapiSelfTest(driDevice)) {
      encoder = 'libx264';
      hardware = false;
      note = 'VAAPI present but self-test failed — falling back to libx264';
    }
  }

  cached = {
    encoder,
    hardware,
    cores,
    threads: pickEncodeThreads(cores, os.freemem(), process.env.CONVERSION_THREADS),
    memoryTotalBytes: os.totalmem(),
    memoryFreeBytes: os.freemem(),
    driDevice,
    availableEncoders: available,
    speedX: benchmarkCpuSpeed(),
    note,
  };
  return cached;
}

/** Detect stale ffmpeg writers for a package dir and kill them (orphaned children survive node restarts). */
export function killPackageWriters(root: string): void {
  const target = path.resolve(root);
  try {
    const procs = fs.readdirSync('/proc');
    for (const pid of procs) {
      if (!/^\d+$/.test(pid)) continue;
      let cmdline = '';
      try {
        cmdline = fs.readFileSync(path.join('/proc', pid, 'cmdline'), 'utf8');
      } catch {
        continue; // already gone or not ours
      }
      if (cmdline.includes('ffmpeg') && cmdline.includes(target)) {
        try {
          process.kill(Number(pid), 'SIGKILL');
        } catch {
          // already exited
        }
      }
    }
  } catch {
    // /proc unavailable (non-Linux) — nothing to reap
  }
}
