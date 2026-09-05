import { describe, expect, it } from 'vitest';
import { audioChipLabel, audioLanguageLabel, AUDIO_LANGUAGE_OPTIONS } from './audio';
import type { Source } from '../types';

function mk(overrides: Partial<Source> = {}): Source {
  return {
    indexerId: 1,
    indexer: 'YTS',
    title: 'x',
    sizeBytes: 0,
    seeders: 1,
    leechers: 0,
    infoHash: 'a'.repeat(40),
    magnetUri: 'magnet:',
    ageHours: null,
    resolution: null,
    source: null,
    codec: null,
    hdr: false,
    isDolbyVision: false,
    group: null,
    cleanTitle: 'x',
    audioCodec: null,
    coverage: null,
    ...overrides,
  };
}

describe('audio helpers', () => {
  it('lists the supported languages', () => {
    expect(AUDIO_LANGUAGE_OPTIONS.map((o) => o.code)).toEqual(['en', 'pt', 'es', 'fr', 'de', 'it']);
  });

  it('looks up display labels', () => {
    expect(audioLanguageLabel('pt')).toBe('Português');
    expect(audioLanguageLabel('en')).toBe('English');
  });

  it('builds short chip labels', () => {
    expect(audioChipLabel(mk({ audioLang: 'pt' }))).toBe('PT');
    expect(audioChipLabel(mk({ audioMode: 'dual' }))).toBe('Dual');
    expect(audioChipLabel(mk({ audioLang: 'pt', audioMode: 'dual' }))).toBe('PT · Dual');
    expect(audioChipLabel(mk({ audioMode: 'multi' }))).toBe('MULTi');
    expect(audioChipLabel(mk())).toBeNull();
  });
});
