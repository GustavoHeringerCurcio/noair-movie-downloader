import { describe, expect, it } from 'vitest';
import { makeTestDeps } from '../../test/helpers.js';
import { backfillMissingRatings } from './warmArt.js';
import { createOmdbClient } from '../services/omdb.js';
import type { ArtFilesRepository, ArtFileRow } from '../db/artFilesRepo.js';
import type { AppDeps } from '../deps.js';

function row(mediaType: 'movie' | 'tv', tmdbId: number, fetchedAt: string): ArtFileRow {
  return {
    mediaType,
    tmdbId,
    kind: 'poster',
    originUrl: 'https://m.media-amazon.com/images/M/p.jpg',
    filePath: `${mediaType}_${tmdbId}_poster.jpg`,
    status: 'ok',
    fetchedAt,
    imdbRating: null,
  };
}

/** In-memory `art_files` double tracking imdb_rating writes. */
function memoryRepo(seed: ArtFileRow[]): ArtFilesRepository & { updated: Array<{ mediaType: string; tmdbId: number; imdbRating: number }> } {
  const rows = new Map<string, ArtFileRow>();
  for (const r of seed) rows.set(`${r.mediaType}:${r.tmdbId}`, r);
  const updated: Array<{ mediaType: string; tmdbId: number; imdbRating: number }> = [];
  return {
    updated,
    async getMany(subjects) {
      return subjects
        .flatMap((s) => [rows.get(`${s.mediaType}:${s.tmdbId}`)])
        .filter((r): r is ArtFileRow => r != null);
    },
    async upsertMany() {},
    async listPosterRowsMissingRating() {
      return Array.from(rows.values())
        .filter((r) => r.kind === 'poster' && r.imdbRating === null)
        .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
    },
    async updateImdbRatings(entries) {
      for (const e of entries) {
        const key = `${e.mediaType}:${e.tmdbId}`;
        const existing = rows.get(key);
        if (existing) rows.set(key, { ...existing, imdbRating: e.imdbRating });
        updated.push(e);
      }
    },
  };
}

function omdbFetch(clock: { ms: number }, ratings: Record<number, string>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = /i=tt(\d+)/.exec(url);
    const rating = match?.[1] ? ratings[Number(match[1])] : undefined;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        Response: 'True',
        Poster: 'https://m.media-amazon.com/images/M/p.jpg',
        imdbRating: rating ?? 'N/A',
      }),
    } as Response;
  }) as typeof fetch;
}

function depsFor(overrides: {
  rows: ArtFileRow[];
  dailyLimit: number;
  clockMs: number;
  ratings?: Record<number, string>;
}): { deps: AppDeps; repo: ReturnType<typeof memoryRepo>; clock: { ms: number } } {
  const clock = { ms: overrides.clockMs };
  const repo = memoryRepo(overrides.rows);
  const base = makeTestDeps();
  const omdb = createOmdbClient({
    apiKey: 'test-key',
    dailyLimit: overrides.dailyLimit,
    now: () => clock.ms,
    fetchImpl: omdbFetch(clock, overrides.ratings ?? {}),
  });
  const deps = makeTestDeps({
    tmdb: {
      ...base.tmdb,
      imdbId: async (id: number) => `tt${id}`,
    },
    omdb,
    artFiles: repo,
  });
  return { deps, repo, clock };
}

describe('backfillMissingRatings (T-004)', () => {
  it('fills ratings for every stored row missing one, oldest first', async () => {
    const { deps, repo } = depsFor({
      rows: [
        row('movie', 550, '2026-01-01T00:00:00Z'),
        row('movie', 551, '2026-01-02T00:00:00Z'),
        row('tv', 100, '2026-01-03T00:00:00Z'),
      ],
      dailyLimit: 850,
      clockMs: new Date('2026-09-01T10:00:00Z').getTime(),
      ratings: { 550: '8.3', 551: '7.1', 100: '8.7' },
    });

    const written = await backfillMissingRatings(deps);
    expect(written).toBe(3);
    expect(repo.updated).toEqual([
      { mediaType: 'movie', tmdbId: 550, imdbRating: 8.3 },
      { mediaType: 'movie', tmdbId: 551, imdbRating: 7.1 },
      { mediaType: 'tv', tmdbId: 100, imdbRating: 8.7 },
    ]);
  });

  it('leaves rows OMDb reports no score for as NULL and does not fail', async () => {
    const { deps, repo } = depsFor({
      rows: [row('movie', 550, '2026-01-01T00:00:00Z'), row('movie', 551, '2026-01-02T00:00:00Z')],
      dailyLimit: 850,
      clockMs: new Date('2026-09-01T10:00:00Z').getTime(),
      // No entry for tt550/tt551 → OMDb returns imdbRating "N/A".
    });

    const written = await backfillMissingRatings(deps);
    expect(written).toBe(0);
    expect(repo.updated).toEqual([]);
  });

  it('pauses when the daily OMDb slice is exhausted and resumes on a later day', async () => {
    const rows = [
      row('movie', 550, '2026-01-01T00:00:00Z'),
      row('movie', 551, '2026-01-02T00:00:00Z'),
      row('movie', 552, '2026-01-03T00:00:00Z'),
      row('tv', 100, '2026-01-04T00:00:00Z'),
    ];
    const { deps, repo, clock } = depsFor({
      rows,
      dailyLimit: 2,
      clockMs: new Date('2026-09-01T10:00:00Z').getTime(),
      ratings: { 550: '8.3', 551: '7.1', 552: '6.0', 100: '8.7' },
    });

    // Day one: only two of the four rows fit inside the shared daily budget.
    const dayOne = await backfillMissingRatings(deps);
    expect(dayOne).toBe(2);
    expect(repo.updated).toHaveLength(2);

    // Same day, another pass must stall (nothing left of the slice).
    expect(await backfillMissingRatings(deps)).toBe(0);
    expect(repo.updated).toHaveLength(2);

    // Next day: the pass resumes and fills the remaining rows.
    clock.ms = new Date('2026-09-02T10:00:00Z').getTime();
    const dayTwo = await backfillMissingRatings(deps);
    expect(dayTwo).toBe(2);
    expect(repo.updated).toHaveLength(4);
  });

  it('is a no-op without an OMDb key or an art_files store', async () => {
    const base = makeTestDeps();
    expect(await backfillMissingRatings(makeTestDeps({ omdb: null }))).toBe(0);
    expect(await backfillMissingRatings(makeTestDeps({ ...base, omdb: undefined }))).toBe(0);
  });
});
