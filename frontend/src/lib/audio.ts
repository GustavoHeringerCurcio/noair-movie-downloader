import type { AudioLang, AudioMode, Source } from '../types';

export interface AudioLanguageOption {
  code: AudioLang;
  label: string;
  hint: string;
}

export const AUDIO_LANGUAGE_OPTIONS: readonly AudioLanguageOption[] = [
  { code: 'en', label: 'English', hint: 'Original audio — no filtering' },
  { code: 'pt', label: 'Português', hint: 'Brazilian dubbed / dual-audio releases (strict)' },
  { code: 'es', label: 'Español', hint: 'Spanish audio releases (strict)' },
  { code: 'fr', label: 'Français', hint: 'French audio releases (strict)' },
  { code: 'de', label: 'Deutsch', hint: 'German audio releases (strict)' },
  { code: 'it', label: 'Italiano', hint: 'Italian audio releases (strict)' },
];

export function audioLanguageLabel(code: AudioLang): string {
  return AUDIO_LANGUAGE_OPTIONS.find((o) => o.code === code)?.label ?? code;
}

export function audioLanguageNative(code: AudioLang): string {
  switch (code) {
    case 'pt':
      return 'Português';
    case 'es':
      return 'Español';
    case 'fr':
      return 'Français';
    case 'de':
      return 'Deutsch';
    case 'it':
      return 'Italiano';
    default:
      return 'English';
  }
}

const MODE_TEXT: Record<AudioMode, string> = {
  dub: 'Dub',
  dual: 'Dual',
  multi: 'MULTi',
};

export function audioModeText(mode: AudioMode): string {
  return MODE_TEXT[mode];
}

export interface AudioIdentity {
  audioLang?: AudioLang | null;
  audioMode?: AudioMode | null;
}

/** Short text describing any audio-tagged entity (Source or DownloadRecord). */
export function audioName(audio: AudioIdentity | null | undefined): string | null {
  if (!audio) return null;
  const lang = audio.audioLang ? audio.audioLang.toUpperCase() : null;
  const mode = audio.audioMode ? MODE_TEXT[audio.audioMode] : null;
  if (lang && mode) return `${lang} · ${mode}`;
  return lang ?? mode ?? null;
}

/** Short chip text describing a release's audio, or null when untagged. */
export function audioChipLabel(source: Source): string | null {
  return audioName(source);
}
