import { create } from 'zustand';

const KEY_PREFIX = 'movie-downloader.playback.';

function storageKey(infoHash: string, file: string | null): string {
  return `${KEY_PREFIX}${infoHash}${file ? `|${file}` : ''}`;
}

interface PlaybackState {
  getPosition: (infoHash: string, file: string | null) => number;
  setPosition: (infoHash: string, file: string | null, seconds: number) => void;
  clearPosition: (infoHash: string, file: string | null) => void;
}

export const usePlaybackStore = create<PlaybackState>(() => ({
  getPosition: (infoHash, file) => {
    try {
      const raw = window.localStorage.getItem(storageKey(infoHash, file));
      const seconds = raw ? Number(raw) : 0;
      return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    } catch {
      return 0;
    }
  },
  setPosition: (infoHash, file, seconds) => {
    try {
      if (!Number.isFinite(seconds) || seconds < 0) return;
      window.localStorage.setItem(storageKey(infoHash, file), String(Math.floor(seconds)));
    } catch {
      // storage may be unavailable — degrade silently
    }
  },
  clearPosition: (infoHash, file) => {
    try {
      window.localStorage.removeItem(storageKey(infoHash, file));
    } catch {
      // ignore
    }
  },
}));
