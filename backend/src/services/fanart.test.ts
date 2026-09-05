import { describe, expect, it } from 'vitest';
import { createFanartClient } from './fanart.js';
import { createResponse, makeFetch } from '../../test/helpers.js';

const CONFIG = { apiKey: 'k', baseUrl: 'https://webservice.fanart.tv/v3' };

function thumb(url: string, likes = 0): { url: string; likes: number } {
  return { url, likes };
}

describe('createFanartClient', () => {
  it('returns the most-liked movie thumb and logo', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/movies/550'),
        respond: () =>
          createResponse(200, {
            moviethumb: [thumb('https://fanart.tv/a.jpg', 2), thumb('https://fanart.tv/b.jpg', 9)],
            hdmovielogo: [thumb('https://fanart.tv/logo.png', 1)],
          }),
      },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    const art = await client.getMovieArt(550);
    expect(art).toEqual({
      status: 'ok',
      thumbUrl: 'https://fanart.tv/b.jpg',
      logoUrl: 'https://fanart.tv/logo.png',
    });
  });

  it('falls back movielogo to hdmovielogo and rejects non-https urls', async () => {
    const fetchImpl = makeFetch([
      {
        match: () => true,
        respond: () =>
          createResponse(200, {
            moviethumb: [thumb('http://insecure.example/a.jpg', 5)],
            hdmovielogo: [],
            movielogo: [thumb('https://fanart.tv/logo2.png', 1)],
          }),
      },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    const art = await client.getMovieArt(123);
    expect(art.status).toBe('ok');
    expect(art.thumbUrl).toBeNull();
    expect(art.logoUrl).toBe('https://fanart.tv/logo2.png');
  });

  it('maps TV responses from tvthumb + hdtvlogo/clearlogo', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/tv/321'),
        respond: () =>
          createResponse(200, {
            tvthumb: [thumb('https://fanart.tv/tv.jpg')],
            clearlogo: [thumb('https://fanart.tv/clear.png')],
          }),
      },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    const art = await client.getTvArt(321);
    expect(art.status).toBe('ok');
    expect(art.thumbUrl).toBe('https://fanart.tv/tv.jpg');
    expect(art.logoUrl).toBe('https://fanart.tv/clear.png');
  });

  it('returns empty when the payload has no matching art', async () => {
    const fetchImpl = makeFetch([
      {
        match: () => true,
        respond: () => createResponse(200, { moviethumb: [], hdmovielogo: [] }),
      },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    const art = await client.getMovieArt(7);
    expect(art).toEqual({ status: 'empty', thumbUrl: null, logoUrl: null });
  });

  it('reports 404 as empty', async () => {
    const fetchImpl = makeFetch([
      {
        match: () => true,
        respond: () => createResponse(404, {}),
      },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    const art = await client.getMovieArt(1);
    expect(art).toEqual({ status: 'empty', thumbUrl: null, logoUrl: null });
  });

  it('caches successful results', async () => {
    let calls = 0;
    const fetchImpl = makeFetch([
      {
        match: () => true,
        respond: () => {
          calls += 1;
          return createResponse(200, { moviethumb: [thumb('https://fanart.tv/x.jpg', 1)] });
        },
      },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    const first = await client.getMovieArt(1);
    expect(first.status).toBe('ok');
    const second = await client.getMovieArt(1);
    expect(second.status).toBe('ok');
    expect(calls).toBe(1);
  });

  it('never caches transient errors', async () => {
    let calls = 0;
    const fetchImpl = makeFetch([
      {
        match: () => true,
        respond: () => {
          calls += 1;
          return createResponse(429, {});
        },
      },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    const first = await client.getMovieArt(2);
    const second = await client.getMovieArt(2);
    expect(first.status).toBe('error');
    expect(second.status).toBe('error');
    expect(calls).toBe(2);
  });
});
