import { describe, expect, it } from 'vitest';
import { decideStreamMode, decidePlaybackMode } from './streamPlan.js';
import type { MediaInfo } from './mediaInfo.js';

function media(overrides: Partial<MediaInfo>): MediaInfo {
  return {
    container: 'mkv',
    durationSeconds: 5400,
    video: { index: 0, codec: 'h264', width: 1920, height: 1080, hdr: false },
    audioTracks: [{ index: 1, codec: 'aac', language: 'en', title: null, channels: 2, default: true }],
    subtitleTracks: [],
    videoCodec: 'h264',
    audioCodec: 'aac',
    height: 1080,
    ...overrides,
  };
}

describe('decideStreamMode', () => {
  it('direct-plays browser-safe codecs', () => {
    expect(decideStreamMode({ videoCodec: 'h264', audioCodec: 'aac', height: 1080 })).toBe('direct');
    expect(decideStreamMode({ videoCodec: 'av1', audioCodec: 'opus', height: 1080 })).toBe('direct');
    expect(decideStreamMode({ videoCodec: 'h264', audioCodec: null, height: 720 })).toBe('direct');
    expect(decideStreamMode({ videoCodec: null, audioCodec: null, height: null })).toBe('direct');
  });

  it('remuxes audio when only the audio codec is unsupported', () => {
    expect(decideStreamMode({ videoCodec: 'h264', audioCodec: 'ac3', height: 1080 })).toBe('remux-audio');
    expect(decideStreamMode({ videoCodec: 'h264', audioCodec: 'eac3', height: 1080 })).toBe('remux-audio');
    expect(decideStreamMode({ videoCodec: 'h264', audioCodec: 'dts', height: 1080 })).toBe('remux-audio');
  });

  it('transcodes HEVC below 4K', () => {
    expect(decideStreamMode({ videoCodec: 'hevc', audioCodec: 'aac', height: 1080 })).toBe('transcode');
    expect(decideStreamMode({ videoCodec: 'hevc', audioCodec: 'eac3', height: 1080 })).toBe('transcode');
  });

  it('requires an external player for 4K/UHD non-browser-safe video', () => {
    expect(decideStreamMode({ videoCodec: 'hevc', audioCodec: 'aac', height: 2160 })).toBe('player-required');
    expect(decideStreamMode({ videoCodec: 'hevc', audioCodec: 'eac3', height: 2160 })).toBe('player-required');
  });

  it('direct-plays HEVC only if considered safe (not the case for Chrome)', () => {
    expect(decideStreamMode({ videoCodec: 'vp9', audioCodec: 'eac3', height: 2160 })).toBe('remux-audio');
  });
});

describe('decidePlaybackMode', () => {
  it('direct-plays a native mp4 with one browser-safe audio track', () => {
    expect(decidePlaybackMode(media({ container: 'mp4' }))).toBe('direct');
    expect(decidePlaybackMode(media({ container: 'webm', videoCodec: 'vp9' }))).toBe('direct');
  });

  it('packages to hls when the container is not natively playable', () => {
    expect(decidePlaybackMode(media({ container: 'mkv' }))).toBe('hls');
    expect(decidePlaybackMode(media({ container: 'avi' }))).toBe('hls');
  });

  it('packages to hls for unsupported audio, multiple audio or subtitles in native containers', () => {
    expect(
      decidePlaybackMode(media({ container: 'mp4', audioCodec: 'eac3', audioTracks: [
        { index: 1, codec: 'eac3', language: 'en', title: null, channels: 6, default: true },
      ] })),
    ).toBe('hls');
    expect(decidePlaybackMode(media({ container: 'mp4', audioTracks: [
      { index: 1, codec: 'aac', language: 'en', title: null, channels: 2, default: true },
      { index: 2, codec: 'aac', language: 'es', title: null, channels: 2, default: false },
    ] }))).toBe('hls');
    expect(decidePlaybackMode(media({ container: 'mp4' }), { sidecarSubtitles: 1 })).toBe('hls');
    expect(decidePlaybackMode(media({ container: 'mp4', subtitleTracks: [
      { index: 2, codec: 'subrip', kind: 'text', language: 'en', title: null, default: false },
    ] }))).toBe('hls');
  });

  it('packages HEVC below 4K, but keeps 4K HEVC external (player-required)', () => {
    expect(decidePlaybackMode(media({ videoCodec: 'hevc', height: 1080 }))).toBe('hls');
    expect(decidePlaybackMode(media({ videoCodec: 'hevc', height: 2160 }))).toBe('player-required');
  });

  it('keeps legacy transcode for video codecs that cannot be stream-copied', () => {
    expect(decidePlaybackMode(media({ videoCodec: 'mpeg4', audioCodec: 'aac', height: 720 }))).toBe('transcode');
  });

  it('direct-plays when no probe is available (caller fallback)', () => {
    expect(decidePlaybackMode(null)).toBe('direct');
  });
});
