import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUDIO_LANG,
  audioGrade,
  audioProfile,
  detectAudioFlags,
  isAudioLang,
  loadAudioPreference,
  titleMatchesAudio,
} from './language.js';
import type { AppDeps } from '../deps.js';

function depsWithSettings(get: (key: string) => Promise<unknown>): AppDeps {
  return {
    settings: {
      get: (key: string) => get(key) as ReturnType<AppDeps['settings']['get']>,
      set: async () => {},
    },
  } as unknown as AppDeps;
}

describe('detectAudioFlags', () => {
  it('detects Brazilian Portuguese dub releases', () => {
    expect(detectAudioFlags('movie 2021 1080p dublado web-dl')).toEqual({ lang: 'pt', mode: null });
    expect(detectAudioFlags('movie 2021 1080p portugues web-dl')).toEqual({ lang: 'pt', mode: null });
    expect(detectAudioFlags('movie 2021 1080p portuguese web-dl')).toEqual({ lang: 'pt', mode: null });
  });

  it('detects dual-audio and MULTi as modes without a language', () => {
    expect(detectAudioFlags('movie 2021 dual audio 1080p')).toEqual({ lang: null, mode: 'dual' });
    expect(detectAudioFlags('movie 2021 1080p multi x264')).toEqual({ lang: null, mode: 'multi' });
  });

  it('combines a named language with a mode', () => {
    expect(detectAudioFlags('movie dual 1080p portugues web-dl')).toEqual({ lang: 'pt', mode: 'dual' });
  });

  it('detects other supported languages', () => {
    expect(detectAudioFlags('movie 2021 spanish 720p')).toEqual({ lang: 'es', mode: null });
    expect(detectAudioFlags('movie 2021 french 720p')).toEqual({ lang: 'fr', mode: null });
    expect(detectAudioFlags('movie 2021 german 720p')).toEqual({ lang: 'de', mode: null });
    expect(detectAudioFlags('movie 2021 italian 720p')).toEqual({ lang: 'it', mode: null });
    expect(detectAudioFlags('movie 2021 english 720p')).toEqual({ lang: 'en', mode: null });
  });

  it('returns null flags for untagged releases', () => {
    expect(detectAudioFlags('movie 2021 1080p web-dl x265 5 1')).toEqual({ lang: null, mode: null });
  });
});

describe('audioGrade', () => {
  it('exact when the language matches', () => {
    expect(audioGrade({ lang: 'pt', mode: null }, 'pt')).toBe('exact');
    expect(audioGrade({ lang: 'es', mode: 'dub' }, 'es')).toBe('exact');
  });

  it('treats dual audio as a likely Portuguese match (BR convention)', () => {
    expect(audioGrade({ lang: null, mode: 'dual' }, 'pt')).toBe('likely');
    expect(audioGrade({ lang: null, mode: 'dual' }, 'es')).toBe('none');
  });

  it('a named language other than the preference wins over the dual heuristic', () => {
    expect(audioGrade({ lang: 'es', mode: 'dual' }, 'pt')).toBe('none');
    expect(audioGrade({ lang: 'en', mode: 'dual' }, 'pt')).toBe('none');
    expect(audioGrade({ lang: 'de', mode: 'dual' }, 'es')).toBe('none');
    // ...but a named language matching the preference is exact even alongside dual.
    expect(audioGrade({ lang: 'es', mode: 'dual' }, 'es')).toBe('exact');
    expect(audioGrade({ lang: 'pt', mode: 'dual' }, 'pt')).toBe('exact');
  });

  it('excludes MULTi and wrong-language releases for strict preferences', () => {
    expect(audioGrade({ lang: null, mode: 'multi' }, 'pt')).toBe('none');
    expect(audioGrade({ lang: 'en', mode: null }, 'pt')).toBe('none');
  });
});

describe('titleMatchesAudio', () => {
  it('strict filtering includes exact and likely, excludes everything else', () => {
    expect(titleMatchesAudio({ lang: 'pt', mode: null }, 'pt')).toBe(true);
    expect(titleMatchesAudio({ lang: null, mode: 'dual' }, 'pt')).toBe(true);
    expect(titleMatchesAudio({ lang: null, mode: null }, 'pt')).toBe(false);
    expect(titleMatchesAudio({ lang: 'en', mode: null }, 'pt')).toBe(false);
  });
});

describe('preference helpers', () => {
  it('validates supported codes', () => {
    expect(isAudioLang('pt')).toBe(true);
    expect(isAudioLang('pt-BR')).toBe(false);
    expect(isAudioLang('ja')).toBe(false);
  });

  it('profile for a known code maps to its TMDB locale', () => {
    expect(audioProfile('pt').tmdb).toBe('pt-BR');
    expect(audioProfile('en').tmdb).toBe('en-US');
  });

  it('defaults to English when nothing is stored', async () => {
    const deps = depsWithSettings(async () => null);
    await expect(loadAudioPreference(deps)).resolves.toBe(DEFAULT_AUDIO_LANG);
  });

  it('reads a stored Portuguese preference', async () => {
    const deps = depsWithSettings(async (key: string) => (key === 'audioLanguage' ? { audio: 'pt' } : null));
    await expect(loadAudioPreference(deps)).resolves.toBe('pt');
  });

  it('falls back to English for a corrupt stored value', async () => {
    const deps = depsWithSettings(async () => ({ audio: 'zz' }));
    await expect(loadAudioPreference(deps)).resolves.toBe('en');
  });
});
