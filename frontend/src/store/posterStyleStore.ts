import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Poster orientation for every Home/Search rail card (T-002):
 * - `horizontal` (default) — the 16:9 horizontal-poster look (fanart key-art
 *   thumb → TMDB backdrop + logo / typography fallback).
 * - `vertical` — classic 2:3 poster cards using raw TMDB poster art.
 *
 * Persisted to localStorage (matching the player-preference pattern, D19
 * versionStore) so the choice survives reloads on the device.
 */
export type PosterStyle = 'horizontal' | 'vertical';

export const DEFAULT_POSTER_STYLE: PosterStyle = 'horizontal';

interface PosterStyleState {
  style: PosterStyle;
  setStyle: (style: PosterStyle) => void;
}

export const usePosterStyleStore = create<PosterStyleState>()(
  persist(
    (set) => ({
      style: DEFAULT_POSTER_STYLE,
      setStyle: (style) => set({ style }),
    }),
    { name: 'movie-downloader:poster-style' },
  ),
);

/** CSS class added to the app shell when vertical posters are active. */
export function posterStyleClass(style: PosterStyle): string {
  return style === 'vertical' ? 'posters-vertical' : '';
}
