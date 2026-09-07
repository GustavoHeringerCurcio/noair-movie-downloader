import type {
  AudioLang,
  CreateDownloadPayload,
  DiscoverSection,
  DownloadRecord,
  HoverCardInfo,
  MediaDetail,
  MediaItem,
  MediaType,
  PlayInfo,
  SearchType,
  SeasonEpisodesResponse,
  SourcesResponse,
  StreamFileInfo,
  Trailer,
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

/**
 * Portrait poster the backend downloaded to its `art` volume (D21). The image
 * route lazily warms a title on first request, so this resolves for anything
 * that has an OMDb poster; otherwise it 404s and the card shows its monogram.
 */
export function cardPosterUrl(mediaType: MediaType, tmdbId: number): string {
  return `/api/images/art/${mediaType}/${tmdbId}/poster`;
}

/**
 * 16:9 key-art thumbnail the backend cached from fanart.tv `moviethumb`/
 * `tvthumb` (T-002, S8c) — the primary wide art of the horizontal poster card.
 * The route warms on first miss; a 404 means the title has no fanart thumb and
 * the card falls back to backdrop + logo / typography.
 */
export function fanartThumbUrl(mediaType: MediaType, tmdbId: number): string {
  return `/api/images/fanart/${mediaType}/${tmdbId}/thumb`;
}

/**
 * Transparent studio logo the backend cached from TMDB `/images` `logos`
 * (T-002, S8b) — overlaid on the backdrop in the horizontal fallback composite.
 */
export function logoUrl(mediaType: MediaType, tmdbId: number): string {
  return `/api/images/art/${mediaType}/${tmdbId}/logo`;
}

export interface SiteSettings {
  language: { audio: AudioLang };
}

export function fetchSettings(): Promise<SiteSettings> {
  return request<SiteSettings>('/api/settings');
}

export function saveAudioLanguage(audio: AudioLang): Promise<SiteSettings> {
  return request<SiteSettings>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ language: { audio } }),
  });
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

const HOVER_TTL_MS = 60 * 60 * 1000;
const hoverCache = new Map<string, { promise: Promise<HoverCardInfo | null>; expires: number }>();

/**
 * Everything the expanded Netflix-style hover card needs (S16/D20): best
 * trailer + genres/duration/seasons/certification in one call. In-flight
 * requests are deduped and results (including "no hover card" answers) cached
 * ~1h. Any failure degrades to `null` — a hover card must never block a card.
 */
export function hoverCardFor(item: { tmdbId: number; mediaType: MediaType }): Promise<HoverCardInfo | null> {
  const key = `${item.mediaType}:${item.tmdbId}`;
  const cached = hoverCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = request<HoverCardInfo>(`/api/media/${item.tmdbId}/hover?type=${item.mediaType}`)
    .then((body) => body ?? null)
    .catch(() => null);
  hoverCache.set(key, { promise, expires: Date.now() + HOVER_TTL_MS });
  return promise;
}

/** Test hook — clears the module-level hover cache. */
export function clearHoverCache(): void {
  hoverCache.clear();
}

/** Looping hover-preview embed URL (D18/D20); sound defaults ON (`muted` false). */
export function trailerEmbedUrl(trailer: Trailer, opts: { muted?: boolean } = {}): string {
  const muted = opts.muted ?? false;
  if (trailer.provider === 'vimeo') {
    const v = muted ? '1' : '0';
    return `https://player.vimeo.com/video/${encodeURIComponent(trailer.videoId)}?autoplay=1&muted=${v}&loop=1&controls=0&title=0&byline=0&portrait=0`;
  }
  const m = muted ? '1' : '0';
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer.videoId)}?autoplay=1&mute=${m}&controls=0&playsinline=1&loop=1&playlist=${encodeURIComponent(trailer.videoId)}&modestbranding=1`;
}

export function seasonEpisodes(id: number, season: number): Promise<SeasonEpisodesResponse> {
  return request<SeasonEpisodesResponse>(`/api/media/${id}/season/${season}?type=tv`);
}

const SOURCES_TTL_MS = 10 * 60 * 1000;
const sourcesCache = new Map<string, { promise: Promise<SourcesResponse>; expires: number }>();

/**
 * Best-source search (S3). In-flight requests are deduped and successful
 * results cached ~10 min per context (`type:id:season:episode:audio`) so the
 * confirm sheet stays instant and re-visiting a title never re-asks Prowlarr.
 * HTTP failures are never cached, so Retry always hits the network again.
 */
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
  const cacheKey = `${type}:${id}:${context?.season ?? ''}:${context?.episode ?? ''}:${context?.audio ?? ''}`;
  const hit = sourcesCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.promise;
  const promise = request<SourcesResponse>(`/api/media/${id}/sources?${params.toString()}`);
  sourcesCache.set(cacheKey, { promise, expires: Date.now() + SOURCES_TTL_MS });
  // Failures are dropped once they settle so a later Retry really re-queries.
  promise.catch(() => {
    if (sourcesCache.get(cacheKey)?.promise === promise) sourcesCache.delete(cacheKey);
  });
  return promise;
}

/** Test hook — clears the module-level sources cache. */
export function clearSourcesCache(): void {
  sourcesCache.clear();
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
