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
    expect(detail.seasons).toBeUndefined();
  });

  it('maps a tv detail seasons, dropping season 0 and empty seasons', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/tv/100'),
        respond: () =>
          createResponse(200, {
            id: 100,
            name: 'Fallout',
            first_air_date: '2024-04-10',
            overview: 'o',
            vote_average: 8.3,
            episode_run_time: [49],
            seasons: [
              { season_number: 0, name: 'Specials', episode_count: 5 },
              { season_number: 1, name: 'Season 1', episode_count: 8 },
              { season_number: 2, name: 'Season 2', episode_count: 0 },
              { season_number: 2, name: 'Season 2', episode_count: 8 },
            ],
          }),
      },
    ]);
    const client = createTmdbClient({ ...CONFIG, fetchImpl });
    const detail = await client.details(100, 'tv');
    expect(detail.seasons).toEqual([
      { seasonNumber: 1, name: 'Season 1', episodeCount: 8 },
      { seasonNumber: 2, name: 'Season 2', episodeCount: 8 },
    ]);
    expect(detail.runtime).toBe(49);
  });
});

describe('TmdbClient.seasonEpisodes', () => {
  it('maps episodes of a season (S12)', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/tv/100/season/1'),
        respond: () =>
          createResponse(200, {
            episodes: [
              { season_number: 1, episode_number: 1, name: 'The End', overview: 'o1', still_path: '/s1.jpg', runtime: 52, air_date: '2024-04-10' },
              { season_number: 1, episode_number: 2, name: 'The Target', overview: 'o2', still_path: '/s2.jpg', runtime: null, air_date: '2024-04-10' },
            ],
          }),
      },
    ]);
    const client = createTmdbClient({ ...CONFIG, fetchImpl });
    const episodes = await client.seasonEpisodes(100, 1);
    expect(episodes).toEqual([
      { seasonNumber: 1, episodeNumber: 1, name: 'The End', overview: 'o1', stillPath: '/s1.jpg', runtime: 52, airDate: '2024-04-10' },
      { seasonNumber: 1, episodeNumber: 2, name: 'The Target', overview: 'o2', stillPath: '/s2.jpg', runtime: null, airDate: '2024-04-10' },
    ]);
  });

  it('throws 404 for a missing season', async () => {
    const fetchImpl = makeFetch([{ match: () => true, respond: () => createResponse(404, {}) }]);
    const client = createTmdbClient({ ...CONFIG, fetchImpl });
    await expect(client.seasonEpisodes(100, 9)).rejects.toMatchObject({ status: 404 });
  });
});
