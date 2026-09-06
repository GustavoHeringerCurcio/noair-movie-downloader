export type MediaType = 'movie' | 'tv';
export type SearchType = MediaType | 'all';
export type DiscoverSection = 'trending-week' | 'best-movies' | 'best-tv';
export type ImageProvider = 'tmdb' | 'fanart';

/** Temporary card A/B (D17): `backdrop` = current full-bleed tile; `poster` = poster-first layered tile. */
export type CardStyle = 'backdrop' | 'poster';

/** TMDB-native card art kinds (never FanArt). */
export type TmdbArtKind = 'backdrop' | 'poster';
/** FanArt.tv-native sizes; FanArt never falls back to TMDB art. */
export type FanartArtKind = 'thumb' | 'background' | 'poster';

export interface ArtPreference {
  tmdb: TmdbArtKind;
  fanart: FanartArtKind;
}

/** Primary audio languages we can act on. `en` is the implicit default/original. */
export type AudioLang = 'en' | 'pt' | 'es' | 'fr' | 'de' | 'it';

/** Audio descriptor read from a release title. */
export type AudioMode = 'dub' | 'dual' | 'multi';

export interface LanguageSettings {
  audio: AudioLang;
}

export interface SourcesResponse {
  sources: Source[];
  unreachable?: boolean;
  authError?: boolean;
  /** Set when a strict (non-English) audio search found nothing. */
  noMatchForAudio?: AudioLang;
}

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
  backgroundUrl?: string | null;
  posterUrl?: string | null;
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

/** Best hover-trailer for a title (S15); `videoId` is directly embeddable. */
export interface Trailer {
  provider: 'youtube' | 'vimeo';
  videoId: string;
  name: string | null;
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
  /** Language explicitly named in the title (e.g. `DUBLADO` → `pt`). */
  audioLang?: AudioLang | null;
  /** Audio descriptor from the title (`dub`/`dual`/`multi`). */
  audioMode?: AudioMode | null;
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
  /** Language named in the release title (persisted from the chosen Source). */
  audioLang?: AudioLang | null;
  /** Audio descriptor from the release title (`dub`/`dual`/`multi`). */
  audioMode?: AudioMode | null;
  art?: MediaArt | null;
}

export type PlayMode = 'direct' | 'remux-audio' | 'transcode' | 'player-required' | 'hls';

export interface StreamFileInfo {
  relative: string;
  mime: string;
  size: number;
  complete: boolean;
  seasonNumber: number | null;
  episodeNumber: number | null;
}

export interface VideoTrackInfo {
  index: number;
  codec: string | null;
  width: number | null;
  height: number | null;
  hdr: boolean;
  /** Codec profile label (e.g. "High", "Main", "Main 10") — used for decode-support checks. */
  profile?: string | null;
  /** Pixel format (e.g. "yuv420p", "yuv420p10le") — bit-depth gate for HEVC. */
  pixFmt?: string | null;
  /** ffprobe level value. */
  level?: number | null;
}

export interface AudioTrackInfo {
  index: number;
  codec: string | null;
  language: string | null;
  title: string | null;
  channels: number | null;
  default: boolean;
  profile?: string | null;
  sampleRate?: number | null;
}

export interface SubtitleTrackInfo {
  index: number;
  codec: string | null;
  kind: 'text' | 'bitmap';
  language: string | null;
  title: string | null;
  default: boolean;
}

export interface SidecarSubtitle {
  name: string;
  language: string | null;
}

export interface PlayInfo {
  mode: PlayMode;
  videoCodec: string | null;
  audioCodec: string | null;
  height: number | null;
  container: string | null;
  durationSeconds: number | null;
  video: VideoTrackInfo | null;
  audioTracks: AudioTrackInfo[];
  subtitleTracks: SubtitleTrackInfo[];
  sidecarSubtitles: SidecarSubtitle[];
  streamUrl: string;
  playUrl: string;
  fileUrl: string;
  /** Present when mode === 'hls': HLS master playlist for the Shaka player. */
  manifestUrl: string | null;
  /**
   * Present when mode === 'hls': `MediaSource.isTypeSupported` type strings for
   * the packaged rendition. Empty array = definitely not decodable in this
   * browser (skip packaging, use the external player); null = no gate.
   */
  mseProbe: string[] | null;
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
  audioLang?: AudioLang | null;
  audioMode?: AudioMode | null;
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
