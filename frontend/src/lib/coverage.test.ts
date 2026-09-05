import { describe, expect, it } from 'vitest';
import type { Source } from '../types';
import {
  chooseEpisodePick,
  chooseSeasonPick,
  coversEpisode,
  coversWholeSeason,
  hasEpisodeCover,
} from './coverage';

function source(title: string, seeders: number, coverage: Source['coverage']): Source {
  return {
    indexerId: 1,
    indexer: 'x',
    title,
    sizeBytes: 1,
    seeders,
    leechers: 0,
    infoHash: title,
    magnetUri: `magnet:?xt=urn:btih:${title}`,
    ageHours: null,
    resolution: '1080p',
    source: 'WEB-DL',
    codec: 'x264',
    hdr: false,
    isDolbyVision: false,
    group: null,
    cleanTitle: 's',
    audioCodec: null,
    coverage,
  };
}

describe('coverage pickers', () => {
  const fullS1 = source('Show.S01.COMPLETE', 100, [{ season: 1, episodes: null }]);
  const exactE3 = source('Show.S01E03', 200, [{ season: 1, episodes: [3, 3] }]);
  const partial = source('Show.S01E01-E05', 50, [{ season: 1, episodes: [1, 5] }]);
  const otherSeason = source('Show.S02E03', 999, [{ season: 2, episodes: [3, 3] }]);

  it('coversWholeSeason / coversEpisode', () => {
    expect(coversWholeSeason(fullS1.coverage, 1)).toBe(true);
    expect(coversWholeSeason(exactE3.coverage, 1)).toBe(false);
    expect(coversEpisode(fullS1.coverage, 1, 3)).toBe(true);
    expect(coversEpisode(partial.coverage, 1, 3)).toBe(true);
    expect(coversEpisode(partial.coverage, 1, 6)).toBe(false);
  });

  it('chooses the most-seeded full-season pack for a season', () => {
    const pick = chooseSeasonPick([exactE3, partial, fullS1, otherSeason], 1);
    expect(pick).toBe(fullS1);
  });

  it('prefers an exact single-episode release over a partial pack', () => {
    const pick = chooseEpisodePick([fullS1, partial, exactE3], 1, 3);
    expect(pick).toBe(exactE3);
  });

  it('falls back to a partial pack that contains the episode', () => {
    const pick = chooseEpisodePick([fullS1, partial], 1, 3);
    expect(pick).toBe(partial);
  });

  it('never auto-picks a whole-season pack for a single episode', () => {
    const pick = chooseEpisodePick([fullS1], 1, 3);
    expect(pick).toBeNull();
    expect(hasEpisodeCover([fullS1], 1, 3)).toBe(true);
  });

  it('ignores other seasons', () => {
    expect(chooseEpisodePick([otherSeason], 1, 3)).toBeNull();
    expect(chooseSeasonPick([otherSeason], 1)).toBeNull();
  });
});
