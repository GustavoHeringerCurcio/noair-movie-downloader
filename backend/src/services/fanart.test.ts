import { describe, expect, it } from 'vitest';
import { createFanartClient } from './fanart.js';
import { createResponse, makeFetch } from '../../test/helpers.js';

const CONFIG = { apiKey: 'k', baseUrl: 'https://webservice.fanart.tv/v3' };

function thumb(url: string, likes = 0): { url: string; likes: number } {
  return { url, likes };
}

describe('createFanartClient', () => {
  it('returns the most-liked movie thumb, poster and logo', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/movies/550'),
        respond: () =>
          createResponse(200, {
            moviethumb: [thumb('https://fanart.tv/a.jpg', 2), thumb('https://fanart.tv/b.jpg', 9)],
            movieposter: [thumb('https://fanart.tv/p1.jpg', 1), thumb('https://fanart.tv/p2.jpg', 5)],
            hdmovielogo: [thumb('https://fanart.tv/logo.png', 1)],
          }),
      },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    const art = await client.getMovieArt(550);
    expect(art).toEqual({
      status: 'ok',
      thumbUrl: 'https://fanart.tv/b.jpg',
      backgroundUrl: null,
      posterUrl: 'https://fanart.tv/p2.jpg',
      logoUrl: 'https://fanart.tv/logo.png',
    });
  });

  it('selects the most-liked HD movie background', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/movies/550'),
        respond: () =>
          createResponse(200, {
            moviethumb: [thumb('https://fanart.tv/a.jpg', 2)],
            moviebackground: [thumb('https://fanart.tv/hd1.jpg', 1), thumb('https://fanart.tv/hd2.jpg', 9)],
            movieposter: [thumb('https://fanart.tv/p1.jpg', 1)],
            hdmovielogo: [thumb('https://fanart.tv/logo.png', 1)],
          }),
      },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    const art = await client.getMovieArt(550);
    expect(art.status).toBe('ok');
    expect(art.backgroundUrl).toBe('https://fanart.tv/hd2.jpg');
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
    expect(art.backgroundUrl).toBeNull();
    expect(art.posterUrl).toBeNull();
    expect(art.logoUrl).toBe('https://fanart.tv/logo2.png');
  });

  it('classifies a background-only title as ok (so it is cached, not empty)', async () => {
    const fetchImpl = makeFetch([
      {
        match: () => true,
        respond: () =>
          createResponse(200, {
            moviebackground: [thumb('https://fanart.tv/hd.jpg', 3)],
            moviethumb: [],
            movieposter: [],
            hdmovielogo: [],
          }),
      },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    const art = await client.getMovieArt(6);
    expect(art).toEqual({
      status: 'ok',
      thumbUrl: null,
      backgroundUrl: 'https://fanart.tv/hd.jpg',
      posterUrl: null,
      logoUrl: null,
    });
  });

  it('classifies a poster-only title as ok (so it is cached, not empty)', async () => {
    const fetchImpl = makeFetch([
      {
        match: () => true,
        respond: () =>
          createResponse(200, {
            moviethumb: [],
            movieposter: [thumb('https://fanart.tv/poster.jpg', 3)],
            hdmovielogo: [],
          }),
      },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    const art = await client.getMovieArt(5);
    expect(art).toEqual({
      status: 'ok',
      thumbUrl: null,
      backgroundUrl: null,
      posterUrl: 'https://fanart.tv/poster.jpg',
      logoUrl: null,
    });
  });

  it('maps TV responses from tvthumb + tvposter + hdtvlogo/clearlogo', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/tv/321'),
        respond: () =>
          createResponse(200, {
            tvthumb: [thumb('https://fanart.tv/tv.jpg')],
            tvposter: [thumb('https://fanart.tv/tvp.jpg')],
            clearlogo: [thumb('https://fanart.tv/clear.png')],
          }),
      },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    const art = await client.getTvArt(321);
    expect(art).toEqual({
      status: 'ok',
      thumbUrl: 'https://fanart.tv/tv.jpg',
      backgroundUrl: null,
      posterUrl: 'https://fanart.tv/tvp.jpg',
      logoUrl: 'https://fanart.tv/clear.png',
    });
  });

  it('maps TV showbackground as the HD background size', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/tv/321'),
        respond: () =>
          createResponse(200, {
            tvthumb: [thumb('https://fanart.tv/tv.jpg')],
            showbackground: [thumb('https://fanart.tv/showhd.jpg')],
            tvposter: [thumb('https://fanart.tv/tvp.jpg')],
            clearlogo: [thumb('https://fanart.tv/clear.png')],
          }),
      },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    const art = await client.getTvArt(321);
    expect(art.backgroundUrl).toBe('https://fanart.tv/showhd.jpg');
  });

  it('returns empty when the payload has no matching art', async () => {
    const fetchImpl = makeFetch([
      {
        match: () => true,
        respond: () => createResponse(200, { moviethumb: [], movieposter: [], hdmovielogo: [] }),
      },
    ]);
    const client = createFanartClient({ ...CONFIG, fetchImpl });
    const art = await client.getMovieArt(7);
    expect(art).toEqual({
      status: 'empty',
      thumbUrl: null,
      backgroundUrl: null,
      posterUrl: null,
      logoUrl: null,
    });
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
    expect(art).toEqual({
      status: 'empty',
      thumbUrl: null,
      backgroundUrl: null,
      posterUrl: null,
      logoUrl: null,
    });
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
