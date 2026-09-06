import { create } from 'zustand';
import { fetchSettings, saveAudioLanguage } from '../api';
import type { AudioLang } from '../types';

interface SettingsState {
  audio: AudioLang;
  ready: boolean;
  saving: boolean;
  loadError: string | null;
  load: () => Promise<void>;
  saveAudio: (audio: AudioLang) => Promise<void>;
}

export const DEFAULT_AUDIO_LANG: AudioLang = 'en';

export const useSettingsStore = create<SettingsState>((set) => ({
  audio: DEFAULT_AUDIO_LANG,
  ready: false,
  saving: false,
  loadError: null,
  load: async () => {
    try {
      const res = await fetchSettings();
      set({ audio: res.language.audio, ready: true, loadError: null });
    } catch (error) {
      set({
        ready: true,
        loadError: error instanceof Error ? error.message : 'Failed to load settings',
      });
    }
  },
  saveAudio: async (audio) => {
    set({ saving: true });
    try {
      const res = await saveAudioLanguage(audio);
      set({ audio: res.language.audio, saving: false });
    } catch (error) {
      set({ saving: false });
      throw error;
    }
  },
}));

/** Active audio language; before settings load completes, treat as English. */
export function useAudioLanguage(): AudioLang {
  return useSettingsStore((s) => (s.ready ? s.audio : DEFAULT_AUDIO_LANG));
}
