import type pg from 'pg';
import type { AppConfig } from './config.js';
import type { DownloadsRepository } from './db/downloadsRepo.js';
import type { SettingsRepository } from './db/settingsRepo.js';
import type { ArtFilesRepository } from './db/artFilesRepo.js';
import type { ArtService } from './lib/artService.js';
import type { ArtCache } from './lib/artCache.js';
import type { FanartClient } from './services/fanart.js';
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
  art: ArtService;
  fanart?: FanartClient | null;
  /** Downloaded-artwork files (D17); wired in prod, optional so tests stay lean. */
  artFiles?: ArtFilesRepository | null;
  /** Download-once artwork pipeline (D17); wired in prod, optional for tests. */
  artCache?: ArtCache | null;
  /** Admin/indexer introspection. Optional so tests (and headless setups) skip Prowlarr admin calls. */
  prowlarrAdmin?: ProwlarrAdminClient | null;
}
