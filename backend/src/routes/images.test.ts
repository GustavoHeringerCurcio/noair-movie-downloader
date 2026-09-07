import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { makeTestDeps } from '../../test/helpers.js';
import type { AppDeps } from '../deps.js';
import type { ArtFilesRepository, ArtFileRow } from '../db/artFilesRepo.js';
import type { ArtSubject } from '../types.js';

/** In-memory repo whose rows can grow via upsert (drives warm-on-miss tests). */
function makeMutableRepo(seed: ArtFileRow[] = []): { repo: ArtFilesRepository; rows: Map<string, ArtFileRow> } {
  const rows = new Map<string, ArtFileRow>();
  for (const row of seed) rows.set(`${row.mediaType}:${row.tmdbId}:${row.kind}`, row);
  return {
    repo: {
      async getMany(subjects) {
        return subjects.flatMap((s) =>
          Array.from(rows.values()).filter((r) => r.mediaType === s.mediaType && r.tmdbId === s.tmdbId),
        );
      },
      async upsertMany(newRows) {
        for (const row of newRows) rows.set(`${row.mediaType}:${row.tmdbId}:${row.kind}`, row);
      },
      async listPosterRowsMissingRating() {
        return [];
      },
      async updateImdbRatings() {},
    },
    rows,
  };
}

function row(overrides: Partial<ArtFileRow>): ArtFileRow {
  return {
    mediaType: 'movie',
    tmdbId: 550,
    kind: 'poster',
    originUrl: null,
    filePath: 'movie_550_poster.png',
    status: 'ok',
    fetchedAt: new Date().toISOString(),
    imdbRating: null,
    ...overrides,
  };
}

const noopCache = { warm: async () => 0 };

describe('GET /api/images/art/:mediaType/:tmdbId/:kind (S8b)', () => {
  let artDir: string;
  let deps: AppDeps;

  beforeEach(async () => {
    artDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artserve-'));
    deps = makeTestDeps();
    deps.config = { ...deps.config, artDir };
    deps.artCache = noopCache;
  });

  afterEach(async () => {
    await fs.rm(artDir, { recursive: true, force: true });
  });

  it('serves a downloaded art file with image content type and immutable cache', async () => {
    await fs.writeFile(path.join(artDir, 'movie_550_poster.png'), Buffer.from([137, 80, 78, 71]));
    deps.artFiles = makeMutableRepo([
      row({ originUrl: 'https://image.tmdb.org/t/p/w780/p.jpg' }),
    ]).repo;
    const res = await request(createApp(deps)).get('/api/images/art/movie/550/poster');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('404s for an unknown (subject, kind) pair', async () => {
    deps.artFiles = makeMutableRepo().repo;
    const res = await request(createApp(deps)).get('/api/images/art/movie/550/poster');
    expect(res.status).toBe(404);
  });

  it('404s when the row exists but the file is gone from disk', async () => {
    deps.artFiles = makeMutableRepo([row({ originUrl: 'x' })]).repo;
    const res = await request(createApp(deps)).get('/api/images/art/movie/550/poster');
    expect(res.status).toBe(404);
  });

  it('404s for invalid mediaType/kind/tmdbId', async () => {
    deps.artFiles = makeMutableRepo().repo;
    const app = createApp(deps);
    expect((await request(app).get('/api/images/art/song/550/poster')).status).toBe(404);
    expect((await request(app).get('/api/images/art/movie/550/logo-foo')).status).toBe(404);
    expect((await request(app).get('/api/images/art/movie/550/thumb')).status).toBe(404);
    expect((await request(app).get('/api/images/art/movie/notanumber/poster')).status).toBe(404);
  });

  it('never serves a path-traversal file name from the DB', async () => {
    deps.artFiles = makeMutableRepo([row({ originUrl: 'x', filePath: '../secret.jpg' })]).repo;
    const res = await request(createApp(deps)).get('/api/images/art/movie/550/poster');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/images/art/:mediaType/:tmdbId/logo (S8b, TMDB transparent logo)', () => {
  let artDir: string;
  let deps: AppDeps;

  beforeEach(async () => {
    artDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logoserve-'));
    deps = makeTestDeps();
    deps.config = { ...deps.config, artDir };
    deps.logoCache = noopCache;
  });

  afterEach(async () => {
    await fs.rm(artDir, { recursive: true, force: true });
  });

  it('serves a cached logo file', async () => {
    await fs.writeFile(path.join(artDir, 'movie_550_logo.png'), Buffer.from([137, 80, 78, 71]));
    deps.artFiles = makeMutableRepo([row({ kind: 'logo', filePath: 'movie_550_logo.png' })]).repo;
    const res = await request(createApp(deps)).get('/api/images/art/movie/550/logo');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });

  it('404s when no logo cache is wired', async () => {
    deps.logoCache = null;
    deps.artFiles = makeMutableRepo().repo;
    const res = await request(createApp(deps)).get('/api/images/art/movie/550/logo');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/images/fanart/:mediaType/:tmdbId/thumb (S8c)', () => {
  let artDir: string;
  let deps: AppDeps;

  beforeEach(async () => {
    artDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fanserve-'));
    deps = makeTestDeps();
    deps.config = { ...deps.config, artDir };
    deps.fanartCache = noopCache;
  });

  afterEach(async () => {
    await fs.rm(artDir, { recursive: true, force: true });
  });

  it('serves a cached fanart thumb with immutable cache', async () => {
    await fs.writeFile(path.join(artDir, 'movie_550_thumb.jpg'), Buffer.from([0xff, 0xd8]));
    deps.artFiles = makeMutableRepo([row({ kind: 'thumb', filePath: 'movie_550_thumb.jpg' })]).repo;
    const res = await request(createApp(deps)).get('/api/images/fanart/movie/550/thumb');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('warms on first miss: downloads the key-art and serves it', async () => {
    const { repo, rows } = makeMutableRepo();
    deps.artFiles = repo;
    let warmed = 0;
    deps.fanartCache = {
      async warm(_subjects: ArtSubject[]) {
        warmed += 1;
        await fs.writeFile(path.join(artDir, 'movie_550_thumb.jpg'), Buffer.from([0xff, 0xd8]));
        rows.set('movie:550:thumb', row({ kind: 'thumb', filePath: 'movie_550_thumb.jpg' }));
        return 1;
      },
    };
    const res = await request(createApp(deps)).get('/api/images/fanart/movie/550/thumb');
    expect(res.status).toBe(200);
    expect(warmed).toBe(1);
  });

  it('answers 404 when the title has no fanart art (empty) and does not loop', async () => {
    const { repo, rows } = makeMutableRepo();
    deps.artFiles = repo;
    deps.fanartCache = {
      async warm() {
        rows.set('movie:550:thumb', row({ kind: 'thumb', status: 'empty', filePath: null, originUrl: null }));
        return 0;
      },
    };
    const res = await request(createApp(deps)).get('/api/images/fanart/movie/550/thumb');
    expect(res.status).toBe(404);
  });

  it('404s without a fanart key (no cache wired)', async () => {
    deps.fanartCache = null;
    deps.artFiles = makeMutableRepo().repo;
    const res = await request(createApp(deps)).get('/api/images/fanart/movie/550/thumb');
    expect(res.status).toBe(404);
  });

  it('rejects invalid subjects', async () => {
    const app = createApp(deps);
    expect((await request(app).get('/api/images/fanart/song/550/thumb')).status).toBe(404);
    expect((await request(app).get('/api/images/fanart/movie/notanumber/thumb')).status).toBe(404);
  });
});
