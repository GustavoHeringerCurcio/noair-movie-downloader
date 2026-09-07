import { describe, expect, it } from 'vitest';
import { createFanartClient, pickBestThumbUrl, type FanartArtworkEntry } from './fanart.js';
import { createResponse, makeFetch } from '../../test/helpers.js';

const CONFIG = { apiKey: 'k', baseUrl: 'https://webservice.fanart.tv/v3' };

describe('pickBestThumbUrl', () => {
  it('prefers an English entry, then most likes', () => {
    const entries: FanartArtworkEntry[] = [
      { url: 'https://a/x.jpg', lang: 'de', likes: '99' },
      { url: 'https://a/en.jpg', lang: 'en', likes: '3' },
      { url: 'https://a/en2.jpg', lang: 'en', likes: '10' },
    ];
    expect(pickBestThumbUrl(entries)).toBe('https://a/en2.jpg');
  });

  it('falls back to non-English entries when nothing English exists', () => {
    const entries: FanartArtworkEntry[] = [
      { url: 'https://a/low.jpg', lang: 'fr', likes: '1' },
      { url: 'https://a/high.jpg', lang: 'de', likes: '50' },
    ];
    expect(pickBestThumbUrl(entries)).toBe('https://a/high.jpg');
  });

  it('ignores entries without a url and returns null for empty lists', () => {
    expect(pickBestThumbUrl([])).toBeNull();
    expect(pickBestThumbUrl(null)).toBeNull();
    expect(pickBestThumbUrl(undefined)).toBeNull();
    expect(pickBestThumbUrl([{ url: '', likes: '5' }])).toBeNull();
  });
});

function movieResponse(): Response {
  return createResponse(200, {
    name: 'Inception',
    tmdb_id: 27205,
    moviethumb: [
      { id: '1', url: 'https://assets.fanart.tv/fanart/movies/27205/moviethumb/x.jpg', lang: 'en', likes: '12' },
    ],
  });
}

function tvResponse(): Response {
  return createResponse(200, {
    name: 'Fallout',
    tmdb_id: 100,
    showbackground: [{ id: '9', url: 'https://a/bg.jpg', lang: 'en', likes: '4' }],
    tvthumb: [
      { id: '2', url: 'https://assets.fanart.tv/fanart/tv/100/tvthumb/x.jpg', lang: 'en', likes: '8' },
    ],
  });
}

describe('FanartClient.keyArt', () => {
  it('resolves the moviethumb URL for a movie (Part A wide art)', async () => {
    const fetchImpl = makeFetch([
      { match: (url) => url.includes('/movies/27205'), respond: () => movieResponse() },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    await expect(client.keyArt('movie', 27205)).resolves.toEqual({
      status: 'ok',
      url: 'https://assets.fanart.tv/fanart/movies/27205/moviethumb/x.jpg',
    });
  });

  it('resolves the tvthumb URL for a tv series (TV equivalent of moviethumb)', async () => {
    const fetchImpl = makeFetch([
      { match: (url) => url.includes('/tv/100'), respond: () => tvResponse() },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    await expect(client.keyArt('tv', 100)).resolves.toEqual({
      status: 'ok',
      url: 'https://assets.fanart.tv/fanart/tv/100/tvthumb/x.jpg',
    });
  });

  it('records empty for a 404 (title unknown to fanart)', async () => {
    const fetchImpl = makeFetch([{ match: () => true, respond: () => createResponse(404, {}) }]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    await expect(client.keyArt('movie', 999999)).resolves.toEqual({ status: 'empty', url: null });
  });

  it('records empty when the record has no thumb array', async () => {
    const fetchImpl = makeFetch([
      { match: () => true, respond: () => createResponse(200, { name: 'X', tmdb_id: 1 }) },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    await expect(client.keyArt('movie', 1)).resolves.toEqual({ status: 'empty', url: null });
  });

  it('records error (never empty) for a bad key or upstream failure', async () => {
    const badKey = makeFetch([{ match: () => true, respond: () => createResponse(401, {}) }]);
    const clientBad = createFanartClient({ ...CONFIG, fetchImpl: badKey });
    await expect(clientBad.keyArt('movie', 550)).resolves.toEqual({ status: 'error', url: null });

    const down = makeFetch([
      { match: () => true, respond: () => { throw new TypeError('network down'); } },
    ]);
    const clientDown = createFanartClient({ ...CONFIG, fetchImpl: down });
    await expect(clientDown.keyArt('movie', 550)).resolves.toEqual({ status: 'error', url: null });
  });

  it('sends the api key as a query param', async () => {
    const seen: string[] = [];
    const fetchImpl = makeFetch([
      {
        match: (url) => {
          seen.push(url);
          return url.includes('/movies/27205');
        },
        respond: () => movieResponse(),
      },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    await client.keyArt('movie', 27205);
    // fanart.tv uses `/movies/{id}` (plural) — a `/movie/{id}` call 404s and
    // would be recorded as "no art" for every movie (regression guard).
    expect(seen[0]).toContain('/v3/movies/27205?api_key=k');
  });
});
