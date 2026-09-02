import { describe, expect, it } from 'vitest';
import { buildMagnet, infoHashFromMagnet, MAGNET_TRACKERS } from './magnet.js';

const HASH = 'abc123def456abc123def456abc123def456abc1';

describe('buildMagnet', () => {
  it('includes valid xt and dn components', () => {
    const magnet = buildMagnet(HASH, 'Inception 2010');
    expect(magnet.startsWith('magnet:?xt=urn:btih:')).toBe(true);
    expect(magnet).toContain(`xt=urn:btih:${HASH}`);
    expect(magnet).toContain('dn=Inception%202010');
  });

  it('contains all 9 trackers', () => {
    const magnet = buildMagnet(HASH, 'test');
    const trs = magnet.split('&').filter((part) => part.startsWith('tr='));
    expect(trs).toHaveLength(9);
    for (const tracker of MAGNET_TRACKERS) {
      expect(magnet).toContain(`tr=${encodeURIComponent(tracker)}`);
    }
  });

  it('lowercases the info hash', () => {
    const magnet = buildMagnet(HASH.toUpperCase(), 'test');
    expect(magnet).toContain(`xt=urn:btih:${HASH}`);
  });
});

describe('infoHashFromMagnet', () => {
  it('round-trips an info hash', () => {
    const magnet = buildMagnet(HASH, 'Inception 2010');
    expect(infoHashFromMagnet(magnet)).toBe(HASH);
  });

  it('returns null for invalid magnet', () => {
    expect(infoHashFromMagnet('not a magnet')).toBeNull();
  });
});
