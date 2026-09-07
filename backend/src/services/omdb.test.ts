import { describe, expect, it } from 'vitest';
import { createOmdbClient, type OmdbClientConfig } from './omdb.js';

interface FetchCall {
  url: string;
}

function makeFetch(responses: Array<{ status?: number; body: unknown }>, calls: FetchCall[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url });
    const next = responses.shift() ?? { status: 404, body: { Response: 'False' } };
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      json: async () => next.body,
    } as Response;
  }) as typeof fetch;
}

function config(overrides: Partial<OmdbClientConfig> = {}): OmdbClientConfig {
  return { apiKey: 'test-key', ...overrides };
}

describe('createOmdbClient', () => {
  it('returns an https Amazon poster and the IMDb rating for a valid IMDb id', async () => {
    const calls: FetchCall[] = [];
    const client = createOmdbClient(
      config({
        fetchImpl: makeFetch(
          [{ body: { Response: 'True', Poster: 'https://m.media-amazon.com/images/M/poster.jpg', imdbRating: '8.3' } }],
          calls,
        ),
      }),
    );
    const result = await client.fetchPoster('tt1375666');
    expect(result).toEqual({
      status: 'ok',
      posterUrl: 'https://m.media-amazon.com/images/M/poster.jpg',
      imdbRating: 8.3,
    });
    expect(calls[0]?.url).toContain('i=tt1375666');
    expect(calls[0]?.url).toContain('apikey=test-key');
  });

  it('keeps the rating when the poster is missing from the record (empty, storable)', async () => {
    const client = createOmdbClient({
      ...config(),
      fetchImpl: makeFetch([{ body: { Response: 'True', Poster: 'N/A', imdbRating: '7.5' } }], []),
    });
    const result = await client.fetchPoster('tt1375666');
    expect(result).toEqual({ status: 'empty', posterUrl: null, imdbRating: 7.5 });
  });

  it('parses a one-decimal rating and rounds extra precision', async () => {
    const client = createOmdbClient({
      ...config(),
      fetchImpl: makeFetch([{ body: { Response: 'True', Poster: 'https://m.media-amazon.com/p.jpg', imdbRating: '8.44' } }], []),
    });
    const result = await client.fetchPoster('tt1375666');
    expect(result.status).toBe('ok');
    expect(result.imdbRating).toBe(8.4);
  });

  it('maps an N/A rating to null', async () => {
    const client = createOmdbClient({
      ...config(),
      fetchImpl: makeFetch([{ body: { Response: 'True', Poster: 'https://m.media-amazon.com/p.jpg', imdbRating: 'N/A' } }], []),
    });
    const result = await client.fetchPoster('tt1375666');
    expect(result).toEqual({ status: 'ok', posterUrl: 'https://m.media-amazon.com/p.jpg', imdbRating: null });
  });

  it('maps Response=False to empty (no poster, no rating)', async () => {
    const client = createOmdbClient({
      ...config(),
      fetchImpl: makeFetch([{ body: { Response: 'False', Error: 'Incorrect IMDb ID.' } }], []),
    });
    const result = await client.fetchPoster('tt0000000');
    expect(result).toEqual({ status: 'empty', posterUrl: null, imdbRating: null });
  });

  it('maps an N/A poster to empty', async () => {
    const client = createOmdbClient({
      ...config(),
      fetchImpl: makeFetch([{ body: { Response: 'True', Poster: 'N/A' } }], []),
    });
    const result = await client.fetchPoster('tt1375666');
    expect(result).toEqual({ status: 'empty', posterUrl: null, imdbRating: null });
  });

  it('rejects a non-https poster URL', async () => {
    const client = createOmdbClient({
      ...config(),
      fetchImpl: makeFetch([{ body: { Response: 'True', Poster: 'http://insecure.example/p.jpg' } }], []),
    });
    const result = await client.fetchPoster('tt1375666');
    expect(result).toEqual({ status: 'empty', posterUrl: null, imdbRating: null });
  });

  it('treats a malformed imdb id as empty without hitting the network', async () => {
    let called = false;
    const client = createOmdbClient({
      ...config(),
      fetchImpl: (async () => {
        called = true;
        return { ok: true, json: async () => ({}) } as Response;
      }) as typeof fetch,
    });
    const result = await client.fetchPoster('not-an-id');
    expect(result).toEqual({ status: 'empty', posterUrl: null, imdbRating: null });
    expect(called).toBe(false);
  });

  it('reports a non-2xx as error (never cached as no poster)', async () => {
    const client = createOmdbClient({
      ...config(),
      fetchImpl: makeFetch([{ status: 429, body: {} }], []),
    });
    const result = await client.fetchPoster('tt1375666');
    expect(result).toEqual({ status: 'error', posterUrl: null, imdbRating: null });
  });

  it('stops calling OMDb once the daily budget is exhausted and resets on a new day', async () => {
    let clock = new Date('2026-01-01T10:00:00Z').getTime();
    let hits = 0;
    const client = createOmdbClient({
      ...config({ dailyLimit: 2 }),
      now: () => clock,
      fetchImpl: (async () => {
        hits += 1;
        return { ok: true, json: async () => ({ Response: 'True', Poster: 'https://m.media-amazon.com/p.jpg', imdbRating: '8.0' }) } as Response;
      }) as typeof fetch,
    });

    expect(client.isBudgetExhausted()).toBe(false);
    await client.fetchPoster('tt1');
    await client.fetchPoster('tt2');
    expect(client.isBudgetExhausted()).toBe(true);
    const blocked = await client.fetchPoster('tt3');
    expect(blocked).toEqual({ status: 'error', posterUrl: null, imdbRating: null });
    expect(hits).toBe(2);

    clock = new Date('2026-01-02T00:00:00Z').getTime();
    expect(client.isBudgetExhausted()).toBe(false);
    const nextDay = await client.fetchPoster('tt4');
    expect(nextDay.status).toBe('ok');
    expect(hits).toBe(3);
  });
});
