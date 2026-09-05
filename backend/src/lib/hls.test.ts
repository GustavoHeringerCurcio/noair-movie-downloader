import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  audioSegmentArgs,
  buildMasterPlaylist,
  embeddedSubtitleArgs,
  languageLabel,
  packageKey,
  pickAudioRenditions,
  pickSubtitleRenditions,
  subtitleMediaPlaylist,
  videoSegmentArgs,
} from './hls.js';
import type { MediaInfo } from './mediaInfo.js';

const media: MediaInfo = {
  container: 'mkv',
  durationSeconds: 5400,
  video: { index: 0, codec: 'h264', width: 1920, height: 1080, hdr: false },
  audioTracks: [
    { index: 1, codec: 'dts', language: 'en', title: 'DTS-HD MA 5.1', channels: 6, default: true },
    { index: 2, codec: 'ac3', language: 'es', title: null, channels: 6, default: false },
  ],
  subtitleTracks: [{ index: 3, codec: 'subrip', kind: 'text', language: 'en', title: null, default: true }],
  videoCodec: 'h264',
  audioCodec: 'dts',
  height: 1080,
};

describe('packageKey', () => {
  it('is deterministic and path-safe', () => {
    expect(packageKey('AB'.repeat(20), 'Show.S01/S01E01.mkv')).toBe(
      `${'ab'.repeat(20)}-Show.S01-S01E01.mkv`,
    );
    expect(packageKey('x'.repeat(40), 'a/b')).not.toContain('/');
  });
});

describe('languageLabel', () => {
  it('maps known codes and falls back to an uppercased code', () => {
    expect(languageLabel('en')).toBe('English');
    expect(languageLabel('ja')).toBe('日本語');
    expect(languageLabel('xx')).toBe('XX');
    expect(languageLabel(null)).toBe('Unknown');
  });
});

describe('pickAudioRenditions', () => {
  it('keeps every track with a stable streamIndex and marks exactly one default', () => {
    const renditions = pickAudioRenditions(media);
    expect(renditions.map((r) => r.streamIndex)).toEqual([1, 2]);
    expect(renditions[0]!.default).toBe(true);
    expect(renditions[1]!.default).toBe(false);
    expect(renditions[0]!.label).toBe('DTS-HD MA 5.1');
    expect(renditions[1]!.label).toBe('Español');
  });

  it('defaults the only track when there is just one', () => {
    const renditions = pickAudioRenditions({ ...media, audioTracks: [media.audioTracks[0]!] });
    expect(renditions[0]!.default).toBe(true);
  });
});

describe('pickSubtitleRenditions', () => {
  it('keeps text embedded tracks and language-tagged sidecars, drops bitmap subs', () => {
    const subs = pickSubtitleRenditions(media.subtitleTracks, [{ name: 'Movie.2024.spa.ass', language: 'es' }]);
    expect(subs).toHaveLength(2);
    expect(subs[0]).toMatchObject({ id: 'track-0', language: 'en' });
    expect(subs[1]).toMatchObject({ id: 'sidecar-0', language: 'es' });
  });
});

describe('ffmpeg argument builders', () => {
  it('video segment args copy video and disable all audio/subtitles', () => {
    const args = videoSegmentArgs('/downloads/m.mkv', path.join('/packages', 'k', 'video'));
    expect(args[args.indexOf('-i') + 1]).toBe('/downloads/m.mkv');
    expect(args).toContain('-c:v');
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
    expect(args).toContain('fmp4');
    expect(args[args.indexOf('-map')]).toBe('-map');
    expect(args[args.length - 1]).toBe(path.join('/packages', 'k', 'video', 'main.m3u8'));
  });

  it('audio segment args target one track and encode AAC', () => {
    const args = audioSegmentArgs('/x.mkv', 2, path.join('/packages', 'k', 'audio', '2'));
    expect(args).toContain('-map');
    expect(args[args.indexOf('-map') + 1]).toBe('0:a:2');
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
    expect(args[args.length - 1]).toBe(path.join('/packages', 'k', 'audio', '2', 'main.m3u8'));
  });

  it('embedded subtitle args write a single WebVTT file', () => {
    const args = embeddedSubtitleArgs('/x.mkv', 3, '/packages/k/subs/track-0.vtt');
    expect(args[args.indexOf('-map') + 1]).toBe('0:3');
    expect(args).toContain('webvtt');
    expect(args[args.length - 1]).toBe('/packages/k/subs/track-0.vtt');
  });
});

describe('subtitleMediaPlaylist', () => {
  it('declares a single whole-file WebVTT segment', () => {
    const text = subtitleMediaPlaylist(5400);
    expect(text).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(text).toContain('#EXT-X-TARGETDURATION:5400');
    expect(text).toContain('#EXTINF:5400.000,');
    expect(text).toContain('subs.vtt');
    expect(text).toContain('#EXT-X-ENDLIST');
  });
});

describe('buildMasterPlaylist', () => {
  it('authors audio + subtitle groups and a video-only main rendition', () => {
    const master = buildMasterPlaylist({
      durationSeconds: 5400,
      audio: pickAudioRenditions(media),
      subtitles: pickSubtitleRenditions(media.subtitleTracks, []),
      bandwidth: 8_000_000,
      videoCodec: 'h264',
      resolution: { width: 1920, height: 1080 },
    });
    expect(master).toContain('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud"');
    expect(master).toContain('URI="audio/1/main.m3u8"');
    expect(master).toContain('URI="audio/2/main.m3u8"');
    expect(master).toContain('URI="subs/track-0.m3u8"');
    expect(master).toContain('AUDIO="aud"');
    expect(master).toContain('SUBTITLES="subs"');
    expect(master).toContain('RESOLUTION=1920x1080');
    expect(master).toContain('video/main.m3u8');
  });

  it('omits groups when there is no audio or subtitles', () => {
    const master = buildMasterPlaylist({ durationSeconds: 10, audio: [], subtitles: [], bandwidth: 100 });
    expect(master).not.toContain('#EXT-X-MEDIA');
    expect(master).not.toContain('AUDIO="');
  });
});
