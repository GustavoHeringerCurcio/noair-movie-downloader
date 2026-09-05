export type MediaType = 'movie' | 'tv';
export type SearchType = MediaType | 'all';

export interface MediaArt {
  thumbUrl: string | null;
  logoUrl: string | null;
}

export interface MediaItem {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string;
  voteAverage: number;
  art?: MediaArt | null;
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
  seasons?: TvSeasonSummary[] | null;
  art?: MediaArt | null;
}

export interface TvSeasonSummary {
  seasonNumber: number;
  name: string;
  episodeCount: number;
}

export interface TvEpisode {
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  overview: string;
  stillPath: string | null;
  runtime: number | null;
  airDate: string | null;
}

/**
 * Which seasons/episodes a release covers, parsed from its title.
 * `episodes: null` means a whole season. `season: 0` is never produced.
 */
export interface Coverage {
  season: number;
  episodes: [number, number] | null;
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
  ageHours: number | null;
  resolution: '2160p' | '1080p' | '720p' | '480p' | null;
  source: 'REMUX' | 'BluRay' | 'WEB-DL' | 'WEBRip' | 'BDRip' | 'BRRip' | 'HDTV' | 'DVDRip' | null;
  codec: 'x264' | 'x265' | 'AV1' | 'XviD' | 'DivX' | null;
  hdr: boolean;
  isDolbyVision: boolean;
  group: string | null;
  cleanTitle: string;
  audioCodec: 'AAC' | 'AC3' | 'E-AC3' | 'DTS' | 'TrueHD' | 'FLAC' | 'Opus' | 'MP3' | 'Atmos' | null;
  coverage: Coverage[] | null;
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
  backdropPath: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
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
  resolution: '2160p' | '1080p' | '720p' | '480p' | null;
  source: 'REMUX' | 'BluRay' | 'WEB-DL' | 'WEBRip' | 'BDRip' | 'BRRip' | 'HDTV' | 'DVDRip' | null;
  codec: 'x264' | 'x265' | 'AV1' | 'XviD' | 'DivX' | null;
  hdr: boolean;
  isDolbyVision: boolean;
  art?: MediaArt | null;
}

export interface CreateDownloadInput {
  tmdbId: number | null;
  mediaType: MediaType | null;
  title: string | null;
  year: number | null;
  posterPath: string | null;
  backdropPath?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  infoHash: string;
  magnetUri: string;
  torrentName: string;
  indexer: string | null;
  resolution?: '2160p' | '1080p' | '720p' | '480p' | null;
  source?: 'REMUX' | 'BluRay' | 'WEB-DL' | 'WEBRip' | 'BDRip' | 'BRRip' | 'HDTV' | 'DVDRip' | null;
  codec?: 'x264' | 'x265' | 'AV1' | 'XviD' | 'DivX' | null;
  hdr?: boolean;
  isDolbyVision?: boolean;
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
