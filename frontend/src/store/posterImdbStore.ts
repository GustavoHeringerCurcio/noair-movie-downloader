import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Whether Home/Search title cards show the true IMDb score as a small
 * bottom-left badge over the poster art. Default ON — the badge reads the
 * cached `imdbRating` the listings carry (T-004) and appears only when the
 * backend actually knows the score (no empty slot for unknown titles).
 *
 * Persisted per device (localStorage), matching the poster-style/player
 * preference pattern. Controls ONLY the on-poster badge; the hover-card and
 * detail-hero IMDb chips are untouched.
 */
export const DEFAULT_POSTER_IMDB = true;

interface PosterImdbState {
  show: boolean;
  setShow: (show: boolean) => void;
}

export const usePosterImdbStore = create<PosterImdbState>()(
  persist(
    (set) => ({
      show: DEFAULT_POSTER_IMDB,
      setShow: (show) => set({ show }),
    }),
    { name: 'movie-downloader:poster-imdb' },
  ),
);
