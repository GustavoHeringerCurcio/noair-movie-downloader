import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createArtCache } from './artCache.js';
import type { ArtFilesRepository, ArtFileRow } from '../db/artFilesRepo.js';
import type { ArtSubject } from '../types.js';

function createMemoryArtFilesRepo(seed: ArtFileRow[] = []): ArtFilesRepository {
  const rows = new Map<string, ArtFileRow>();
  for (const row of seed) rows.set(`${row.mediaType}:${row.tmdbId}:${row.kind}`, row);
  return {
    async getMany(subjects) {
      return subjects.flatMap((s) =>
        Array.from(rows.values()).filter((r) => r.mediaType === s.mediaType && r.tmdbId === s.tmdbId),
      );
    },
    async upsertMany(newRows) {
      for (const row of newRows) {
        rows.set(`${row.mediaType}:${row.tmdbId}:${row.kind}`, row);
      }
    },
    async listPosterRowsMissingRating() {
      return Array.from(rows.values()).filter((r) => r.kind === 'poster' && r.imdbRating === null);
    },
    async updateImdbRatings(entries) {
      for (const entry of entries) {
        const row = rows.get(`${entry.mediaType}:${entry.tmdbId}:poster`);
        if (row) rows.set(`${entry.mediaType}:${entry.tmdbId}:poster`, { ...row, imdbRating: entry.imdbRating });
      }
    },
  };
}

const SUBJECT: ArtSubject = { mediaType: 'movie', tmdbId: 550 };

function posterRow(overrides: Partial<ArtFileRow> = {}): ArtFileRow {
  return {
    mediaType: 'movie',
    tmdbId: 550,
    kind: 'poster',
    originUrl: null,
    filePath: null,
    status: 'ok',
    fetchedAt: new Date().toISOString(),
    imdbRating: null,
    ...overrides,
  };
}

function artResponse(contentType = 'image/jpeg'): Response {
  return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': contentType } });
}

describe('artCache', () => {
  let artDir: string;
  let repo: ArtFilesRepository;
  let urls: string[] = [];

  beforeEach(async () => {
    artDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artcache-'));
    urls = [];
  });

  afterEach(async () => {
    await fs.rm(artDir, { recursive: true, force: true });
  });

  function cache(resolveOrigin: (subject: ArtSubject) => Promise<string | null>) {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      urls.push(url);
      return artResponse('image/png');
    }) as typeof fetch;
    return createArtCache({ repo, artDir, resolveOrigin, fetchImpl });
  }

  const omdbPoster = 'https://m.media-amazon.com/images/M/poster.jpg';

  it('downloads the OMDb portrait poster and records it', async () => {
    repo = createMemoryArtFilesRepo();
    const written = await cache(async () => omdbPoster).warm([SUBJECT]);
    expect(written).toBe(1);
    expect(urls).toEqual([omdbPoster]);
    const file = await fs.readdir(artDir);
    expect(file).toHaveLength(1);
    expect(file[0]).toBe('movie_550_poster.png');
    const rows = await repo.getMany([SUBJECT]);
    expect(rows[0]?.kind).toBe('poster');
    expect(rows[0]?.originUrl).toBe(omdbPoster);
  });

  it('records empty (no poster) when OMDb reports none', async () => {
    repo = createMemoryArtFilesRepo();
    const written = await cache(async () => null).warm([SUBJECT]);
    expect(written).toBe(0);
    expect(urls).toHaveLength(0);
    const rows = await repo.getMany([SUBJECT]);
    expect(rows[0]?.status).toBe('empty');
  });

  it('does not re-ask OMDb for an empty row recorded recently', async () => {
    repo = createMemoryArtFilesRepo([
      posterRow({ originUrl: null, filePath: null, status: 'empty', imdbRating: null }),
    ]);
    let calls = 0;
    const written = await cache(async () => {
      calls += 1;
      return omdbPoster;
    }).warm([SUBJECT]);
    expect(written).toBe(0);
    expect(calls).toBe(0);
  });

  it('skips files already downloaded and on disk', async () => {
    repo = createMemoryArtFilesRepo([
      posterRow({ originUrl: omdbPoster, filePath: 'movie_550_poster.jpg', status: 'ok', imdbRating: null }),
    ]);
    await fs.writeFile(path.join(artDir, 'movie_550_poster.jpg'), Buffer.from([1, 2, 3]));
    const written = await cache(async () => omdbPoster).warm([SUBJECT]);
    expect(written).toBe(0);
    expect(urls).toHaveLength(0);
  });

  it('re-downloads when the recorded file is gone from disk', async () => {
    repo = createMemoryArtFilesRepo([
      posterRow({ originUrl: omdbPoster, filePath: 'movie_550_poster.jpg', status: 'ok', imdbRating: null }),
    ]);
    const written = await cache(async () => omdbPoster).warm([SUBJECT]);
    expect(written).toBe(1);
    expect(urls).toEqual([omdbPoster]);
  });

  it('skips (records nothing) when resolveOrigin throws — transient failure must not be cached', async () => {
    repo = createMemoryArtFilesRepo();
    const c = createArtCache({
      repo,
      artDir,
      resolveOrigin: async () => {
        throw new Error('OMDb unreachable');
      },
      fetchImpl: (async () => artResponse()) as typeof fetch,
    });
    const written = await c.warm([SUBJECT]);
    expect(written).toBe(0);
    const rows = await repo.getMany([SUBJECT]);
    expect(rows).toEqual([]);
  });
});

describe('artCache with a custom kind (T-002 fanart thumb / logo)', () => {
  let artDir: string;
  let repo: ArtFilesRepository;
  let urls: string[] = [];

  beforeEach(async () => {
    artDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artcache-kind-'));
    urls = [];
  });

  afterEach(async () => {
    await fs.rm(artDir, { recursive: true, force: true });
  });

  function cache(kind: 'thumb' | 'logo', resolveOrigin: (s: ArtSubject) => Promise<string | null>) {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      urls.push(url);
      return artResponse('image/png');
    }) as typeof fetch;
    return createArtCache({ repo, artDir, kind, resolveOrigin, fetchImpl });
  }

  it('downloads and names the file for the configured kind (thumb)', async () => {
    repo = createMemoryArtFilesRepo();
    const written = await cache('thumb', async () => 'https://assets.fanart.tv/fanart/x.jpg').warm([SUBJECT]);
    expect(written).toBe(1);
    expect(urls).toEqual(['https://assets.fanart.tv/fanart/x.jpg']);
    const files = await fs.readdir(artDir);
    expect(files[0]).toBe('movie_550_thumb.png');
    const rows = await repo.getMany([SUBJECT]);
    expect(rows[0]?.kind).toBe('thumb');
  });

  it('records empty under the configured kind (logo), not poster', async () => {
    repo = createMemoryArtFilesRepo();
    const written = await cache('logo', async () => null).warm([SUBJECT]);
    expect(written).toBe(0);
    const rows = await repo.getMany([SUBJECT]);
    expect(rows).toEqual([expect.objectContaining({ kind: 'logo', status: 'empty' })]);
  });

  it('does not treat a cached poster row as a cached logo', async () => {
    repo = createMemoryArtFilesRepo([
      {
        mediaType: 'movie',
        tmdbId: 550,
        kind: 'poster',
        originUrl: 'https://x/poster.jpg',
        filePath: 'movie_550_poster.jpg',
        status: 'ok',
        fetchedAt: new Date().toISOString(),
        imdbRating: null,
      },
    ]);
    await fs.writeFile(path.join(artDir, 'movie_550_poster.jpg'), Buffer.from([1, 2, 3]));
    const written = await cache('thumb', async () => 'https://assets.fanart.tv/fanart/y.jpg').warm([SUBJECT]);
    expect(written).toBe(1);
    const files = await fs.readdir(artDir);
    expect(files.sort()).toEqual(['movie_550_poster.jpg', 'movie_550_thumb.png']);
  });
});
