import { describe, expect, it, vi } from 'vitest';
import { createArtService } from './artService.js';
import type { FanartOutcome, FanartGateway } from './fanartGateway.js';
import type { ArtRepository, MediaArtRow } from '../db/artRepo.js';
import type { ArtSubject, MediaArt } from '../types.js';

const MOVIE: ArtSubject = { mediaType: 'movie', tmdbId: 550 };
const KEY = 'movie:550';
const ART: MediaArt = { thumbUrl: 'https://fanart.tv/t.jpg', logoUrl: 'https://fanart.tv/l.png' };

function memoryRepo(): ArtRepository & { rows: MediaArtRow[]; getCalls: number; upserted: MediaArtRow[] } {
  const self: ArtRepository & { rows: MediaArtRow[]; getCalls: number; upserted: MediaArtRow[] } = {
    rows: [],
    getCalls: 0,
    upserted: [],
    async getMany(keys: ArtSubject[]) {
      self.getCalls += 1;
      return self.rows.filter((row) => keys.some((k) => k.mediaType === row.mediaType && k.tmdbId === row.tmdbId));
    },
    async upsertMany(rows: MediaArtRow[]) {
      for (const row of rows) {
        const index = self.rows.findIndex((r) => r.mediaType === row.mediaType && r.tmdbId === row.tmdbId);
        if (index >= 0) self.rows[index] = row;
        else self.rows.push(row);
      }
      self.upserted.push(...rows);
    },
  };
  return self;
}

function outcome(out: FanartOutcome): FanartGateway {
  return {
    fetch: vi.fn(async () => out) as unknown as FanartGateway['fetch'],
    isBusy: () => false,
  };
}

function emptyRepo(): ArtRepository {
  return { getMany: async () => [], upsertMany: async () => {} };
}

function lastUpserted(repo: ReturnType<typeof memoryRepo>): MediaArtRow {
  return repo.upserted[repo.upserted.length - 1]!;
}

describe('createArtService', () => {
  it('resolves from the DB once and memoizes for the next call', async () => {
    const repo = memoryRepo();
    repo.rows.push({ mediaType: 'movie', tmdbId: 550, tvdbId: null, thumbUrl: ART.thumbUrl, logoUrl: ART.logoUrl, status: 'ok', fetchedAt: new Date().toISOString() });
    const gateway = outcome({ kind: 'empty', tvdbId: null });
    const service = createArtService({ repo, gateway });

    const first = await service.resolveManyCached([MOVIE]);
    expect(first.get(KEY)).toEqual(ART);
    const second = await service.resolveManyCached([MOVIE]);
    expect(second.get(KEY)).toEqual(ART);
    expect(repo.getCalls).toBe(1);
    expect(gateway.fetch).not.toHaveBeenCalled();
  });

  it('enqueues only unknown subjects and persists ok results after drain', async () => {
    const repo = memoryRepo();
    const gateway = outcome({ kind: 'ok', thumbUrl: ART.thumbUrl, logoUrl: ART.logoUrl, tvdbId: null });
    const service = createArtService({ repo, gateway });

    service.enqueueMissing([MOVIE]);
    service.enqueueMissing([MOVIE]);
    await service.drain();

    expect(gateway.fetch).toHaveBeenCalledTimes(1);
    const row = lastUpserted(repo);
    expect(row.status).toBe('ok');
    expect(row.thumbUrl).toBe(ART.thumbUrl);
    const cached = await service.resolveManyCached([MOVIE]);
    expect(cached.get(KEY)).toEqual(ART);
    expect(gateway.fetch).toHaveBeenCalledTimes(1);
  });

  it('persists empty results so known-absent titles are never refetched immediately', async () => {
    const repo = memoryRepo();
    const gateway = outcome({ kind: 'empty', tvdbId: null });
    const service = createArtService({ repo, gateway });

    service.enqueueMissing([MOVIE]);
    await service.drain();
    expect(lastUpserted(repo).status).toBe('empty');

    service.enqueueMissing([MOVIE]);
    await service.drain();
    expect(gateway.fetch).toHaveBeenCalledTimes(1);
    expect((await service.resolveManyCached([MOVIE])).has(KEY)).toBe(false);
  });

  it('never persists transient errors and backs off before retrying', async () => {
    const repo = memoryRepo();
    const gateway = outcome({ kind: 'error' });
    const service = createArtService({ repo, gateway });

    service.enqueueMissing([MOVIE]);
    await service.drain();
    expect(repo.upserted).toHaveLength(0);

    const one = await service.resolveOne(MOVIE);
    expect(one).toBeNull();
    expect(gateway.fetch).toHaveBeenCalledTimes(1);
  });

  it('resolveOne blocks until the fetch resolves', async () => {
    const repo = memoryRepo();
    const gateway = outcome({ kind: 'ok', thumbUrl: ART.thumbUrl, logoUrl: ART.logoUrl, tvdbId: null });
    const service = createArtService({ repo, gateway });
    const art = await service.resolveOne(MOVIE);
    expect(art).toEqual(ART);
  });

  it('refreshExpired only refetches stale empty rows', async () => {
    const repo = memoryRepo();
    repo.rows.push({
      mediaType: 'movie',
      tmdbId: 550,
      tvdbId: null,
      thumbUrl: null,
      logoUrl: null,
      status: 'empty',
      fetchedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const gateway = outcome({ kind: 'ok', thumbUrl: ART.thumbUrl, logoUrl: ART.logoUrl, tvdbId: null });
    const service = createArtService({ repo, gateway });

    const refreshed = await service.refreshExpired([MOVIE], 7 * 24 * 60 * 60 * 1000);
    expect(refreshed).toBe(1);
    await service.drain();
    expect(lastUpserted(repo).status).toBe('ok');
  });

  it('does not refetch fresh empty rows during refreshExpired', async () => {
    const repo = memoryRepo();
    repo.rows.push({
      mediaType: 'movie',
      tmdbId: 550,
      tvdbId: null,
      thumbUrl: null,
      logoUrl: null,
      status: 'empty',
      fetchedAt: new Date().toISOString(),
    });
    const gateway = outcome({ kind: 'empty', tvdbId: null });
    const service = createArtService({ repo, gateway });
    const refreshed = await service.refreshExpired([MOVIE], 7 * 24 * 60 * 60 * 1000);
    expect(refreshed).toBe(0);
    expect(gateway.fetch).not.toHaveBeenCalled();
  });

  it('clear() drops the memo so a provider flip can refetch', async () => {
    const repo = memoryRepo();
    repo.rows.push({ mediaType: 'movie', tmdbId: 550, tvdbId: null, thumbUrl: ART.thumbUrl, logoUrl: ART.logoUrl, status: 'ok', fetchedAt: new Date().toISOString() });
    const gateway = outcome({ kind: 'ok', thumbUrl: ART.thumbUrl, logoUrl: ART.logoUrl, tvdbId: null });
    const service = createArtService({ repo, gateway });
    await service.resolveManyCached([MOVIE]);
    expect(repo.getCalls).toBe(1);
    service.clear();
    await service.resolveManyCached([MOVIE]);
    expect(repo.getCalls).toBe(2);
  });

  it('treats a missing repo row as an unknown that can be enqueued', async () => {
    const service = createArtService({ repo: emptyRepo(), gateway: outcome({ kind: 'ok', thumbUrl: ART.thumbUrl, logoUrl: ART.logoUrl, tvdbId: null }) });
    const cached = await service.resolveManyCached([MOVIE]);
    expect(cached.has(KEY)).toBe(false);
  });
});
