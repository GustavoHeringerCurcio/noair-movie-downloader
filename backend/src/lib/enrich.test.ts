import { describe, expect, it } from 'vitest';
import { enrichDetail, enrichItems } from './enrich.js';
import { makeTestDeps } from '../../test/helpers.js';
import type { AppDeps } from '../deps.js';
import type { MediaDetail, MediaItem } from '../types.js';

const MOVIE: MediaItem = {
  tmdbId: 550,
  mediaType: 'movie',
  title: 'Fight Club',
  year: 1999,
  posterPath: '/p.jpg',
  backdropPath: '/b.jpg',
  overview: '',
  voteAverage: 8.4,
};

const TV: MediaItem = { ...MOVIE, tmdbId: 100, mediaType: 'tv', title: 'Fallout' };

function depsWith(fanart: AppDeps['fanart']): AppDeps {
  return makeTestDeps({
    fanart,
    tmdb: { ...makeTestDeps().tmdb, tvdbId: async () => 789 },
  });
}

describe('enrichItems', () => {
  it('skips enrichment entirely when no Fanart key is configured', async () => {
    const deps = makeTestDeps({ fanart: null });
    const items = await enrichItems([MOVIE], deps);
    expect(items[0]!.art).toBeUndefined();
  });

  it('enriches movies from Fanart directly', async () => {
    const deps = depsWith({
      getMovieArt: async () => ({ thumbUrl: 'https://fanart.tv/movie.jpg', logoUrl: 'https://fanart.tv/mlogo.png' }),
      getTvArt: async () => ({ thumbUrl: null, logoUrl: null }),
    });
    const items = await enrichItems([MOVIE, TV], deps);
    expect(items[0]!.art).toEqual({ thumbUrl: 'https://fanart.tv/movie.jpg', logoUrl: 'https://fanart.tv/mlogo.png' });
    expect(items[1]!.art).toEqual({ thumbUrl: null, logoUrl: null });
  });

  it('resolves TV through TMDB tvdbId then Fanart', async () => {
    let gotTvdb: number | null = null;
    const deps = depsWith({
      getMovieArt: async () => ({ thumbUrl: null, logoUrl: null }),
      getTvArt: async (tvdbId: number) => {
        gotTvdb = tvdbId;
        return { thumbUrl: 'https://fanart.tv/tv.jpg', logoUrl: 'https://fanart.tv/tlogo.png' };
      },
    });
    const items = await enrichItems([TV], deps);
    expect(gotTvdb).toBe(789);
    expect(items[0]!.art!.thumbUrl).toBe('https://fanart.tv/tv.jpg');
  });

  it('never throws when Fanart is down', async () => {
    const deps = depsWith({
      getMovieArt: async () => {
        throw new Error('down');
      },
      getTvArt: async () => ({ thumbUrl: null, logoUrl: null }),
    });
    const items = await enrichItems([MOVIE, TV], deps);
    expect(items).toHaveLength(2);
    expect(items[0]!.art).toBeUndefined();
  });
});

describe('enrichDetail', () => {
  it('attaches art to a detail payload', async () => {
    const deps = depsWith({
      getMovieArt: async () => ({ thumbUrl: 'https://fanart.tv/t.jpg', logoUrl: 'https://fanart.tv/l.png' }),
      getTvArt: async () => ({ thumbUrl: null, logoUrl: null }),
    });
    const detail: MediaDetail = { ...MOVIE, overview: 'o', genres: [], runtime: 100 };
    const out = await enrichDetail(detail, deps);
    expect(out.art).toEqual({ thumbUrl: 'https://fanart.tv/t.jpg', logoUrl: 'https://fanart.tv/l.png' });
  });
});
