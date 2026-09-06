import type pg from 'pg';
import type { CreateDownloadInput, DownloadRecord, TorrentState } from '../types.js';

interface DownloadRow {
  id: number;
  tmdb_id: number | null;
  media_type: string | null;
  title: string | null;
  year: number | null;
  poster_path: string | null;
  backdrop_path: string | null;
  season_number: number | null;
  episode_number: number | null;
  info_hash: string;
  torrent_name: string;
  indexer: string | null;
  size_bytes: string | number;
  state: string;
  progress: number;
  download_speed: string | number;
  upload_speed: string | number;
  eta_seconds: number;
  ratio: number;
  content_path: string | null;
  stream_file_path: string | null;
  created_at: string;
  completed_at: string | null;
  resolution: string | null;
  source: string | null;
  codec: string | null;
  hdr: boolean;
  is_dolby_vision: boolean;
  audio_lang: string | null;
  audio_mode: string | null;
}

function rowToRecord(row: DownloadRow): DownloadRecord {
  return {
    id: row.id,
    tmdbId: row.tmdb_id,
    mediaType: (row.media_type as DownloadRecord['mediaType']) ?? null,
    title: row.title,
    year: row.year,
    posterPath: row.poster_path,
    backdropPath: row.backdrop_path,
    seasonNumber: row.season_number,
    episodeNumber: row.episode_number,
    infoHash: row.info_hash,
    torrentName: row.torrent_name,
    indexer: row.indexer,
    sizeBytes: Number(row.size_bytes) || 0,
    state: row.state as TorrentState,
    progress: row.progress,
    downloadSpeed: Number(row.download_speed) || 0,
    uploadSpeed: Number(row.upload_speed) || 0,
    etaSeconds: row.eta_seconds === 0 ? null : row.eta_seconds,
    ratio: row.ratio,
    contentPath: row.content_path,
    streamFilePath: row.stream_file_path,
    streamable: row.stream_file_path != null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    resolution: (row.resolution as DownloadRecord['resolution']) ?? null,
    source: (row.source as DownloadRecord['source']) ?? null,
    codec: (row.codec as DownloadRecord['codec']) ?? null,
    hdr: row.hdr,
    isDolbyVision: row.is_dolby_vision,
    audioLang: (row.audio_lang as DownloadRecord['audioLang']) ?? null,
    audioMode: (row.audio_mode as DownloadRecord['audioMode']) ?? null,
  };
}

export interface DownloadUpdate {
  torrentName?: string;
  sizeBytes?: number;
  state?: TorrentState;
  progress?: number;
  downloadSpeed?: number;
  uploadSpeed?: number;
  etaSeconds?: number | null;
  ratio?: number;
  contentPath?: string | null;
  streamFilePath?: string | null;
  completedAt?: Date | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}

const UPDATE_COLUMNS: Record<keyof DownloadUpdate, string> = {
  torrentName: 'torrent_name',
  sizeBytes: 'size_bytes',
  state: 'state',
  progress: 'progress',
  downloadSpeed: 'download_speed',
  uploadSpeed: 'upload_speed',
  etaSeconds: 'eta_seconds',
  ratio: 'ratio',
  contentPath: 'content_path',
  streamFilePath: 'stream_file_path',
  completedAt: 'completed_at',
  seasonNumber: 'season_number',
  episodeNumber: 'episode_number',
};

export interface DownloadsRepository {
  insert(input: CreateDownloadInput): Promise<DownloadRecord>;
  findByInfoHash(infoHash: string): Promise<DownloadRecord | null>;
  findByTorrentName(torrentName: string): Promise<DownloadRecord | null>;
  list(): Promise<DownloadRecord[]>;
  update(infoHash: string, fields: DownloadUpdate): Promise<void>;
  adoptInfoHash(fromInfoHash: string, toInfoHash: string): Promise<void>;
  remove(infoHash: string): Promise<void>;
}

export function createDownloadsRepository(pool: pg.Pool): DownloadsRepository {
  async function insert(input: CreateDownloadInput): Promise<DownloadRecord> {
    const result = await pool.query<DownloadRow>(
      `INSERT INTO downloads
        (tmdb_id, media_type, title, year, poster_path, backdrop_path, season_number,
         episode_number, info_hash, torrent_name, indexer,
         resolution, source, codec, hdr, is_dolby_vision, audio_lang, audio_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING *`,
      [
        input.tmdbId,
        input.mediaType,
        input.title,
        input.year,
        input.posterPath,
        input.backdropPath ?? null,
        input.seasonNumber ?? null,
        input.episodeNumber ?? null,
        input.infoHash,
        input.torrentName,
        input.indexer,
        input.resolution ?? null,
        input.source ?? null,
        input.codec ?? null,
        input.hdr === true,
        input.isDolbyVision === true,
        input.audioLang ?? null,
        input.audioMode ?? null,
      ],
    );
    return rowToRecord(result.rows[0]!);
  }

  async function findByInfoHash(infoHash: string): Promise<DownloadRecord | null> {
    const result = await pool.query<DownloadRow>(
      'SELECT * FROM downloads WHERE info_hash = $1',
      [infoHash.toLowerCase()],
    );
    const row = result.rows[0];
    return row ? rowToRecord(row) : null;
  }

  async function findByTorrentName(torrentName: string): Promise<DownloadRecord | null> {
    const result = await pool.query<DownloadRow>(
      'SELECT * FROM downloads WHERE torrent_name = $1 LIMIT 1',
      [torrentName],
    );
    const row = result.rows[0];
    return row ? rowToRecord(row) : null;
  }

  async function list(): Promise<DownloadRecord[]> {
    const result = await pool.query<DownloadRow>('SELECT * FROM downloads ORDER BY created_at DESC');
    return result.rows.map(rowToRecord);
  }

  async function update(infoHash: string, fields: DownloadUpdate): Promise<void> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;
    const setClause = entries
      .map(([key], index) => `${UPDATE_COLUMNS[key as keyof DownloadUpdate]} = $${index + 1}`)
      .join(', ');
    const values = entries.map(([, value]) => {
      if (value === null) return null;
      if (value instanceof Date) return value.toISOString();
      return value;
    });
    await pool.query(
      `UPDATE downloads SET ${setClause} WHERE info_hash = $${entries.length + 1}`,
      [...values, infoHash.toLowerCase()],
    );
  }

  async function remove(infoHash: string): Promise<void> {
    await pool.query('DELETE FROM downloads WHERE info_hash = $1', [infoHash.toLowerCase()]);
  }

  async function adoptInfoHash(fromInfoHash: string, toInfoHash: string): Promise<void> {
    await pool.query(
      'UPDATE downloads SET info_hash = $1 WHERE info_hash = $2',
      [toInfoHash.toLowerCase(), fromInfoHash.toLowerCase()],
    );
  }

  return { insert, findByInfoHash, findByTorrentName, list, update, adoptInfoHash, remove };
}
