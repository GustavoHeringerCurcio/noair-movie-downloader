import { describe, expect, it, vi } from 'vitest';
import { pollOnce } from './hub.js';
import { makeDownloadRecord, makeTestDeps } from '../../test/helpers.js';
import type { DownloadRecord } from '../types.js';

const REAL_HASH = 'ab'.repeat(20);
const PLACEHOLDER = 'url-' + 'c'.repeat(40);

function torrent(hash: string, name: string) {
  return {
    hash,
    name,
    state: 'downloading',
    progress: 0.5,
    dlspeed: 100,
    upspeed: 10,
    eta: -1,
    ratio: 0,
    size: 1000,
    content_path: '/downloads/inc',
  };
}

function recordWith(hash: string, name: string): DownloadRecord {
  return makeDownloadRecord({ infoHash: hash, torrentName: name });
}

describe('pollOnce', () => {
  it('adopts the real qBittorrent hash for a placeholder-keyed row matched by name', async () => {
    const adopt = vi.fn();
    const update = vi.fn();
    const deps = makeTestDeps({
      qbittorrent: {
        addTorrent: async () => {},
        listTorrents: async () => [torrent(REAL_HASH, 'Inception 2010')],
        deleteTorrent: async () => {},
        pauseTorrent: async () => {},
        resumeTorrent: async () => {},
      },
      downloads: {
        ...makeTestDeps().downloads,
        findByInfoHash: async () => null,
        findByTorrentName: async () => recordWith(PLACEHOLDER, 'Inception 2010'),
        adoptInfoHash: adopt,
        update,
      },
    });
    await pollOnce(deps);
    expect(adopt).toHaveBeenCalledWith(PLACEHOLDER, REAL_HASH);
    expect(update).toHaveBeenCalled();
  });

  it('does not adopt for a row with a real (non-placeholder) hash', async () => {
    const adopt = vi.fn();
    const deps = makeTestDeps({
      qbittorrent: {
        addTorrent: async () => {},
        listTorrents: async () => [torrent(REAL_HASH, 'Inception 2010')],
        deleteTorrent: async () => {},
        pauseTorrent: async () => {},
        resumeTorrent: async () => {},
      },
      downloads: {
        ...makeTestDeps().downloads,
        findByInfoHash: async () => null,
        findByTorrentName: async () => recordWith('aa'.repeat(20), 'Inception 2010'),
        adoptInfoHash: adopt,
        update: async () => {},
      },
    });
    await pollOnce(deps);
    expect(adopt).not.toHaveBeenCalled();
  });
});
