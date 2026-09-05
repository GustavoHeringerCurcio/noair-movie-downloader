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

vi.mock('../lib/mediaInfo.js', () => ({
  probeMediaInfo: vi.fn(),
  listSidecarSubtitles: vi.fn(() => []),
}));

import { probeMedia } from '../lib/probe.js';
import { probeMediaInfo } from '../lib/mediaInfo.js';

const HASH = 'ab'.repeat(20);

function mediaFor(probe: { videoCodec: string | null; audioCodec: string | null; height: number | null }, container: string) {
  return {
    container,
    durationSeconds: 5400,
    video: { index: 0, codec: probe.videoCodec, width: 1920, height: probe.height, hdr: false },
    audioTracks:
      probe.audioCodec == null
        ? []
        : [{ index: 1, codec: probe.audioCodec, language: 'en', title: null, channels: 2, default: true }],
    subtitleTracks: [],
    videoCodec: probe.videoCodec,
    audioCodec: probe.audioCodec,
    height: probe.height,
  };
}

function setup(
  probe: { videoCodec: string | null; audioCodec: string | null; height: number | null },
  opts: { container?: string } = {},
) {
  const container = opts.container ?? 'mp4';
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playinfo-'));
  const file = path.join(downloadDir, `movie.${container}`);
  fs.writeFileSync(file, Buffer.alloc(1000));
  vi.mocked(probeMedia).mockResolvedValue(probe);
  vi.mocked(probeMediaInfo).mockResolvedValue(mediaFor(probe, container));

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
  vi.mocked(probeMediaInfo).mockReset();
});

describe('GET /api/downloads/:infoHash/playinfo', () => {
  it('reports direct for a native mp4 with browser-safe single audio', async () => {
    const app = setup({ videoCodec: 'h264', audioCodec: 'aac', height: 1080 });
    const res = await request(app).get(`/api/downloads/${HASH}/playinfo`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('direct');
    expect(res.body.manifestUrl).toBeNull();
    expect(res.body.streamUrl).toBe(`/api/stream/${HASH}/watch`);
  });

  it('reports hls for an MKV (container change) and exposes the manifest URL', async () => {
    const app = setup({ videoCodec: 'h264', audioCodec: 'aac', height: 1080 }, { container: 'mkv' });
    const res = await request(app).get(`/api/downloads/${HASH}/playinfo`);
    expect(res.body.mode).toBe('hls');
    expect(res.body.manifestUrl).toBe(`/api/playback/${HASH}/hls/master.m3u8`);
  });

  it('reports hls when audio needs normalization even in a playable container', async () => {
    const app = setup({ videoCodec: 'h264', audioCodec: 'eac3', height: 1080 });
    const res = await request(app).get(`/api/downloads/${HASH}/playinfo`);
    expect(res.body.mode).toBe('hls');
    expect(res.body.audioTracks[0].codec).toBe('eac3');
  });

  it('reports hls for 1080p HEVC (copyable, browser-dependent decode)', async () => {
    const app = setup({ videoCodec: 'hevc', audioCodec: 'aac', height: 1080 });
    const res = await request(app).get(`/api/downloads/${HASH}/playinfo`);
    expect(res.body.mode).toBe('hls');
    expect(res.body.videoCodec).toBe('hevc');
  });

  it('keeps player-required for 4K HEVC (bit-perfect external path)', async () => {
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

  it('reports every audio and subtitle track plus container metadata', async () => {
    const app = setup({ videoCodec: 'h264', audioCodec: 'aac', height: 1080 }, { container: 'mkv' });
    const res = await request(app).get(`/api/downloads/${HASH}/playinfo`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      container: 'mkv',
      durationSeconds: 5400,
      video: { index: 0, codec: 'h264', width: 1920, height: 1080, hdr: false },
      audioTracks: [{ index: 1, codec: 'aac', language: 'en', title: null, channels: 2, default: true }],
      subtitleTracks: [],
      sidecarSubtitles: [],
    });
  });
});
