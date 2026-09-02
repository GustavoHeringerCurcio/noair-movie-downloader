import http from 'node:http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { createPool } from './db/pool.js';
import { runSchema } from './db/migrate.js';
import { createDownloadsRepository } from './db/downloadsRepo.js';
import { createTmdbClient } from './services/tmdb.js';
import { createProwlarrClient } from './services/prowlarr.js';
import { createQbittorrentClient } from './services/qbittorrent.js';
import { createApp } from './app.js';
import { attachSocket, startPollLoop } from './socket/hub.js';
import type { AppDeps } from './deps.js';

async function main(): Promise<void> {
  const pool = createPool(config.databaseUrl);
  await runSchema(pool);
  console.log('schema ready');

  const deps: AppDeps = {
    config,
    pool,
    tmdb: createTmdbClient({ baseUrl: config.tmdbBaseUrl, apiKey: config.tmdbApiKey }),
    prowlarr: createProwlarrClient({ baseUrl: config.prowlarrUrl, apiKey: config.prowlarrApiKey }),
    qbittorrent: createQbittorrentClient({
      baseUrl: config.qbittorrentUrl,
      username: config.qbittorrentUser,
      password: config.qbittorrentPass,
      savePath: config.downloadDir,
      category: 'stream',
    }),
    downloads: createDownloadsRepository(pool),
  };

  const app = createApp(deps);
  const server = http.createServer(app);
  const io = new Server(server);

  attachSocket(io, deps);
  startPollLoop(deps, io, config.pollIntervalMs);

  server.listen(config.port, () => {
    console.log(`backend listening on :${config.port}`);
  });
}

main().catch((error) => {
  console.error('backend failed to boot', error);
  process.exit(1);
});
