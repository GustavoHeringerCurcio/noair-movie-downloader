import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { makeDownloadRecord, makeTestDeps } from '../../test/helpers.js';
import { UpstreamError } from '../types.js';
import type { MediaDetail } from '../types.js';

const DETAIL: MediaDetail = {
  tmdbId: 27205,
  mediaType: 'movie',
  title: 'Inception',
  year: 2010,
  overview: 'o',
  posterPath: '/p.jpg',
  backdropPath: '/b.jpg',
  voteAverage: 8.4,
  genres: ['Sci-Fi'],
  runtime: 148,
};

const HASH = 'aa'.repeat(20);

describe('routes', () => {
  it('GET /api/media/:id/sources returns unreachable:true when Prowlarr is down', async () => {
    const deps = makeTestDeps({
      tmdb: {
        searchMulti: async () => [],
        details: async () => DETAIL,
      },
      prowlarr: {
        search: async () => {
          throw new UpstreamError(502, 'Prowlarr unreachable');
        },
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/media/27205/sources?type=movie');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sources: [], unreachable: true });
  });

  it('GET /api/media/:id/sources returns authError:true on an invalid Prowlarr key', async () => {
    const deps = makeTestDeps({
      tmdb: {
        searchMulti: async () => [],
        details: async () => DETAIL,
      },
      prowlarr: {
        search: async () => {
          throw new UpstreamError(401, 'Prowlarr API key invalid');
        },
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/media/27205/sources?type=movie');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sources: [], authError: true });
  });

  it('GET /api/images/tmdb/* rejects invalid paths with 400', async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).get('/api/images/tmdb/w500/bad%00path');
    expect(res.status).toBe(400);
  });

  it('GET /api/images/tmdb/* rejects disallowed sizes with 400', async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).get('/api/images/tmdb/w999/abc.jpg');
    expect(res.status).toBe(400);
  });

  it('POST /api/downloads returns 400 for missing fields', async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).post('/api/downloads').send({ infoHash: HASH });
    expect(res.status).toBe(400);
  });

  it('POST /api/downloads returns 409 for an existing info_hash', async () => {
    const deps = makeTestDeps({
      downloads: {
        ...makeTestDeps().downloads,
        findByInfoHash: async () => makeDownloadRecord({ infoHash: HASH }),
      },
    });
    const app = createApp(deps);
    const res = await request(app).post('/api/downloads').send({
      infoHash: HASH,
      magnetUri: 'magnet:?xt=urn:btih:' + HASH,
      torrentName: 't',
    });
    expect(res.status).toBe(409);
  });

  it('POST /api/downloads returns 201 on success', async () => {
    const deps = makeTestDeps();
    const app = createApp(deps);
    const res = await request(app).post('/api/downloads').send({
      tmdbId: 27205,
      mediaType: 'movie',
      title: 'Inception',
      year: 2010,
      posterPath: '/p.jpg',
      infoHash: HASH,
      magnetUri: 'magnet:?xt=urn:btih:' + HASH,
      torrentName: 'Inception.2010.1080p',
      indexer: 'x',
    });
    expect(res.status).toBe(201);
    expect(res.body.infoHash).toBe(HASH);
  });

  it('POST /api/downloads/:infoHash/pause returns 204', async () => {
    const deps = makeTestDeps({
      downloads: {
        ...makeTestDeps().downloads,
        findByInfoHash: async () => makeDownloadRecord({ infoHash: HASH }),
      },
    });
    const app = createApp(deps);
    const res = await request(app).post(`/api/downloads/${HASH}/pause`);
    expect(res.status).toBe(204);
  });
});
