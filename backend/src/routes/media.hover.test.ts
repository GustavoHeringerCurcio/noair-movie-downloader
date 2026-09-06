import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { makeTestDeps } from '../../test/helpers.js';
import { UpstreamError } from '../types.js';
import type { TmdbVideo } from '../services/tmdb.js';
import type { MediaDetail } from '../types.js';

function video(overrides: Partial<TmdbVideo> = {}): TmdbVideo {
  return {
    name: null,
    key: 'k',
    site: 'YouTube',
    kind: 'Trailer',
    official: true,
    language: 'en',
    publishedAt: null,
    ...overrides,
  };
}

function movieDetail(overrides: Partial<MediaDetail> = {}): MediaDetail {
  return {
    tmdbId: 550,
    mediaType: 'movie',
    title: 'Fight Club',
    year: 1999,
    overview: 'o',
    posterPath: null,
    backdropPath: null,
    voteAverage: 8.4,
    genres: ['Drama'],
    runtime: 139,
    ...overrides,
  };
}

function tvDetail(overrides: Partial<MediaDetail> = {}): MediaDetail {
  return {
    tmdbId: 100,
    mediaType: 'tv',
    title: 'Fallout',
    year: 2024,
    overview: 'o',
    posterPath: null,
    backdropPath: null,
    voteAverage: 8.3,
    genres: ['Sci-Fi', 'Drama'],
    runtime: 49,
    seasons: [
      { seasonNumber: 1, name: 'Season 1', episodeCount: 8 },
      { seasonNumber: 2, name: 'Season 2', episodeCount: 8 },
    ],
    ...overrides,
  };
}

function appWith(overrides: {
  details?: (id: number, type: 'movie' | 'tv') => Promise<MediaDetail>;
  videos?: (id: number, type: 'movie' | 'tv') => Promise<TmdbVideo[]>;
  certification?: (id: number, type: 'movie' | 'tv') => Promise<string | null>;
} = {}) {
  const base = makeTestDeps();
  const deps = makeTestDeps({
    tmdb: {
      ...base.tmdb,
      details: overrides.details ?? (async (_id, type) => (type === 'movie' ? movieDetail() : tvDetail())),
      videos: overrides.videos ?? (async () => []),
      certification: overrides.certification ?? (async () => null),
    },
  });
  return createApp(deps);
}

describe('S16 GET /api/media/:id/hover', () => {
  it('returns the full hover payload for a movie', async () => {
    const app = appWith({
      videos: async () => [video({ key: 'abc' })],
      certification: async () => 'R',
    });
    const res = await request(app).get('/api/media/550/hover?type=movie');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      trailer: { provider: 'youtube', videoId: 'abc', name: null },
      genres: ['Drama'],
      runtime: 139,
      seasons: null,
      certification: 'R',
    });
  });

  it('returns seasons for a tv title and keeps runtime null', async () => {
    const app = appWith({
      details: async () => tvDetail(),
      videos: async () => [video({ key: 'tvabc' })],
      certification: async () => 'TV-MA',
    });
    const res = await request(app).get('/api/media/100/hover?type=tv');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      trailer: { provider: 'youtube', videoId: 'tvabc', name: null },
      genres: ['Sci-Fi', 'Drama'],
      runtime: null,
      seasons: 2,
      certification: 'TV-MA',
    });
  });

  it('degrades a trailer-less title to trailer:null with the card still populated', async () => {
    const app = appWith({ videos: async () => [] });
    const res = await request(app).get('/api/media/550/hover?type=movie');
    expect(res.status).toBe(200);
    expect(res.body.trailer).toBeNull();
    expect(res.body.genres).toEqual(['Drama']);
  });

  it('keeps the card working when the certification lookup fails', async () => {
    const app = appWith({
      videos: async () => [video({ key: 'abc' })],
      certification: async () => {
        throw new UpstreamError(502, 'TMDB unreachable');
      },
    });
    const res = await request(app).get('/api/media/550/hover?type=movie');
    expect(res.status).toBe(200);
    expect(res.body.certification).toBeNull();
    expect(res.body.trailer).not.toBeNull();
  });

  it('rejects a missing or invalid type', async () => {
    const app = appWith();
    expect((await request(app).get('/api/media/550/hover')).status).toBe(400);
    expect((await request(app).get('/api/media/550/hover?type=person')).status).toBe(400);
  });

  it('rejects an invalid id', async () => {
    const app = appWith();
    expect((await request(app).get('/api/media/abc/hover?type=movie')).status).toBe(400);
  });

  it('maps a TMDB details failure to 502', async () => {
    const app = appWith({
      details: async () => {
        throw new UpstreamError(502, 'TMDB unreachable');
      },
    });
    const res = await request(app).get('/api/media/550/hover?type=movie');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('TMDB unreachable');
  });
});
