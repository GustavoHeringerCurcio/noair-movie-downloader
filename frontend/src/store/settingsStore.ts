import { create } from 'zustand';
import { fetchSettings, saveArtworkProvider, saveAudioLanguage } from '../api';
import type { AudioLang, ImageProvider } from '../types';

interface SettingsState {
  provider: ImageProvider;
  fanartConfigured: boolean;
  audio: AudioLang;
  ready: boolean;
  saving: boolean;
  loadError: string | null;
  load: () => Promise<void>;
  saveProvider: (provider: ImageProvider) => Promise<void>;
  saveAudio: (audio: AudioLang) => Promise<void>;
}

export const DEFAULT_AUDIO_LANG: AudioLang = 'en';

export const useSettingsStore = create<SettingsState>((set) => ({
  provider: 'tmdb',
  fanartConfigured: false,
  audio: DEFAULT_AUDIO_LANG,
  ready: false,
  saving: false,
  loadError: null,
  load: async () => {
    try {
      const res = await fetchSettings();
      set({
        provider: res.artwork.provider,
        fanartConfigured: res.artwork.fanartConfigured,
        audio: res.language.audio,
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
      set({
        provider: res.artwork.provider,
        fanartConfigured: res.artwork.fanartConfigured,
        audio: res.language.audio,
        saving: false,
      });
    } catch (error) {
      set({ saving: false });
      throw error;
    }
  },
  saveAudio: async (audio) => {
    set({ saving: true });
    try {
      const res = await saveAudioLanguage(audio);
      set({
        audio: res.language.audio,
        provider: res.artwork.provider,
        fanartConfigured: res.artwork.fanartConfigured,
        saving: false,
      });
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

/** Active audio language; before settings load completes, treat as English. */
export function useAudioLanguage(): AudioLang {
  return useSettingsStore((s) => (s.ready ? s.audio : DEFAULT_AUDIO_LANG));
}
