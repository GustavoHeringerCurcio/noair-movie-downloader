import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { makeTestDeps } from '../../test/helpers.js';
import type { ArtFilesRepository, ArtFileRow } from '../db/artFilesRepo.js';
import type { MediaDetail, MediaItem } from '../types.js';

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

function posterRow(overrides: Partial<ArtFileRow> = {}): ArtFileRow {
  return {
    mediaType: 'movie',
    tmdbId: 550,
    kind: 'poster',
    originUrl: 'https://m.media-amazon.com/images/M/p.jpg',
    filePath: 'movie_550_poster.jpg',
    status: 'ok',
    fetchedAt: new Date().toISOString(),
    imdbRating: 8.3,
    ...overrides,
  };
}

function repoWith(rows: ArtFileRow[]): ArtFilesRepository {
  return {
    async getMany(subjects) {
      return subjects
        .flatMap((s) => rows.filter((r) => r.mediaType === s.mediaType && r.tmdbId === s.tmdbId))
        .filter((row): row is ArtFileRow => row != null);
    },
    async upsertMany() {},
    async listPosterRowsMissingRating() {
      return [];
    },
    async updateImdbRatings() {},
  };
}

function baseDeps(overrides: { artFiles?: ArtFilesRepository | null } = {}) {
  const base = makeTestDeps();
  return makeTestDeps({
    tmdb: {
      ...base.tmdb,
      details: async (_id, type) => (type === 'movie' ? movieDetail() : tvDetail()),
      videos: async () => [],
      certification: async () => null,
    },
    artFiles: overrides.artFiles,
  });
}

describe('T-004 GET /api/media/:id (S2) carries imdbRating from art_files', () => {
  it('returns the cached IMDb score on the movie detail payload', async () => {
    const deps = baseDeps({ artFiles: repoWith([posterRow()]) });
    const res = await request(createApp(deps)).get('/api/media/550?type=movie');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Fight Club');
    expect(res.body.imdbRating).toBe(8.3);
  });

  it('returns the cached IMDb score on the tv detail payload', async () => {
    const deps = baseDeps({
      artFiles: repoWith([posterRow({ mediaType: 'tv', tmdbId: 100, filePath: 'tv_100_poster.jpg' })]),
    });
    const res = await request(createApp(deps)).get('/api/media/100?type=tv');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Fallout');
    expect(res.body.imdbRating).toBe(8.3);
    expect(res.body.seasons).toHaveLength(2);
  });

  it('defaults to imdbRating null when no art_files are wired', async () => {
    const deps = baseDeps({});
    const res = await request(createApp(deps)).get('/api/media/550?type=movie');
    expect(res.status).toBe(200);
    expect(res.body.imdbRating).toBeNull();
  });

  it('keeps the detail working (imdbRating null) when the art_files read fails', async () => {
    const failing = repoWith([posterRow()]);
    failing.getMany = async () => {
      throw new Error('db down');
    };
    const deps = baseDeps({ artFiles: failing });
    const res = await request(createApp(deps)).get('/api/media/550?type=movie');
    expect(res.status).toBe(200);
    expect(res.body.imdbRating).toBeNull();
  });
});

describe('T-004 on-demand reads never hit OMDb', () => {
  it('detail and hover of a cached row perform zero OMDb requests', async () => {
    const base = makeTestDeps();
    const fetchPoster = vi.fn(async () => {
      throw new Error('OMDb must not be called for an on-demand read');
    });
    const deps = makeTestDeps({
      tmdb: {
        ...base.tmdb,
        details: async (_id, type) => (type === 'movie' ? movieDetail() : tvDetail()),
        videos: async () => [],
        certification: async () => null,
      },
      omdb: {
        fetchPoster,
        isBudgetExhausted: () => false,
      },
      artFiles: repoWith([posterRow()]),
    });
    const app = createApp(deps);

    const detail = await request(app).get('/api/media/550?type=movie');
    expect(detail.status).toBe(200);
    expect(detail.body.imdbRating).toBe(8.3);

    const hover = await request(app).get('/api/media/550/hover?type=movie');
    expect(hover.status).toBe(200);
    expect(hover.body.imdbRating).toBe(8.3);

    expect(fetchPoster).not.toHaveBeenCalled();
  });
});

function mediaItem(tmdbId: number, mediaType: 'movie' | 'tv', title: string): MediaItem {
  return {
    tmdbId,
    mediaType,
    title,
    year: null,
    posterPath: null,
    backdropPath: null,
    overview: '',
    voteAverage: 0,
  };
}

describe('List payloads carry the cached IMDb rating (poster-badge feed)', () => {
  it('GET /api/browse attaches each stored rating in one read', async () => {
    const base = makeTestDeps();
    const deps = makeTestDeps({
      tmdb: {
        ...base.tmdb,
        browse: async () => [mediaItem(550, 'movie', 'Fight Club'), mediaItem(100, 'tv', 'Fallout')],
      },
      artFiles: repoWith([
        posterRow(),
        posterRow({ mediaType: 'tv', tmdbId: 100, filePath: 'tv_100_poster.jpg' }),
      ]),
    });
    const res = await request(createApp(deps)).get('/api/browse?section=trending-week');
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ tmdbId: 550, imdbRating: 8.3 });
    expect(res.body.items[1]).toMatchObject({ tmdbId: 100, imdbRating: 8.3 });
  });

  it('GET /api/browse maps an item with no stored row to imdbRating null', async () => {
    const base = makeTestDeps();
    const deps = makeTestDeps({
      tmdb: {
        ...base.tmdb,
        browse: async () => [mediaItem(550, 'movie', 'Fight Club'), mediaItem(603, 'movie', 'The Matrix')],
      },
      artFiles: repoWith([posterRow()]),
    });
    const res = await request(createApp(deps)).get('/api/browse?section=best-movies');
    expect(res.status).toBe(200);
    expect(res.body.items[0].imdbRating).toBe(8.3);
    expect(res.body.items[1].imdbRating).toBeNull();
  });

  it('GET /api/search attaches the cached rating to every result', async () => {
    const base = makeTestDeps();
    const deps = makeTestDeps({
      tmdb: {
        ...base.tmdb,
        searchMulti: async () => [mediaItem(550, 'movie', 'Fight Club')],
      },
      artFiles: repoWith([posterRow()]),
    });
    const res = await request(createApp(deps)).get('/api/search?q=fight+club&type=all');
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ tmdbId: 550, imdbRating: 8.3 });
  });

  it('listings keep working when no art_files are wired (all ratings null)', async () => {
    const base = makeTestDeps();
    const deps = makeTestDeps({
      tmdb: { ...base.tmdb, browse: async () => [mediaItem(550, 'movie', 'Fight Club')] },
    });
    const res = await request(createApp(deps)).get('/api/browse?section=best-movies');
    expect(res.status).toBe(200);
    expect(res.body.items[0].imdbRating).toBeNull();
  });

  it('a ratings read failure never breaks the listing (degrade to null)', async () => {
    const base = makeTestDeps();
    const failing = repoWith([posterRow()]);
    failing.getMany = async () => {
      throw new Error('db down');
    };
    const deps = makeTestDeps({
      tmdb: { ...base.tmdb, browse: async () => [mediaItem(550, 'movie', 'Fight Club')] },
      artFiles: failing,
    });
    const res = await request(createApp(deps)).get('/api/browse?section=best-movies');
    expect(res.status).toBe(200);
    expect(res.body.items[0].imdbRating).toBeNull();
  });
});
