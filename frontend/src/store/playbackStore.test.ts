import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackStore } from './playbackStore';

const HASH = 'ab'.repeat(20);
const PREFIX = 'movie-downloader.playback.';

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('usePlaybackStore', () => {
  it('reports 0 for an unknown download', () => {
    expect(usePlaybackStore.getState().getPosition(HASH, null)).toBe(0);
  });

  it('round-trips a saved position keyed by file', () => {
    const { setPosition, getPosition } = usePlaybackStore.getState();

    setPosition(HASH, null, 42.7);
    expect(getPosition(HASH, null)).toBe(42);
    expect(getPosition(HASH, 'movie.mkv')).toBe(0);
    expect(window.localStorage.getItem(`${PREFIX}${HASH}`)).toBe('42');

    setPosition(HASH, 'movie.mkv', 15);
    expect(getPosition(HASH, 'movie.mkv')).toBe(15);
    expect(getPosition(HASH, null)).toBe(42);
  });

  it('clearPosition removes only the matching key', () => {
    const { setPosition, getPosition, clearPosition } = usePlaybackStore.getState();
    setPosition(HASH, null, 10);
    setPosition(HASH, 'movie.mkv', 20);

    clearPosition(HASH, null);

    expect(getPosition(HASH, null)).toBe(0);
    expect(getPosition(HASH, 'movie.mkv')).toBe(20);
  });

  it('ignores corrupt stored values', () => {
    window.localStorage.setItem(`${PREFIX}${HASH}`, 'not-a-number');
    expect(usePlaybackStore.getState().getPosition(HASH, null)).toBe(0);

    window.localStorage.setItem(`${PREFIX}${HASH}`, '-5');
    expect(usePlaybackStore.getState().getPosition(HASH, null)).toBe(0);
  });

  it('never stores non-finite or negative seconds', () => {
    const { setPosition, getPosition } = usePlaybackStore.getState();

    setPosition(HASH, null, Number.NaN);
    setPosition(HASH, null, -3);
    setPosition(HASH, null, Number.POSITIVE_INFINITY);

    expect(window.localStorage.getItem(`${PREFIX}${HASH}`)).toBeNull();
    expect(getPosition(HASH, null)).toBe(0);
  });

  it('degrades silently when storage is unavailable', () => {
    const { setPosition, getPosition, clearPosition } = usePlaybackStore.getState();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(() => setPosition(HASH, null, 50)).not.toThrow();
    expect(getPosition(HASH, null)).toBe(0);
    expect(() => clearPosition(HASH, null)).not.toThrow();
  });
});
