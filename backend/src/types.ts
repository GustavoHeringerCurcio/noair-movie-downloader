export type MediaType = 'movie' | 'tv';
export type SearchType = MediaType | 'all';

export interface MediaItem {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string;
  voteAverage: number;
}

export interface MediaDetail {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  voteAverage: number;
  genres: string[];
  runtime: number | null;
}

export interface Source {
  indexerId: number;
  indexer: string;
  title: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
  infoHash: string;
  magnetUri: string;
}

export type TorrentState =
  | 'queued'
  | 'fetching-metadata'
  | 'downloading'
  | 'stalled'
  | 'paused'
  | 'checking'
  | 'seeding'
  | 'error'
  | 'unknown';

export interface DownloadRecord {
  id: number;
  tmdbId: number | null;
  mediaType: MediaType | null;
  title: string | null;
  year: number | null;
  posterPath: string | null;
  infoHash: string;
  torrentName: string;
  indexer: string | null;
  sizeBytes: number;
  state: TorrentState;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  etaSeconds: number | null;
  ratio: number;
  contentPath: string | null;
  streamFilePath: string | null;
  streamable: boolean;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateDownloadInput {
  tmdbId: number | null;
  mediaType: MediaType | null;
  title: string | null;
  year: number | null;
  posterPath: string | null;
  infoHash: string;
  magnetUri: string;
  torrentName: string;
  indexer: string | null;
}

export class UpstreamError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}
