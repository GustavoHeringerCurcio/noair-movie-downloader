import { describe, expect, it } from 'vitest';
import { cardImages, humanEta, humanSize, humanSpeed, localArtUrl, posterStyleLayers } from './api';
import type { ArtPreference, MediaArt } from './types';

const PREF: ArtPreference = { tmdb: 'backdrop', fanart: 'thumb' };

function art(overrides: Partial<MediaArt> = {}): MediaArt {
  return { thumbUrl: null, posterUrl: null, logoUrl: null, ...overrides };
}

describe('humanSize', () => {
  it('formats byte sizes', () => {
    expect(humanSize(0)).toBe('0 B');
    expect(humanSize(500)).toBe('500 B');
    expect(humanSize(2048)).toBe('2 KB');
    expect(humanSize(5 * 1024 * 1024)).toBe('5 MB');
    expect(humanSize(2 * 1024 * 1024 * 1024)).toBe('2 GB');
  });
});

describe('humanSpeed', () => {
  it('formats speeds', () => {
    expect(humanSpeed(0)).toBe('0 B/s');
    expect(humanSpeed(1048576)).toBe('1 MB/s');
  });
});

describe('humanEta', () => {
  it('formats eta values', () => {
    expect(humanEta(null)).toBe('—');
    expect(humanEta(-1)).toBe('—');
    expect(humanEta(45)).toBe('45s');
    expect(humanEta(125)).toBe('2m 5s');
    expect(humanEta(3700)).toBe('1h 1m');
  });
});

describe('cardImages (STRICT provider isolation)', () => {
  it('returns only TMDB sources in TMDB mode, never FanArt', () => {
    const srcs = cardImages(
      {
        backdropPath: '/b.jpg',
        posterPath: '/p.jpg',
        art: art({ thumbUrl: 'https://fanart.tv/key.jpg', posterUrl: 'https://fanart.tv/poster.jpg' }),
      },
      'tmdb',
      PREF,
    );
    expect(srcs).toHaveLength(2);
    expect(srcs[0]).toContain('/api/images/tmdb/w1280/b.jpg');
    expect(srcs[1]).toContain('/api/images/tmdb/w500/p.jpg');
    expect(srcs.join(' ')).not.toContain('fanart.tv');
  });

  it('honors a TMDB poster-first preference', () => {
    const srcs = cardImages(
      { backdropPath: '/b.jpg', posterPath: '/p.jpg', art: null },
      'tmdb',
      { tmdb: 'poster', fanart: 'thumb' },
    );
    expect(srcs).toEqual([
      expect.stringContaining('/api/images/tmdb/w500/p.jpg'),
      expect.stringContaining('/api/images/tmdb/w1280/b.jpg'),
    ]);
  });

  it('returns only FanArt sources in FanArt mode, never TMDB', () => {
    const srcs = cardImages(
      {
        backdropPath: '/b.jpg',
        posterPath: '/p.jpg',
        art: art({ thumbUrl: 'https://fanart.tv/key.jpg', posterUrl: 'https://fanart.tv/poster.jpg' }),
      },
      'fanart',
      PREF,
    );
    expect(srcs).toEqual(['https://fanart.tv/key.jpg', 'https://fanart.tv/poster.jpg']);
    expect(srcs.join(' ')).not.toContain('/api/images/tmdb/');
  });

  it('tries the preferred FanArt size first, then other FanArt sizes', () => {
    const srcs = cardImages(
      {
        backdropPath: null,
        posterPath: null,
        art: art({ thumbUrl: 'https://fanart.tv/key.jpg', backgroundUrl: 'https://fanart.tv/hd.jpg' }),
      },
      'fanart',
      { tmdb: 'backdrop', fanart: 'background' },
    );
    expect(srcs).toEqual(['https://fanart.tv/hd.jpg', 'https://fanart.tv/key.jpg']);
  });

  it('uses the FanArt portrait poster only when it is the sole FanArt size', () => {
    const srcs = cardImages(
      {
        backdropPath: '/b.jpg',
        posterPath: '/p.jpg',
        art: art({ thumbUrl: null, backgroundUrl: null, posterUrl: 'https://fanart.tv/poster.jpg' }),
      },
      'fanart',
      PREF,
    );
    expect(srcs).toEqual(['https://fanart.tv/poster.jpg']);
    expect(srcs.join(' ')).not.toContain('/api/images/tmdb/');
  });

  it('returns no sources in FanArt mode when FanArt has no art (no TMDB rescue)', () => {
    const srcs = cardImages({ backdropPath: '/b.jpg', posterPath: '/p.jpg', art: null }, 'fanart', PREF);
    expect(srcs).toEqual([]);
  });

  it('returns no sources when neither provider has any image', () => {
    const srcs = cardImages({ backdropPath: null, posterPath: null, art: null }, 'fanart', PREF);
    expect(srcs).toEqual([]);
  });
});

describe('localArtUrl', () => {
  it('points at the local S8b artwork route', () => {
    expect(localArtUrl('movie', 550, 'poster')).toBe('/api/images/art/movie/550/poster');
    expect(localArtUrl('tv', 1396, 'background')).toBe('/api/images/art/tv/1396/background');
  });
});

describe('posterStyleLayers (D17 poster-first tile)', () => {
  it('builds the figure from local cache, then Fanart hi-res, then TMDB w780/w500', () => {
    const item = {
      mediaType: 'movie' as const,
      tmdbId: 550,
      backdropPath: '/b.jpg',
      posterPath: '/p.jpg',
      art: art({ posterUrl: 'https://fanart.tv/poster.jpg', thumbUrl: 'https://fanart.tv/key.jpg' }),
    };
    const { figure } = posterStyleLayers(item);
    expect(figure).toEqual([
      '/api/images/art/movie/550/poster',
      'https://fanart.tv/poster.jpg',
      expect.stringContaining('/api/images/tmdb/w780/p.jpg'),
      expect.stringContaining('/api/images/tmdb/w500/p.jpg'),
    ]);
  });

  it('keeps the 16:9 Fanart thumb or the TMDB backdrop as the ground layer', () => {
    const item = {
      mediaType: 'tv' as const,
      tmdbId: 1396,
      backdropPath: '/b.jpg',
      posterPath: '/p.jpg',
      art: art({ thumbUrl: 'https://fanart.tv/key.jpg' }),
    };
    const { background } = posterStyleLayers(item);
    expect(background[0]).toBe('https://fanart.tv/key.jpg');
    expect(background[1]).toBe('/api/images/tmdb/w1280/b.jpg');
    expect(background).toContain('/api/images/art/tv/1396/poster');
  });

  it('degrades to empty layers when nothing exists (UI shows the monogram)', () => {
    const item = { mediaType: 'movie' as const, tmdbId: 1, backdropPath: null, posterPath: null, art: null };
    const { figure, background } = posterStyleLayers(item);
    expect(figure).toEqual([]);
    expect(background).toEqual([]);
  });

  it('keeps each layer internally unique (ground may reuse the figure source)', () => {
    const item = {
      mediaType: 'movie' as const,
      tmdbId: 550,
      backdropPath: null,
      posterPath: '/p.jpg',
      art: art({ posterUrl: 'https://fanart.tv/poster.jpg' }),
    };
    const { figure, background } = posterStyleLayers(item);
    expect(new Set(figure).size).toBe(figure.length);
    expect(new Set(background).size).toBe(background.length);
  });
});
