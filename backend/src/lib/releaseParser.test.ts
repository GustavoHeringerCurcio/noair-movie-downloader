import { describe, expect, it } from 'vitest';
import {
  isAudioCodecBrowserSafe,
  parseReleaseTitle,
  parseCoverage,
  coverageCovers,
  isFullSeason,
  isWholeSeriesTitle,
  episodeKeyFromFilename,
  seasonQueryToken,
} from './releaseParser.js';

describe('parseReleaseTitle', () => {
  it('parses a 1080p BluRay x265 release', () => {
    const p = parseReleaseTitle('Blade Runner 2049 2017 Open Matte 1080p BluRay x265 10bit KONTRAST');
    expect(p.resolution).toBe('1080p');
    expect(p.source).toBe('BluRay');
    expect(p.codec).toBe('x265');
    expect(p.hdr).toBe(false);
    expect(p.group).toBe('KONTRAST');
    expect(p.cleanTitle).toBe('blade runner');
  });

  it('parses a 2160p REMUX HEVC HDR release', () => {
    const p = parseReleaseTitle('Blade Runner 2049 2017 PROPER 2160p US BluRay REMUX HEVC DTS HD MA TrueHD 7 1 Atmos FGT');
    expect(p.resolution).toBe('2160p');
    expect(p.source).toBe('REMUX');
    expect(p.codec).toBe('x265');
    expect(p.hdr).toBe(false);
    expect(p.group).toBe('FGT');
  });

  it('detects HDR + Dolby Vision', () => {
    const p = parseReleaseTitle('Blade Runner 2049 2017 UHD BluRay 2160p DDP 7 1 DV HDR x265 hallowed[TGx]');
    expect(p.resolution).toBe('2160p');
    expect(p.source).toBe('BluRay');
    expect(p.codec).toBe('x265');
    expect(p.hdr).toBe(true);
    expect(p.isDolbyVision).toBe(true);
    expect(p.group).toBe('TGx');
  });

  it('maps AMZN WEB DL to WEB-DL source', () => {
    const p = parseReleaseTitle('Blade Runner 2049 2017 1080p AMZN WEB DL DDP2 0 H 265 ViSTA');
    expect(p.resolution).toBe('1080p');
    expect(p.source).toBe('WEB-DL');
    expect(p.codec).toBe('x265');
    expect(p.group).toBe('ViSTA');
  });

  it('parses dotted 1337x-style titles', () => {
    const p = parseReleaseTitle('Blade.Runner.2049.2017.1080p.BluRay.DDP5.1.x265.10bit-GalaxyRG265');
    expect(p.resolution).toBe('1080p');
    expect(p.source).toBe('BluRay');
    expect(p.codec).toBe('x265');
    expect(p.group).toBe('GalaxyRG265');
  });

  it('detects AV1 codec', () => {
    const p = parseReleaseTitle('Inception 2010 PROPER Bluray 2160p AV1 HDR10 EN/ITA/FR/ES/DE OPUS 5.1-UH');
    expect(p.resolution).toBe('2160p');
    expect(p.codec).toBe('AV1');
    expect(p.hdr).toBe(true);
  });

  it('detects x264', () => {
    const p = parseReleaseTitle('Blade Runner 2049 2017 Uncut 720p BluRay x264 Esub Dual Audio Hindi 2 0 224kbps English 1 45GB-CraZzyBoY');
    expect(p.resolution).toBe('720p');
    expect(p.source).toBe('BluRay');
    expect(p.codec).toBe('x264');
    expect(p.group).toBe('CraZzyBoY');
  });

  it('groups by cleanTitle ignoring quality tokens', () => {
    const a = parseReleaseTitle('Blade Runner 2049 2017 1080p BluRay x265 10bit KONTRAST');
    const b = parseReleaseTitle('Blade Runner 2049 (2017) Open Matte (1080p x265 HEVC 10bit AAC 7.1 Q22 Joy) [UTR]');
    expect(a.cleanTitle).toBe(b.cleanTitle);
  });

  it('returns nulls for unknown titles without quality info', () => {
    const p = parseReleaseTitle('Some.Weird.Unknown.Release');
    expect(p.resolution).toBeNull();
    expect(p.source).toBeNull();
    expect(p.codec).toBeNull();
    expect(p.hdr).toBe(false);
  });

  it('normalizes real-world Inception variants to the same cleanTitle', () => {
    const titles = [
      'Inception 2010 1080p BluRay HEVC x265 51 BONE',
      'Inception 2010 1080p BluRay DDP5 1 x265 10bit GalaxyRG265',
      'Inception 2010 PROPER Bluray 2160p AV1 HDR10 EN ITA FR ES DE OPUS 5 1 UH [UserHEVC]',
      'Inception 2010 UHD BluRay 2160p HDR10 DV HEVC DTS HD MA 51 x265',
      'Inception.2010.1080p.BluRay.DDP5.1.x265.10bit-GalaxyRG265',
      'Inception (2010) 1080p BluRay x264 DTS HD MA Soup',
    ];
    const clean = titles.map((t) => parseReleaseTitle(t).cleanTitle);
    expect(clean).toEqual(titles.map(() => 'inception'));
  });

  it('detects audio codecs', () => {
    expect(parseReleaseTitle('Movie 1080p BluRay DDP5.1 x265').audioCodec).toBe('E-AC3');
    expect(parseReleaseTitle('Movie 1080p BluRay AC3 x264').audioCodec).toBe('AC3');
    expect(parseReleaseTitle('Movie 1080p BluRay DTS x264').audioCodec).toBe('DTS');
    expect(parseReleaseTitle('Movie 1080p WEB-DL AAC x264').audioCodec).toBe('AAC');
    expect(parseReleaseTitle('Movie 1080p BluRay TrueHD Atmos x265').audioCodec).toBe('TrueHD');
    expect(parseReleaseTitle('Movie 1080p WEBRip x264').audioCodec).toBeNull();
  });

  it('marks browser-safe audio codecs', () => {
    expect(isAudioCodecBrowserSafe('AAC')).toBe(true);
    expect(isAudioCodecBrowserSafe('MP3')).toBe(true);
    expect(isAudioCodecBrowserSafe('E-AC3')).toBe(false);
    expect(isAudioCodecBrowserSafe('DTS')).toBe(false);
    expect(isAudioCodecBrowserSafe(null)).toBe(false);
  });
});

describe('coverage parsing', () => {
  it('parses a single episode', () => {
    const p = parseReleaseTitle('Fallout.S01E01.1080p.WEB-DL.DDP5.1.H.264-ELEANOR');
    expect(p.coverage).toEqual([{ season: 1, episodes: [1, 1] }]);
  });

  it('parses a full-season pack', () => {
    const p = parseReleaseTitle('Fallout.S01.COMPLETE.1080p.WEB-DL.x265');
    expect(p.coverage).toEqual([{ season: 1, episodes: null }]);
  });

  it('parses a partial pack episode range', () => {
    const p = parseReleaseTitle('The.Expanse.S01E01-E05.1080p.WEB-DL.x264');
    expect(p.coverage).toEqual([{ season: 1, episodes: [1, 5] }]);
  });

  it('parses multi-season ranges as whole seasons', () => {
    const p = parseReleaseTitle('Breaking.Bad.S01-S05.COMPLETE.1080p.BluRay');
    expect(p.coverage).toEqual([
      { season: 1, episodes: null },
      { season: 2, episodes: null },
      { season: 3, episodes: null },
      { season: 4, episodes: null },
      { season: 5, episodes: null },
    ]);
  });

  it('parses "Season N" wording and x/y scene numbering', () => {
    expect(parseCoverage('chernobyl season 1 complete')).toEqual([{ season: 1, episodes: null }]);
    expect(parseCoverage('stargate sg-1 1x03 hdtv xvid')).toEqual([{ season: 1, episodes: [3, 3] }]);
    expect(parseCoverage('a show s01x03 720p')).toEqual([{ season: 1, episodes: [3, 3] }]);
  });

  it('returns null coverage for movies and ambiguous titles', () => {
    const p = parseReleaseTitle('Blade Runner 2049 2017 1080p BluRay x265 KONTRAST');
    expect(p.coverage).toBeNull();
    expect(parseCoverage('Some.Weird.Unknown.Release')).toBeNull();
  });

  it('does not double-count episode tokens as full seasons', () => {
    expect(parseCoverage('fallout s01e01 s01e02')).toEqual([{ season: 1, episodes: [1, 2] }]);
  });
});

describe('coverage helpers', () => {
  const fullS1 = [{ season: 1, episodes: null }] as const;
  const epS1 = [{ season: 1, episodes: [1, 1] }] as const;
  const partial = [{ season: 1, episodes: [1, 5] }] as const;

  it('coverageCovers season scope requires a whole season', () => {
    expect(coverageCovers(fullS1, 1)).toBe(true);
    expect(coverageCovers(epS1, 1)).toBe(false);
    expect(coverageCovers(partial, 1)).toBe(false);
  });

  it('coverageCovers episode scope includes full seasons, partial packs and exact episodes', () => {
    expect(coverageCovers(fullS1, 1, 3)).toBe(true);
    expect(coverageCovers(partial, 1, 3)).toBe(true);
    expect(coverageCovers(partial, 1, 6)).toBe(false);
    expect(coverageCovers(epS1, 1, 1)).toBe(true);
    expect(coverageCovers(epS1, 1, 2)).toBe(false);
    expect(coverageCovers(null, 1, 1)).toBe(false);
  });

  it('isFullSeason', () => {
    expect(isFullSeason(fullS1, 1)).toBe(true);
    expect(isFullSeason(partial, 1)).toBe(false);
    expect(isFullSeason(null, 1)).toBe(false);
  });

  it('detects whole-series titles but not plain season packs', () => {
    expect(isWholeSeriesTitle('The.Wire.The.Complete.Series.1080p')).toBe(true);
    expect(isWholeSeriesTitle('The Wire Complete Series BluRay')).toBe(true);
    expect(isWholeSeriesTitle('Fallout.S01.COMPLETE.1080p')).toBe(false);
  });

  it('parses episode keys from file basenames (S13 tagging)', () => {
    expect(episodeKeyFromFilename('Show.S01E03.mkv')).toEqual({ season: 1, episode: 3 });
    expect(episodeKeyFromFilename('Show.S01E03.mkv.!qb')).toEqual({ season: 1, episode: 3 });
    expect(episodeKeyFromFilename('Show.S01E03.1080p.mkv')).toEqual({ season: 1, episode: 3 });
    expect(episodeKeyFromFilename('Show.S01E01E02.mkv')).toBeNull();
    expect(episodeKeyFromFilename('Movie.2024.mkv')).toBeNull();
  });

  it('builds canonical season query tokens', () => {
    expect(seasonQueryToken(1)).toBe('S01');
    expect(seasonQueryToken(12)).toBe('S12');
  });
});
