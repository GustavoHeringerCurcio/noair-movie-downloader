import http from 'node:http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { createPool } from './db/pool.js';
import { runSchema } from './db/migrate.js';
import { createDownloadsRepository } from './db/downloadsRepo.js';
import { createTmdbClient } from './services/tmdb.js';
import { createProwlarrClient } from './services/prowlarr.js';
import { createProwlarrAdminClient, type ProwlarrAdminClient } from './services/prowlarrAdmin.js';
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

  if (config.prowlarrBootstrapIndexers) {
    const admin = createProwlarrAdminClient({ baseUrl: config.prowlarrUrl, apiKey: config.prowlarrApiKey });
    void bootstrapIndexers(admin, config.prowlarrBootstrapIndexerNames).catch((error) => {
      console.error('indexer bootstrap gave up', error);
    });
  }

  const app = createApp(deps);
  const server = http.createServer(app);
  const io = new Server(server);

  attachSocket(io, deps);
  startPollLoop(deps, io, config.pollIntervalMs);

  server.listen(config.port, () => {
    console.log(`backend listening on :${config.port}`);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Prowlarr can lag the backend at container start, so retry provisioning for a
// while before giving up. Once Prowlarr responds, definitive per-indexer
// failures (e.g. 1337x blocked by Cloudflare) are reported once and never
// retried. Failures are non-fatal (NFR3) and never block boot.
async function bootstrapIndexers(admin: ProwlarrAdminClient, names: readonly string[]): Promise<void> {
  const MAX_ATTEMPTS = 12;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await admin.ensureIndexers(names);
      const created = result.created.join(', ') || '-';
      const enabled = result.enabled.join(', ') || '-';
      const skipped = result.skipped.join(', ') || '-';
      console.log(`[prowlarr] indexer bootstrap (attempt ${attempt}): created=[${created}] enabled=[${enabled}] skipped=[${skipped}]`);
      if (result.failed.length > 0) {
        console.warn(
          `[prowlarr] indexer bootstrap warnings: ${result.failed.map((f) => `${f.name}: ${f.reason}`).join(' | ')}`,
        );
      }
      return;
    } catch (error) {
      console.warn(`[prowlarr] indexer bootstrap attempt ${attempt} failed (Prowlarr unreachable?): ${error instanceof Error ? error.message : error}`);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(10_000);
  }
}

main().catch((error) => {
  console.error('backend failed to boot', error);
  process.exit(1);
});
