import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { makeDownloadRecord, makeTestDeps, createMemoryArtRepo } from '../../test/helpers.js';
import { createArtService } from '../lib/artService.js';
import { createFanartGateway } from '../lib/fanartGateway.js';
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
  it('GET /api/browse returns items for a known section', async () => {
    const deps = makeTestDeps({
      tmdb: {
        ...makeTestDeps().tmdb,
        browse: async () => [{ ...DETAIL, overview: '' }],
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/browse?section=trending-week');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].tmdbId).toBe(27205);
  });

  it('GET /api/browse returns 400 for an unknown section', async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).get('/api/browse?section=bogus');
    expect(res.status).toBe(400);
  });

  it('GET /api/browse returns 400 when section is missing', async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).get('/api/browse');
    expect(res.status).toBe(400);
  });

  it('GET /api/browse maps an UpstreamError to 502', async () => {
    const deps = makeTestDeps({
      tmdb: {
        ...makeTestDeps().tmdb,
        browse: async () => {
          throw new UpstreamError(502, 'TMDB unreachable');
        },
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/browse?section=best-movies');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('TMDB unreachable');
  });

  it('GET /api/media/:id/sources filters out releases for a different year of the same title', async () => {
    const source = (title: string) => ({
      indexerId: 1,
      indexer: 'YTS',
      title,
      sizeBytes: 0,
      seeders: 0,
      leechers: 0,
      infoHash: 'b'.repeat(40),
      magnetUri: 'magnet:?xt=urn:btih:' + 'b'.repeat(40),
      ageHours: null,
      resolution: '1080p',
      source: 'WEB-DL',
      codec: 'x264',
      hdr: false,
      isDolbyVision: false,
      group: null,
      cleanTitle: 'the odyssey',
      audioCodec: null,
    });
    const deps = makeTestDeps({
      tmdb: {
        ...makeTestDeps().tmdb,
        details: async () => ({ ...DETAIL, title: 'The Odyssey', year: 2026 }),
      },
      prowlarr: {
        search: async () => [
          source('The.Odyssey.2026.1080p.WEB-DL'),
          source('The.Odyssey.1969.720p'),
          source('The.Odyssey.2026.REMUX.2160p'),
        ],
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/media/27205/sources?type=movie');
    expect(res.status).toBe(200);
    const titles = res.body.sources.map((s: { title: string }) => s.title);
    expect(titles).toEqual(['The.Odyssey.2026.1080p.WEB-DL', 'The.Odyssey.2026.REMUX.2160p']);
  });

  it('GET /api/media/:id/sources returns unreachable:true when Prowlarr is down', async () => {    const deps = makeTestDeps({
      tmdb: {
        ...makeTestDeps().tmdb,
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
        ...makeTestDeps().tmdb,
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

  it('GET /api/downloads attaches cached Fanart art to rows in Fanart mode only', async () => {
    const record = makeDownloadRecord({ infoHash: HASH });
    const fanart = {
      getMovieArt: async () => ({ status: 'empty' as const, thumbUrl: null, logoUrl: null }),
      getTvArt: async () => ({ status: 'empty' as const, thumbUrl: null, logoUrl: null }),
    };
    const list = async () => [record];
    const seededArt = createArtService({
      repo: createMemoryArtRepo([
        {
          mediaType: 'movie',
          tmdbId: 1,
          tvdbId: null,
          thumbUrl: 'https://fanart.tv/t.jpg',
          logoUrl: 'https://fanart.tv/l.png',
          status: 'ok',
          fetchedAt: new Date().toISOString(),
        },
      ]),
      gateway: createFanartGateway({ fanart, minGapMs: 0 }),
    });

    const fanartApp = createApp(
      makeTestDeps({
        fanart,
        art: seededArt,
        downloads: { ...makeTestDeps().downloads, list },
        settings: { get: async () => ({ provider: 'fanart' }), set: async () => {} },
      }),
    );
    const fanartRes = await request(fanartApp).get('/api/downloads');
    expect(fanartRes.status).toBe(200);
    expect(fanartRes.body.downloads[0].art).toEqual({
      thumbUrl: 'https://fanart.tv/t.jpg',
      backgroundUrl: null,
      posterUrl: null,
      logoUrl: 'https://fanart.tv/l.png',
    });

    const tmdbApp = createApp(
      makeTestDeps({
        fanart,
        downloads: { ...makeTestDeps().downloads, list },
        settings: { get: async () => ({ provider: 'tmdb' }), set: async () => {} },
      }),
    );
    const tmdbRes = await request(tmdbApp).get('/api/downloads');
    expect(tmdbRes.status).toBe(200);
    expect(tmdbRes.body.downloads[0].art).toBeUndefined();
  });

  it('POST /api/downloads persists season/episode and backdrop', async () => {
    let captured: unknown = null;
    const deps = makeTestDeps({
      downloads: {
        ...makeTestDeps().downloads,
        insert: async (input) => {
          captured = input;
          return makeDownloadRecord({
            infoHash: input.infoHash,
            backdropPath: input.backdropPath ?? null,
            seasonNumber: input.seasonNumber ?? null,
            episodeNumber: input.episodeNumber ?? null,
          });
        },
      },
    });
    const app = createApp(deps);
    const res = await request(app).post('/api/downloads').send({
      tmdbId: 94997,
      mediaType: 'tv',
      title: 'Fallout',
      year: 2024,
      posterPath: '/p.jpg',
      backdropPath: '/b.jpg',
      seasonNumber: 1,
      episodeNumber: 3,
      infoHash: HASH,
      magnetUri: 'magnet:?xt=urn:btih:' + HASH,
      torrentName: 'Fallout.S01E03.1080p.WEB-DL',
      indexer: 'x',
    });
    expect(res.status).toBe(201);
    expect(captured).toMatchObject({ backdropPath: '/b.jpg', seasonNumber: 1, episodeNumber: 3 });
    expect(res.body).toMatchObject({ backdropPath: '/b.jpg', seasonNumber: 1, episodeNumber: 3 });
  });
});

const TV_DETAIL: MediaDetail = {
  tmdbId: 94997,
  mediaType: 'tv',
  title: 'Fallout',
  year: 2024,
  overview: 'o',
  posterPath: '/p.jpg',
  backdropPath: '/b.jpg',
  voteAverage: 8.3,
  genres: ['Sci-Fi'],
  runtime: 49,
  seasons: [
    { seasonNumber: 1, name: 'Season 1', episodeCount: 8 },
    { seasonNumber: 2, name: 'Season 2', episodeCount: 8 },
  ],
};

function tvSource(title: string, coverage: unknown) {
  return {
    indexerId: 1,
    indexer: 'YTS',
    title,
    sizeBytes: 0,
    seeders: 0,
    leechers: 0,
    infoHash: Buffer.from(title).toString('hex').slice(0, 40) || 'a'.repeat(40),
    magnetUri: 'magnet:?xt=urn:btih:' + 'a'.repeat(40),
    ageHours: null,
    resolution: '1080p',
    source: 'WEB-DL',
    codec: 'x264',
    hdr: false,
    isDolbyVision: false,
    group: null,
    cleanTitle: 'fallout',
    audioCodec: null,
    coverage,
  };
}

describe('TV contextual sources (S3 params + gating)', () => {
  it('queries "<title> S01" for a season and gates out other seasons', async () => {
    const queries: string[] = [];
    const deps = makeTestDeps({
      tmdb: { ...makeTestDeps().tmdb, details: async () => TV_DETAIL },
      prowlarr: {
        search: async (query: string) => {
          queries.push(query);
          return [
            tvSource('Fallout.S02.COMPLETE.1080p.WEB-DL', [{ season: 2, episodes: null }]),
            tvSource('Fallout.S01.COMPLETE.1080p.WEB-DL', [{ season: 1, episodes: null }]),
            tvSource('Fallout.S01E01.1080p.WEB-DL', [{ season: 1, episodes: [1, 1] }]),
            tvSource('Fallout.1080p.WEB-DL.UNKNOWN', null),
          ];
        },
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/media/94997/sources?type=tv&season=1');
    expect(res.status).toBe(200);
    expect(queries).toEqual(['Fallout S01']);
    const titles = res.body.sources.map((s: { title: string }) => s.title);
    expect(titles).toEqual([
      'Fallout.S01.COMPLETE.1080p.WEB-DL',
      'Fallout.S01E01.1080p.WEB-DL',
      'Fallout.1080p.WEB-DL.UNKNOWN',
    ]);
  });

  it('scopes an episode search to releases covering that episode', async () => {
    const queries: string[] = [];
    const deps = makeTestDeps({
      tmdb: { ...makeTestDeps().tmdb, details: async () => TV_DETAIL },
      prowlarr: {
        search: async (query: string) => {
          queries.push(query);
          return [
            tvSource('Fallout.S01E03.1080p.WEB-DL', [{ season: 1, episodes: [3, 3] }]),
            tvSource('Fallout.S01.COMPLETE.1080p.WEB-DL', [{ season: 1, episodes: null }]),
            tvSource('Fallout.S01E01-E05.1080p.WEB-DL', [{ season: 1, episodes: [1, 5] }]),
            tvSource('Fallout.S01E02.1080p.WEB-DL', [{ season: 1, episodes: [2, 2] }]),
            tvSource('Fallout.1080p.WEB-DL.UNKNOWN', null),
          ];
        },
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/media/94997/sources?type=tv&season=1&episode=3');
    expect(res.status).toBe(200);
    expect(queries).toEqual(['Fallout S01E03']);
    const titles = res.body.sources.map((s: { title: string }) => s.title);
    expect(titles).toEqual([
      'Fallout.S01E03.1080p.WEB-DL',
      'Fallout.S01.COMPLETE.1080p.WEB-DL',
      'Fallout.S01E01-E05.1080p.WEB-DL',
      'Fallout.1080p.WEB-DL.UNKNOWN',
    ]);
  });

  it('expands a whole-series pack into each aired season under a season scope', async () => {
    const deps = makeTestDeps({
      tmdb: { ...makeTestDeps().tmdb, details: async () => TV_DETAIL },
      prowlarr: {
        search: async () => [tvSource('Fallout.The.Complete.Series.1080p.WEB-DL', null)],
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/media/94997/sources?type=tv&season=1');
    expect(res.status).toBe(200);
    expect(res.body.sources).toHaveLength(1);
    expect(res.body.sources[0].coverage).toEqual([
      { season: 1, episodes: null },
      { season: 2, episodes: null },
    ]);
  });

  it('rejects season on a movie and episode without a season', async () => {
    const app = createApp(makeTestDeps());
    expect((await request(app).get('/api/media/27205/sources?type=movie&season=1')).status).toBe(400);
    expect((await request(app).get('/api/media/94997/sources?type=tv&episode=1')).status).toBe(400);
  });
});

describe('S12 GET /api/media/:id/season/:n', () => {
  it('returns the season summary and its episodes', async () => {
    const deps = makeTestDeps({
      tmdb: {
        ...makeTestDeps().tmdb,
        details: async () => TV_DETAIL,
        seasonEpisodes: async () => [
          { seasonNumber: 1, episodeNumber: 1, name: 'The End', overview: 'o', stillPath: '/s.jpg', runtime: 52, airDate: '2024-04-10' },
        ],
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/media/94997/season/1?type=tv');
    expect(res.status).toBe(200);
    expect(res.body.season).toEqual({ seasonNumber: 1, name: 'Season 1', episodeCount: 8 });
    expect(res.body.episodes).toHaveLength(1);
    expect(res.body.episodes[0].name).toBe('The End');
  });

  it('404s when the season does not exist', async () => {
    const deps = makeTestDeps({
      tmdb: { ...makeTestDeps().tmdb, details: async () => TV_DETAIL },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/media/94997/season/9?type=tv');
    expect(res.status).toBe(404);
  });

  it('400s without type=tv', async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).get('/api/media/94997/season/1');
    expect(res.status).toBe(400);
  });
});

describe('Fanart enrichment on detail', () => {
  it('returns art on GET /api/media/:id when a fanart client is configured', async () => {
    const deps = makeTestDeps({
      tmdb: { ...makeTestDeps().tmdb, details: async () => DETAIL },
      fanart: {
        getMovieArt: async () => ({ status: 'ok' as const, thumbUrl: 'https://fanart.tv/t.jpg', logoUrl: 'https://fanart.tv/l.png' }),
        getTvArt: async () => ({ status: 'empty' as const, thumbUrl: null, logoUrl: null }),
      },
    });
    const app = createApp(deps);
    const res = await request(app).get('/api/media/27205?type=movie');
    expect(res.status).toBe(200);
    expect(res.body.art).toEqual({
      thumbUrl: 'https://fanart.tv/t.jpg',
      backgroundUrl: null,
      posterUrl: null,
      logoUrl: 'https://fanart.tv/l.png',
    });
  });
});
