import { describe, expect, it } from 'vitest';
import { createProwlarrClient } from './prowlarr.js';
import { UpstreamError } from '../types.js';
import { createResponse, makeFetch } from '../../test/helpers.js';
import { infoHashFromMagnet } from '../lib/magnet.js';

const CONFIG = { baseUrl: 'http://prowlarr:9696', apiKey: 'pk' };

const HASH_A = 'aaa'.repeat(13) + 'a';
const HASH_B = 'bbb'.repeat(13) + 'b';

describe('ProwlarrClient.search', () => {
  it('maps camelCase fields, sorts by seeders, dedupes by infoHash, and fills magnetUri', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/api/v1/search'),
        respond: () =>
          createResponse(200, [
            { title: 'Low Seeds', size: 100, seeders: 2, leechers: 1, infoHash: HASH_B, indexerId: 1, indexer: '1337x', magnetUrl: '' },
            { title: 'High Seeds', size: 200, seeders: 10, leechers: 3, infoHash: HASH_A, indexerId: 2, indexer: 'tpb', magnetUrl: 'magnet:?xt=urn:btih:' + HASH_A },
            { title: 'Dup Low', size: 300, seeders: 4, leechers: 0, infoHash: HASH_A, indexerId: 3, indexer: 'tpb', magnetUrl: '' },
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

  it('builds a real magnet from infoHash when magnetUrl is a Prowlarr download URL', async () => {
    const fetchImpl = makeFetch([
      {
        match: () => true,
        respond: () =>
          createResponse(200, [
            { title: 'DL', size: 1, seeders: 5, infoHash: HASH_A, indexerId: 1, indexer: 'x', magnetUrl: 'http://localhost:9696/1/download?apikey=abc&link=xyz' },
          ]),
      },
    ]);
    const client = createProwlarrClient({ ...CONFIG, fetchImpl });
    const sources = await client.search('q', 2000);
    expect(sources[0]!.magnetUri.startsWith('magnet:?xt=urn:btih:')).toBe(true);
    expect(sources[0]!.magnetUri).not.toContain('download?apikey');
    expect(infoHashFromMagnet(sources[0]!.magnetUri)).toBe(HASH_A);
  });

  it('falls back to the Prowlarr download URL with a placeholder hash when no infoHash exists', async () => {
    const fetchImpl = makeFetch([
      {
        match: () => true,
        respond: () =>
          createResponse(200, [
            { title: 'No Hash Source', size: 1, seeders: 5, indexerId: 4, indexer: '1337x', downloadUrl: 'http://localhost:9696/4/download?apikey=abc&link=xyz' },
          ]),
      },
    ]);
    const client = createProwlarrClient({ ...CONFIG, fetchImpl });
    const sources = await client.search('q', 2000);
    expect(sources).toHaveLength(1);
    const s = sources[0]!;
    expect(s.infoHash.startsWith('url-')).toBe(true);
    expect(s.magnetUri.startsWith('http://prowlarr:9696/4/download')).toBe(true);
    expect(s.magnetUri).not.toContain('localhost');
  });

  it('drops results with no infoHash, magnet, or downloadUrl', async () => {
    const fetchImpl = makeFetch([
      {
        match: () => true,
        respond: () =>
          createResponse(200, [
            { title: 'Nothing', size: 1, seeders: 5, indexerId: 1, indexer: 'x' },
            { title: 'Valid', size: 1, seeders: 5, infoHash: HASH_A, indexerId: 1, indexer: 'x' },
          ]),
      },
    ]);
    const client = createProwlarrClient({ ...CONFIG, fetchImpl });
    const sources = await client.search('q', 2000);
    expect(sources).toHaveLength(1);
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
