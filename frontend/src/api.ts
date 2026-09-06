import type {
  AudioLang,
  ArtPreference,
  CardStyle,
  CreateDownloadPayload,
  DiscoverSection,
  DownloadRecord,
  FanartArtKind,
  ImageProvider,
  MediaArt,
  MediaDetail,
  MediaItem,
  MediaType,
  PlayInfo,
  SearchType,
  SeasonEpisodesResponse,
  SourcesResponse,
  StreamFileInfo,
  TmdbArtKind,
} from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const message = body?.error ?? `Request failed (HTTP ${res.status})`;
    const error = new Error(message) as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return body;
}

export function posterUrl(posterPath: string | null, size: 'w500' | 'w780' = 'w500'): string | null {
  return posterPath ? `/api/images/tmdb/${size}${posterPath}` : null;
}

export function backdropUrl(backdropPath: string | null): string | null {
  return backdropPath ? `/api/images/tmdb/w1280${backdropPath}` : null;
}

/** S8b — artwork the pipeline downloaded to the backend `art` volume. */
export function localArtUrl(mediaType: MediaType, tmdbId: number, kind: 'poster' | 'background' | 'logo'): string {
  return `/api/images/art/${mediaType}/${tmdbId}/${kind}`;
}

export interface ArtworkSettings {
  provider: ImageProvider;
  fanartConfigured: boolean;
  preference: ArtPreference;
  /** Temporary card A/B (D17). */
  style: CardStyle;
}

export interface SiteSettings {
  artwork: ArtworkSettings;
  language: { audio: AudioLang };
}

export const DEFAULT_ART_PREFERENCE: ArtPreference = { tmdb: 'backdrop', fanart: 'thumb' };
export const DEFAULT_CARD_STYLE: CardStyle = 'backdrop';

export function fetchSettings(): Promise<SiteSettings> {
  return request<SiteSettings>('/api/settings');
}

export function saveArtworkProvider(provider: ImageProvider): Promise<SiteSettings> {
  return request<SiteSettings>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ artwork: { provider } }),
  });
}

export function saveArtworkPreference(preference: Partial<ArtPreference>): Promise<SiteSettings> {
  return request<SiteSettings>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ artwork: { preference } }),
  });
}

export function saveCardStyle(style: CardStyle): Promise<SiteSettings> {
  return request<SiteSettings>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ artwork: { style } }),
  });
}

export function saveAudioLanguage(audio: AudioLang): Promise<SiteSettings> {
  return request<SiteSettings>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ language: { audio } }),
  });
}

export interface CardArtSource {
  backdropPath: string | null;
  posterPath: string | null;
  art?: MediaArt | null;
}

/** FanArt candidate order: preferred kind first, then the other FanArt sizes. */
const FANART_KIND_ORDER: FanartArtKind[] = ['thumb', 'background', 'poster'];

function fanartUrls(art: MediaArt | null | undefined): Record<FanartArtKind, string | null> {
  return {
    thumb: art?.thumbUrl ?? null,
    background: art?.backgroundUrl ?? null,
    poster: art?.posterUrl ?? null,
  };
}

/**
 * Candidate card images for a title under a given artwork provider + preference.
 *
 * STRICT: candidates never mix providers.
 * - TMDB mode → only TMDB proxy URLs (preferred kind first, then the other TMDB kind).
 * - FanArt mode → only FanArt.tv URLs (preferred FanArt size first, then other FanArt sizes).
 * A title with nothing from the active provider yields an empty list (UI shows a
 * placeholder) — it never silently borrows the other provider's art.
 */
export function cardImages(item: CardArtSource, provider: ImageProvider, preference: ArtPreference): string[] {
  if (provider === 'fanart') {
    const urls = fanartUrls(item.art);
    const preferred = preference.fanart;
    const ordered = [preferred, ...FANART_KIND_ORDER.filter((k) => k !== preferred)];
    return ordered.map((kind) => urls[kind]).filter((v): v is string => Boolean(v));
  }
  // TMDB mode — strictly TMDB proxy URLs (backdrop → poster), never FanArt.
  const backdrop = backdropUrl(item.backdropPath);
  const poster = posterUrl(item.posterPath);
  const preferred: TmdbArtKind = preference.tmdb;
  const ordered = preferred === 'backdrop' ? [backdrop, poster] : [poster, backdrop];
  return ordered.filter((v): v is string => Boolean(v));
}

/** Poster-first layered tile (D17, temporary): needs the title's identity to build S8b URLs. */
export interface PosterCardLayers {
  /** Ordered background candidates (full-bleed, CSS-blurred unless it is 16:9 key art). */
  background: string[];
  /** Ordered poster candidates (the crisp figure — title identity). */
  figure: string[];
}

export function dedupeUrls(urls: Array<string | null>): string[] {
  return urls.filter((u): u is string => Boolean(u)).filter((u, i, all) => all.indexOf(u) === i);
}

export function posterStyleLayers(
  item: CardArtSource & { mediaType: MediaType; tmdbId: number },
): PosterCardLayers {
  const posterUrlHi = posterUrl(item.posterPath, 'w780');
  const posterUrlLo = posterUrl(item.posterPath);
  const localPoster = item.posterPath ? localArtUrl(item.mediaType, item.tmdbId, 'poster') : null;

  const figure = dedupeUrls([localPoster, item.art?.posterUrl ?? null, posterUrlHi, posterUrlLo]);
  const background = dedupeUrls([
    item.art?.thumbUrl ?? null,
    backdropUrl(item.backdropPath),
    localPoster,
    item.art?.posterUrl ?? null,
    posterUrlHi,
  ]);
  return { background, figure };
}

export function fanartArtKindLabel(kind: FanartArtKind): string {
  switch (kind) {
    case 'thumb':
      return 'Key art (16:9 thumb)';
    case 'background':
      return 'HD background';
    case 'poster':
      return 'Poster';
  }
}

export function tmdbArtKindLabel(kind: TmdbArtKind): string {
  return kind === 'backdrop' ? 'Backdrop' : 'Poster';
}

export function artworkPreview(tmdbId: number, type: MediaType): Promise<ArtworkPreview> {
  return request<ArtworkPreview>(`/api/settings/artwork-preview?tmdbId=${tmdbId}&type=${type}`);
}

export interface ArtworkPreview {
  title: string;
  year: number | null;
  mediaType: MediaType;
  tmdbId: number;
  tmdb: { posterPath: string | null; backdropPath: string | null };
  fanart: {
    thumbUrl: string | null;
    backgroundUrl: string | null;
    posterUrl: string | null;
    logoUrl: string | null;
  } | null;
}

export function streamUrl(infoHash: string, file?: string): string {
  const qs = file ? `?file=${encodeURIComponent(file)}` : '';
  return `/api/stream/${encodeURIComponent(infoHash)}${qs}`;
}

/**
 * Custom-scheme URL that hands an HTTP Range stream to a local player
 * (VLC/MPV/…) once the `movie://` handler is registered (see Settings → Local
 * player). The browser can never launch a native app on its own — this only
 * triggers when a protocol handler exists on the user's machine.
 */
export function externalPlayerUrl(infoHash: string, file?: string): string {
  const http = `${window.location.origin}${streamUrl(infoHash, file)}`;
  return `movie://${http}`;
}

export function playInfo(infoHash: string, file?: string): Promise<PlayInfo> {
  const qs = file ? `?file=${encodeURIComponent(file)}` : '';
  return request<PlayInfo>(`/api/downloads/${encodeURIComponent(infoHash)}/playinfo${qs}`);
}

export interface PackageStatus {
  phase: 'idle' | 'packaging' | 'ready' | 'failed';
  progress: number;
  error: string | null;
}

export function packageStatus(infoHash: string, file?: string): Promise<PackageStatus> {
  const qs = file ? `?file=${encodeURIComponent(file)}` : '';
  return request<PackageStatus>(`/api/playback/${encodeURIComponent(infoHash)}/hls/status${qs}`);
}

export function clearPackage(infoHash: string, file?: string): Promise<void> {
  const qs = file ? `?file=${encodeURIComponent(file)}` : '';
  return request<void>(`/api/playback/${encodeURIComponent(infoHash)}/hls${qs}`, { method: 'DELETE' });
}

export function fileUrl(infoHash: string, file?: string): string {
  const qs = file ? `?file=${encodeURIComponent(file)}` : '';
  return `/api/downloads/${encodeURIComponent(infoHash)}/file${qs}`;
}

export function downloadFiles(infoHash: string): Promise<{ files: StreamFileInfo[] }> {
  return request<{ files: StreamFileInfo[] }>(`/api/downloads/${encodeURIComponent(infoHash)}/files`);
}

export function search(q: string, type: SearchType): Promise<{ items: MediaItem[] }> {
  return request<{ items: MediaItem[] }>(`/api/search?q=${encodeURIComponent(q)}&type=${type}`);
}

export function browse(section: DiscoverSection): Promise<{ items: MediaItem[] }> {
  return request<{ items: MediaItem[] }>(`/api/browse?section=${section}`);
}

export function mediaDetails(id: number, type: MediaType): Promise<MediaDetail> {
  return request<MediaDetail>(`/api/media/${id}?type=${type}`);
}

export function seasonEpisodes(id: number, season: number): Promise<SeasonEpisodesResponse> {
  return request<SeasonEpisodesResponse>(`/api/media/${id}/season/${season}?type=tv`);
}

export function sources(
  id: number,
  type: MediaType,
  context?: { season?: number; episode?: number; audio?: AudioLang },
): Promise<SourcesResponse> {
  const params = new URLSearchParams({ type });
  if (context?.audio != null) {
    params.set('audio', context.audio);
  }
  if (context?.season != null) {
    params.set('season', String(context.season));
    if (context.episode != null) params.set('episode', String(context.episode));
  }
  return request<SourcesResponse>(`/api/media/${id}/sources?${params.toString()}`);
}

export function listDownloads(): Promise<{ downloads: DownloadRecord[] }> {
  return request<{ downloads: DownloadRecord[] }>('/api/downloads');
}

export function createDownload(payload: CreateDownloadPayload): Promise<DownloadRecord> {
  return request<DownloadRecord>('/api/downloads', { method: 'POST', body: JSON.stringify(payload) });
}

export function removeDownload(infoHash: string, deleteFiles: boolean): Promise<void> {
  return request<void>(`/api/downloads/${encodeURIComponent(infoHash)}?deleteFiles=${deleteFiles}`, {
    method: 'DELETE',
  });
}

export function pauseDownload(infoHash: string): Promise<void> {
  return request<void>(`/api/downloads/${encodeURIComponent(infoHash)}/pause`, { method: 'POST' });
}

export function resumeDownload(infoHash: string): Promise<void> {
  return request<void>(`/api/downloads/${encodeURIComponent(infoHash)}/resume`, { method: 'POST' });
}

export function humanSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  const fixed = i === 0 ? String(Math.round(value)) : value.toFixed(1);
  const trimmed = fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
  return `${trimmed} ${units[i]}`;
}

export function humanSpeed(bytesPerSec: number): string {
  return bytesPerSec > 0 ? `${humanSize(bytesPerSec)}/s` : '0 B/s';
}

export function humanEta(seconds: number | null): string {
  if (seconds == null || seconds < 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
