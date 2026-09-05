import type {
  CreateDownloadPayload,
  DiscoverSection,
  DownloadRecord,
  ImageProvider,
  MediaArt,
  MediaDetail,
  MediaItem,
  MediaType,
  PlayInfo,
  SearchType,
  SeasonEpisodesResponse,
  Source,
  StreamFileInfo,
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

export function posterUrl(posterPath: string | null): string | null {
  return posterPath ? `/api/images/tmdb/w500${posterPath}` : null;
}

export function backdropUrl(backdropPath: string | null): string | null {
  return backdropPath ? `/api/images/tmdb/w1280${backdropPath}` : null;
}

export interface ArtworkSettings {
  provider: ImageProvider;
  fanartConfigured: boolean;
}

export function fetchSettings(): Promise<{ artwork: ArtworkSettings }> {
  return request<{ artwork: ArtworkSettings }>('/api/settings');
}

export function saveArtworkProvider(provider: ImageProvider): Promise<{ artwork: ArtworkSettings }> {
  return request<{ artwork: ArtworkSettings }>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ artwork: { provider } }),
  });
}

export interface CardArtSource {
  backdropPath: string | null;
  posterPath: string | null;
  art?: MediaArt | null;
}

/**
 * Candidate card images for a given artwork provider. Each provider list is
 * intentionally pure — a FanArt source is never mixed with a TMDB source, so a
 * broken/missing provider degrades to the placeholder instead of silently
 * swapping providers.
 */
export function cardImages(item: CardArtSource, provider: ImageProvider): string[] {
  if (provider === 'fanart') {
    const thumb = item.art?.thumbUrl;
    return thumb ? [thumb] : [];
  }
  const list = [backdropUrl(item.backdropPath), posterUrl(item.posterPath)];
  return list.filter((v): v is string => Boolean(v));
}

export function streamUrl(infoHash: string, file?: string): string {
  const qs = file ? `?file=${encodeURIComponent(file)}` : '';
  return `/api/stream/${encodeURIComponent(infoHash)}${qs}`;
}

export function playInfo(infoHash: string, file?: string): Promise<PlayInfo> {
  const qs = file ? `?file=${encodeURIComponent(file)}` : '';
  return request<PlayInfo>(`/api/downloads/${encodeURIComponent(infoHash)}/playinfo${qs}`);
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
  context?: { season?: number; episode?: number },
): Promise<{ sources: Source[]; unreachable?: boolean; authError?: boolean }> {
  const params = new URLSearchParams({ type });
  if (context?.season != null) {
    params.set('season', String(context.season));
    if (context.episode != null) params.set('episode', String(context.episode));
  }
  return request<{ sources: Source[]; unreachable?: boolean; authError?: boolean }>(
    `/api/media/${id}/sources?${params.toString()}`,
  );
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
