import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { makeTestDeps } from '../../test/helpers.js';

function depsWithKey(configured: boolean): ReturnType<typeof makeTestDeps> {
  return makeTestDeps({
    fanart: configured
      ? {
          getMovieArt: async () => ({ status: 'empty' as const, thumbUrl: null, logoUrl: null }),
          getTvArt: async () => ({ status: 'empty' as const, thumbUrl: null, logoUrl: null }),
        }
      : null,
  });
}

const PREF = { tmdb: 'backdrop' as const, fanart: 'thumb' as const };

describe('GET /api/settings', () => {
  it('defaults to TMDB when no Fanart key is configured', async () => {
    const app = createApp(depsWithKey(false));
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      artwork: { provider: 'tmdb', fanartConfigured: false, preference: PREF },
      language: { audio: 'en' },
    });
  });

  it('defaults to Fanart when a key is configured and nothing is stored', async () => {
    const app = createApp(depsWithKey(true));
    const res = await request(app).get('/api/settings');
    expect(res.body).toEqual({
      artwork: { provider: 'fanart', fanartConfigured: true, preference: PREF },
      language: { audio: 'en' },
    });
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
    expect(res.body).toEqual({
      artwork: { provider: 'fanart', fanartConfigured: true, preference: PREF },
      language: { audio: 'en' },
    });
    expect(stored).toEqual({ provider: 'fanart' });
  });

  it('persists a per-provider artwork size preference', async () => {
    const state: Record<string, unknown> = {};
    const deps = depsWithKey(true);
    deps.settings = {
      get: async (key: string) => state[key] ?? null,
      set: async (key, value) => {
        state[key] = value;
      },
    };
    const app = createApp(deps);
    const res = await request(app)
      .put('/api/settings')
      .send({ artwork: { preference: { tmdb: 'poster', fanart: 'background' } } });
    expect(res.status).toBe(200);
    expect(res.body.artwork.preference).toEqual({ tmdb: 'poster', fanart: 'background' });
    expect(state.artworkPreference).toEqual({ tmdb: 'poster', fanart: 'background' });
  });

  it('rejects invalid artwork size preferences', async () => {
    const deps = depsWithKey(true);
    deps.settings = {
      get: async () => null,
      set: async () => {},
    };
    const app = createApp(deps);
    const res = await request(app)
      .put('/api/settings')
      .send({ artwork: { preference: { fanart: 'backdrop' } } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('fanart');
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

  it('persists a Portuguese audio preference', async () => {
    const state: Record<string, unknown> = {};
    const deps = depsWithKey(false);
    deps.settings = {
      get: async (key: string) => state[key] ?? null,
      set: async (key, value) => {
        state[key] = value;
      },
    };
    const app = createApp(deps);
    const res = await request(app).put('/api/settings').send({ language: { audio: 'pt' } });
    expect(res.status).toBe(200);
    expect(res.body.language).toEqual({ audio: 'pt' });
    expect(state.audioLanguage).toEqual({ audio: 'pt' });
  });

  it('reads the stored Portuguese preference back on GET', async () => {
    const deps = depsWithKey(false);
    deps.settings = {
      get: async (key: string) => (key === 'audioLanguage' ? { audio: 'pt' } : null),
      set: async () => {},
    };
    const app = createApp(deps);
    const res = await request(app).get('/api/settings');
    expect(res.body.language).toEqual({ audio: 'pt' });
  });

  it('rejects unknown audio codes', async () => {
    const app = createApp(depsWithKey(false));
    const res = await request(app).put('/api/settings').send({ language: { audio: 'pt-BR' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('language.audio');
  });
});
