import type { Server } from 'socket.io';
import type { AppDeps } from '../deps.js';
import type { DownloadUpdate } from '../db/downloadsRepo.js';
import { toCanonicalState } from '../services/qbittorrent.js';
import { existsOnDisk, resolveInside, resolveStreamForServing } from '../lib/streaming.js';

export async function pollOnce(deps: AppDeps): Promise<void> {
  const torrents = await deps.qbittorrent.listTorrents();
  for (const torrent of torrents) {
    const infoHash = torrent.hash;
    if (!infoHash) continue;
    const record = await deps.downloads.findByInfoHash(infoHash);
    if (!record) continue;

    const storedStreamPath = record.streamFilePath;
    const storedIsValid = storedStreamPath != null && existsOnDisk(resolveInside(deps.config.downloadDir, storedStreamPath));
    const contentPath = torrent.content_path;

    const update: DownloadUpdate = {
      torrentName: torrent.name,
      sizeBytes: torrent.size,
      state: toCanonicalState(torrent.state),
      progress: torrent.progress,
      downloadSpeed: torrent.dlspeed,
      uploadSpeed: torrent.upspeed,
      etaSeconds: torrent.eta === -1 ? null : torrent.eta,
      ratio: torrent.ratio ?? 0,
      contentPath,
    };

    if (contentPath && !storedIsValid) {
      const resolved = resolveStreamForServing(deps.config.downloadDir, contentPath, storedStreamPath);
      update.streamFilePath = resolved ? resolved.relative : null;
    }

    if (torrent.progress >= 1 && !record.completedAt) {
      update.completedAt = new Date();
    }

    await deps.downloads.update(infoHash, update);
  }
}

export function attachSocket(io: Server, deps: AppDeps): void {
  io.on('connection', async (socket) => {
    try {
      const downloads = await deps.downloads.list();
      socket.emit('downloads:initial', { downloads });
    } catch (error) {
      console.error('failed to send downloads:initial', error);
    }
  });
}

export function startPollLoop(deps: AppDeps, io: Server, intervalMs: number): NodeJS.Timeout {
  async function run(): Promise<void> {
    try {
      await pollOnce(deps);
    } catch (error) {
      console.error('qBittorrent poll failed', error);
    }
    try {
      const downloads = await deps.downloads.list();
      io.emit('downloads:update', { downloads });
    } catch (error) {
      console.error('failed to emit downloads:update', error);
    }
  }
  void run();
  return setInterval(run, intervalMs);
}
