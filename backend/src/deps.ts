import type pg from 'pg';
import type { AppConfig } from './config.js';
import type { DownloadsRepository } from './db/downloadsRepo.js';
import type { SettingsRepository } from './db/settingsRepo.js';
import type { ArtFilesRepository } from './db/artFilesRepo.js';
import type { ArtCache } from './lib/artCache.js';
import type { OmdbClient } from './services/omdb.js';
import type { ProwlarrAdminClient } from './services/prowlarrAdmin.js';
import type { ProwlarrClient } from './services/prowlarr.js';
import type { QBittorrentClient } from './services/qbittorrent.js';
import type { TmdbClient } from './services/tmdb.js';

export interface AppDeps {
  config: AppConfig;
  pool: pg.Pool;
  tmdb: TmdbClient;
  prowlarr: ProwlarrClient;
  qbittorrent: QBittorrentClient;
  downloads: DownloadsRepository;
  settings: SettingsRepository;
  /** OMDb portrait client (D21); null when no `OMDB_API_KEY` is configured. */
  omdb?: OmdbClient | null;
  /** Downloaded portrait-poster files (D21); wired in prod, optional so tests stay lean. */
  artFiles?: ArtFilesRepository | null;
  /** Download-once poster pipeline (D21); wired in prod, optional for tests. */
  artCache?: ArtCache | null;
  /** Admin/indexer introspection. Optional so tests (and headless setups) skip Prowlarr admin calls. */
  prowlarrAdmin?: ProwlarrAdminClient | null;
}
