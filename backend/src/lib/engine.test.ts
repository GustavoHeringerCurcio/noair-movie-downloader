import { describe, expect, it } from 'vitest';
import { pickEncodeThreads, selectEncoder } from './engine.js';

describe('selectEncoder (engine hardware pick)', () => {
  it('falls back to software libx264 when no hardware device or encoder exists', () => {
    expect(selectEncoder([], null)).toEqual({
      encoder: 'libx264',
      hardware: false,
      note: 'software libx264 (no usable hardware encoder)',
    });
    expect(selectEncoder(['libx264'], null).encoder).toBe('libx264');
  });

  it('prefers VAAPI when a render node is present and the encoder exists', () => {
    const pick = selectEncoder(['libx264', 'h264_vaapi'], '/dev/dri/renderD128');
    expect(pick.encoder).toBe('h264_vaapi');
    expect(pick.hardware).toBe(true);
  });

  it('ignores a device node when the ffmpeg build lacks the encoder', () => {
    expect(selectEncoder(['libx264'], '/dev/dri/renderD128').encoder).toBe('libx264');
  });

  it('uses NVENC when available (no DRI required)', () => {
    const pick = selectEncoder(['libx264', 'h264_nvenc'], null);
    expect(pick.encoder).toBe('h264_nvenc');
    expect(pick.hardware).toBe(true);
  });
});

describe('pickEncodeThreads', () => {
  it('caps threads on low-memory hosts to keep the box usable', () => {
    expect(pickEncodeThreads(16, 2 * 1024 ** 3, undefined)).toBeLessThanOrEqual(4);
    expect(pickEncodeThreads(16, 6 * 1024 ** 3, undefined)).toBeLessThanOrEqual(8);
    expect(pickEncodeThreads(8, 16 * 1024 ** 3, undefined)).toBe(8);
  });

  it('never exceeds the core count', () => {
    expect(pickEncodeThreads(4, 32 * 1024 ** 3, undefined)).toBe(4);
  });

  it('honors an explicit CONVERSION_THREADS override', () => {
    expect(pickEncodeThreads(16, 32 * 1024 ** 3, '6')).toBe(6);
    expect(pickEncodeThreads(16, 1 * 1024 ** 3, '12')).toBe(12);
    expect(pickEncodeThreads(16, 32 * 1024 ** 3, 'bogus')).toBe(16);
  });
});
