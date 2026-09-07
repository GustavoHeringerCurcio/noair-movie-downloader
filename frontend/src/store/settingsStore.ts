import { create } from 'zustand';
import { fetchSettings, saveAudioLanguage, saveMaxResolution } from '../api';
import { isMaxResolution } from '../lib/quality';
import type { AudioLang, MaxResolution } from '../types';

interface SettingsState {
  audio: AudioLang;
  maxResolution: MaxResolution;
  ready: boolean;
  saving: boolean;
  loadError: string | null;
  load: () => Promise<void>;
  saveAudio: (audio: AudioLang) => Promise<void>;
  saveMaxResolution: (maxResolution: MaxResolution) => Promise<void>;
}

export const DEFAULT_AUDIO_LANG: AudioLang = 'en';
export const DEFAULT_MAX_RESOLUTION: MaxResolution = '1080p';

export const useSettingsStore = create<SettingsState>((set) => ({
  audio: DEFAULT_AUDIO_LANG,
  maxResolution: DEFAULT_MAX_RESOLUTION,
  ready: false,
  saving: false,
  loadError: null,
  load: async () => {
    try {
      const res = await fetchSettings();
      const maxResolution = isMaxResolution(res.quality?.maxResolution)
        ? res.quality.maxResolution
        : DEFAULT_MAX_RESOLUTION;
      set({ audio: res.language.audio, maxResolution, ready: true, loadError: null });
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
      set({
        audio: res.language.audio,
        maxResolution: isMaxResolution(res.quality?.maxResolution)
          ? res.quality.maxResolution
          : DEFAULT_MAX_RESOLUTION,
        saving: false,
      });
    } catch (error) {
      set({ saving: false });
      throw error;
    }
  },
  saveMaxResolution: async (maxResolution) => {
    set({ saving: true });
    try {
      const res = await saveMaxResolution(maxResolution);
      set({
        audio: res.language.audio,
        maxResolution: isMaxResolution(res.quality?.maxResolution)
          ? res.quality.maxResolution
          : DEFAULT_MAX_RESOLUTION,
        saving: false,
      });
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

/** Active quality ceiling; before settings load completes, treat as 1080p. */
export function useMaxResolution(): MaxResolution {
  return useSettingsStore((s) => (s.ready ? s.maxResolution : DEFAULT_MAX_RESOLUTION));
}
