import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { makeDownloadRecord, makeTestDeps } from '../../test/helpers.js';
import { relativeToDownloadDir } from '../lib/streaming.js';

vi.mock('../lib/probe.js', () => ({
  probeMedia: vi.fn(),
}));

import { probeMedia } from '../lib/probe.js';

const HASH = 'ab'.repeat(20);

function setup(probe: { videoCodec: string | null; audioCodec: string | null; height: number | null }) {
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playinfo-'));
  const file = path.join(downloadDir, 'movie.mkv');
  fs.writeFileSync(file, Buffer.alloc(1000));
  vi.mocked(probeMedia).mockResolvedValue(probe);

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
  return createApp(deps);
}

beforeEach(() => {
  vi.mocked(probeMedia).mockReset();
});

describe('GET /api/downloads/:infoHash/playinfo', () => {
  it('reports direct for browser-safe codecs', async () => {
    const app = setup({ videoCodec: 'h264', audioCodec: 'aac', height: 1080 });
    const res = await request(app).get(`/api/downloads/${HASH}/playinfo`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('direct');
    expect(res.body.streamUrl).toBe(`/api/stream/${HASH}/watch`);
  });

  it('reports remux-audio when only audio is unsupported', async () => {
    const app = setup({ videoCodec: 'h264', audioCodec: 'eac3', height: 1080 });
    const res = await request(app).get(`/api/downloads/${HASH}/playinfo`);
    expect(res.body.mode).toBe('remux-audio');
  });

  it('reports transcode for 1080p HEVC', async () => {
    const app = setup({ videoCodec: 'hevc', audioCodec: 'aac', height: 1080 });
    const res = await request(app).get(`/api/downloads/${HASH}/playinfo`);
    expect(res.body.mode).toBe('transcode');
    expect(res.body.videoCodec).toBe('hevc');
  });

  it('reports player-required for 4K HEVC', async () => {
    const app = setup({ videoCodec: 'hevc', audioCodec: 'eac3', height: 2160 });
    const res = await request(app).get(`/api/downloads/${HASH}/playinfo`);
    expect(res.body.mode).toBe('player-required');
    expect(res.body.playUrl).toBe(`/api/stream/${HASH}`);
    expect(res.body.fileUrl).toBe(`/api/downloads/${HASH}/file`);
  });

  it('404s for unknown downloads', async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).get(`/api/downloads/${HASH}/playinfo`);
    expect(res.status).toBe(404);
  });
});
