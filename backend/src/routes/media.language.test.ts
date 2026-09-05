import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { makeTestDeps } from '../../test/helpers.js';
import type { AppDeps } from '../deps.js';
import type { MediaDetail, Source } from '../types.js';

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

function mk(title: string, cleanTitle: string, overrides: Partial<Source> = {}): Source {
  return {
    indexerId: 1,
    indexer: 'YTS',
    title,
    sizeBytes: 0,
    seeders: 10,
    leechers: 0,
    infoHash: title + '-'.repeat(40),
    magnetUri: 'magnet:?xt=urn:btih:' + title,
    ageHours: null,
    resolution: '1080p',
    source: 'WEB-DL',
    codec: 'x264',
    hdr: false,
    isDolbyVision: false,
    group: null,
    cleanTitle,
    audioCodec: null,
    ...overrides,
  };
}

function baseDeps(overrides: Partial<AppDeps>): AppDeps {
  return makeTestDeps({
    tmdb: {
      ...makeTestDeps().tmdb,
      details: async () => DETAIL,
    },
    prowlarr: {
      search: async () => [],
    },
    settings: {
      get: async (key: string) => (key === 'audioLanguage' ? { audio: 'pt' } : null),
      set: async () => {},
    },
    ...overrides,
  });
}

describe('GET /api/media/:id/sources (language)', () => {
  it('default (English) returns every source without strict filtering', async () => {
    const deps = baseDeps({
      settings: { get: async () => null, set: async () => {} },
      prowlarr: {
        search: async () => [
          mk('Inception.2010.1080p', 'inception'),
          mk('Inception.2010.1080p.DUBLADO', 'inception', { audioLang: 'pt' }),
        ],
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/media/27205/sources?type=movie');
    expect(res.status).toBe(200);
    expect(res.body.sources).toHaveLength(2);
    expect(res.body.noMatchForAudio).toBeUndefined();
  });

  it('strict pt keeps only Portuguese-audio releases from the main search', async () => {
    let searchCalls = 0;
    const deps = baseDeps({
      prowlarr: {
        search: async () => {
          searchCalls += 1;
          return [
            mk('Inception.2010.1080p.WEB-DL', 'inception'),
            mk('Inception.2010.1080p.DUBLADO.WEB-DL', 'inception', { audioLang: 'pt' }),
            mk('Inception.2010.DUAL.1080p', 'inception', { audioMode: 'dual' }),
          ];
        },
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/media/27205/sources?type=movie');
    expect(res.status).toBe(200);
    expect(res.body.noMatchForAudio).toBeUndefined();
    expect(res.body.sources).toHaveLength(2);
    expect(res.body.sources[0].audioLang).toBe('pt');
    expect(searchCalls).toBe(1);
  });

  it('reports noMatchForAudio when nothing Portuguese is found and no PT indexers exist', async () => {
    const deps = baseDeps({
      prowlarr: {
        search: async () => [mk('Inception.2010.1080p', 'inception')],
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/media/27205/sources?type=movie');
    expect(res.status).toBe(200);
    expect(res.body.sources).toEqual([]);
    expect(res.body.noMatchForAudio).toBe('pt');
  });

  it('retries with the localized title only on matching (pt) indexers when strict is empty', async () => {
    const detailLangs: string[] = [];
    const searchCalls: Array<{ q: string; opts?: { indexerIds?: number[] } }> = [];
    const deps = baseDeps({
      tmdb: {
        ...makeTestDeps().tmdb,
        details: async (_id: number, _type: string, lang = 'en-US') => {
          detailLangs.push(lang);
          return lang === 'pt-BR' ? { ...DETAIL, title: 'A Origem' } : DETAIL;
        },
      },
      prowlarr: {
        search: async (q: string, _cat: number, opts?: { indexerIds?: number[] }) => {
          searchCalls.push({ q, opts });
          return searchCalls.length === 1
            ? []
            : [mk('A.Origem.2010.1080p.DUBLADO', 'a origem', { audioLang: 'pt', indexerId: 5 })];
        },
      },
      prowlarrAdmin: {
        ensureIndexers: async () => ({ created: [], enabled: [], skipped: [], failed: [] }),
        listIndexers: async () => [
          { id: 5, name: 'CapybaraBR', language: 'pt-BR' },
          { id: 1, name: '1337x', language: 'en-US' },
        ],
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/media/27205/sources?type=movie');
    expect(res.status).toBe(200);
    expect(res.body.sources).toHaveLength(1);
    expect(res.body.sources[0].indexerId).toBe(5);
    expect(res.body.noMatchForAudio).toBeUndefined();
    expect(detailLangs).toEqual(['en-US', 'pt-BR']);
    expect(searchCalls[1]).toEqual({ q: 'A Origem 2010', opts: { indexerIds: [5] } });
  });

  it('audio=en override opts the stored preference out (consented English fallback)', async () => {
    const deps = baseDeps({
      prowlarr: {
        search: async () => [mk('Inception.2010.1080p', 'inception')],
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/media/27205/sources?type=movie&audio=en');
    expect(res.status).toBe(200);
    expect(res.body.sources).toHaveLength(1);
    expect(res.body.noMatchForAudio).toBeUndefined();
  });

  it('tags and keeps an untagged release from a pt-BR indexer as a Portuguese match', async () => {
    let searchCalls = 0;
    const deps = baseDeps({
      prowlarr: {
        search: async () => {
          searchCalls += 1;
          return [mk('Inception.2010.1080p.WEB-DL', 'inception', { indexerId: 5 })];
        },
      },
      prowlarrAdmin: {
        ensureIndexers: async () => ({ created: [], enabled: [], skipped: [], failed: [] }),
        listIndexers: async () => [
          { id: 5, name: 'CapybaraBR', language: 'pt-BR' },
          { id: 1, name: '1337x', language: 'en-US' },
        ],
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/media/27205/sources?type=movie');
    expect(res.status).toBe(200);
    expect(res.body.sources).toHaveLength(1);
    expect(res.body.sources[0].audioLang).toBe('pt');
    expect(res.body.noMatchForAudio).toBeUndefined();
    expect(searchCalls).toBe(1);
  });

  it('does not auto-match original-audio releases from a pt-PT indexer', async () => {
    let searchCalls = 0;
    const deps = baseDeps({
      prowlarr: {
        search: async () => {
          searchCalls += 1;
          return searchCalls === 1
            ? [mk('Inception.2010.1080p.WEB-DL', 'inception', { indexerId: 6 })]
            : [];
        },
      },
      prowlarrAdmin: {
        ensureIndexers: async () => ({ created: [], enabled: [], skipped: [], failed: [] }),
        listIndexers: async () => [{ id: 6, name: 'SceneRush', language: 'pt-PT' }],
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/media/27205/sources?type=movie');
    expect(res.status).toBe(200);
    expect(res.body.sources).toEqual([]);
    expect(res.body.noMatchForAudio).toBe('pt');
  });

  it('returns a plain empty result (no language banner) when nothing was found at all', async () => {
    let searchCalls = 0;
    const deps = baseDeps({
      prowlarr: {
        search: async () => {
          searchCalls += 1;
          return [];
        },
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/media/27205/sources?type=movie');
    expect(res.status).toBe(200);
    expect(res.body.sources).toEqual([]);
    expect(res.body.noMatchForAudio).toBeUndefined();
    expect(searchCalls).toBe(1);
  });
});
