import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DownloadRecord, MediaType } from '../types';
import { bestPlayable, leadCopy } from '../lib/versions';

export function versionKey(mediaType: MediaType, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

interface VersionState {
  active: Record<string, string>;
  select: (key: string, infoHash: string) => void;
}

/**
 * App-wide "which copy of this title is primary" (per movie). Persisted to
 * localStorage so rails, the Downloads page and the Detail hero agree on the
 * Watch target. A selected hash that no longer exists falls back to the
 * default rule in `resolveActiveVersion`.
 */
export const useVersionStore = create<VersionState>()(
  persist(
    (set) => ({
      active: {},
      select: (key, infoHash) =>
        set((s) => ({ active: { ...s.active, [key]: infoHash } })),
    }),
    { name: 'movie-downloader:active-version' },
  ),
);

/**
 * Pure resolver for the active copy of a title. A persisted selection wins when
 * it still exists; otherwise the locked default rule (best playable, else the
 * most advanced copy) applies.
 */
export function resolveActiveVersion(
  key: string,
  downloads: DownloadRecord[],
  activeMap: Record<string, string>,
): string | null {
  if (downloads.length === 0) return null;
  const persisted = activeMap[key];
  if (persisted && downloads.some((d) => d.infoHash === persisted)) return persisted;
  return bestPlayable(downloads)?.infoHash ?? leadCopy(downloads)?.infoHash ?? null;
}

/** Hook: returns the infoHash of the copy that should be "the" copy of a title. */
export function useActiveVersion(
  mediaType: MediaType,
  tmdbId: number,
  downloads: DownloadRecord[],
): string | null {
  const key = versionKey(mediaType, tmdbId);
  const activeMap = useVersionStore((s) => s.active);
  return resolveActiveVersion(key, downloads, activeMap);
}
