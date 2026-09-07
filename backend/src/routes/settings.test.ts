import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { makeTestDeps } from '../../test/helpers.js';

function depsWithMemorySettings(): { deps: ReturnType<typeof makeTestDeps>; state: Record<string, unknown> } {
  const state: Record<string, unknown> = {};
  const deps = makeTestDeps({
    settings: {
      get: async (key: string) => state[key] ?? null,
      set: async (key: string, value: unknown) => {
        state[key] = value;
      },
    },
  });
  return { deps, state };
}

describe('GET /api/settings', () => {
  it('returns the default audio + quality preferences when nothing is stored', async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ language: { audio: 'en' }, quality: { maxResolution: '1080p' } });
  });
});

describe('PUT /api/settings', () => {
  it('persists a Portuguese audio preference', async () => {
    const { deps, state } = depsWithMemorySettings();
    const app = createApp(deps);
    const res = await request(app).put('/api/settings').send({ language: { audio: 'pt' } });
    expect(res.status).toBe(200);
    expect(res.body.language).toEqual({ audio: 'pt' });
    expect(res.body.quality.maxResolution).toBe('1080p');
    expect(state.audioLanguage).toEqual({ audio: 'pt' });
  });

  it('persists a 720p quality ceiling', async () => {
    const { deps, state } = depsWithMemorySettings();
    const app = createApp(deps);
    const res = await request(app).put('/api/settings').send({ quality: { maxResolution: '720p' } });
    expect(res.status).toBe(200);
    expect(res.body.quality).toEqual({ maxResolution: '720p' });
    expect(res.body.language).toEqual({ audio: 'en' });
    expect(state.maxResolution).toEqual({ maxResolution: '720p' });
  });

  it('rejects an invalid quality ceiling', async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).put('/api/settings').send({ quality: { maxResolution: '4k' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('quality.maxResolution');
  });

  it('reads the stored Portuguese preference back on GET', async () => {
    const deps = makeTestDeps({
      settings: {
        get: async (key: string) => (key === 'audioLanguage' ? { audio: 'pt' } : null),
        set: async () => {},
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/settings');
    expect(res.body.language).toEqual({ audio: 'pt' });
  });

  it('reads the stored 720p quality ceiling back on GET', async () => {
    const deps = makeTestDeps({
      settings: {
        get: async (key: string) => (key === 'maxResolution' ? { maxResolution: '720p' } : null),
        set: async () => {},
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/settings');
    expect(res.body.quality).toEqual({ maxResolution: '720p' });
  });

  it('rejects unknown audio codes', async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).put('/api/settings').send({ language: { audio: 'pt-BR' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('language.audio');
  });

  it('400s with a legacy artwork payload (D17 controls were removed)', async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).put('/api/settings').send({ artwork: { provider: 'fanart', style: 'poster' } });
    expect(res.status).toBe(400);
  });
});
