import { describe, expect, it } from 'vitest';
import { enrichDetail, enrichDownloads, enrichItems } from './enrich.js';
import { makeTestDeps, makeDownloadRecord } from '../../test/helpers.js';
import { artKey, type ArtService } from './artService.js';
import type { AppDeps } from '../deps.js';
import type { ArtSubject, MediaDetail, MediaItem } from '../types.js';

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

const MOVIE_ART = { thumbUrl: 'https://fanart.tv/movie.jpg', logoUrl: 'https://fanart.tv/mlogo.png' };

function fanartClient(): AppDeps['fanart'] {
  return {
    getMovieArt: async () => ({ status: 'empty' as const, thumbUrl: null, logoUrl: null }),
    getTvArt: async () => ({ status: 'empty' as const, thumbUrl: null, logoUrl: null }),
  };
}

interface StubCallLog {
  resolved: string[];
  enqueued: string[];
}

function stubArt(overrides: Partial<ArtService> = {}): { service: ArtService; calls: StubCallLog } {
  const calls: StubCallLog = { resolved: [], enqueued: [] };
  const service: ArtService = {
    resolveManyCached: async (subjects: ArtSubject[]) => {
      calls.resolved.push(...subjects.map(artKey));
      if (overrides.resolveManyCached) return overrides.resolveManyCached(subjects);
      return new Map();
    },
    enqueueMissing: (subjects) => {
      calls.enqueued.push(...subjects.map(artKey));
    },
    resolveOne: overrides.resolveOne ?? (async () => null),
    refresh: () => {},
    refreshExpired: async () => 0,
    drain: async () => {},
    clear: () => {},
  };
  return { service, calls };
}

function depsWithProvider(provider: 'tmdb' | 'fanart', artOverrides: Partial<ArtService> = {}): { deps: AppDeps; calls: StubCallLog } {
  const { service, calls } = stubArt(artOverrides);
  const deps = makeTestDeps({
    fanart: fanartClient(),
    art: service,
    settings: { get: async () => ({ provider }), set: async () => {} },
  });
  return { deps, calls };
}

function depsWithoutFanart(): { deps: AppDeps; calls: StubCallLog } {
  const { service, calls } = stubArt();
  const deps = makeTestDeps({ fanart: null, art: service });
  return { deps, calls };
}

describe('enrichItems', () => {
  it('skips enrichment entirely when no Fanart key is configured', async () => {
    const { deps, calls } = depsWithoutFanart();
    const items = await enrichItems([MOVIE], deps);
    expect(items[0]!.art).toBeUndefined();
    expect(calls.resolved).toHaveLength(0);
  });

  it('skips enrichment in TMDB mode even when a Fanart client exists', async () => {
    const { deps, calls } = depsWithProvider('tmdb');
    const items = await enrichItems([MOVIE], deps);
    expect(items[0]!.art).toBeUndefined();
    expect(calls.resolved).toHaveLength(0);
    expect(calls.enqueued).toHaveLength(0);
  });

  it('attaches cached art (service dedupes the follow-up enqueue)', async () => {
    const { deps, calls } = depsWithProvider('fanart', {
      resolveManyCached: async () => new Map([['movie:550', MOVIE_ART]]),
    });
    const items = await enrichItems([MOVIE], deps);
    expect(items[0]!.art).toEqual(MOVIE_ART);
    expect(calls.resolved).toEqual(['movie:550']);
    expect(calls.enqueued).toEqual(['movie:550']);
  });

  it('never blocks on a cold cache: returns no art and enqueues the misses', async () => {
    const { deps, calls } = depsWithProvider('fanart');
    const items = await enrichItems([MOVIE, TV], deps);
    expect(items[0]!.art).toBeUndefined();
    expect(items[1]!.art).toBeUndefined();
    expect(calls.resolved).toEqual(['movie:550', 'tv:100']);
    expect(calls.enqueued).toEqual(['movie:550', 'tv:100']);
  });
});

describe('enrichDetail', () => {
  it('attaches art when the detail resolves it', async () => {
    const { deps } = depsWithProvider('fanart', {
      resolveOne: async (subject) => (subject.tmdbId === 550 ? MOVIE_ART : null),
    });
    const detail: MediaDetail = { ...MOVIE, overview: 'o', genres: [], runtime: 100 };
    const out = await enrichDetail(detail, deps);
    expect(out.art).toEqual(MOVIE_ART);
  });

  it('leaves detail untouched when art is missing or the fetch fails', async () => {
    const { deps } = depsWithProvider('fanart');
    const detail: MediaDetail = { ...MOVIE, overview: 'o', genres: [], runtime: 100 };
    const out = await enrichDetail(detail, deps);
    expect(out.art).toBeUndefined();
  });

  it('skips the lookup in TMDB mode', async () => {
    const { deps } = depsWithProvider('tmdb');
    const detail: MediaDetail = { ...MOVIE, overview: 'o', genres: [], runtime: 100 };
    const out = await enrichDetail(detail, deps);
    expect(out.art).toBeUndefined();
  });
});

describe('enrichDownloads', () => {
  const MOVIE_DL = makeDownloadRecord({ tmdbId: 550, mediaType: 'movie' });
  const NO_TMDB_DL = makeDownloadRecord({ tmdbId: null, mediaType: null, infoHash: 'c'.repeat(40) });

  it('attaches cached art to identified rows in Fanart mode', async () => {
    const { deps } = depsWithProvider('fanart', {
      resolveManyCached: async () => new Map([['movie:550', MOVIE_ART]]),
    });
    const out = await enrichDownloads([MOVIE_DL, NO_TMDB_DL], deps);
    expect(out[0]!.art).toEqual(MOVIE_ART);
    expect(out[1]!.art).toBeUndefined();
  });

  it('never blocks and only enqueues rows with a TMDB identity', async () => {
    const { deps, calls } = depsWithProvider('fanart');
    const out = await enrichDownloads([MOVIE_DL, NO_TMDB_DL], deps);
    expect(out[0]!.art).toBeUndefined();
    expect(calls.resolved).toEqual(['movie:550']);
    expect(calls.enqueued).toEqual(['movie:550']);
  });

  it('returns records untouched in TMDB mode', async () => {
    const { deps, calls } = depsWithProvider('tmdb');
    const out = await enrichDownloads([MOVIE_DL], deps);
    expect(out[0]!.art).toBeUndefined();
    expect(calls.resolved).toHaveLength(0);
  });

  it('does not enrich when no Fanart client exists', async () => {
    const { deps } = depsWithoutFanart();
    const out = await enrichDownloads([MOVIE_DL], deps);
    expect(out[0]!.art).toBeUndefined();
  });
});
