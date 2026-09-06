import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { makeTestDeps } from '../../test/helpers.js';
import { UpstreamError } from '../types.js';
import type { TmdbVideo } from '../services/tmdb.js';

function video(overrides: Partial<TmdbVideo> = {}): TmdbVideo {
  return {
    name: null,
    key: 'k',
    site: 'YouTube',
    kind: 'Trailer',
    official: false,
    language: null,
    publishedAt: null,
    ...overrides,
  };
}

function appWithVideos(videos: TmdbVideo[]) {
  const deps = makeTestDeps({
    tmdb: {
      ...makeTestDeps().tmdb,
      videos: async () => videos,
    },
  });
  return createApp(deps);
}

describe('S15 GET /api/media/:id/trailer', () => {
  it('returns the best trailer for a movie', async () => {
    const res = await request(appWithVideos([video({ key: 'abc', kind: 'Teaser', official: false, language: 'en' })])).get(
      '/api/media/550/trailer?type=movie',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ trailer: { provider: 'youtube', videoId: 'abc', name: null } });
  });

  it('returns trailer:null when TMDB has no usable video', async () => {
    const res = await request(appWithVideos([video({ site: 'Twitch' })])).get('/api/media/550/trailer?type=movie');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ trailer: null });
  });

  it('rejects a missing or invalid type', async () => {
    expect((await request(appWithVideos([])).get('/api/media/550/trailer')).status).toBe(400);
    expect((await request(appWithVideos([])).get('/api/media/550/trailer?type=person')).status).toBe(400);
  });

  it('rejects an invalid id', async () => {
    expect((await request(appWithVideos([])).get('/api/media/abc/trailer?type=movie')).status).toBe(400);
  });

  it('maps a TMDB failure to 502', async () => {
    const deps = makeTestDeps({
      tmdb: {
        ...makeTestDeps().tmdb,
        videos: async () => {
          throw new UpstreamError(502, 'TMDB unreachable');
        },
      },
    });
    const res = await request(createApp(deps)).get('/api/media/550/trailer?type=tv');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('TMDB unreachable');
  });
});
