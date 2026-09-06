import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { makeDownloadRecord, makeTestDeps } from '../../test/helpers.js';
import { relativeToDownloadDir } from '../lib/streaming.js';

vi.mock('../lib/mediaInfo.js', () => ({
  probeMediaInfo: vi.fn(async () => ({
    container: 'mkv',
    durationSeconds: 600,
    video: { index: 0, codec: 'h264', width: 1920, height: 1080, hdr: false },
    audioTracks: [{ index: 1, codec: 'dts', language: 'en', title: null, channels: 6, default: true }],
    subtitleTracks: [],
    videoCodec: 'h264',
    audioCodec: 'dts',
    height: 1080,
  })),
  listSidecarSubtitles: vi.fn(() => []),
}));

vi.mock('../lib/packages.js', () => {
  const fake: { phase: string; progress: number; error: string | null; master: string | null; file: string | null } = {
    phase: 'packaging',
    progress: 0,
    error: null,
    master: null,
    file: null,
  };
  const state = () => ({
    key: '',
    infoHash: '',
    relative: '',
    absolutePath: '',
    phase: fake.phase,
    progress: fake.progress,
    error: fake.error,
  });
  return {
    createPackageManager: () => ({
      ensurePackage: async () => state(),
      status: () => state(),
      masterPlaylistPath: () => fake.master,
      filePathInPackage: (_key: string, subPath: string) => (subPath.endsWith('master.m3u8') ? fake.master : fake.file),
      deletePackage: () => {},
    }),
    __setFake: (patch: Partial<typeof fake>) => Object.assign(fake, patch),
  };
});

import { __setFake } from '../lib/packages.js';

const HASH = 'ab'.repeat(20);

function setup(): { app: ReturnType<typeof createApp>; downloadDir: string } {
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playback-'));
  const file = path.join(downloadDir, 'movie.mkv');
  fs.writeFileSync(file, Buffer.alloc(1000));
  const deps = makeTestDeps({
    config: { ...makeTestDeps().config, downloadDir },
    downloads: {
      ...makeTestDeps().downloads,
      findByInfoHash: async () =>
        makeDownloadRecord({
          infoHash: HASH,
          contentPath: file,
          streamFilePath: relativeToDownloadDir(downloadDir, file),
        }),
    },
  });
  return { app: createApp(deps), downloadDir };
}

beforeEach(() => {
  __setFake({ phase: 'packaging', progress: 0, error: null, master: null, file: null });
});

describe('GET /api/playback/:infoHash/hls/status', () => {
  it('returns the current packaging phase', async () => {
    const { app } = setup();
    const res = await request(app).get(`/api/playback/${HASH}/hls/status`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ phase: 'packaging', progress: 0, error: null });
  });

  it('404s for an unknown download', async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).get(`/api/playback/${HASH}/hls/status`);
    expect(res.status).toBe(404);
  });

  it('404s when the torrent has no complete file yet', async () => {
    const deps = makeTestDeps({
      downloads: {
        ...makeTestDeps().downloads,
        findByInfoHash: async () => makeDownloadRecord({ infoHash: HASH, contentPath: null, streamFilePath: null }),
      },
    });
    const res = await request(createApp(deps)).get(`/api/playback/${HASH}/hls/status`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/playback/:infoHash/hls/master.m3u8', () => {
  it('answers 202 with status while packaging is still running', async () => {
    const { app } = setup();
    const res = await request(app).get(`/api/playback/${HASH}/hls/master.m3u8`);
    expect(res.status).toBe(202);
    expect(res.body.phase).toBe('packaging');
  });

  it('serves the master playlist once the package is ready', async () => {
    const { app, downloadDir } = setup();
    const master = path.join(downloadDir, 'master.m3u8');
    fs.writeFileSync(master, '#EXTM3U\n');
    __setFake({ phase: 'ready', progress: 1, master });
    const res = await request(app).get(`/api/playback/${HASH}/hls/master.m3u8`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('mpegurl');
    expect(res.text).toContain('#EXTM3U');
  });
});

describe('GET /api/playback/pkg/:key/*', () => {
  it('rejects invalid package keys', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/playback/pkg/..%2F..%2Fetc/init.mp4');
    expect([400, 404]).toContain(res.status);
  });

  it('rejects path traversal and missing files inside a package', async () => {
    const { app } = setup();
    const ok = await request(app).get(`/api/playback/pkg/${HASH}-movie.mkv/init.mp4`);
    expect(ok.status).toBe(404);
  });
});

describe('manifest URL serves a playable package tree', () => {
  it('serves the master and its child media playlist with mpegurl content types', async () => {
    const { app, downloadDir } = setup();
    const key = `${HASH}-movie.mkv`;
    const master = path.join(downloadDir, 'master.m3u8');
    const child = path.join(downloadDir, 'video', 'main.m3u8');
    fs.mkdirSync(path.dirname(child), { recursive: true });
    fs.writeFileSync(
      master,
      [
        '#EXTM3U',
        '#EXT-X-VERSION:6',
        '#EXT-X-INDEPENDENT-SEGMENTS',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="audio/1/main.m3u8"',
        '#EXT-X-STREAM-INF:BANDWIDTH=4000000,AUDIO="aud"',
        'video/main.m3u8',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(child, '#EXTM3U\n');
    __setFake({ phase: 'ready', progress: 1, master, file: child });

    const masterRes = await request(app).get(`/api/playback/pkg/${key}/master.m3u8`);
    expect(masterRes.status).toBe(200);
    expect(masterRes.headers['content-type']).toContain('mpegurl');
    expect(masterRes.text).toContain('video/main.m3u8');

    // Shaka resolves the master's relative child URI under the pkg base.
    const childRes = await request(app).get(`/api/playback/pkg/${key}/video/main.m3u8`);
    expect(childRes.status).toBe(200);
    expect(childRes.headers['content-type']).toContain('mpegurl');
  });
});
