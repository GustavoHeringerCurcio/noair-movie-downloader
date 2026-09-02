import { describe, expect, it } from 'vitest';
import { isAudioCodecBrowserSafe, parseReleaseTitle } from './releaseParser.js';

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
