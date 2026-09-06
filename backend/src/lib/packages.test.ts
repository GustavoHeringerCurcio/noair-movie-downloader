import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPackageManager, cleanupTorrentPackages } from './packages.js';
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

    expect(maps).toEqual(['0:v:0', '0:1', '0:2', '0:3']);
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
});
