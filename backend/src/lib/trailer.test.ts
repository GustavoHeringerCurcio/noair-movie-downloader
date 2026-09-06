import { describe, expect, it } from 'vitest';
import type { TmdbVideo } from '../services/tmdb.js';
import { pickTrailer } from './trailer.js';

function video(overrides: Partial<TmdbVideo> = {}): TmdbVideo {
  return {
    name: null,
    key: 'k',
    site: 'YouTube',
    kind: 'Trailer',
    official: false,
    language: null,
    publishedAt: null,
    ...overrides,
  };
}

describe('pickTrailer', () => {
  it('returns null when nothing is embeddable', () => {
    expect(pickTrailer([])).toBeNull();
    expect(pickTrailer([video({ site: 'Twitch', key: 'x' }), video({ site: '', key: 'y' })])).toBeNull();
  });

  it('returns null when the only entry has no key', () => {
    expect(pickTrailer([video({ key: '' })])).toBeNull();
  });

  it('prefers an official English Trailer over everything else', () => {
    const pick = pickTrailer([
      video({ key: 'teaser', kind: 'Teaser', official: true, language: 'en', publishedAt: '2020-01-01' }),
      video({ key: 'fan', kind: 'Clip', official: false, language: 'en', publishedAt: '2021-01-01' }),
      video({ key: 'trailer', kind: 'Trailer', official: true, language: 'en', publishedAt: '2022-01-01' }),
      video({ key: 'old', kind: 'Trailer', official: true, language: 'en', publishedAt: '2019-01-01' }),
    ]);
    expect(pick?.videoId).toBe('trailer');
    expect(pick?.provider).toBe('youtube');
  });

  it('falls back through kinds: Trailer → Teaser → other', () => {
    const pick = pickTrailer([
      video({ key: 'clip', kind: 'Featurette', language: 'en' }),
      video({ key: 'teaser', kind: 'Teaser', language: 'en' }),
    ]);
    expect(pick?.videoId).toBe('teaser');
  });

  it('prefers the English subset when present, otherwise any language', () => {
    const mixed = pickTrailer([
      video({ key: 'pt', kind: 'Trailer', official: true, language: 'pt' }),
      video({ key: 'en', kind: 'Trailer', official: false, language: 'en' }),
    ]);
    expect(mixed?.videoId).toBe('en');

    const onlyOther = pickTrailer([video({ key: 'pt', kind: 'Teaser', language: 'pt' })]);
    expect(onlyOther?.videoId).toBe('pt');
  });

  it('ranks YouTube over Vimeo on otherwise-equal entries', () => {
    const pick = pickTrailer([
      video({ key: 'v', site: 'Vimeo', kind: 'Trailer', official: true, language: 'en' }),
      video({ key: 'y', site: 'YouTube', kind: 'Trailer', official: true, language: 'en' }),
    ]);
    expect(pick?.videoId).toBe('y');
    expect(pick?.provider).toBe('youtube');
  });

  it('ranks newer publishedAt first, keeping null dates last', () => {
    const pick = pickTrailer([
      video({ key: 'null-date', kind: 'Trailer', official: true, language: 'en', publishedAt: null }),
      video({ key: 'old', kind: 'Trailer', official: true, language: 'en', publishedAt: '2010-01-01' }),
      video({ key: 'new', kind: 'Trailer', official: true, language: 'en', publishedAt: '2023-06-01' }),
    ]);
    expect(pick?.videoId).toBe('new');
  });

  it('returns the provider and display name', () => {
    const pick = pickTrailer([video({ key: 'abc', site: 'vimeo', name: 'Official Teaser', kind: 'Teaser', language: 'en' })]);
    expect(pick).toEqual({ provider: 'vimeo', videoId: 'abc', name: 'Official Teaser' });
  });
});
