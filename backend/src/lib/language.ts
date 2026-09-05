import type { AppDeps } from '../deps.js';
import type { AudioLang, AudioMode } from '../types.js';

export interface AudioLanguageProfile {
  code: AudioLang;
  label: string;
  /** The TMDB `language` tag used to fetch localized titles for this audio language. */
  tmdb: string;
  /** Shown under the language name in the settings UI. */
  hint: string;
}

export const AUDIO_LANGUAGES: readonly AudioLanguageProfile[] = [
  { code: 'en', label: 'English', tmdb: 'en-US', hint: 'Original/English audio — no filtering' },
  { code: 'pt', label: 'Português', tmdb: 'pt-BR', hint: 'Brazilian dubbed or dual-audio releases (strict)' },
  { code: 'es', label: 'Español', tmdb: 'es-ES', hint: 'Spanish audio releases (strict)' },
  { code: 'fr', label: 'Français', tmdb: 'fr-FR', hint: 'French audio releases (strict)' },
  { code: 'de', label: 'Deutsch', tmdb: 'de-DE', hint: 'German audio releases (strict)' },
  { code: 'it', label: 'Italiano', tmdb: 'it-IT', hint: 'Italian audio releases (strict)' },
];

export const DEFAULT_AUDIO_LANG: AudioLang = 'en';

export const AUDIO_LANGUAGE_KEY = 'audioLanguage';

const PROFILE_BY_CODE = new Map(AUDIO_LANGUAGES.map((p) => [p.code, p]));

export function isAudioLang(value: unknown): value is AudioLang {
  return typeof value === 'string' && PROFILE_BY_CODE.has(value as AudioLang);
}

export function audioProfile(code: AudioLang): AudioLanguageProfile {
  return PROFILE_BY_CODE.get(code) ?? PROFILE_BY_CODE.get(DEFAULT_AUDIO_LANG)!;
}

export interface AudioFlags {
  lang: AudioLang | null;
  mode: AudioMode | null;
}

/** Order matters: `DUBLADO`/`português` must win over generic English patterns. */
const LANG_RE: ReadonlyArray<[AudioLang, RegExp]> = [
  ['pt', /\b(dublado|dublagem|dub pt|pt br|brazil|brasil|portugues|portuguese)\b/i],
  ['es', /\b(spanish|espanol|castellano|latino)\b/i],
  ['fr', /\b(french|francais|vfq)\b/i],
  ['de', /\b(german|deutsch)\b/i],
  ['it', /\b(italian|italiano)\b/i],
  ['en', /\b(english)\b/i],
];

const MODE_RE: ReadonlyArray<[AudioMode, RegExp]> = [
  ['dub', /\b(dubbed)\b/i],
  ['dual', /\b(dual audio|dual)\b/i],
  ['multi', /\b(multi audio|multilanguage|multilang|multi)\b/i],
];

export function isAudioLangName(value: unknown): value is AudioLang {
  return isAudioLang(value);
}

/**
 * Reads audio-language signals from a *normalized* release title (lowercased,
 * separators turned to spaces — the same form `releaseParser` builds).
 * A bare `Dual`/`MULTi` yields `mode` only; a named language yields `lang`.
 */
export function detectAudioFlags(norm: string): AudioFlags {
  let lang: AudioLang | null = null;
  for (const [code, re] of LANG_RE) {
    if (re.test(norm)) {
      lang = code;
      break;
    }
  }

  let mode: AudioMode | null = null;
  for (const [kind, re] of MODE_RE) {
    if (re.test(norm)) {
      mode = kind;
      break;
    }
  }

  return { lang, mode };
}

/** How strongly a release (its detected flags) satisfies a language preference. */
export function audioGrade(flags: AudioFlags, pref: AudioLang): 'exact' | 'likely' | 'none' {
  // A language explicitly named in the title is authoritative: if it is not the
  // preference, the release is never a match — even when dual/MULTi is present.
  if (flags.lang !== null && flags.lang !== pref) return 'none';
  if (flags.lang === pref) return 'exact';
  // BR scene convention: a bare "Dual Audio" usually means PT + original. Only
  // applies when no language was named.
  if (pref === 'pt' && flags.mode === 'dual') return 'likely';
  return 'none';
}

/** Whether a source passes strict filtering for `pref` based on title flags alone. */
export function titleMatchesAudio(flags: AudioFlags, pref: AudioLang): boolean {
  return audioGrade(flags, pref) !== 'none';
}

interface AudioPreferenceSetting {
  audio?: unknown;
}

/** Persisted site-wide audio preference (single-user install). Defaults to English. */
export async function loadAudioPreference(deps: AppDeps): Promise<AudioLang> {
  const setting = await deps.settings.get<AudioPreferenceSetting>(AUDIO_LANGUAGE_KEY);
  return isAudioLang(setting?.audio) ? setting.audio : DEFAULT_AUDIO_LANG;
}

export async function saveAudioPreference(deps: AppDeps, audio: AudioLang): Promise<void> {
  await deps.settings.set(AUDIO_LANGUAGE_KEY, { audio });
}
