import type pg from 'pg';
import type { ArtSubject, MediaType } from '../types.js';

/** What the poster pipeline stores on disk for a title (OMDb portrait, D21). */
export type ArtKind = 'poster';

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
  /** True IMDb score (one decimal) stored from the OMDb response; null until known/backfilled. */
  imdbRating: number | null;
}

export interface ArtFilesRepository {
  /** Rows for the given subjects (any kind); missing (subject, kind) combos are absent. */
  getMany(subjects: ArtSubject[]): Promise<ArtFileRow[]>;
  upsertMany(rows: ArtFileRow[]): Promise<void>;
  /** Poster rows whose rating has not been captured yet (oldest fetch first) — feeds the backfill. */
  listPosterRowsMissingRating(): Promise<ArtFileRow[]>;
  /** Store the IMDb scores resolved by the backfill onto their poster rows. */
  updateImdbRatings(entries: Array<{ mediaType: ArtSubject['mediaType']; tmdbId: number; imdbRating: number }>): Promise<void>;
}

interface ArtFileDbRow {
  media_type: MediaType;
  tmdb_id: number;
  kind: ArtKind;
  origin_url: string | null;
  file_path: string | null;
  status: ArtFileStatus;
  fetched_at: string;
  imdb_rating: string | null;
}

function parseRating(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
    imdbRating: parseRating(row.imdb_rating),
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
      `SELECT media_type, tmdb_id, kind, origin_url, file_path, status, fetched_at, imdb_rating
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
      const offset = index * 7;
      tuples.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`);
      values.push(row.mediaType, row.tmdbId, row.kind, row.originUrl, row.filePath, row.status, row.imdbRating);
    });
    await pool.query(
      `INSERT INTO art_files
         (media_type, tmdb_id, kind, origin_url, file_path, status, imdb_rating)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (media_type, tmdb_id, kind) DO UPDATE SET
         origin_url = EXCLUDED.origin_url,
         file_path = EXCLUDED.file_path,
         status = EXCLUDED.status,
         imdb_rating = COALESCE(EXCLUDED.imdb_rating, art_files.imdb_rating),
         fetched_at = now()`,
      values,
    );
  }

  async function listPosterRowsMissingRating(): Promise<ArtFileRow[]> {
    const result = await pool.query<ArtFileDbRow>(
      `SELECT media_type, tmdb_id, kind, origin_url, file_path, status, fetched_at, imdb_rating
       FROM art_files
       WHERE kind = 'poster' AND imdb_rating IS NULL
       ORDER BY fetched_at ASC`,
    );
    return result.rows.map(rowToModel);
  }

  async function updateImdbRatings(
    entries: Array<{ mediaType: ArtSubject['mediaType']; tmdbId: number; imdbRating: number }>,
  ): Promise<void> {
    if (entries.length === 0) return;
    const values: unknown[] = [];
    const tuples: string[] = [];
    entries.forEach((entry, index) => {
      const offset = index * 3;
      tuples.push(`($${offset + 1}::text, $${offset + 2}::int, $${offset + 3}::numeric(3,1))`);
      values.push(entry.mediaType, entry.tmdbId, entry.imdbRating);
    });
    await pool.query(
      `UPDATE art_files SET imdb_rating = v.rating
       FROM (VALUES ${tuples.join(', ')}) AS v(media_type, tmdb_id, rating)
       WHERE art_files.media_type = v.media_type
         AND art_files.tmdb_id = v.tmdb_id
         AND art_files.kind = 'poster'`,
      values,
    );
  }

  return { getMany, upsertMany, listPosterRowsMissingRating, updateImdbRatings };
}
