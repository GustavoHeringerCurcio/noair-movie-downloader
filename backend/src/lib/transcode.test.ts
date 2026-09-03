import { describe, expect, it } from 'vitest';
import { buildRemuxCommand, buildTranscodeCommand } from './transcode.js';

describe('buildRemuxCommand', () => {
  it('copies video and re-encodes the first audio track to AAC in a fragmented mp4', () => {
    const { args } = buildRemuxCommand('/downloads/movie/a.mkv');
    expect(args[args.indexOf('-i') + 1]).toBe('/downloads/movie/a.mkv');
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
    expect(args[args.indexOf('-f') + 1]).toBe('mp4');
    expect(args.join(' ')).toContain('frag_keyframe+empty_moov');
    expect(args[args.length - 1]).toBe('pipe:1');
  });
});

describe('buildTranscodeCommand', () => {
  it('encodes video to H.264 veryfast and audio to AAC', () => {
    const { args } = buildTranscodeCommand('/downloads/movie/hevc.mkv');
    expect(args[args.indexOf('-c:v') + 1]).toBe('libx264');
    expect(args[args.indexOf('-preset') + 1]).toBe('veryfast');
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
    expect(args.join(' ')).toContain('yuv420p');
    expect(args[args.length - 1]).toBe('pipe:1');
  });
});
