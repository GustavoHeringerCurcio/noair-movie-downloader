import { describe, expect, it } from 'vitest';
import type { DownloadRecord, TorrentState } from '../types';
import {
  bestPlayable,
  leadCopy,
  movieGroupKey,
  playable,
  qualityName,
  sortVersions,
  versionLabel,
} from './versions';

function make(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  const base: DownloadRecord = {
    id: 1,
    tmdbId: 550,
    mediaType: 'movie',
    title: 'Fight Club',
    year: 1999,
    posterPath: '/p.jpg',
    backdropPath: null,
    seasonNumber: null,
    episodeNumber: null,
    infoHash: 'a'.repeat(40),
    torrentName: 'Fight.Club.1999.1080p',
    indexer: '1337x',
    sizeBytes: 0,
    state: 'seeding' as TorrentState,
    progress: 1,
    downloadSpeed: 0,
    uploadSpeed: 0,
    etaSeconds: null,
    ratio: 1,
    contentPath: null,
    streamFilePath: '/x.mkv',
    streamable: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    completedAt: '2026-09-02T00:00:00.000Z',
    resolution: '1080p',
    source: 'WEB-DL',
    codec: 'x264',
    hdr: false,
    isDolbyVision: false,
    ...overrides,
  };
  return base;
}

describe('playable', () => {
  it('is true only when a complete file is available', () => {
    expect(playable(make())).toBe(true);
    expect(playable(make({ streamable: false, streamFilePath: null }))).toBe(false);
  });
});

describe('qualityName / versionLabel', () => {
  it('builds a quality string from the release fields', () => {
    expect(qualityName(make({ resolution: '2160p', source: 'REMUX', codec: 'x265', hdr: true }))).toBe(
      '2160p REMUX x265 HDR',
    );
  });

  it('prefixes the audio identity so EN and PT-Dub copies never read the same', () => {
    expect(versionLabel(make({ audioLang: 'pt', audioMode: 'dub', resolution: '1080p', source: 'WEB-DL' }))).toBe(
      'PT · Dub · 1080p WEB-DL x264',
    );
    expect(versionLabel(make({ audioLang: 'en' }))).toBe('EN · 1080p WEB-DL x264');
    expect(versionLabel(make({}))).toBe('1080p WEB-DL x264');
  });
});

describe('bestPlayable (locked default rule)', () => {
  it('returns null when nothing is playable', () => {
    expect(bestPlayable([make({ streamable: false, progress: 0.4 })])).toBeNull();
  });

  it('prefers the most recently completed playable copy', () => {
    const newer = make({ infoHash: 'b'.repeat(40), completedAt: '2026-09-05T00:00:00.000Z' });
    const older = make({ infoHash: 'c'.repeat(40), completedAt: '2026-09-03T00:00:00.000Z' });
    const busy = make({ infoHash: 'd'.repeat(40), streamable: false, progress: 0.9 });
    expect(bestPlayable([older, busy, newer])?.infoHash).toBe('b'.repeat(40));
  });

  it('tie-breaks equal completion toward the higher resolution', () => {
    const hd = make({ infoHash: 'b'.repeat(40), resolution: '1080p' });
    const uhd = make({ infoHash: 'c'.repeat(40), resolution: '2160p' });
    const best = bestPlayable([hd, uhd]);
    expect(best?.infoHash).toBe('c'.repeat(40));
  });
});

describe('sortVersions', () => {
  it('orders playable first (newest completion), then downloading by progress', () => {
    const oldReady = make({ infoHash: 'b'.repeat(40), completedAt: '2026-09-03T00:00:00.000Z' });
    const newReady = make({ infoHash: 'c'.repeat(40), completedAt: '2026-09-05T00:00:00.000Z' });
    const slow = make({ infoHash: 'd'.repeat(40), streamable: false, progress: 0.2 });
    const fast = make({ infoHash: 'e'.repeat(40), streamable: false, progress: 0.8 });
    expect(sortVersions([slow, oldReady, fast, newReady]).map((d) => d.infoHash)).toEqual([
      'c'.repeat(40),
      'b'.repeat(40),
      'e'.repeat(40),
      'd'.repeat(40),
    ]);
  });
});

describe('leadCopy / movieGroupKey', () => {
  it('returns the most advanced copy of a title', () => {
    const busy = make({ streamable: false, progress: 0.5 });
    expect(leadCopy([busy])?.infoHash).toBe(busy.infoHash);
  });

  it('groups standalone movie copies under one key, TV/episodes stay separate', () => {
    expect(movieGroupKey(make())).toBe('movie:550');
    expect(movieGroupKey(make({ mediaType: 'tv', seasonNumber: 1, episodeNumber: 3 }))).toBeNull();
    expect(movieGroupKey(make({ mediaType: 'tv', seasonNumber: 1, episodeNumber: null }))).toBeNull();
    expect(movieGroupKey(make({ tmdbId: null }))).toBeNull();
  });
});
