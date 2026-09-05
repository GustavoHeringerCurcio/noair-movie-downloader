import { beforeEach, describe, expect, it } from 'vitest';
import { clearArtCache, enrichDetail, enrichDownloads, enrichItems } from './enrich.js';
import { makeTestDeps, makeDownloadRecord } from '../../test/helpers.js';
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

function depsWithProvider(provider: 'tmdb' | 'fanart', fanart: AppDeps['fanart']): AppDeps {
  return makeTestDeps({
    fanart,
    tmdb: { ...makeTestDeps().tmdb, tvdbId: async () => 789 },
    settings: {
      get: async () => ({ provider }),
      set: async () => {},
    },
  });
}

beforeEach(() => {
  clearArtCache();
});

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

describe('image provider gating', () => {
  it('skips enrichment in TMDB mode even when a Fanart client is configured', async () => {
    let called = false;
    const deps = depsWithProvider('tmdb', {
      getMovieArt: async () => {
        called = true;
        return { thumbUrl: 'https://fanart.tv/x.jpg', logoUrl: null };
      },
      getTvArt: async () => ({ thumbUrl: null, logoUrl: null }),
    });
    const items = await enrichItems([MOVIE], deps);
    expect(items[0]!.art).toBeUndefined();
    expect(called).toBe(false);
  });

  it('attaches art in Fanart mode', async () => {
    const deps = depsWithProvider('fanart', {
      getMovieArt: async () => ({ thumbUrl: 'https://fanart.tv/x.jpg', logoUrl: null }),
      getTvArt: async () => ({ thumbUrl: null, logoUrl: null }),
    });
    const items = await enrichItems([MOVIE], deps);
    expect(items[0]!.art!.thumbUrl).toBe('https://fanart.tv/x.jpg');
  });

  it('falls back to Fanart by default when a key is configured', async () => {
    const deps = depsWith({
      getMovieArt: async () => ({ thumbUrl: 'https://fanart.tv/x.jpg', logoUrl: null }),
      getTvArt: async () => ({ thumbUrl: null, logoUrl: null }),
    });
    const items = await enrichItems([MOVIE], deps);
    expect(items[0]!.art!.thumbUrl).toBe('https://fanart.tv/x.jpg');
  });
});

describe('enrichDownloads', () => {
  const MOVIE_DL = makeDownloadRecord({ tmdbId: 550, mediaType: 'movie' });
  const TV_DL = makeDownloadRecord({ tmdbId: 100, mediaType: 'tv', infoHash: 'b'.repeat(40) });
  const NO_TMDB_DL = makeDownloadRecord({ tmdbId: null, mediaType: null, infoHash: 'c'.repeat(40) });

  it('attaches Fanart art to download rows in Fanart mode', async () => {
    const deps = depsWithProvider('fanart', {
      getMovieArt: async () => ({ thumbUrl: 'https://fanart.tv/m.jpg', logoUrl: null }),
      getTvArt: async (tvdbId: number) => ({ thumbUrl: `https://fanart.tv/t${tvdbId}.jpg`, logoUrl: null }),
    });
    const out = await enrichDownloads([MOVIE_DL, TV_DL, NO_TMDB_DL], deps);
    expect(out[0]!.art!.thumbUrl).toBe('https://fanart.tv/m.jpg');
    expect(out[1]!.art!.thumbUrl).toBe('https://fanart.tv/t789.jpg');
    expect(out[2]!.art).toBeUndefined();
  });

  it('returns records untouched in TMDB mode', async () => {
    let called = false;
    const deps = depsWithProvider('tmdb', {
      getMovieArt: async () => {
        called = true;
        return { thumbUrl: 'https://fanart.tv/m.jpg', logoUrl: null };
      },
      getTvArt: async () => ({ thumbUrl: null, logoUrl: null }),
    });
    const out = await enrichDownloads([MOVIE_DL], deps);
    expect(out[0]!.art).toBeUndefined();
    expect(called).toBe(false);
  });

  it('does not enrich when no Fanart client exists', async () => {
    const deps = makeTestDeps({ fanart: null });
    const out = await enrichDownloads([MOVIE_DL], deps);
    expect(out[0]!.art).toBeUndefined();
  });
});
