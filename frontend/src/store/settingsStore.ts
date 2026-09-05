import { create } from 'zustand';
import { fetchSettings, saveArtworkProvider } from '../api';
import type { ImageProvider } from '../types';

interface SettingsState {
  provider: ImageProvider;
  fanartConfigured: boolean;
  ready: boolean;
  saving: boolean;
  loadError: string | null;
  load: () => Promise<void>;
  saveProvider: (provider: ImageProvider) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  provider: 'tmdb',
  fanartConfigured: false,
  ready: false,
  saving: false,
  loadError: null,
  load: async () => {
    try {
      const res = await fetchSettings();
      set({
        provider: res.artwork.provider,
        fanartConfigured: res.artwork.fanartConfigured,
        ready: true,
        loadError: null,
      });
    } catch (error) {
      set({
        ready: true,
        loadError: error instanceof Error ? error.message : 'Failed to load settings',
      });
    }
  },
  saveProvider: async (provider) => {
    set({ saving: true });
    try {
      const res = await saveArtworkProvider(provider);
      set({ provider: res.artwork.provider, fanartConfigured: res.artwork.fanartConfigured, saving: false });
    } catch (error) {
      set({ saving: false });
      throw error;
    }
  },
}));

/** Active artwork provider; before settings load completes, treat as TMDB. */
export function useImageProvider(): ImageProvider {
  return useSettingsStore((s) => (s.ready ? s.provider : 'tmdb'));
}
