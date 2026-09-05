import { describe, expect, it } from 'vitest';
import { episodeKeyFromFilename, episodeToken, parseEpisodeToken } from './episode';

describe('episode token helpers', () => {
  it('formats canonical tokens', () => {
    expect(episodeToken(1, 3)).toBe('S01E03');
    expect(episodeToken(12, 100)).toBe('S12E100');
  });

  it('parses tokens', () => {
    expect(parseEpisodeToken('S01E03')).toEqual({ season: 1, episode: 3 });
    expect(parseEpisodeToken('nope')).toBeNull();
  });

  it('falls back to filename parsing when files lack server tags', () => {
    expect(episodeKeyFromFilename('Show.S01E03.mkv')).toEqual({ season: 1, episode: 3 });
    expect(episodeKeyFromFilename('Show.S01E03.mkv.!qb')).toEqual({ season: 1, episode: 3 });
    expect(episodeKeyFromFilename('Movie.2024.mkv')).toBeNull();
  });
});
