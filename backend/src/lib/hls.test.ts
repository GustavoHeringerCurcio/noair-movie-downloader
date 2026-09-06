import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  audioSegmentArgs,
  buildMasterPlaylist,
  canCopyAudioTrack,
  embeddedSubtitleArgs,
  languageLabel,
  mseProbeTypes,
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

  it('audio segment args target one track (global stream index) and encode AAC', () => {
    const args = audioSegmentArgs('/x.mkv', 2, path.join('/packages', 'k', 'audio', '2'));
    expect(args).toContain('-map');
    expect(args[args.indexOf('-map') + 1]).toBe('0:2');
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
    expect(args[args.length - 1]).toBe(path.join('/packages', 'k', 'audio', '2', 'main.m3u8'));
  });

  it('audio segment args stream-copy when the track is browser-safe AAC', () => {
    const args = audioSegmentArgs('/x.mkv', 2, path.join('/packages', 'k', 'audio', '2'), { copy: true });
    expect(args[args.indexOf('-c:a') + 1]).toBe('copy');
    expect(args).not.toContain('aac_coder');
  });

  it('audio segment args use the fast AAC coder for genuine encodes', () => {
    const args = audioSegmentArgs('/x.mkv', 2, path.join('/packages', 'k', 'audio', '2'));
    expect(args).toContain('-aac_coder');
    expect(args[args.indexOf('-aac_coder') + 1]).toBe('fast');
  });

  it('audio segment args map a single audio track at global index 1 to 0:1', () => {
    const args = audioSegmentArgs('/x.mkv', 1, path.join('/packages', 'k', 'audio', '1'));
    expect(args[args.indexOf('-map') + 1]).toBe('0:1');
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

describe('canCopyAudioTrack', () => {
  it('copies AAC-LC at 48kHz and leaves everything else to the encoder', () => {
    expect(canCopyAudioTrack({ codec: 'aac', profile: 'LC', sampleRate: 48000 })).toBe(true);
    expect(canCopyAudioTrack({ codec: 'aac', sampleRate: 44100 })).toBe(true);
    expect(canCopyAudioTrack({ codec: 'aac', profile: null, sampleRate: null })).toBe(true);
  });

  it('refuses to copy non-AAC, HE-AAC, or >48kHz tracks', () => {
    expect(canCopyAudioTrack({ codec: 'dts', profile: null, sampleRate: 48000 })).toBe(false);
    expect(canCopyAudioTrack({ codec: 'aac', profile: 'HE-AAC', sampleRate: 44100 })).toBe(false);
    expect(canCopyAudioTrack({ codec: 'aac', profile: 'LC', sampleRate: 96000 })).toBe(false);
    expect(canCopyAudioTrack({ codec: 'eac3' })).toBe(false);
  });
});

describe('mseProbeTypes', () => {
  it('provides avc1 candidates for h264 and vp09/av01 for the modern codecs', () => {
    expect(mseProbeTypes({ codec: 'h264', profile: 'High', level: 40 })).toEqual([
      'video/mp4; codecs="avc1.640028,mp4a.40.2"',
      'video/mp4; codecs="avc1.4d401f,mp4a.40.2"',
    ]);
    expect(mseProbeTypes({ codec: 'vp9' })[0]).toContain('vp09');
    expect(mseProbeTypes({ codec: 'av1' })[0]).toContain('av01');
  });

  it('routes 8-bit HEVC through an hvc1/hev1 probe pair', () => {
    const types = mseProbeTypes({ codec: 'hevc', profile: 'Main', pixFmt: 'yuv420p', level: 120 });
    expect(types).toEqual([
      'video/mp4; codecs="hvc1.1.6.L120.B0,mp4a.40.2"',
      'video/mp4; codecs="hev1.1.6.L120.B0,mp4a.40.2"',
    ]);
  });

  it('declares 10-bit HEVC unsupported (no candidates → skip packaging)', () => {
    expect(mseProbeTypes({ codec: 'hevc', profile: 'Main 10', pixFmt: 'yuv420p10le', level: 120 })).toEqual([]);
    expect(mseProbeTypes({ codec: 'hevc', profile: 'Main', pixFmt: 'yuv420p12le' })).toEqual([]);
  });

  it('is permissive for unknown or missing video', () => {
    expect(mseProbeTypes(null)).toEqual([]);
    expect(mseProbeTypes({ codec: 'mpeg4' })).toEqual([]);
  });
});
