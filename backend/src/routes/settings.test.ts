import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { makeTestDeps } from '../../test/helpers.js';

function depsWithKey(configured: boolean): ReturnType<typeof makeTestDeps> {
  return makeTestDeps({
    fanart: configured
      ? {
          getMovieArt: async () => ({ thumbUrl: null, logoUrl: null }),
          getTvArt: async () => ({ thumbUrl: null, logoUrl: null }),
        }
      : null,
  });
}

describe('GET /api/settings', () => {
  it('defaults to TMDB when no Fanart key is configured', async () => {
    const app = createApp(depsWithKey(false));
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ artwork: { provider: 'tmdb', fanartConfigured: false } });
  });

  it('defaults to Fanart when a key is configured and nothing is stored', async () => {
    const app = createApp(depsWithKey(true));
    const res = await request(app).get('/api/settings');
    expect(res.body).toEqual({ artwork: { provider: 'fanart', fanartConfigured: true } });
  });
});

describe('PUT /api/settings', () => {
  it('persists a Fanart choice when a key is configured', async () => {
    let stored: unknown = null;
    const deps = depsWithKey(true);
    deps.settings = {
      get: async () => null,
      set: async (_key, value) => {
        stored = value;
      },
    };
    const app = createApp(deps);
    const res = await request(app).put('/api/settings').send({ artwork: { provider: 'fanart' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ artwork: { provider: 'fanart', fanartConfigured: true } });
    expect(stored).toEqual({ provider: 'fanart' });
  });

  it('rejects Fanart when no key is configured', async () => {
    const app = createApp(depsWithKey(false));
    const res = await request(app).put('/api/settings').send({ artwork: { provider: 'fanart' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('FANART_API_KEY');
  });

  it('rejects unknown providers', async () => {
    const app = createApp(depsWithKey(true));
    const res = await request(app).put('/api/settings').send({ artwork: { provider: 'flickr' } });
    expect(res.status).toBe(400);
  });
});
