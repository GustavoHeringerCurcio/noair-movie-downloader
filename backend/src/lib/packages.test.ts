import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPackageManager, cleanupTorrentPackages, type CommandPromise, type CommandRunner } from './packages.js';
import { packageKey, layoutFor } from './hls.js';
import type { MediaInfo } from './mediaInfo.js';

const media: MediaInfo = {
  container: 'mkv',
  durationSeconds: 600,
  video: { index: 0, codec: 'h264', width: 1920, height: 1080, hdr: false },
  audioTracks: [{ index: 1, codec: 'dts', language: 'en', title: null, channels: 6, default: true }],
  subtitleTracks: [],
  videoCodec: 'h264',
  audioCodec: 'dts',
  height: 1080,
};

function makeDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition not reached');
}

describe('createPackageManager', () => {
  it('maps every packaging step to a real stream of the media file', async () => {
    const root = makeDir('pkg-map-');
    const sourceDir = makeDir('src-map-');
    const source = path.join(sourceDir, 'movie.mkv');
    fs.writeFileSync(source, Buffer.alloc(1_000_000));
    const multiMedia: MediaInfo = {
      container: 'mkv',
      durationSeconds: 600,
      video: { index: 0, codec: 'h264', width: 1920, height: 1080, hdr: false },
      audioTracks: [
        { index: 1, codec: 'dts', language: 'en', title: null, channels: 6, default: true },
        { index: 2, codec: 'ac3', language: 'es', title: null, channels: 6, default: false },
      ],
      subtitleTracks: [{ index: 3, codec: 'subrip', kind: 'text', language: 'en', title: null, default: true }],
      videoCodec: 'h264',
      audioCodec: 'dts',
      height: 1080,
    };

    const maps: string[] = [];
    const manager = createPackageManager({ packageRoot: root }, async (args) => {
      const map = args[args.indexOf('-map') + 1];
      if (map) maps.push(map);
      return 0;
    });

    const key = packageKey('aa'.repeat(20), 'movie.mkv');
    await manager.ensurePackage({
      infoHash: 'aa'.repeat(20),
      relative: 'movie.mkv',
      absolutePath: source,
      media: multiMedia,
      sidecars: [],
    });
    await waitUntil(() => manager.status(key)?.phase === 'ready');

    // Renditions run concurrently, so completion order is not guaranteed — the
    // set of ffmpeg maps (video + each audio track + embedded subtitle) is.
    expect(maps.sort()).toEqual(['0:1', '0:2', '0:3', '0:v:0']);
    expect(maps.some((m) => m.includes('a:') || m.includes('s:'))).toBe(false);
  });

  it('packages a file to ready with the master playlist and DONE marker', async () => {
    const root = makeDir('pkg-');
    const sourceDir = makeDir('src-');
    const source = path.join(sourceDir, 'movie.mkv');
    fs.writeFileSync(source, Buffer.alloc(1_000_000));
    const manager = createPackageManager({ packageRoot: root }, async (args) => {
      fs.writeFileSync(args[args.length - 1]!, '#EXTM3U\n');
      return 0;
    });

    const key = packageKey('a'.repeat(40), 'movie.mkv');
    const state = await manager.ensurePackage({
      infoHash: 'a'.repeat(40),
      relative: 'movie.mkv',
      absolutePath: source,
      media,
      sidecars: [],
    });
    expect(state.phase).toBe('packaging');
    await waitUntil(() => manager.status(key)?.phase === 'ready');

    const layout = layoutFor(root, key);
    expect(fs.existsSync(path.join(layout.videoDir, 'main.m3u8'))).toBe(true);
    expect(fs.existsSync(path.join(layout.root, 'master.m3u8'))).toBe(true);
    expect(fs.existsSync(path.join(layout.root, 'DONE'))).toBe(true);
    expect(manager.masterPlaylistPath(key)).toBe(path.join(layout.root, 'master.m3u8'));
  });

  it('marks the package failed when a step fails', async () => {
    const root = makeDir('pkg-fail-');
    const source = path.join(makeDir('src-fail-'), 'movie.mkv');
    fs.writeFileSync(source, Buffer.alloc(10));
    const manager = createPackageManager({ packageRoot: root }, async () => 1);

    const key = packageKey('b'.repeat(40), 'movie.mkv');
    await manager.ensurePackage({
      infoHash: 'b'.repeat(40),
      relative: 'movie.mkv',
      absolutePath: source,
      media,
      sidecars: [],
    });
    await waitUntil(() => manager.status(key)?.phase === 'failed');
    expect(manager.status(key)?.error).toContain('ffmpeg');
  });

  it('reports ready from a DONE marker left on disk (cache survives restart)', () => {
    const root = makeDir('pkg-cache-');
    const key = packageKey('c'.repeat(40), 'movie.mkv');
    const layout = layoutFor(root, key);
    fs.mkdirSync(layout.root, { recursive: true });
    fs.writeFileSync(path.join(layout.root, 'DONE'), '1');
    const manager = createPackageManager({ packageRoot: root });
    expect(manager.status(key)?.phase).toBe('ready');
  });

  it('serves only files inside the package and rejects escapes', () => {
    const root = makeDir('pkg-safe-');
    const key = packageKey('d'.repeat(40), 'movie.mkv');
    const layout = layoutFor(root, key);
    fs.mkdirSync(layout.root, { recursive: true });
    fs.writeFileSync(path.join(layout.root, 'ok.m4s'), 'x');
    fs.writeFileSync(path.join(root, 'outside.txt'), 'secret');
    const manager = createPackageManager({ packageRoot: root });
    expect(manager.filePathInPackage(key, 'ok.m4s')).toBe(path.join(layout.root, 'ok.m4s'));
    expect(manager.filePathInPackage(key, '../outside.txt')).toBeNull();
    expect(manager.filePathInPackage(key, 'missing.m4s')).toBeNull();
  });

  it('deletePackage removes the directory', () => {
    const root = makeDir('pkg-del-');
    const key = packageKey('e'.repeat(40), 'movie.mkv');
    const layout = layoutFor(root, key);
    fs.mkdirSync(layout.root, { recursive: true });
    const manager = createPackageManager({ packageRoot: root });
    manager.deletePackage(key);
    expect(fs.existsSync(layout.root)).toBe(false);
  });

  it('builds a compat variant under a suffixed key using H.264 args', async () => {
    const root = makeDir('pkg-compat-');
    const source = path.join(makeDir('src-compat-'), 'movie.mkv');
    fs.writeFileSync(source, Buffer.alloc(1_000_000));
    const seen: string[][] = [];
    const manager = createPackageManager({ packageRoot: root }, async (args) => {
      seen.push(args);
      fs.writeFileSync(args[args.length - 1]!, '#EXTM3U\n');
      return 0;
    });

    const compatKey = packageKey('aa'.repeat(20), 'movie.mkv', 'compat');
    await manager.ensurePackage({
      infoHash: 'aa'.repeat(20),
      relative: 'movie.mkv',
      absolutePath: source,
      media,
      sidecars: [],
      variant: 'compat',
      targetHeight: null,
    });
    await waitUntil(() => manager.status(compatKey)?.phase === 'ready');

    expect(manager.status(compatKey)?.phase).toBe('ready');
    // The web (stream-copy) package for the same file stays untouched.
    expect(manager.status(packageKey('aa'.repeat(20), 'movie.mkv'))).toBeNull();
    expect(seen.some((a) => a.includes('-c:v') && a.includes('libx264'))).toBe(true);
    expect(seen.some((a) => a.includes('-c:v') && a[a.indexOf('-c:v') + 1] === 'copy')).toBe(false);
  });

  it('evicts the oldest completed package when over the size budget', async () => {
    const root = makeDir('pkg-evict-');
    const source = path.join(makeDir('src-evict-'), 'movie.mkv');
    fs.writeFileSync(source, Buffer.alloc(1000));
    const manager = createPackageManager({ packageRoot: root, maxBytes: 1_500_000 }, async () => 0);

    const oldLayout = layoutFor(root, packageKey('aa'.repeat(20), 'old.mkv'));
    const newLayout = layoutFor(root, packageKey('bb'.repeat(20), 'new.mkv'));
    for (const [layout, secs] of [[oldLayout, 1], [newLayout, 2]] as const) {
      fs.mkdirSync(layout.root, { recursive: true });
      fs.writeFileSync(path.join(layout.root, 'big.m4s'), Buffer.alloc(1_000_000));
      fs.writeFileSync(path.join(layout.root, 'DONE'), 'x');
      fs.utimesSync(path.join(layout.root, 'DONE'), secs, secs);
    }

    await manager.ensurePackage({
      infoHash: 'cc'.repeat(20),
      relative: 'third.mkv',
      absolutePath: source,
      media,
      sidecars: [],
    });

    expect(fs.existsSync(oldLayout.root)).toBe(false);
    expect(fs.existsSync(newLayout.root)).toBe(true);
  });

  it('becomes playable as soon as the first segments land while the video pass still runs', async () => {
    const root = makeDir('pkg-playable-');
    const source = path.join(makeDir('src-playable-'), 'movie.mkv');
    fs.writeFileSync(source, Buffer.alloc(1_000_000));
    let releaseVideo: (() => void) | undefined;
    const runner: CommandRunner = (args) => {
      const dir = path.dirname(args[args.length - 1]!);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'init.mp4'), 'x');
      fs.writeFileSync(path.join(dir, 'seg_00000.m4s'), 'x');
      fs.writeFileSync(path.join(dir, 'seg_00001.m4s'), 'x');
      if (args.indexOf('-map') !== -1 && args[args.indexOf('-map') + 1] === '0:v:0') {
        // Hold the video pass open so we can observe the playable window first.
        return new Promise<number>((resolve) => {
          releaseVideo = () => resolve(0);
        }) as CommandPromise;
      }
      return Promise.resolve(0) as CommandPromise;
    };
    const manager = createPackageManager({ packageRoot: root }, runner);

    const key = packageKey('ee'.repeat(20), 'movie.mkv');
    await manager.ensurePackage({
      infoHash: 'ee'.repeat(20),
      relative: 'movie.mkv',
      absolutePath: source,
      media,
      sidecars: [],
    });
    expect(manager.status(key)?.phase).toBe('packaging');
    await waitUntil(() => manager.status(key)?.playable === true);
    // A provisional master exists so the player can start while the build continues.
    expect(manager.masterPlaylistPath(key)).not.toBeNull();
    expect(manager.status(key)?.phase).toBe('packaging');

    releaseVideo?.();
    await waitUntil(() => manager.status(key)?.phase === 'ready');
    const layout = layoutFor(root, key);
    expect(fs.existsSync(path.join(layout.root, 'DONE'))).toBe(true);
  });

  it('aborts a video encode that makes no progress and reports the stall', async () => {
    const root = makeDir('pkg-stall-');
    const source = path.join(makeDir('src-stall-'), 'movie.mkv');
    fs.writeFileSync(source, Buffer.alloc(1_000_000));
    let cancelVideo: (() => void) | undefined;
    const runner: CommandRunner = (args) => {
      const isVideo = args.indexOf('-map') !== -1 && args[args.indexOf('-map') + 1] === '0:v:0';
      if (isVideo) {
        const promise = new Promise<number>((resolve) => {
          cancelVideo = () => resolve(1);
        }) as CommandPromise;
        promise.cancel = () => cancelVideo?.();
        return promise;
      }
      return Promise.resolve(0) as CommandPromise;
    };
    const manager = createPackageManager({ packageRoot: root, stallTimeoutMs: 40 }, runner);

    const key = packageKey('ff'.repeat(20), 'movie.mkv', 'compat');
    await manager.ensurePackage({
      infoHash: 'ff'.repeat(20),
      relative: 'movie.mkv',
      absolutePath: source,
      media,
      sidecars: [],
      variant: 'compat',
      targetHeight: null,
    });
    await waitUntil(() => manager.status(key)?.phase === 'failed');
    expect(manager.status(key)?.error).toContain('stalled');
  });

  it('runs at most two conversions at once and queues the rest (default RAM budget)', async () => {
    const root = makeDir('pkg-budget-');
    const source = path.join(makeDir('src-budget-'), 'movie.mkv');
    fs.writeFileSync(source, Buffer.alloc(1_000_000));
    let videoConcurrent = 0;
    let videoPeak = 0;
    const runner: CommandRunner = async (args) => {
      const isVideo = args.indexOf('-map') !== -1 && args[args.indexOf('-map') + 1] === '0:v:0';
      if (isVideo) {
        videoConcurrent += 1;
        videoPeak = Math.max(videoPeak, videoConcurrent);
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
      if (isVideo) videoConcurrent -= 1;
      return 0;
    };
    const manager = createPackageManager({ packageRoot: root }, runner);
    const hashes = ['g'.repeat(40), 'h'.repeat(40), 'i'.repeat(40)];
    for (const h of hashes) {
      await manager.ensurePackage({
        infoHash: h,
        relative: 'movie.mkv',
        absolutePath: source,
        media,
        sidecars: [],
      });
    }
    for (const h of hashes) {
      const key = packageKey(h, 'movie.mkv');
      await waitUntil(() => manager.status(key)?.phase === 'ready');
    }
    expect(videoPeak).toBeGreaterThan(0);
    expect(videoPeak).toBeLessThanOrEqual(2);
  });
});

describe('cleanupTorrentPackages', () => {
  it('removes every package dir belonging to the torrent files', () => {
    const root = makeDir('pkg-clean-');
    const downloadDir = makeDir('dl-clean-');
    const content = path.join(downloadDir, 'show.s01');
    fs.mkdirSync(content);
    const file = path.join(content, 'S01E01.mkv');
    fs.writeFileSync(file, Buffer.alloc(10));
    const key = packageKey('f'.repeat(40), 'show.s01/S01E01.mkv');
    const layout = layoutFor(root, key);
    fs.mkdirSync(layout.root, { recursive: true });
    cleanupTorrentPackages(root, 'f'.repeat(40), downloadDir, content);
    expect(fs.existsSync(layout.root)).toBe(false);
  });

  it('removes both the web and compat packages of a torrent', () => {
    const root = makeDir('pkg-clean2-');
    const downloadDir = makeDir('dl-clean2-');
    const content = path.join(downloadDir, 'show.s01');
    fs.mkdirSync(content);
    const file = path.join(content, 'S01E01.mkv');
    fs.writeFileSync(file, Buffer.alloc(10));
    const webKey = packageKey('ab'.repeat(20), 'show.s01/S01E01.mkv');
    const compatKey = packageKey('ab'.repeat(20), 'show.s01/S01E01.mkv', 'compat');
    for (const key of [webKey, compatKey]) {
      fs.mkdirSync(layoutFor(root, key).root, { recursive: true });
    }
    cleanupTorrentPackages(root, 'ab'.repeat(20), downloadDir, content);
    expect(fs.existsSync(layoutFor(root, webKey).root)).toBe(false);
    expect(fs.existsSync(layoutFor(root, compatKey).root)).toBe(false);
  });
});
