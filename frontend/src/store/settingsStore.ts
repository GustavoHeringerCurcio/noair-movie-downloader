import { create } from 'zustand';
import {
  DEFAULT_ART_PREFERENCE,
  DEFAULT_CARD_STYLE,
  fetchSettings,
  saveArtworkPreference,
  saveArtworkProvider,
  saveAudioLanguage,
  saveCardStyle,
} from '../api';
import type { ArtPreference, AudioLang, CardStyle, FanartArtKind, ImageProvider, TmdbArtKind } from '../types';

interface SettingsState {
  provider: ImageProvider;
  preference: ArtPreference;
  /** Temporary card A/B (D17). */
  style: CardStyle;
  fanartConfigured: boolean;
  audio: AudioLang;
  ready: boolean;
  saving: boolean;
  loadError: string | null;
  load: () => Promise<void>;
  saveProvider: (provider: ImageProvider) => Promise<void>;
  saveTmdbKind: (kind: TmdbArtKind) => Promise<void>;
  saveFanartKind: (kind: FanartArtKind) => Promise<void>;
  saveStyle: (style: CardStyle) => Promise<void>;
  saveAudio: (audio: AudioLang) => Promise<void>;
}

export const DEFAULT_AUDIO_LANG: AudioLang = 'en';

function applySettings(res: {
  artwork: { provider: ImageProvider; fanartConfigured: boolean; preference: ArtPreference; style: CardStyle };
  language: { audio: AudioLang };
}): Partial<SettingsState> {
  return {
    provider: res.artwork.provider,
    fanartConfigured: res.artwork.fanartConfigured,
    preference: { ...DEFAULT_ART_PREFERENCE, ...res.artwork.preference },
    style: res.artwork.style,
    audio: res.language.audio,
  };
}

export const useSettingsStore = create<SettingsState>((set) => ({
  provider: 'tmdb',
  preference: DEFAULT_ART_PREFERENCE,
  style: DEFAULT_CARD_STYLE,
  fanartConfigured: false,
  audio: DEFAULT_AUDIO_LANG,
  ready: false,
  saving: false,
  loadError: null,
  load: async () => {
    try {
      const res = await fetchSettings();
      set({ ...applySettings(res), ready: true, loadError: null });
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
      set({ ...applySettings(res), saving: false });
    } catch (error) {
      set({ saving: false });
      throw error;
    }
  },
  saveTmdbKind: async (kind) => {
    set({ saving: true });
    try {
      const res = await saveArtworkPreference({ tmdb: kind });
      set({ ...applySettings(res), saving: false });
    } catch (error) {
      set({ saving: false });
      throw error;
    }
  },
  saveFanartKind: async (kind) => {
    set({ saving: true });
    try {
      const res = await saveArtworkPreference({ fanart: kind });
      set({ ...applySettings(res), saving: false });
    } catch (error) {
      set({ saving: false });
      throw error;
    }
  },
  saveStyle: async (style) => {
    set({ saving: true });
    try {
      const res = await saveCardStyle(style);
      set({ ...applySettings(res), saving: false });
    } catch (error) {
      set({ saving: false });
      throw error;
    }
  },
  saveAudio: async (audio) => {
    set({ saving: true });
    try {
      const res = await saveAudioLanguage(audio);
      set({ ...applySettings(res), saving: false });
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

/** Active artwork preference; before settings load completes, use TMDB defaults. */
export function useArtPreference(): ArtPreference {
  return useSettingsStore((s) => s.preference);
}

/** Active card style (D17); before settings load completes, use the backdrop default. */
export function useCardStyle(): CardStyle {
  return useSettingsStore((s) => (s.ready ? s.style : DEFAULT_CARD_STYLE));
}

/** Active audio language; before settings load completes, treat as English. */
export function useAudioLanguage(): AudioLang {
  return useSettingsStore((s) => (s.ready ? s.audio : DEFAULT_AUDIO_LANG));
}
