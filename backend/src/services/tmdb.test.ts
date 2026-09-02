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
