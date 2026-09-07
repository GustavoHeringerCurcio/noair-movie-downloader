import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FriendlyPickMode } from '../types';

export const FRIENDLY_PICK_STORAGE_KEY = 'movie-downloader:friendly-pick';
export const DEFAULT_FRIENDLY_PICK_MODE: FriendlyPickMode = 'most-seeded';

export interface FriendlyPickOption {
  value: FriendlyPickMode;
  label: string;
  hint: string;
}

export const FRIENDLY_PICK_OPTIONS: FriendlyPickOption[] = [
  {
    value: 'most-seeded',
    label: 'Most-seeded',
    hint: 'Default — the release with the most seeders, whatever its codec.',
  },
  {
    value: 'web-playable',
    label: 'Web-playable first',
    hint: 'Prefer a release the in-browser player can exhibit (x264/AV1 · SDR · up to 1080p); only fall back to most-seeded when nothing qualifies.',
  },
];

interface FriendlyPickState {
  mode: FriendlyPickMode;
  setMode: (mode: FriendlyPickMode) => void;
}

const FRIENDLY_PICK_MODES: readonly FriendlyPickMode[] = ['most-seeded', 'web-playable'];

/**
 * How the friendly (one-click) Download auto-picks a source (T-003). A per-user
 * visual product setting, so it lives in localStorage (the audio-language
 * server setting is not involved). `most-seeded` stays the default so nothing
 * changes until the user opts in.
 */
export const useFriendlyPickStore = create<FriendlyPickState>()(
  persist(
    (set) => ({
      mode: DEFAULT_FRIENDLY_PICK_MODE,
      setMode: (mode) => set({ mode }),
    }),
    {
      name: FRIENDLY_PICK_STORAGE_KEY,
      // Guard against a corrupt/unknown persisted value (e.g. written by a
      // newer build) — never hydrate a mode we don't understand.
      merge: (persisted, current) => {
        const p = persisted as Partial<FriendlyPickState> | undefined;
        const mode = p?.mode != null && FRIENDLY_PICK_MODES.includes(p.mode) ? p.mode : current.mode;
        return { ...current, mode };
      },
    },
  ),
);
