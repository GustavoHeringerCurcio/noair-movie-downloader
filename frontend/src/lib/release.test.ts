import { describe, expect, it } from 'vitest';
import type { Source } from '../types';
import { filterSources, groupSources, sortSources } from './release';

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    indexerId: 1,
    indexer: '1337x',
    title: 'Blade Runner 2049 2017 1080p BluRay x265 10bit',
    sizeBytes: 2 * 1024 ** 3,
    seeders: 100,
    leechers: 10,
    infoHash: 'a'.repeat(40),
    magnetUri: 'magnet:?xt=urn:btih:' + 'a'.repeat(40),
    ageHours: 100,
    resolution: '1080p',
    source: 'BluRay',
    codec: 'x265',
    hdr: false,
    isDolbyVision: false,
    group: 'GalaxyRG265',
    cleanTitle: 'blade runner',
    audioCodec: null,
    coverage: null,
    ...overrides,
  };
}

describe('groupSources', () => {
  it('collapses identical releases across indexers into one group', () => {
    const sources = [
      makeSource({ indexer: '1337x', seeders: 50 }),
      makeSource({ indexer: 'TorrentDownload', seeders: 120 }),
      makeSource({ indexer: 'LimeTorrents', seeders: 80 }),
    ];
    const groups = groupSources(sources);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.variants).toHaveLength(3);
    expect(groups[0]!.best.indexer).toBe('TorrentDownload');
  });

  it('keeps different resolutions in separate groups', () => {
    const sources = [
      makeSource({ resolution: '1080p' }),
      makeSource({ resolution: '2160p', title: 'Blade Runner 2049 2017 2160p BluRay x265' }),
    ];
    const groups = groupSources(sources);
    expect(groups).toHaveLength(2);
  });
});

describe('filterSources', () => {
  it('filters by resolution and codec', () => {
    const sources = [
      makeSource({ resolution: '1080p', codec: 'x265' }),
      makeSource({ resolution: '2160p', codec: 'AV1' }),
    ];
    const out = filterSources(sources, { resolutions: ['1080p'], codecs: ['x265'] });
    expect(out).toHaveLength(1);
    expect(out[0]!.resolution).toBe('1080p');
  });

  it('filters by min seeders and size range', () => {
    const sources = [
      makeSource({ seeders: 5, sizeBytes: 1 * 1024 ** 3 }),
      makeSource({ seeders: 200, sizeBytes: 8 * 1024 ** 3 }),
    ];
    const out = filterSources(sources, { minSeeders: 100, minSizeGB: 2, maxSizeGB: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]!.seeders).toBe(200);
  });

  it('filters by indexer', () => {
    const sources = [makeSource({ indexer: '1337x' }), makeSource({ indexer: 'YTS' })];
    const out = filterSources(sources, { indexers: ['YTS'] });
    expect(out).toHaveLength(1);
    expect(out[0]!.indexer).toBe('YTS');
  });

  it('applies regex filter and ignores invalid regex', () => {
    const sources = [makeSource({ title: '...REMUX...' }), makeSource({ title: '...WEB-DL...' })];
    expect(filterSources(sources, { regex: 'remux' })).toHaveLength(1);
    expect(filterSources(sources, { regex: '([' })).toHaveLength(2);
  });
});

describe('sortSources', () => {
  it('sorts by seeders desc by default', () => {
    const sources = [makeSource({ seeders: 5 }), makeSource({ seeders: 500 }), makeSource({ seeders: 50 })];
    const out = sortSources(sources, 'seeders');
    expect(out.map((s) => s.seeders)).toEqual([500, 50, 5]);
  });

  it('sorts by size desc', () => {
    const sources = [
      makeSource({ sizeBytes: 1 }),
      makeSource({ sizeBytes: 100 }),
      makeSource({ sizeBytes: 10 }),
    ];
    const out = sortSources(sources, 'size');
    expect(out.map((s) => s.sizeBytes)).toEqual([100, 10, 1]);
  });
});
