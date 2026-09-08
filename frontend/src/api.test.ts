import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearHoverCache,
  clearSourcesCache,
  externalPlayerHref,
  fanartThumbUrl,
  hoverCardFor,
  humanEta,
  humanSize,
  humanSpeed,
  logoUrl,
  removeDownload,
  sources,
  trailerEmbedUrl,
  trailerStillUrl,
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

describe('fanartThumbUrl / logoUrl (T-002 horizontal-poster art)', () => {
  it('builds the fanart key-art thumb route under /api/images/fanart', () => {
    expect(fanartThumbUrl('movie', 27205)).toBe('/api/images/fanart/movie/27205/thumb');
    expect(fanartThumbUrl('tv', 100)).toBe('/api/images/fanart/tv/100/thumb');
  });

  it('builds the cached TMDB logo route under /api/images/art', () => {
    expect(logoUrl('movie', 27205)).toBe('/api/images/art/movie/27205/logo');
    expect(logoUrl('tv', 100)).toBe('/api/images/art/tv/100/logo');
  });
});

describe('trailerEmbedUrl (D18/D20)', () => {
  it('builds a sound-on looping youtube-nocookie embed by default, starting at 5s', () => {
    const url = trailerEmbedUrl({ provider: 'youtube', videoId: 'O-b2VfmmbyA', name: null });
    expect(url).toBe(
      'https://www.youtube-nocookie.com/embed/O-b2VfmmbyA?autoplay=1&mute=0&controls=0&playsinline=1&loop=1&playlist=O-b2VfmmbyA&modestbranding=1&start=5',
    );
  });

  it('mutes the youtube embed when asked', () => {
    const url = trailerEmbedUrl({ provider: 'youtube', videoId: 'O-b2VfmmbyA', name: null }, { muted: true });
    expect(url).toContain('mute=1');
    expect(url).toContain('start=5');
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

describe('trailerStillUrl (reduced-motion static frame)', () => {
  it('builds a YouTube first-frame thumbnail for a youtube trailer', () => {
    expect(trailerStillUrl({ provider: 'youtube', videoId: 'O-b2VfmmbyA', name: null })).toBe(
      'https://i.ytimg.com/vi/O-b2VfmmbyA/hqdefault.jpg',
    );
  });

  it('returns null for trailers without a public thumbnail', () => {
    expect(trailerStillUrl({ provider: 'vimeo', videoId: '12345', name: null })).toBeNull();
    expect(trailerStillUrl(null)).toBeNull();
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

  it('does not cache a null answer, so the next hover re-queries', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({ error: 'boom' }, 500) : jsonResponse(CARD);
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await hoverCardFor({ tmdbId: 550, mediaType: 'movie' })).toBeNull();
    expect(await hoverCardFor({ tmdbId: 550, mediaType: 'movie' })).toEqual(CARD);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it('sends the quality ceiling as a maxResolution query param', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ sources: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await sources(550, 'movie', { audio: 'en', maxResolution: '2160p' });
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('/api/media/550/sources?');
    expect(url).toContain('type=movie');
    expect(url).toContain('audio=en');
    expect(url).toContain('maxResolution=2160p');
  });

  it('keeps distinct cache entries per quality ceiling', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ sources: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await sources(550, 'movie', { audio: 'en', maxResolution: '1080p' });
    await sources(550, 'movie', { audio: 'en', maxResolution: '2160p' });
    await sources(550, 'movie', { audio: 'en', maxResolution: '1080p' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('removeDownload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('DELETEs /api/downloads/:infoHash?deleteFiles=true so the seed and its files are removed', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 204));
    vi.stubGlobal('fetch', fetchMock);
    await removeDownload('aa'.repeat(20), true);
    const calls = fetchMock.mock.calls as unknown[];
    const [input, init] = calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(input)).toBe(`/api/downloads/${'aa'.repeat(20)}?deleteFiles=true`);
    expect(init?.method).toBe('DELETE');
  });

  it('passes deleteFiles=false to drop the seed while keeping the files', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 204));
    vi.stubGlobal('fetch', fetchMock);
    await removeDownload('bb'.repeat(20), false);
    const calls = fetchMock.mock.calls as unknown[];
    const [input] = calls[0] as [RequestInfo | URL];
    expect(String(input)).toBe(`/api/downloads/${'bb'.repeat(20)}?deleteFiles=false`);
  });
});
