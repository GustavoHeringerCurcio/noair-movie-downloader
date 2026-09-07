import { describe, expect, it } from 'vitest';
import type { Source } from '../types';
import {
  chooseEpisodePick,
  chooseMoviePick,
  chooseSeasonPick,
  coversEpisode,
  coversWholeSeason,
  hasEpisodeCover,
  isWebExhibitable,
} from './coverage';

function source(
  title: string,
  seeders: number,
  coverage: Source['coverage'],
  overrides: Partial<Pick<Source, 'codec' | 'resolution' | 'hdr' | 'isDolbyVision'>> = {},
): Source {
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
    ...overrides,
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

describe('isWebExhibitable (T-003)', () => {
  const src = source('X', 0, null);

  it('accepts x264 and AV1 in SDR up to 1080p', () => {
    expect(isWebExhibitable(src)).toBe(true);
    expect(isWebExhibitable({ ...src, codec: 'AV1' })).toBe(true);
    expect(isWebExhibitable({ ...src, resolution: '720p' })).toBe(true);
    expect(isWebExhibitable({ ...src, resolution: '480p' })).toBe(true);
    expect(isWebExhibitable({ ...src, resolution: null })).toBe(true);
  });

  it('rejects x265 at any resolution (no reliable in-browser HEVC)', () => {
    expect(isWebExhibitable({ ...src, codec: 'x265' })).toBe(false);
    expect(isWebExhibitable({ ...src, codec: 'x265', resolution: '1080p' })).toBe(false);
  });

  it('rejects 2160p even when the codec is safe', () => {
    expect(isWebExhibitable({ ...src, resolution: '2160p' })).toBe(false);
    expect(isWebExhibitable({ ...src, codec: 'AV1', resolution: '2160p' })).toBe(false);
  });

  it('rejects HDR and Dolby Vision', () => {
    expect(isWebExhibitable({ ...src, hdr: true })).toBe(false);
    expect(isWebExhibitable({ ...src, isDolbyVision: true })).toBe(false);
  });

  it('rejects unknown codecs (strict)', () => {
    expect(isWebExhibitable({ ...src, codec: null })).toBe(false);
    expect(isWebExhibitable({ ...src, codec: 'XviD' })).toBe(false);
  });
});

describe('friendly-pick modes (T-003)', () => {
  const webMovie = source('Movie.1080p.x264', 200, null);
  const bestSeededMovie = source('Movie.2160p.x265.HDR', 500, null, {
    codec: 'x265',
    resolution: '2160p',
    hdr: true,
  });

  it('defaults to most-seeded (behaviour unchanged) even when a web-playable source exists', () => {
    expect(chooseMoviePick([bestSeededMovie, webMovie])).toBe(bestSeededMovie);
    expect(chooseSeasonPick([bestSeededMovie], 1)).toBeNull();
    expect(chooseEpisodePick([bestSeededMovie, webMovie], 1, 3)).toBeNull();
  });

  it('web-playable mode prefers the best-seeded web-exhibitable movie source', () => {
    const pick = chooseMoviePick([bestSeededMovie, webMovie], 'web-playable');
    expect(pick).toBe(webMovie);
  });

  it('web-playable mode falls back to the most-seeded source when nothing qualifies, and empty stays null', () => {
    const pick = chooseMoviePick([bestSeededMovie], 'web-playable');
    expect(pick).toBe(bestSeededMovie);
    expect(chooseMoviePick([], 'web-playable')).toBeNull();
  });

  it('web-playable season pick prefers the best-seeded web-exhibitable full-season pack', () => {
    const packWeb = source('Show.S01.COMPLETE.1080p.x264', 300, [{ season: 1, episodes: null }]);
    const packHevc = source('Show.S01.COMPLETE.2160p.x265', 900, [{ season: 1, episodes: null }], {
      codec: 'x265',
      resolution: '2160p',
    });
    expect(chooseSeasonPick([packHevc, packWeb], 1)).toBe(packHevc);
    expect(chooseSeasonPick([packHevc, packWeb], 1, 'web-playable')).toBe(packWeb);
    expect(chooseSeasonPick([packHevc], 1, 'web-playable')).toBe(packHevc);
  });

  it('web-playable episode pick prefers a web-exact over a more-seeded non-web exact', () => {
    const exactHevc = source('Show.S01E03.2160p.x265', 900, [{ season: 1, episodes: [3, 3] }], {
      codec: 'x265',
      resolution: '2160p',
    });
    const exactWeb = source('Show.S01E03.720p.x264', 100, [{ season: 1, episodes: [3, 3] }], {
      resolution: '720p',
    });
    expect(chooseEpisodePick([exactHevc, exactWeb], 1, 3)).toBe(exactHevc);
    expect(chooseEpisodePick([exactHevc, exactWeb], 1, 3, 'web-playable')).toBe(exactWeb);
  });

  it('web-playable episode pick keeps exact-episode > partial-pack even when only the partial is web', () => {
    const exactHevc = source('Show.S01E03.2160p.x265', 900, [{ season: 1, episodes: [3, 3] }], {
      codec: 'x265',
      resolution: '2160p',
    });
    const partialWeb = source('Show.S01E01-E05.1080p.x264', 400, [{ season: 1, episodes: [1, 5] }]);
    expect(chooseEpisodePick([exactHevc, partialWeb], 1, 3, 'web-playable')).toBe(exactHevc);
  });

  it('web-playable episode pick prefers a web partial pack over a non-web partial pack', () => {
    const partialHevc = source('Show.S01E01-E05.2160p.x265', 900, [{ season: 1, episodes: [1, 5] }], {
      codec: 'x265',
      resolution: '2160p',
    });
    const partialWeb = source('Show.S01E01-E05.1080p.x264', 100, [{ season: 1, episodes: [1, 5] }]);
    expect(chooseEpisodePick([partialHevc, partialWeb], 1, 3)).toBe(partialHevc);
    expect(chooseEpisodePick([partialHevc, partialWeb], 1, 3, 'web-playable')).toBe(partialWeb);
  });

  it('web-playable episode pick never auto-picks a whole-season pack', () => {
    const seasonWeb = source('Show.S01.COMPLETE.1080p.x264', 1000, [{ season: 1, episodes: null }]);
    expect(chooseEpisodePick([seasonWeb], 1, 3, 'web-playable')).toBeNull();
    expect(chooseEpisodePick([seasonWeb], 1, 3)).toBeNull();
  });
});
