import { describe, expect, it } from 'vitest';
import { filterSourcesToMedia } from './releaseFilter.js';
import type { Source } from '../types.js';

function makeSource(title: string, cleanTitle: string): Source {
  return {
    indexerId: 1,
    indexer: 'YTS',
    title,
    sizeBytes: 0,
    seeders: 0,
    leechers: 0,
    infoHash: 'a'.repeat(40),
    magnetUri: 'magnet:?xt=urn:btih:' + 'a'.repeat(40),
    ageHours: null,
    resolution: null,
    source: null,
    codec: null,
    hdr: false,
    isDolbyVision: false,
    group: null,
    cleanTitle,
    audioCodec: null,
  };
}

describe('filterSourcesToMedia', () => {
  it('drops releases carrying a year that conflicts with the media year', () => {
    const sources = [
      makeSource('2001.A.Space.Odyssey.1968.1080p', 'a space odyssey'),
      makeSource('The.Odyssey.2026.1080p.WEB-DL', 'the odyssey'),
      makeSource('Star.Odyssey.1979.720p', 'star odyssey'),
      makeSource('The.Odyssey.1969.720p', 'the odyssey'),
    ];
    const kept = filterSourcesToMedia(sources, { title: 'The Odyssey', year: 2026 });
    expect(kept.map((s) => s.title)).toEqual(['The.Odyssey.2026.1080p.WEB-DL']);
  });

  it('keeps releases with no conflicting year even when title words overlap', () => {
    const sources = [
      makeSource('The.Odyssey.1080p', 'the odyssey'),
      makeSource('A.Space.Odyssey.1968.2160p', 'a space odyssey'),
    ];
    const kept = filterSourcesToMedia(sources, { title: 'The Odyssey', year: 2026 });
    expect(kept.map((s) => s.title)).toEqual(['The.Odyssey.1080p']);
  });

  it('keeps same-year duplicate releases that share the title words', () => {
    const sources = [
      makeSource('The.Odyssey.2026.2160p.REMUX', 'the odyssey'),
      makeSource('The.Odyssey.2026.1080p.WEB-DL', 'the odyssey'),
    ];
    const kept = filterSourcesToMedia(sources, { title: 'The Odyssey', year: 2026 });
    expect(kept).toHaveLength(2);
  });

  it('does not treat a title number such as 2049 as a conflicting year', () => {
    const sources = [
      makeSource('Blade.Runner.2049.2017.2160p', 'blade runner 2049'),
      makeSource('Blade.Runner.2049.2017.1080p', 'blade runner 2049'),
    ];
    const kept = filterSourcesToMedia(sources, { title: 'Blade Runner 2049', year: 2017 });
    expect(kept).toHaveLength(2);
  });

  it('drops a different year release even when it shares the movie number', () => {
    const sources = [
      makeSource('Blade.Runner.2049.2017.2160p', 'blade runner 2049'),
      makeSource('Blade.Runner.2049.2007.1080p', 'blade runner 2049'),
    ];
    const kept = filterSourcesToMedia(sources, { title: 'Blade Runner 2049', year: 2017 });
    expect(kept.map((s) => s.title)).toEqual(['Blade.Runner.2049.2017.2160p']);
  });

  it('hides sources whose title has none of the media words', () => {
    const sources = [
      makeSource('Inception.2010.1080p', 'inception'),
      makeSource('Tenet.2020.1080p', 'tenet'),
    ];
    const kept = filterSourcesToMedia(sources, { title: 'Inception', year: 2010 });
    expect(kept.map((s) => s.title)).toEqual(['Inception.2010.1080p']);
  });

  it('returns the original list when every source would be filtered out', () => {
    const sources = [
      makeSource('2001.A.Space.Odyssey.1968.1080p', 'a space odyssey'),
      makeSource('Star.Odyssey.1979.720p', 'star odyssey'),
    ];
    const kept = filterSourcesToMedia(sources, { title: 'The Odyssey', year: 2026 });
    expect(kept).toHaveLength(2);
  });

  it('returns sources unchanged when the media title has no significant words', () => {
    const sources = [makeSource('Anything.2026.1080p', 'anything')];
    expect(filterSourcesToMedia(sources, { title: 'The', year: 2026 })).toEqual(sources);
  });

  it('returns empty when sources are empty', () => {
    expect(filterSourcesToMedia([], { title: 'Inception', year: 2010 })).toEqual([]);
  });
});
