import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { makeTestDeps } from '../../test/helpers.js';
import type { AppDeps } from '../deps.js';
import type { ArtFilesRepository, ArtFileRow } from '../db/artFilesRepo.js';

function repoWith(rows: ArtFileRow[]): ArtFilesRepository {
  return {
    async getMany() {
      return rows;
    },
    async upsertMany() {},
    async listPosterRowsMissingRating() {
      return [];
    },
    async updateImdbRatings() {},
  };
}

function posterRow(overrides: Partial<ArtFileRow> = {}): ArtFileRow {
  return {
    mediaType: 'movie',
    tmdbId: 550,
    kind: 'poster',
    originUrl: 'https://image.tmdb.org/t/p/w780/p.jpg',
    filePath: 'movie_550_poster.png',
    status: 'ok',
    fetchedAt: new Date().toISOString(),
    imdbRating: null,
    ...overrides,
  };
}

describe('GET /api/images/art/:mediaType/:tmdbId/:kind (S8b)', () => {
  let artDir: string;
  let deps: AppDeps;

  beforeEach(async () => {
    artDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artserve-'));
    deps = makeTestDeps();
    deps.config = { ...deps.config, artDir };
  });

  afterEach(async () => {
    await fs.rm(artDir, { recursive: true, force: true });
  });

  it('serves a downloaded art file with image content type and immutable cache', async () => {
    await fs.writeFile(path.join(artDir, 'movie_550_poster.png'), Buffer.from([137, 80, 78, 71]));
    deps.artFiles = repoWith([posterRow()]);
    const res = await request(createApp(deps)).get('/api/images/art/movie/550/poster');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('404s for an unknown (subject, kind) pair', async () => {
    deps.artFiles = repoWith([]);
    const res = await request(createApp(deps)).get('/api/images/art/movie/550/poster');
    expect(res.status).toBe(404);
  });

  it('404s when the row exists but the file is gone from disk', async () => {
    deps.artFiles = repoWith([posterRow({ originUrl: 'x' })]);
    const res = await request(createApp(deps)).get('/api/images/art/movie/550/poster');
    expect(res.status).toBe(404);
  });

  it('404s for invalid mediaType/kind/tmdbId', async () => {
    deps.artFiles = repoWith([]);
    const app = createApp(deps);
    expect((await request(app).get('/api/images/art/song/550/poster')).status).toBe(404);
    expect((await request(app).get('/api/images/art/movie/550/logo-foo')).status).toBe(404);
    expect((await request(app).get('/api/images/art/movie/notanumber/poster')).status).toBe(404);
  });

  it('never serves a path-traversal file name from the DB', async () => {
    deps.artFiles = repoWith([posterRow({ originUrl: 'x', filePath: '../secret.jpg' })]);
    const res = await request(createApp(deps)).get('/api/images/art/movie/550/poster');
    expect(res.status).toBe(404);
  });
});
