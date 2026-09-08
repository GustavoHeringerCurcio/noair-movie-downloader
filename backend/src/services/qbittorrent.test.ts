import { describe, expect, it, vi } from 'vitest';
import { createQbittorrentClient, toCanonicalState } from './qbittorrent.js';
import { UpstreamError } from '../types.js';
import { createResponse, createResponseWithCookies, makeFetch } from '../../test/helpers.js';

const CONFIG = {
  baseUrl: 'http://qbittorrent:8080',
  username: 'admin',
  password: 'pass',
  savePath: '/downloads',
  category: 'stream',
};

describe('toCanonicalState', () => {
  const cases: Record<string, string> = {
    queuedDL: 'queued',
    queuedUP: 'queued',
    metaDL: 'fetching-metadata',
    forcedMetaDL: 'fetching-metadata',
    downloading: 'downloading',
    forcedDL: 'downloading',
    stalledDL: 'stalled',
    stalledUP: 'stalled',
    pausedDL: 'paused',
    pausedUP: 'paused',
    checkingDL: 'checking',
    checkingUP: 'checking',
    checkingResumeData: 'checking',
    uploading: 'seeding',
    error: 'error',
    missingFiles: 'error',
  };
  for (const [qbit, canonical] of Object.entries(cases)) {
    it(`maps ${qbit} -> ${canonical}`, () => {
      expect(toCanonicalState(qbit)).toBe(canonical);
    });
  }
  it('maps anything else to unknown', () => {
    expect(toCanonicalState('somethingWeird')).toBe('unknown');
  });
});

describe('QBittorrentClient.addTorrent', () => {
  it('sends sequential flags and returns on Ok.', async () => {
    let sentInit: RequestInit | undefined;
    let sentUrl = '';
    const fetchImpl = makeFetch([
      {
        match: (url) => url.endsWith('/api/v2/auth/login'),
        respond: () => createResponseWithCookies(200, 'Ok.', ['SID=abc123; Path=/']),
      },
      {
        match: (url) => url.endsWith('/api/v2/torrents/add'),
        respond: (url, init) => {
          sentUrl = url;
          sentInit = init;
          return createResponse(200, 'Ok.');
        },
      },
    ]);
    const client = createQbittorrentClient({ ...CONFIG, fetchImpl });
    await client.addTorrent('magnet:?xt=urn:btih:abc');
    const body = sentInit?.body as FormData;
    expect(body.get('category')).toBe('stream');
    expect(body.get('savepath')).toBe('/downloads');
    expect(body.get('sequentialDownload')).toBe('true');
    expect(body.get('firstLastPiecePriority')).toBe('true');
    expect(sentUrl).toContain('/api/v2/torrents/add');
  });

  it('accepts a 204 No Content login (qBittorrent 5.x behavior)', async () => {
    let added = false;
    const fetchImpl = makeFetch([
      {
        match: (url) => url.endsWith('/api/v2/auth/login'),
        respond: () => createResponse(204, undefined),
      },
      {
        match: () => true,
        respond: () => {
          added = true;
          return createResponse(200, 'Ok.');
        },
      },
    ]);
    const client = createQbittorrentClient({ ...CONFIG, fetchImpl });
    await client.addTorrent('magnet');
    expect(added).toBe(true);
  });

  it('accepts the qBittorrent 5.x structured JSON success response', async () => {
    let added = false;
    const fetchImpl = makeFetch([
      { match: (url) => url.endsWith('/api/v2/auth/login'), respond: () => createResponseWithCookies(200, 'Ok.', ['SID=x']) },
      {
        match: () => true,
        respond: () => {
          added = true;
          return createResponse(200, {
            added_torrent_ids: ['3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b'],
            failure_count: 0,
            pending_count: 0,
            success_count: 1,
          });
        },
      },
    ]);
    const client = createQbittorrentClient({ ...CONFIG, fetchImpl });
    await client.addTorrent('magnet');
    expect(added).toBe(true);
  });

  it('maps a structured JSON failure to 409', async () => {
    const fetchImpl = makeFetch([
      { match: (url) => url.endsWith('/api/v2/auth/login'), respond: () => createResponseWithCookies(200, 'Ok.', ['SID=x']) },
      { match: () => true, respond: () => createResponse(200, { added_torrent_ids: [], failure_count: 1, pending_count: 0, success_count: 0, error: 'torrent is already in list' }) },
    ]);
    const client = createQbittorrentClient({ ...CONFIG, fetchImpl });
    await expect(client.addTorrent('magnet')).rejects.toMatchObject({ status: 409 });
  });

  it('accepts a pending add (URL-based torrent fetch in progress)', async () => {
    let added = false;
    const fetchImpl = makeFetch([
      { match: (url) => url.endsWith('/api/v2/auth/login'), respond: () => createResponseWithCookies(200, 'Ok.', ['SID=x']) },
      {
        match: () => true,
        respond: () => {
          added = true;
          return createResponse(200, { added_torrent_ids: [], failure_count: 0, pending_count: 1, success_count: 0 });
        },
      },
    ]);
    const client = createQbittorrentClient({ ...CONFIG, fetchImpl });
    await client.addTorrent('https://example.com/file.torrent');
    expect(added).toBe(true);
  });

  it('throws 409 on duplicate add', async () => {
    const fetchImpl = makeFetch([
      { match: (url) => url.endsWith('/api/v2/auth/login'), respond: () => createResponseWithCookies(200, 'Ok.', ['SID=x']) },
      { match: () => true, respond: () => createResponse(200, 'Fails.: Magnet is already being downloaded') },
    ]);
    const client = createQbittorrentClient({ ...CONFIG, fetchImpl });
    await expect(client.addTorrent('magnet')).rejects.toMatchObject({ status: 409 });
  });

  it('throws 502 when add body is not Ok.', async () => {
    const fetchImpl = makeFetch([
      { match: () => true, respond: () => createResponseWithCookies(200, 'Fails.', ['SID=x']) },
    ]);
    const client = createQbittorrentClient({ ...CONFIG, fetchImpl });
    await expect(client.addTorrent('magnet')).rejects.toMatchObject({ status: 502 });
  });
});

describe('QBittorrentClient login flow', () => {
  it('re-logins on 403 and retries once', async () => {
    const loginCalls = vi.fn();
    const fetchImpl = makeFetch([
      {
        match: (url) => url.endsWith('/api/v2/auth/login'),
        respond: () => {
          loginCalls();
          return createResponseWithCookies(200, 'Ok.', ['SID=newcookie; Path=/']);
        },
      },
      {
        match: (url) => url.includes('/api/v2/torrents/info'),
        respond: (url, init) => {
          if (!(init?.headers as Record<string, string>)?.Cookie) {
            return createResponse(403, '');
          }
          return createResponse(200, [{ hash: 'H'.repeat(40), name: 't', state: 'downloading', progress: 0.5, dlspeed: 1, upspeed: 0, eta: -1, ratio: 0, size: 10, content_path: '/downloads/t' }]);
        },
      },
    ]);
    const client = createQbittorrentClient({ ...CONFIG, fetchImpl });
    const torrents = await client.listTorrents();
    expect(torrents).toHaveLength(1);
    expect(torrents[0]!.eta).toBe(-1);
    expect(loginCalls).toHaveBeenCalledTimes(1);
  });

  it('throws 502 if login fails', async () => {
    const fetchImpl = makeFetch([
      { match: () => true, respond: () => createResponse(403, 'Fails.') },
    ]);
    const client = createQbittorrentClient({ ...CONFIG, fetchImpl });
    await expect(client.listTorrents()).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe('QBittorrentClient.deleteTorrent', () => {
  it('passes deleteFiles flag in the POST form body and returns on success', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = makeFetch([
      { match: (url) => url.endsWith('/api/v2/auth/login'), respond: () => createResponseWithCookies(200, 'Ok.', ['SID=x']) },
      {
        match: (url) => url.includes('/api/v2/torrents/delete'),
        respond: (url, init) => {
          seen.push({ url, init });
          return createResponse(200, 'Ok.');
        },
      },
    ]);
    const client = createQbittorrentClient({ ...CONFIG, fetchImpl });
    await client.deleteTorrent('a'.repeat(40), true);
    expect(seen[0]?.url).not.toContain('deleteFiles');
    const body = seen[0]?.init?.body as string;
    expect(body).toContain('deleteFiles=true');
    expect(body).toContain(`hashes=${'a'.repeat(40)}`);
  });

  it('throws 502 when qBittorrent answers the delete with an error status', async () => {
    const fetchImpl = makeFetch([
      { match: (url) => url.endsWith('/api/v2/auth/login'), respond: () => createResponseWithCookies(200, 'Ok.', ['SID=x']) },
      {
        match: (url) => url.includes('/api/v2/torrents/delete'),
        respond: () => createResponse(400, 'Missing required parameters: hashes, deleteFiles'),
      },
    ]);
    const client = createQbittorrentClient({ ...CONFIG, fetchImpl });
    await expect(client.deleteTorrent('a'.repeat(40), true)).rejects.toMatchObject({
      status: 502,
      message: 'qBittorrent delete failed (HTTP 400)',
    });
  });
});

describe('QBittorrentClient pause/resume', () => {
  it('calls stop and start endpoints with the hash in the POST form body', async () => {
    const calls: string[] = [];
    const fetchImpl = makeFetch([
      { match: (url) => url.endsWith('/api/v2/auth/login'), respond: () => createResponseWithCookies(200, 'Ok.', ['SID=x']) },
      {
        match: (url) => url.includes('/api/v2/torrents/stop') || url.includes('/api/v2/torrents/start'),
        respond: (url, init) => {
          calls.push(`${url}|${init?.body as string}`);
          return createResponse(200, 'Ok.');
        },
      },
    ]);
    const client = createQbittorrentClient({ ...CONFIG, fetchImpl });
    await client.pauseTorrent('a'.repeat(40));
    await client.resumeTorrent('a'.repeat(40));
    expect(calls.some((c) => c.includes('/torrents/stop') && c.includes(`hashes=${'a'.repeat(40)}`))).toBe(true);
    expect(calls.some((c) => c.includes('/torrents/start') && c.includes(`hashes=${'a'.repeat(40)}`))).toBe(true);
  });
});
