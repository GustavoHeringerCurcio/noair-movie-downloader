import { describe, expect, it } from 'vitest';
import { buildCompatCommand } from './transcode.js';

describe('buildCompatCommand', () => {
  it('copies video and re-encodes the first audio track to AAC in a fragmented mp4', () => {
    const { args } = buildCompatCommand('/downloads/movie/a.mkv');
    expect(args).toContain('-i');
    expect(args[args.indexOf('-i') + 1]).toBe('/downloads/movie/a.mkv');
    expect(args).toContain('-c:v');
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
    expect(args).toContain('-c:a');
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
    expect(args).toContain('-f');
    expect(args[args.indexOf('-f') + 1]).toBe('mp4');
    expect(args.join(' ')).toContain('frag_keyframe+empty_moov');
    expect(args.join(' ')).toContain('0:v:0?');
    expect(args.join(' ')).toContain('0:a:0?');
    expect(args[args.length - 1]).toBe('pipe:1');
  });
});
