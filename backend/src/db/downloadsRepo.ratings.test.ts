import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createDownloadsRepository } from './downloadsRepo.js';

interface QueryResult {
  rows: unknown[];
}

function downloadsRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    tmdb_id: 550,
    media_type: 'movie',
    title: 'Fight Club',
    year: 1999,
    poster_path: '/p.jpg',
    backdrop_path: null,
    season_number: null,
    episode_number: null,
    info_hash: 'a'.repeat(40),
    torrent_name: 'Fight.Club.1999.1080p',
    indexer: null,
    size_bytes: 1000,
    state: 'seeding',
    progress: 1,
    download_speed: 0,
    upload_speed: 0,
    eta_seconds: 0,
    ratio: 0,
    content_path: null,
    stream_file_path: null,
    created_at: '2026-09-01T00:00:00.000Z',
    completed_at: null,
    resolution: null,
    source: null,
    codec: null,
    hdr: false,
    is_dolby_vision: false,
    audio_lang: null,
    audio_mode: null,
    ...overrides,
  };
}

/**
 * Fake pool that answers the downloads list (`SELECT * FROM downloads`) and the
 * art_files rating read (`FROM art_files`) it performs for the feed.
 */
function makePool(overrides: {
  downloadRows?: Record<string, unknown>[];
  artRows?: Record<string, unknown>[];
  artFails?: boolean;
}): pg.Pool {
  const downloadRows = overrides.downloadRows ?? [];
  const pool = {
    async query(sql: string): Promise<QueryResult> {
      if (sql.includes('FROM art_files')) {
        if (overrides.artFails) throw new Error('db down');
        return { rows: overrides.artRows ?? [] };
      }
      return { rows: downloadRows };
    },
  } as unknown as pg.Pool;
  return pool;
}

describe('downloadsRepo.list() attaches the cached IMDb rating (My Downloads badge)', () => {
  it('adds imdbRating from each record’s art_files poster row', async () => {
    const repo = createDownloadsRepository(
      makePool({
        downloadRows: [
          downloadsRow({ id: 1, info_hash: 'a'.repeat(40), tmdb_id: 550, media_type: 'movie' }),
          downloadsRow({ id: 2, info_hash: 'b'.repeat(40), tmdb_id: 100, media_type: 'tv' }),
        ],
        artRows: [
          { media_type: 'movie', tmdb_id: 550, imdb_rating: '8.3' },
          { media_type: 'tv', tmdb_id: 100, imdb_rating: '8.7' },
        ],
      }),
    );
    const records = await repo.list();
    expect(records[0]?.imdbRating).toBe(8.3);
    expect(records[1]?.imdbRating).toBe(8.7);
  });

  it('maps a missing stored rating to imdbRating null', async () => {
    const repo = createDownloadsRepository(
      makePool({
        downloadRows: [downloadsRow({ tmdb_id: 550, media_type: 'movie' })],
        artRows: [],
      }),
    );
    const records = await repo.list();
    expect(records[0]?.imdbRating).toBeNull();
  });

  it('skips the art_files read entirely when no record has a TMDB subject', async () => {
    const repo = createDownloadsRepository(
      makePool({ downloadRows: [downloadsRow({ tmdb_id: null, media_type: null })] }),
    );
    const records = await repo.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.imdbRating).toBeUndefined();
  });

  it('degrades to no ratings (never throws) when the art_files read fails', async () => {
    const repo = createDownloadsRepository(
      makePool({
        downloadRows: [downloadsRow({})],
        artFails: true,
      }),
    );
    await expect(repo.list()).resolves.toHaveLength(1);
    const records = await repo.list();
    expect(records[0]?.imdbRating).toBeUndefined();
  });
});
