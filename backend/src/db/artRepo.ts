import type pg from 'pg';
import type { ArtSubject, MediaType } from '../types.js';

export interface MediaArtRow {
  mediaType: MediaType;
  tmdbId: number;
  tvdbId: number | null;
  thumbUrl: string | null;
  logoUrl: string | null;
  status: 'ok' | 'empty';
  fetchedAt: string;
}

export interface ArtRepository {
  /** Rows for the given subjects (missing subjects are simply absent). */
  getMany(keys: ArtSubject[]): Promise<MediaArtRow[]>;
  upsertMany(rows: MediaArtRow[]): Promise<void>;
}

interface MediaArtDbRow {
  media_type: MediaType;
  tmdb_id: number;
  tvdb_id: number | null;
  thumb_url: string | null;
  logo_url: string | null;
  status: 'ok' | 'empty';
  fetched_at: string;
}

function rowToModel(row: MediaArtDbRow): MediaArtRow {
  return {
    mediaType: row.media_type,
    tmdbId: row.tmdb_id,
    tvdbId: row.tvdb_id,
    thumbUrl: row.thumb_url,
    logoUrl: row.logo_url,
    status: row.status,
    fetchedAt: row.fetched_at,
  };
}

export function createArtRepository(pool: pg.Pool): ArtRepository {
  async function getMany(keys: ArtSubject[]): Promise<MediaArtRow[]> {
    if (keys.length === 0) return [];
    const movieIds = keys.filter((k) => k.mediaType === 'movie').map((k) => k.tmdbId);
    const tvIds = keys.filter((k) => k.mediaType === 'tv').map((k) => k.tmdbId);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (movieIds.length > 0) {
      params.push(movieIds);
      clauses.push(`(media_type = 'movie' AND tmdb_id = ANY($${params.length}::int[]))`);
    }
    if (tvIds.length > 0) {
      params.push(tvIds);
      clauses.push(`(media_type = 'tv' AND tmdb_id = ANY($${params.length}::int[]))`);
    }
    const result = await pool.query<MediaArtDbRow>(
      `SELECT media_type, tmdb_id, tvdb_id, thumb_url, logo_url, status, fetched_at
       FROM media_art WHERE ${clauses.join(' OR ')}`,
      params,
    );
    return result.rows.map(rowToModel);
  }

  async function upsertMany(rows: MediaArtRow[]): Promise<void> {
    if (rows.length === 0) return;
    const values: unknown[] = [];
    const tuples: string[] = [];
    rows.forEach((row, index) => {
      const offset = index * 6;
      tuples.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`);
      values.push(row.mediaType, row.tmdbId, row.tvdbId, row.thumbUrl, row.logoUrl, row.status);
    });
    await pool.query(
      `INSERT INTO media_art
         (media_type, tmdb_id, tvdb_id, thumb_url, logo_url, status)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (media_type, tmdb_id) DO UPDATE SET
         tvdb_id = EXCLUDED.tvdb_id,
         thumb_url = EXCLUDED.thumb_url,
         logo_url = EXCLUDED.logo_url,
         status = EXCLUDED.status,
         fetched_at = now()`,
      values,
    );
  }

  return { getMany, upsertMany };
}
