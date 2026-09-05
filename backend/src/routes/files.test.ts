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

const HASH = 'cd'.repeat(20);

function setupSeasonPack(): { app: ReturnType<typeof createApp>; downloadDir: string } {
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'episodes-'));
  const seasonDir = path.join(downloadDir, 'Show.S01');
  fs.mkdirSync(seasonDir);
  fs.writeFileSync(path.join(seasonDir, 'S01E01.mkv'), Buffer.alloc(500));
  fs.writeFileSync(path.join(seasonDir, 'S01E02.mkv'), Buffer.alloc(700));
  fs.writeFileSync(path.join(seasonDir, 'S01E03.mkv'), Buffer.alloc(900));
  vi.mocked(probeMedia).mockResolvedValue({ videoCodec: 'h264', audioCodec: 'aac', height: 1080 });

  const deps = makeTestDeps({
    config: { ...makeTestDeps().config, downloadDir },
    downloads: {
      ...makeTestDeps().downloads,
      findByInfoHash: async () =>
        makeDownloadRecord({
          infoHash: HASH,
          contentPath: seasonDir,
          streamFilePath: relativeToDownloadDir(downloadDir, path.join(seasonDir, 'S01E03.mkv')),
        }),
    },
  });
  return { app: createApp(deps), downloadDir };
}

beforeEach(() => {
  vi.mocked(probeMedia).mockReset();
});

describe('GET /api/downloads/:infoHash/files', () => {
  it('lists the video files of a season pack with relative paths and completeness', async () => {
    const { app } = setupSeasonPack();
    const res = await request(app).get(`/api/downloads/${HASH}/files`);
    expect(res.status).toBe(200);
    expect(res.body.files.map((f: { relative: string }) => f.relative)).toEqual([
      'Show.S01/S01E01.mkv',
      'Show.S01/S01E02.mkv',
      'Show.S01/S01E03.mkv',
    ]);
    expect(res.body.files.every((f: { complete: boolean }) => f.complete)).toBe(true);
    expect(res.body.files[0]!.mime).toBe('video/x-matroska');
  });

  it('404s when the content path is not yet known', async () => {
    const deps = makeTestDeps({
      downloads: {
        ...makeTestDeps().downloads,
        findByInfoHash: async () => makeDownloadRecord({ infoHash: HASH, contentPath: null, streamFilePath: null }),
      },
    });
    const res = await request(createApp(deps)).get(`/api/downloads/${HASH}/files`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/downloads/:infoHash/playinfo with ?file=', () => {
  it('probes and reports URLs for a chosen episode file', async () => {
    const { app } = setupSeasonPack();
    const file = 'Show.S01/S01E01.mkv';
    const res = await request(app).get(`/api/downloads/${HASH}/playinfo?file=${encodeURIComponent(file)}`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('direct');
    expect(res.body.streamUrl).toBe(`/api/stream/${HASH}/watch?file=${encodeURIComponent(file)}`);
    expect(res.body.playUrl).toBe(`/api/stream/${HASH}?file=${encodeURIComponent(file)}`);
    expect(res.body.fileUrl).toBe(`/api/downloads/${HASH}/file?file=${encodeURIComponent(file)}`);
    expect(probeMedia).toHaveBeenCalledWith(expect.stringContaining('S01E01.mkv'));
  });

  it('404s when the chosen file is not in the torrent', async () => {
    const { app } = setupSeasonPack();
    const res = await request(app).get(
      `/api/downloads/${HASH}/playinfo?file=${encodeURIComponent('Show.S01/S01E99.mkv')}`,
    );
    expect(res.status).toBe(404);
  });

  it('falls back to the stored largest file when no ?file= is given', async () => {
    const { app } = setupSeasonPack();
    const res = await request(app).get(`/api/downloads/${HASH}/playinfo`);
    expect(res.status).toBe(200);
    expect(probeMedia).toHaveBeenCalledWith(expect.stringContaining('S01E03.mkv'));
    expect(res.body.streamUrl).toBe(`/api/stream/${HASH}/watch`);
  });
});
