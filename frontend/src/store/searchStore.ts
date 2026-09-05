import { create } from 'zustand';

const STORAGE_KEY = 'movie-downloader.recent-searches';
const MAX_RECENT = 6;

function loadRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function persist(recents: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recents.slice(0, MAX_RECENT)));
  } catch {
    // storage may be unavailable — degrade silently
  }
}

export type SearchMediaType = 'all' | 'movie' | 'tv';

interface SearchState {
  open: boolean;
  query: string;
  type: SearchMediaType;
  recentSearches: string[];
  openSet: (open: boolean) => void;
  setQuery: (query: string) => void;
  setType: (type: SearchMediaType) => void;
  pushRecent: (term: string) => void;
  clearRecents: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  open: false,
  query: '',
  type: 'all',
  recentSearches: loadRecents(),
  openSet: (open) => set({ open }),
  setQuery: (query) => set({ query }),
  setType: (type) => set({ type }),
  pushRecent: (term) =>
    set((s) => {
      const trimmed = term.trim();
      const next = trimmed ? [trimmed, ...s.recentSearches.filter((r) => r.toLowerCase() !== trimmed.toLowerCase())] : s.recentSearches;
      const sliced = next.slice(0, MAX_RECENT);
      persist(sliced);
      return { recentSearches: sliced };
    }),
  clearRecents: () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    set({ recentSearches: [] });
  },
}));
