import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const TRANSCODE_4K_STORAGE_KEY = 'movie-downloader:transcode-4k';
export const DEFAULT_TRANSCODE_4K = false;

interface Transcode4kState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

/**
 * Opt-in web rendition for 4K/UHD files (D27). When off (default), 4K stays
 * bit-perfect on the external-player flow; when on, the Watch page instead
 * builds a cached 1080p H.264 copy (~2.5h CPU + ~4 GB per title). A per-device
 * preference, so it lives in localStorage like the poster/friendly-pick toggles.
 */
export const useTranscode4kStore = create<Transcode4kState>()(
  persist(
    (set) => ({
      enabled: DEFAULT_TRANSCODE_4K,
      setEnabled: (enabled) => set({ enabled }),
    }),
    {
      name: TRANSCODE_4K_STORAGE_KEY,
      merge: (persisted, current) => {
        const p = persisted as Partial<Transcode4kState> | undefined;
        const enabled = typeof p?.enabled === 'boolean' ? p.enabled : current.enabled;
        return { ...current, enabled };
      },
    },
  ),
);

export function useTranscode4k(): boolean {
  return useTranscode4kStore((s) => s.enabled);
}
