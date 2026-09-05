export type MediaType = 'movie' | 'tv';
export type SearchType = MediaType | 'all';
export type DiscoverSection = 'trending-week' | 'best-movies' | 'best-tv';
export type ImageProvider = 'tmdb' | 'fanart';

export interface HomeSection {
  section: DiscoverSection;
  title: string;
}

export interface SeasonEpisodesResponse {
  season: TvSeasonSummary;
  episodes: TvEpisode[];
}

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

/** Which seasons/episodes a release covers; `episodes: null` = whole season. */
export interface Coverage {
  season: number;
  episodes: [number, number] | null;
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

export interface SourceGroup {
  key: string;
  cleanTitle: string;
  resolution: Source['resolution'];
  source: Source['source'];
  codec: Source['codec'];
  hdr: boolean;
  isDolbyVision: boolean;
  variants: Source[];
  best: Source;
}

export type SourceSortKey = 'seeders' | 'size' | 'age' | 'resolution' | 'sizePerSeeder';

export interface SourceFilters {
  indexers: string[];
  resolutions: string[];
  sources: string[];
  codecs: string[];
  minSeeders: number | null;
  minSizeGB: number | null;
  maxSizeGB: number | null;
  regex: string;
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

export type PlayMode = 'direct' | 'remux-audio' | 'transcode' | 'player-required';

export interface StreamFileInfo {
  relative: string;
  mime: string;
  size: number;
  complete: boolean;
  seasonNumber: number | null;
  episodeNumber: number | null;
}

export interface PlayInfo {
  mode: PlayMode;
  videoCodec: string | null;
  audioCodec: string | null;
  height: number | null;
  streamUrl: string;
  playUrl: string;
  fileUrl: string;
}

export interface CreateDownloadPayload {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  infoHash: string;
  magnetUri: string;
  torrentName: string;
  indexer: string;
  resolution: Source['resolution'];
  source: Source['source'];
  codec: Source['codec'];
  hdr: boolean;
  isDolbyVision: boolean;
}

export const STATE_COLORS: Record<TorrentState, string> = {
  queued: 'gray',
  'fetching-metadata': 'blue',
  downloading: 'blue',
  stalled: 'amber',
  paused: 'orange',
  checking: 'purple',
  seeding: 'green',
  error: 'red',
  unknown: 'gray',
};
