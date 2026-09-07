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

function mediaFor(
  probe: { videoCodec: string | null; audioCodec: string | null; height: number | null },
  container: string,
  videoExtra: Record<string, unknown> = {},
) {
  return {
    container,
    durationSeconds: 5400,
    video: { index: 0, codec: probe.videoCodec, width: 1920, height: probe.height, hdr: false, ...videoExtra },
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
    expect(res.body.manifestUrl).toBe(`/api/playback/pkg/${HASH}-movie.mkv/master.m3u8`);
  });

  it('exposes MSE probe type strings for hls video (browser preflight)', async () => {
    const app = setup({ videoCodec: 'h264', audioCodec: 'aac', height: 1080 }, { container: 'mkv' });
    const res = await request(app).get(`/api/downloads/${HASH}/playinfo`);
    expect(res.body.mseProbe.length).toBeGreaterThan(0);
    expect(res.body.mseProbe[0]).toContain('avc1');
    expect(res.body.mseProbe[0]).toContain('mp4a.40.2');
  });

  it('returns no candidates for 10-bit HEVC (skip packaging, use player)', async () => {
    vi.mocked(probeMediaInfo).mockResolvedValue(
      mediaFor({ videoCodec: 'hevc', audioCodec: 'aac', height: 1080 }, 'mkv', {
        profile: 'Main 10',
        pixFmt: 'yuv420p10le',
        level: 120,
      }),
    );
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playinfo-hevc10-'));
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
    const res = await request(createApp(deps)).get(`/api/downloads/${HASH}/playinfo`);
    expect(res.body.mode).toBe('hls');
    expect(res.body.mseProbe).toEqual([]);
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

  it('offers a compat package for 1080p HEVC (no downscale)', async () => {
    const app = setup({ videoCodec: 'hevc', audioCodec: 'aac', height: 1080 }, { container: 'mkv' });
    const res = await request(app).get(`/api/downloads/${HASH}/playinfo`);
    expect(res.body.compat).toEqual({
      manifestUrl: `/api/playback/pkg/${HASH}-movie.mkv-compat/master.m3u8`,
      targetHeight: null,
    });
  });

  it('offers a downscaled compat package for 4K HEVC (1080p)', async () => {
    const app = setup({ videoCodec: 'hevc', audioCodec: 'eac3', height: 2160 });
    const res = await request(app).get(`/api/downloads/${HASH}/playinfo`);
    expect(res.body.compat).toEqual({
      manifestUrl: `/api/playback/pkg/${HASH}-movie.mp4-compat/master.m3u8`,
      targetHeight: 1080,
    });
  });

  it('offers no compat package for direct (already browser-safe) playback', async () => {
    const app = setup({ videoCodec: 'h264', audioCodec: 'aac', height: 1080 });
    const res = await request(app).get(`/api/downloads/${HASH}/playinfo`);
    expect(res.body.compat).toBeNull();
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
