import { describe, expect, it, vi } from 'vitest';
import { createFanartGateway } from './fanartGateway.js';
import type { FanartClient, FanartResult } from '../services/fanart.js';
import type { ArtSubject } from '../types.js';

const MOVIE: ArtSubject = { mediaType: 'movie', tmdbId: 550 };
const TV: ArtSubject = { mediaType: 'tv', tmdbId: 100 };

function result(status: FanartResult['status']): FanartResult {
  return { status, thumbUrl: null, backgroundUrl: null, logoUrl: null };
}

function clientWith(getMovieArt?: FanartClient['getMovieArt'], getTvArt?: FanartClient['getTvArt']): FanartClient {
  return {
    getMovieArt: getMovieArt ?? (async () => result('empty')),
    getTvArt: getTvArt ?? (async () => result('empty')),
  };
}

describe('createFanartGateway', () => {
  it('serializes requests (never two Fanart calls at once)', async () => {
    let active = 0;
    let maxActive = 0;
    const client = clientWith(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { status: 'ok' as const, thumbUrl: 'https://fanart.tv/a.jpg', logoUrl: null };
    });
    const gateway = createFanartGateway({ fanart: client, minGapMs: 0 });
    const subjects: ArtSubject[] = [
      { mediaType: 'movie', tmdbId: 1 },
      { mediaType: 'movie', tmdbId: 2 },
      { mediaType: 'movie', tmdbId: 3 },
    ];
    const outcomes = await Promise.all(subjects.map((s) => gateway.fetch(s, 'low')));
    expect(outcomes.every((o) => o.kind === 'ok')).toBe(true);
    expect(maxActive).toBe(1);
  });

  it('lets high-priority fetches jump the warm (low) queue', async () => {
    const order: number[] = [];
    const client = clientWith(async (id: number) => {
      order.push(id);
      return result('empty');
    });
    const gateway = createFanartGateway({ fanart: client, minGapMs: 0 });
    void gateway.fetch({ mediaType: 'movie', tmdbId: 1 }, 'low');
    void gateway.fetch({ mediaType: 'movie', tmdbId: 2 }, 'low');
    await gateway.fetch({ mediaType: 'movie', tmdbId: 3 }, 'high');
    await gateway.fetch({ mediaType: 'movie', tmdbId: 4 }, 'low');
    expect(order).toEqual([1, 3, 2, 4]);
  });

  it('coalesces concurrent fetches for the same subject (single-flight)', async () => {
    const getMovieArt = vi.fn(async () => result('empty'));
    const gateway = createFanartGateway({ fanart: clientWith(getMovieArt), minGapMs: 0 });
    await Promise.all([
      gateway.fetch(MOVIE, 'low'),
      gateway.fetch(MOVIE, 'high'),
      gateway.fetch(MOVIE, 'low'),
    ]);
    expect(getMovieArt).toHaveBeenCalledTimes(1);
  });

  it('maps movie ok results', async () => {
    const gateway = createFanartGateway({
      fanart: clientWith(async () => ({
        status: 'ok' as const,
        thumbUrl: 'https://fanart.tv/t.jpg',
        posterUrl: 'https://fanart.tv/p.jpg',
        logoUrl: 'https://fanart.tv/l.png',
      })),
      minGapMs: 0,
    });
    const outcome = await gateway.fetch(MOVIE, 'high');
    expect(outcome).toEqual({
      kind: 'ok',
      thumbUrl: 'https://fanart.tv/t.jpg',
      posterUrl: 'https://fanart.tv/p.jpg',
      logoUrl: 'https://fanart.tv/l.png',
      tvdbId: null,
    });
  });

  it('propagates poster-only ok results', async () => {
    const gateway = createFanartGateway({
      fanart: clientWith(async () => ({
        status: 'ok' as const,
        thumbUrl: null,
        posterUrl: 'https://fanart.tv/p.jpg',
        logoUrl: null,
      })),
      minGapMs: 0,
    });
    const outcome = await gateway.fetch(MOVIE, 'high');
    expect(outcome).toEqual({ kind: 'ok', thumbUrl: null, posterUrl: 'https://fanart.tv/p.jpg', logoUrl: null, tvdbId: null });
  });

  it('resolves TVDB ids once and uses them for TV art', async () => {
    const resolveTvdbId = vi.fn(async () => 789);
    const getTvArt = vi.fn(async () => ({
      status: 'ok' as const,
      thumbUrl: 'https://fanart.tv/tv.jpg',
      posterUrl: 'https://fanart.tv/tvp.jpg',
      logoUrl: null,
    }));
    const gateway = createFanartGateway({
      fanart: clientWith(undefined, getTvArt),
      resolveTvdbId,
      minGapMs: 0,
    });
    const outcome = await gateway.fetch(TV, 'high');
    expect(resolveTvdbId).toHaveBeenCalledWith(100);
    expect(getTvArt).toHaveBeenCalledWith(789);
    expect(outcome).toEqual({
      kind: 'ok',
      thumbUrl: 'https://fanart.tv/tv.jpg',
      posterUrl: 'https://fanart.tv/tvp.jpg',
      logoUrl: null,
      tvdbId: 789,
    });
  });

  it('treats an unknown TVDB id as empty without calling Fanart', async () => {
    const getTvArt = vi.fn(async () => result('empty'));
    const gateway = createFanartGateway({
      fanart: clientWith(undefined, getTvArt),
      resolveTvdbId: async () => null,
      minGapMs: 0,
    });
    const outcome = await gateway.fetch(TV, 'high');
    expect(outcome).toEqual({ kind: 'empty', tvdbId: null });
    expect(getTvArt).not.toHaveBeenCalled();
  });

  it('maps transient failures to error (never a fake empty)', async () => {
    const client = clientWith(async () => {
      throw new Error('network down');
    });
    const gateway = createFanartGateway({ fanart: client, minGapMs: 0 });
    const outcome = await gateway.fetch(MOVIE, 'high');
    expect(outcome).toEqual({ kind: 'error' });
  });

  it('returns error when no Fanart client is configured', async () => {
    const gateway = createFanartGateway({ fanart: null, minGapMs: 0 });
    const outcome = await gateway.fetch(MOVIE, 'high');
    expect(outcome).toEqual({ kind: 'error' });
  });
});
