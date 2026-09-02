import { describe, expect, it } from 'vitest';
import { createProwlarrClient } from './prowlarr.js';
import { UpstreamError } from '../types.js';
import { createResponse, makeFetch } from '../../test/helpers.js';
import { infoHashFromMagnet } from '../lib/magnet.js';

const CONFIG = { baseUrl: 'http://prowlarr:9696', apiKey: 'pk' };

const HASH_A = 'aaa'.repeat(13) + 'a';
const HASH_B = 'bbb'.repeat(13) + 'b';

describe('ProwlarrClient.search', () => {
  it('maps, sorts by seeders, dedupes by infoHash, and fills magnetUri', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/api/v1/search'),
        respond: () =>
          createResponse(200, [
            { Title: 'Low Seeds', Size: 100, Seeders: 2, Leechers: 1, InfoHash: HASH_B, IndexerId: 1, Indexer: '1337x', MagnetUrl: '' },
            { Title: 'High Seeds', Size: 200, Seeders: 10, Leechers: 3, InfoHash: HASH_A, IndexerId: 2, Indexer: 'tpb', MagnetUrl: 'magnet:?xt=urn:btih:' + HASH_A },
            { Title: 'Dup Low', Size: 300, Seeders: 4, Leechers: 0, InfoHash: HASH_A, IndexerId: 3, Indexer: 'tpb', MagnetUrl: '' },
          ]),
      },
    ]);
    const client = createProwlarrClient({ ...CONFIG, fetchImpl });
    const sources = await client.search('inception 2010', 2000);
    expect(sources).toHaveLength(2);
    expect(sources[0]!.infoHash).toBe(HASH_A);
    expect(sources[0]!.seeders).toBe(10);
    expect(sources[0]!.indexerId).toBe(2);
    expect(sources[1]!.infoHash).toBe(HASH_B);
  });

  it('builds a magnet from infoHash when MagnetUrl is empty', async () => {
    const fetchImpl = makeFetch([
      {
        match: () => true,
        respond: () =>
          createResponse(200, [{ Title: 'No Magnet', Size: 1, Seeders: 5, InfoHash: HASH_A, IndexerId: 1, Indexer: 'x', MagnetUrl: '' }]),
      },
    ]);
    const client = createProwlarrClient({ ...CONFIG, fetchImpl });
    const sources = await client.search('q', 2000);
    expect(sources[0]!.magnetUri.startsWith('magnet:?xt=urn:btih:')).toBe(true);
    expect(infoHashFromMagnet(sources[0]!.magnetUri)).toBe(HASH_A);
  });

  it('derives infoHash from a magnet when InfoHash is absent', async () => {
    const fetchImpl = makeFetch([
      {
        match: () => true,
        respond: () =>
          createResponse(200, [{ Title: 'Magnet only', Size: 1, Seeders: 5, InfoHash: '', IndexerId: 1, Indexer: 'x', MagnetUrl: 'magnet:?xt=urn:btih:' + HASH_A }]),
      },
    ]);
    const client = createProwlarrClient({ ...CONFIG, fetchImpl });
    const sources = await client.search('q', 2000);
    expect(sources[0]!.infoHash).toBe(HASH_A);
  });

  it('drops results with neither InfoHash nor MagnetUrl', async () => {
    const fetchImpl = makeFetch([
      {
        match: () => true,
        respond: () =>
          createResponse(200, [
            { Title: 'No hash', Size: 1, Seeders: 5, InfoHash: '', IndexerId: 1, Indexer: 'x', MagnetUrl: '' },
            { Title: 'Valid', Size: 1, Seeders: 5, InfoHash: HASH_A, IndexerId: 1, Indexer: 'x', MagnetUrl: '' },
          ]),
      },
    ]);
    const client = createProwlarrClient({ ...CONFIG, fetchImpl });
    const sources = await client.search('q', 2000);
    expect(sources).toHaveLength(1);
  });

  it('returns empty array on upstream failure', async () => {
    const fetchImpl = makeFetch([
      { match: () => true, respond: () => { throw new TypeError('down'); } },
    ]);
    const client = createProwlarrClient({ ...CONFIG, fetchImpl });
    await expect(client.search('q', 2000)).rejects.toBeInstanceOf(UpstreamError);
  });

  it('throws UpstreamError(401) on an invalid API key', async () => {
    const fetchImpl = makeFetch([{ match: () => true, respond: () => createResponse(401, {}) }]);
    const client = createProwlarrClient({ ...CONFIG, fetchImpl });
    await expect(client.search('q', 2000)).rejects.toMatchObject({ status: 401 });
  });
});
