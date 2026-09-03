import type {
  CreateDownloadPayload,
  DownloadRecord,
  MediaDetail,
  MediaItem,
  MediaType,
  PlayInfo,
  SearchType,
  Source,
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

export function streamUrl(infoHash: string): string {
  return `/api/stream/${encodeURIComponent(infoHash)}`;
}

export function playInfo(infoHash: string): Promise<PlayInfo> {
  return request<PlayInfo>(`/api/downloads/${encodeURIComponent(infoHash)}/playinfo`);
}

export function fileUrl(infoHash: string): string {
  return `/api/downloads/${encodeURIComponent(infoHash)}/file`;
}

export function search(q: string, type: SearchType): Promise<{ items: MediaItem[] }> {
  return request<{ items: MediaItem[] }>(`/api/search?q=${encodeURIComponent(q)}&type=${type}`);
}

export function mediaDetails(id: number, type: MediaType): Promise<MediaDetail> {
  return request<MediaDetail>(`/api/media/${id}?type=${type}`);
}

export function sources(
  id: number,
  type: MediaType,
): Promise<{ sources: Source[]; unreachable?: boolean; authError?: boolean }> {
  return request<{ sources: Source[]; unreachable?: boolean; authError?: boolean }>(
    `/api/media/${id}/sources?type=${type}`,
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
