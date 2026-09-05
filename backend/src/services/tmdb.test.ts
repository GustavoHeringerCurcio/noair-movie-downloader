import { describe, expect, it } from 'vitest';
import { createTmdbClient } from './tmdb.js';
import { UpstreamError } from '../types.js';
import { createResponse, makeFetch } from '../../test/helpers.js';

const CONFIG = { baseUrl: 'https://api.themoviedb.org/3', apiKey: 'k' };

describe('TmdbClient.searchMulti', () => {
  it('normalizes results and filters by type', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/search/multi'),
        respond: () =>
          createResponse(200, {
            results: [
              {
                id: 27205,
                media_type: 'movie',
                title: 'Inception',
                release_date: '2010-07-16',
                poster_path: '/qL9BmNyBAtPX5N9dXmY1Qa4fPv.jpg',
                overview: 'A thief who steals corporate secrets.',
                vote_average: 8.4,
              },
              { id: 99, media_type: 'person', name: 'Some Person' },
              { id: 1418, media_type: 'tv', name: 'The Big Bang Theory', first_air_date: '2007-09-24' },
            ],
          }),
      },
    ]);
    const client = createTmdbClient({ ...CONFIG, fetchImpl });
    const items = await client.searchMulti('inception', 'movie');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      tmdbId: 27205,
      mediaType: 'movie',
      title: 'Inception',
      year: 2010,
      posterPath: '/qL9BmNyBAtPX5N9dXmY1Qa4fPv.jpg',
      overview: 'A thief who steals corporate secrets.',
      voteAverage: 8.4,
    });
  });

  it('throws UpstreamError on non-2xx', async () => {
    const fetchImpl = makeFetch([{ match: () => true, respond: () => createResponse(500, {}) }]);
    const client = createTmdbClient({ ...CONFIG, fetchImpl });
    await expect(client.searchMulti('inception', 'all')).rejects.toBeInstanceOf(UpstreamError);
  });

  it('throws UpstreamError on network failure', async () => {
    const fetchImpl = makeFetch([
      { match: () => true, respond: () => { throw new TypeError('network down'); } },
    ]);
    const client = createTmdbClient({ ...CONFIG, fetchImpl });
    await expect(client.searchMulti('inception', 'all')).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe('TmdbClient.browse', () => {
  it('merges movie and tv results for trending-week and dedupes by id', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/trending/movie/week'),
        respond: () =>
          createResponse(200, {
            results: [
              { id: 1, media_type: 'movie', title: 'Movie A', release_date: '2026-01-01' },
              { id: 2, media_type: 'movie', title: 'Movie B', release_date: '2026-02-01' },
            ],
          }),
      },
      {
        match: (url) => url.includes('/trending/tv/week'),
        respond: () =>
          createResponse(200, {
            results: [
              { id: 1, media_type: 'tv', name: 'Show A', first_air_date: '2026-01-01' },
              { id: 3, media_type: 'tv', name: 'Show B', first_air_date: '2026-03-01' },
            ],
          }),
      },
    ]);
    const client = createTmdbClient({ ...CONFIG, fetchImpl });
    const items = await client.browse('trending-week');
    expect(items.map((i) => i.tmdbId)).toEqual([1, 2, 3]);
    expect(items[0]).toMatchObject({ tmdbId: 1, mediaType: 'movie', title: 'Movie A', year: 2026 });
    expect(items[1]).toMatchObject({ tmdbId: 2, mediaType: 'movie', title: 'Movie B', year: 2026 });
    expect(items[2]).toMatchObject({ tmdbId: 3, mediaType: 'tv', title: 'Show B', year: 2026 });
  });

  it('infers media type when results omit it', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/movie/popular'),
        respond: () =>
          createResponse(200, {
            results: [{ id: 10, title: 'Only Movie', release_date: '2020-05-05' }],
          }),
      },
    ]);
    const client = createTmdbClient({ ...CONFIG, fetchImpl });
    const items = await client.browse('popular-movies');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ tmdbId: 10, mediaType: 'movie', title: 'Only Movie', year: 2020 });
  });

  it('fetches all-time best movies via discover sorted by vote desc', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) =>
          url.includes('/discover/movie') &&
          url.includes('sort_by=vote_average.desc') &&
          url.includes('vote_count.gte=2000'),
        respond: () =>
          createResponse(200, {
            results: [
              { id: 12, media_type: 'movie', title: 'Best Movie', release_date: '1994-01-01', poster_path: null },
            ],
          }),
      },
    ]);
    const client = createTmdbClient({ ...CONFIG, fetchImpl });
    const items = await client.browse('best-movies');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ tmdbId: 12, mediaType: 'movie', title: 'Best Movie', year: 1994, posterPath: null });
  });

  it('strips null poster fields for tv sections', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/tv/popular'),
        respond: () =>
          createResponse(200, {
            results: [
              { id: 5, media_type: 'tv', name: 'A', first_air_date: '2026-01-01', poster_path: null },
            ],
          }),
      },
    ]);
    const client = createTmdbClient({ ...CONFIG, fetchImpl });
    const items = await client.browse('popular-tv');
    expect(items[0]).toMatchObject({ tmdbId: 5, mediaType: 'tv', posterPath: null });
  });

  it('fetches all-time best tv via discover sorted by vote desc', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) =>
          url.includes('/discover/tv') &&
          url.includes('sort_by=vote_average.desc') &&
          url.includes('vote_count.gte=500'),
        respond: () =>
          createResponse(200, {
            results: [
              { id: 20, media_type: 'tv', name: 'Best Show', first_air_date: '2008-01-20' },
            ],
          }),
      },
    ]);
    const client = createTmdbClient({ ...CONFIG, fetchImpl });
    const items = await client.browse('best-tv');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ tmdbId: 20, mediaType: 'tv', title: 'Best Show', year: 2008 });
  });

  it('throws UpstreamError when one of the calls fails', async () => {
    const fetchImpl = makeFetch([
      { match: () => true, respond: () => createResponse(502, {}) },
    ]);
    const client = createTmdbClient({ ...CONFIG, fetchImpl });
    await expect(client.browse('trending-week')).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe('TmdbClient.details', () => {
  it('normalizes a movie detail', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/movie/27205'),
        respond: () =>
          createResponse(200, {
            id: 27205,
            title: 'Inception',
            release_date: '2010-07-16',
            overview: 'o',
            poster_path: '/p.jpg',
            backdrop_path: '/b.jpg',
            vote_average: 8.4,
            runtime: 148,
            genres: [{ name: 'Sci-Fi' }, { name: 'Action' }],
          }),
      },
    ]);
    const client = createTmdbClient({ ...CONFIG, fetchImpl });
    const detail = await client.details(27205, 'movie');
    expect(detail).toMatchObject({
      tmdbId: 27205,
      mediaType: 'movie',
      title: 'Inception',
      year: 2010,
      genres: ['Sci-Fi', 'Action'],
      runtime: 148,
    });
  });
});
