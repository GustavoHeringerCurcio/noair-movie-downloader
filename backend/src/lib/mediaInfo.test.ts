import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeLanguage, subtitleKind, listSidecarSubtitles, containerFromPath } from './mediaInfo.js';

describe('normalizeLanguage', () => {
  it('keeps 2-letter codes and maps common 3-letter tags', () => {
    expect(normalizeLanguage('en')).toBe('en');
    expect(normalizeLanguage('eng')).toBe('en');
    expect(normalizeLanguage('spa')).toBe('es');
    expect(normalizeLanguage('jpn')).toBe('ja');
    expect(normalizeLanguage('zho')).toBe('zh');
    expect(normalizeLanguage('pt')).toBe('pt');
  });

  it('treats unknown/undefined as null', () => {
    expect(normalizeLanguage(null)).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
    expect(normalizeLanguage('und')).toBeNull();
    expect(normalizeLanguage('unk')).toBeNull();
    expect(normalizeLanguage('xx')).toBeNull();
    expect(normalizeLanguage('qaa')).toBeNull();
  });

  it('is case/whitespace insensitive', () => {
    expect(normalizeLanguage('  FRA ')).toBe('fr');
  });
});

describe('subtitleKind', () => {
  it('treats text subtitle codecs as convertible and others as bitmap', () => {
    expect(subtitleKind('subrip')).toBe('text');
    expect(subtitleKind('ass')).toBe('text');
    expect(subtitleKind('webvtt')).toBe('text');
    expect(subtitleKind('mov_text')).toBe('text');
    expect(subtitleKind('hdmv_pgs_subtitle')).toBe('bitmap');
    expect(subtitleKind('dvd_subtitle')).toBe('bitmap');
    expect(subtitleKind(null)).toBe('bitmap');
  });
});

describe('containerFromPath', () => {
  it('reads the extension', () => {
    expect(containerFromPath('/downloads/a.MKV')).toBe('mkv');
    expect(containerFromPath('/downloads/b.mp4')).toBe('mp4');
    expect(containerFromPath('/downloads/noext')).toBeNull();
  });
});

describe('listSidecarSubtitles', () => {
  function makeDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  }

  it('finds language-tagged sidecar subtitles next to the video', () => {
    const dir = makeDir('sidecar-');
    fs.writeFileSync(path.join(dir, 'Movie.2024.mkv'), Buffer.alloc(10));
    fs.writeFileSync(path.join(dir, 'Movie.2024.en.srt'), '1\n00:00:01,000 --> 00:00:03,000\nHi');
    fs.writeFileSync(path.join(dir, 'Movie.2024.spa.ass'), 'x');
    fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'x');
    const subs = listSidecarSubtitles(path.join(dir, 'Movie.2024.mkv'));
    expect(subs.map((s) => [s.name, s.language])).toEqual([
      ['Movie.2024.en.srt', 'en'],
      ['Movie.2024.spa.ass', 'es'],
    ]);
  });

  it('lists an untagged subtitle with a null language', () => {
    const dir = makeDir('sidecar-');
    fs.writeFileSync(path.join(dir, 'Clip.mkv'), Buffer.alloc(10));
    fs.writeFileSync(path.join(dir, 'Clip.srt'), 'x');
    const subs = listSidecarSubtitles(path.join(dir, 'Clip.mkv'));
    expect(subs).toEqual([{ name: 'Clip.srt', language: null }]);
  });

  it('returns [] when the directory has no subtitles or does not exist', () => {
    const dir = makeDir('sidecar-');
    fs.writeFileSync(path.join(dir, 'Clip.mkv'), Buffer.alloc(10));
    expect(listSidecarSubtitles(path.join(dir, 'Clip.mkv'))).toEqual([]);
    expect(listSidecarSubtitles(path.join(dir, 'missing', 'Clip.mkv'))).toEqual([]);
  });
});
