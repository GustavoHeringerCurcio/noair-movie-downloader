import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cardPosterUrl,
  clearHoverCache,
  clearSourcesCache,
  externalPlayerHref,
  hoverCardFor,
  humanEta,
  humanSize,
  humanSpeed,
  sources,
  trailerEmbedUrl,
} from './api';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
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

describe('cardPosterUrl (D21 OMDb portrait)', () => {
  it('points at the local art-volume poster route for a subject', () => {
    expect(cardPosterUrl('movie', 550)).toBe('/api/images/art/movie/550/poster');
    expect(cardPosterUrl('tv', 1396)).toBe('/api/images/art/tv/1396/poster');
  });
});

describe('externalPlayerHref (T-001 movie: hand-off)', () => {
  it('wraps the stream URL in an opaque movie: URI (no nested authority)', () => {
    const href = externalPlayerHref('http://localhost:5173', 'a'.repeat(40), 'Matrix (1999).mkv');
    expect(href).toBe(`movie:http://localhost:5173/api/stream/${'a'.repeat(40)}?file=${encodeURIComponent('Matrix (1999).mkv')}`);
    expect(href).not.toMatch(/^movie:\/\//);
  });

  it('round-trips the browser URI parser unchanged (the old movie://<url> form did not)', () => {
    const href = externalPlayerHref('http://localhost:5173', 'b'.repeat(40));
    expect(new URL(href).href).toBe(href);
    // Old shape for comparison — canonicalized by dropping the nested colon:
    expect(new URL('movie://http://localhost:5173/x').href).toBe('movie://http//localhost:5173/x');
  });
});

describe('trailerEmbedUrl (D18/D20)', () => {
  it('builds a sound-on looping youtube-nocookie embed by default', () => {
    const url = trailerEmbedUrl({ provider: 'youtube', videoId: 'O-b2VfmmbyA', name: null });
    expect(url).toBe(
      'https://www.youtube-nocookie.com/embed/O-b2VfmmbyA?autoplay=1&mute=0&controls=0&playsinline=1&loop=1&playlist=O-b2VfmmbyA&modestbranding=1',
    );
  });

  it('mutes the youtube embed when asked', () => {
    const url = trailerEmbedUrl({ provider: 'youtube', videoId: 'O-b2VfmmbyA', name: null }, { muted: true });
    expect(url).toContain('mute=1');
  });

  it('builds a sound-on looping Vimeo embed', () => {
    const url = trailerEmbedUrl({ provider: 'vimeo', videoId: '12345', name: null });
    expect(url).toContain('https://player.vimeo.com/video/12345?autoplay=1');
    expect(url).toContain('muted=0');
    expect(url).toContain('loop=1');
  });

  it('mutes the Vimeo embed when asked', () => {
    const url = trailerEmbedUrl({ provider: 'vimeo', videoId: '12345', name: null }, { muted: true });
    expect(url).toContain('muted=1');
  });
});

describe('hoverCardFor (S16)', () => {
  const CARD = {
    trailer: { provider: 'youtube' as const, videoId: 'abc', name: null },
    genres: ['Sci-Fi'],
    runtime: 148,
    seasons: null,
    certification: 'PG-13',
  };

  beforeEach(() => {
    clearHoverCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the hover payload once and serves later calls from the cache', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CARD));
    vi.stubGlobal('fetch', fetchMock);
    const item = { tmdbId: 550, mediaType: 'movie' as const };
    const [a, b] = await Promise.all([hoverCardFor(item), hoverCardFor(item)]);
    expect(a).toEqual(CARD);
    expect(b).toEqual(CARD);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await hoverCardFor(item);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requests the hover route with the media type', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CARD));
    vi.stubGlobal('fetch', fetchMock);
    await hoverCardFor({ tmdbId: 100, mediaType: 'tv' });
    const url = (fetchMock.mock.calls[0] as unknown[])[0];
    expect(String(url)).toContain('/api/media/100/hover?type=tv');
  });

  it('keeps distinct entries per media type', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CARD));
    vi.stubGlobal('fetch', fetchMock);
    await hoverCardFor({ tmdbId: 550, mediaType: 'movie' });
    await hoverCardFor({ tmdbId: 550, mediaType: 'tv' });
    await hoverCardFor({ tmdbId: 550, mediaType: 'movie' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('degrades any failure to null (never throws)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'boom' }, 500));
    vi.stubGlobal('fetch', fetchMock);
    expect(await hoverCardFor({ tmdbId: 550, mediaType: 'movie' })).toBeNull();
  });
});

describe('sources (S3 cached best-source search)', () => {
  beforeEach(() => {
    clearSourcesCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dedupes in-flight calls and serves later calls from the cache', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ sources: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const ctx = { audio: 'en' as const };
    const [a, b] = await Promise.all([sources(550, 'movie', ctx), sources(550, 'movie', ctx)]);
    expect(a.sources).toEqual([]);
    expect(b.sources).toEqual([]);
    await sources(550, 'movie', ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct cache entries per context (audio/language)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ sources: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await sources(550, 'movie', { audio: 'en' });
    await sources(550, 'movie', { audio: 'pt' });
    await sources(550, 'movie', { audio: 'en' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures, so Retry really re-queries', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({ error: 'boom' }, 500) : jsonResponse({ sources: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(sources(550, 'movie', { audio: 'en' })).rejects.toThrow();
    const res = await sources(550, 'movie', { audio: 'en' });
    expect(res.sources).toEqual([]);
    expect(calls).toBe(2);
  });
});
