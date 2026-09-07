import type pg from 'pg';
import type { ArtSubject, MediaType } from '../types.js';

/**
 * What the art pipeline stores on disk for a title:
 * - `poster` — OMDb portrait poster (D21, served by S8b)
 * - `thumb` — fanart.tv 16:9 key-art thumbnail (T-002, served by S8c)
 * - `logo` — TMDB transparent logo (T-002, served by S8b)
 */
export type ArtKind = 'poster' | 'thumb' | 'logo';

export type ArtFileStatus = 'ok' | 'empty';

export interface ArtFileRow {
  mediaType: MediaType;
  tmdbId: number;
  kind: ArtKind;
  originUrl: string | null;
  /** File name relative to `ART_DIR` (null when `status === 'empty'`). */
  filePath: string | null;
  status: ArtFileStatus;
  fetchedAt: string;
}

export interface ArtFilesRepository {
  /** Rows for the given subjects (any kind); missing (subject, kind) combos are absent. */
  getMany(subjects: ArtSubject[]): Promise<ArtFileRow[]>;
  upsertMany(rows: ArtFileRow[]): Promise<void>;
}

interface ArtFileDbRow {
  media_type: MediaType;
  tmdb_id: number;
  kind: ArtKind;
  origin_url: string | null;
  file_path: string | null;
  status: ArtFileStatus;
  fetched_at: string;
}

function rowToModel(row: ArtFileDbRow): ArtFileRow {
  return {
    mediaType: row.media_type,
    tmdbId: row.tmdb_id,
    kind: row.kind,
    originUrl: row.origin_url,
    filePath: row.file_path,
    status: row.status,
    fetchedAt: row.fetched_at,
  };
}

export function createArtFilesRepository(pool: pg.Pool): ArtFilesRepository {
  async function getMany(subjects: ArtSubject[]): Promise<ArtFileRow[]> {
    if (subjects.length === 0) return [];
    const movieIds = subjects.filter((k) => k.mediaType === 'movie').map((k) => k.tmdbId);
    const tvIds = subjects.filter((k) => k.mediaType === 'tv').map((k) => k.tmdbId);
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
    const result = await pool.query<ArtFileDbRow>(
      `SELECT media_type, tmdb_id, kind, origin_url, file_path, status, fetched_at
       FROM art_files WHERE ${clauses.join(' OR ')}`,
      params,
    );
    return result.rows.map(rowToModel);
  }

  async function upsertMany(rows: ArtFileRow[]): Promise<void> {
    if (rows.length === 0) return;
    const values: unknown[] = [];
    const tuples: string[] = [];
    rows.forEach((row, index) => {
      const offset = index * 6;
      tuples.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`);
      values.push(row.mediaType, row.tmdbId, row.kind, row.originUrl, row.filePath, row.status);
    });
    await pool.query(
      `INSERT INTO art_files
         (media_type, tmdb_id, kind, origin_url, file_path, status)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (media_type, tmdb_id, kind) DO UPDATE SET
         origin_url = EXCLUDED.origin_url,
         file_path = EXCLUDED.file_path,
         status = EXCLUDED.status,
         fetched_at = now()`,
      values,
    );
  }

  return { getMany, upsertMany };
}
