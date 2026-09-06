import type { DownloadRecord } from '../types';
import { audioName } from './audio';

const RESOLUTION_RANK: Record<string, number> = { '2160p': 4, '1080p': 3, '720p': 2, '480p': 1 };

/** A copy is playable once a complete file exists (movies only at 100%). */
export function playable(d: DownloadRecord): boolean {
  return d.streamable === true;
}

/** "1080p WEB-DL x265 HDR" — the quality identity of a downloaded release. */
export function qualityName(d: DownloadRecord): string {
  const parts: string[] = [];
  if (d.resolution) parts.push(d.resolution);
  if (d.source) parts.push(d.source);
  if (d.codec) parts.push(d.codec);
  if (d.isDolbyVision) parts.push('DoVi');
  else if (d.hdr) parts.push('HDR');
  return parts.join(' ') || 'Unknown';
}

/**
 * Human label for a downloaded copy: audio first (so an EN and a PT-Dub 1080p
 * never read the same), then quality. e.g. `PT Dub · 1080p WEB-DL`.
 */
export function versionLabel(d: DownloadRecord): string {
  const audio = audioName(d);
  const quality = qualityName(d);
  return audio ? `${audio} · ${quality}` : quality;
}

/**
 * Locked default-version rule: the most recently completed playable copy
 * (an upgrade becomes the default the moment it finishes); tie-break toward
 * the higher resolution.
 */
export function bestPlayable(downloads: DownloadRecord[]): DownloadRecord | null {
  const playables = downloads.filter(playable);
  if (playables.length === 0) return null;
  return [...playables].sort((a, b) => {
    const aTime = (a.completedAt ?? a.createdAt) ?? '';
    const bTime = (b.completedAt ?? b.createdAt) ?? '';
    const timeOrder = bTime.localeCompare(aTime);
    if (timeOrder !== 0) return timeOrder;
    return (RESOLUTION_RANK[b.resolution ?? ''] ?? 0) - (RESOLUTION_RANK[a.resolution ?? ''] ?? 0);
  })[0] ?? null;
}

/**
 * Display order for every copy of one title: playable first (newest complete
 * first), then still-downloading copies by progress (furthest first).
 */
export function sortVersions(downloads: DownloadRecord[]): DownloadRecord[] {
  return [...downloads].sort((a, b) => {
    const aPlay = playable(a) ? 1 : 0;
    const bPlay = playable(b) ? 1 : 0;
    if (aPlay !== bPlay) return bPlay - aPlay;
    if (aPlay === 1) {
      const aTime = a.completedAt ?? a.createdAt ?? '';
      const bTime = b.completedAt ?? b.createdAt ?? '';
      return bTime.localeCompare(aTime);
    }
    return b.progress - a.progress;
  });
}

/** Most advanced copy of a title (used to focus the "arriving" status card). */
export function leadCopy(downloads: DownloadRecord[]): DownloadRecord | null {
  return sortVersions(downloads)[0] ?? null;
}

/**
 * Key used to group standalone copies of one movie into a single library item
 * (rail card / download row). TV stays one entry per season/episode download.
 */
export function movieGroupKey(d: DownloadRecord): string | null {
  if (d.mediaType !== 'movie' || d.tmdbId == null) return null;
  if (d.seasonNumber != null || d.episodeNumber != null) return null;
  return `movie:${d.tmdbId}`;
}
