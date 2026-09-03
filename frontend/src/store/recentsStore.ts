import { create } from 'zustand';
import type { MediaItem } from '../types';

export const RECENTS_KEY = 'movie-downloader.recents';
export const RECENTS_MAX = 24;

export interface RecentEntry {
  item: MediaItem;
  viewedAt: number;
}

interface RecentsState {
  recents: RecentEntry[];
  record: (item: MediaItem) => void;
  clear: () => void;
}

function loadRecents(): RecentEntry[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentEntry);
  } catch {
    return [];
  }
}

function isRecentEntry(value: unknown): value is RecentEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { item?: unknown; viewedAt?: unknown };
  if (typeof v.viewedAt !== 'number') return false;
  const item = v.item as Partial<MediaItem> | undefined;
  if (typeof item !== 'object' || item === null) return false;
  return (
    typeof item.tmdbId === 'number' &&
    (item.mediaType === 'movie' || item.mediaType === 'tv') &&
    typeof item.title === 'string'
  );
}

function persist(recents: RecentEntry[]): void {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, RECENTS_MAX)));
  } catch {
    // storage may be unavailable (private mode, quota) — degrade to in-memory only
  }
}

export function upsertRecent(recents: RecentEntry[], item: MediaItem): RecentEntry[] {
  const entry: RecentEntry = { item, viewedAt: Date.now() };
  const rest = recents.filter(
    (r) => !(r.item.tmdbId === item.tmdbId && r.item.mediaType === item.mediaType),
  );
  return [entry, ...rest].slice(0, RECENTS_MAX);
}

export const useRecentsStore = create<RecentsState>((set) => ({
  recents: loadRecents(),
  record: (item) =>
    set((s) => {
      const next = upsertRecent(s.recents, item);
      persist(next);
      return { recents: next };
    }),
  clear: () => {
    try {
      window.localStorage.removeItem(RECENTS_KEY);
    } catch {
      // ignore
    }
    set({ recents: [] });
  },
}));
