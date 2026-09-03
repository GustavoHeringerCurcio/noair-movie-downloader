import { describe, expect, it } from 'vitest';
import { decideStreamMode } from './streamPlan.js';

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
