import { create } from 'zustand';
import {
  fetchSettings,
  saveAudioLanguage,
  saveAutoConvertMovies,
  saveMaxResolution,
  saveReleaseCatalog,
} from '../api';
import { isMaxResolution } from '../lib/quality';
import type { AudioLang, MaxResolution, ReleaseCatalogMode } from '../types';

const isCatalogMode = (v: unknown): v is ReleaseCatalogMode =>
  v === 'browser-friendly' || v === 'all';

interface SettingsState {
  audio: AudioLang;
  maxResolution: MaxResolution;
  catalogMode: ReleaseCatalogMode;
  autoConvertMovies: boolean;
  ready: boolean;
  saving: boolean;
  loadError: string | null;
  load: () => Promise<void>;
  saveAudio: (audio: AudioLang) => Promise<void>;
  saveMaxResolution: (maxResolution: MaxResolution) => Promise<void>;
  saveCatalogMode: (mode: ReleaseCatalogMode) => Promise<void>;
  saveAutoConvert: (enabled: boolean) => Promise<void>;
}

export const DEFAULT_AUDIO_LANG: AudioLang = 'en';
export const DEFAULT_MAX_RESOLUTION: MaxResolution = '1080p';
export const DEFAULT_CATALOG_MODE: ReleaseCatalogMode = 'browser-friendly';
export const DEFAULT_AUTO_CONVERT = true;

export const useSettingsStore = create<SettingsState>((set) => ({
  audio: DEFAULT_AUDIO_LANG,
  maxResolution: DEFAULT_MAX_RESOLUTION,
  catalogMode: DEFAULT_CATALOG_MODE,
  autoConvertMovies: DEFAULT_AUTO_CONVERT,
  ready: false,
  saving: false,
  loadError: null,
  load: async () => {
    try {
      const res = await fetchSettings();
      set({
        audio: res.language.audio,
        maxResolution: isMaxResolution(res.quality?.maxResolution)
          ? res.quality.maxResolution
          : DEFAULT_MAX_RESOLUTION,
        catalogMode: isCatalogMode(res.catalog?.mode) ? res.catalog.mode : DEFAULT_CATALOG_MODE,
        autoConvertMovies: res.optimize?.autoConvertMovies ?? DEFAULT_AUTO_CONVERT,
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
  saveCatalogMode: async (mode) => {
    set({ saving: true });
    try {
      const res = await saveReleaseCatalog(mode);
      set({
        catalogMode: isCatalogMode(res.catalog?.mode) ? res.catalog.mode : DEFAULT_CATALOG_MODE,
        saving: false,
      });
    } catch (error) {
      set({ saving: false });
      throw error;
    }
  },
  saveAutoConvert: async (enabled) => {
    set({ saving: true });
    try {
      const res = await saveAutoConvertMovies(enabled);
      set({
        autoConvertMovies: res.optimize?.autoConvertMovies ?? DEFAULT_AUTO_CONVERT,
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

/** Active release-catalog strictness; before settings load, treat as browser-friendly. */
export function useReleaseCatalogMode(): ReleaseCatalogMode {
  return useSettingsStore((s) => (s.ready ? s.catalogMode : DEFAULT_CATALOG_MODE));
}
