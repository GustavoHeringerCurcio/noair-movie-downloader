import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createArtCache } from './artCache.js';
import type { ArtFilesRepository, ArtFileRow } from '../db/artFilesRepo.js';
import type { MediaArt } from '../types.js';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

function createMemoryArtFilesRepo(seed: ArtFileRow[] = []): ArtFilesRepository {
  const rows = new Map<string, ArtFileRow>();
  for (const row of seed) rows.set(`${row.mediaType}:${row.tmdbId}:${row.kind}`, row);
  return {
    async getMany(subjects) {
      return subjects
        .flatMap((s) => [rows.get(`${s.mediaType}:${s.tmdbId}:poster`), rows.get(`${s.mediaType}:${s.tmdbId}:background`), rows.get(`${s.mediaType}:${s.tmdbId}:logo`)])
        .filter((row): row is ArtFileRow => row != null);
    },
    async upsertMany(newRows) {
      for (const row of newRows) {
        rows.set(`${row.mediaType}:${row.tmdbId}:${row.kind}`, row);
      }
    },
  };
}

const art = (partial: Partial<MediaArt> = {}): MediaArt | null => ({
  thumbUrl: null,
  posterUrl: null,
  logoUrl: null,
  ...partial,
});

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

  function cache(resolveMediaArt = async () => new Map<string, MediaArt | null>()) {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      urls.push(url);
      return artResponse('image/png');
    }) as typeof fetch;
    return createArtCache({ repo, artDir, tmdbImageBaseUrl: TMDB_IMAGE_BASE, resolveMediaArt, fetchImpl });
  }

  it('downloads the TMDB poster when Fanart has none and records it', async () => {
    repo = createMemoryArtFilesRepo();
    const written = await cache().warm([{ mediaType: 'movie', tmdbId: 550, posterPath: '/p.jpg' }]);
    expect(written).toBe(1);
    expect(urls).toEqual([`${TMDB_IMAGE_BASE}/t/p/w780/p.jpg`]);
    const file = await fs.readdir(artDir);
    expect(file).toHaveLength(1);
    expect(file[0]).toBe('movie_550_poster.png');
  });

  it('prefers the Fanart hi-res poster over the TMDB poster', async () => {
    repo = createMemoryArtFilesRepo();
    const fanartPoster = 'https://fanart.tv/poster.jpg';
    const written = await cache(async () => new Map([['movie:550', art({ posterUrl: fanartPoster })]]))?.warm([
      { mediaType: 'movie', tmdbId: 550, posterPath: '/p.jpg' },
    ]);
    expect(written).toBe(1);
    expect(urls).toEqual([fanartPoster]);
  });

  it('skips files already downloaded and on disk', async () => {
    repo = createMemoryArtFilesRepo([
      {
        mediaType: 'movie',
        tmdbId: 550,
        kind: 'poster',
        originUrl: `${TMDB_IMAGE_BASE}/t/p/w780/p.jpg`,
        filePath: 'movie_550_poster.jpg',
        status: 'ok',
        fetchedAt: new Date().toISOString(),
      },
    ]);
    await fs.writeFile(path.join(artDir, 'movie_550_poster.jpg'), Buffer.from([1, 2, 3]));
    const written = await cache().warm([{ mediaType: 'movie', tmdbId: 550, posterPath: '/p.jpg' }]);
    expect(written).toBe(0);
    expect(urls).toHaveLength(0);
  });

  it('re-downloads when the recorded file is gone from disk', async () => {
    repo = createMemoryArtFilesRepo([
      {
        mediaType: 'movie',
        tmdbId: 550,
        kind: 'poster',
        originUrl: `${TMDB_IMAGE_BASE}/t/p/w780/p.jpg`,
        filePath: 'movie_550_poster.jpg',
        status: 'ok',
        fetchedAt: new Date().toISOString(),
      },
    ]);
    const written = await cache().warm([{ mediaType: 'movie', tmdbId: 550, posterPath: '/p.jpg' }]);
    expect(written).toBe(1);
    expect(urls).toHaveLength(1);
  });

  it('does nothing when no candidate exists for a title', async () => {
    repo = createMemoryArtFilesRepo();
    const written = await cache().warm([{ mediaType: 'movie', tmdbId: 550, posterPath: null }]);
    expect(written).toBe(0);
    expect(urls).toHaveLength(0);
  });

  it('records nothing when the download fails so the next pass retries', async () => {
    repo = createMemoryArtFilesRepo();
    const failing = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const c = createArtCache({
      repo,
      artDir,
      tmdbImageBaseUrl: TMDB_IMAGE_BASE,
      resolveMediaArt: async () => new Map(),
      fetchImpl: failing,
    });
    const written = await c.warm([{ mediaType: 'movie', tmdbId: 550, posterPath: '/p.jpg' }]);
    expect(written).toBe(0);
    const rows = await repo.getMany([{ mediaType: 'movie', tmdbId: 550 }]);
    expect(rows).toEqual([]);
  });
});
