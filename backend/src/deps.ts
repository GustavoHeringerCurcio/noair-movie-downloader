import type pg from 'pg';
import type { AppConfig } from './config.js';
import type { DownloadsRepository } from './db/downloadsRepo.js';
import type { SettingsRepository } from './db/settingsRepo.js';
import type { ArtFilesRepository } from './db/artFilesRepo.js';
import type { ArtCache } from './lib/artCache.js';
import type { PackageManager } from './lib/packages.js';
import type { OmdbClient } from './services/omdb.js';
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
  /** OMDb portrait client (D21); null when no `OMDB_API_KEY` is configured. */
  omdb?: OmdbClient | null;
  /** fanart.tv 16:9 key-art client (T-002); null when no `FANART_API_KEY` is configured. */
  fanart?: FanartClient | null;
  /** Downloaded portrait-poster files (D21); wired in prod, optional so tests stay lean. */
  artFiles?: ArtFilesRepository | null;
  /** Download-once poster pipeline (D21); wired in prod, optional for tests. */
  artCache?: ArtCache | null;
  /** Download-once fanart key-art pipeline (kind `thumb`, T-002); wired in prod, optional for tests. */
  fanartCache?: ArtCache | null;
  /** Download-once TMDB transparent-logo pipeline (kind `logo`, T-002); wired in prod, optional for tests. */
  logoCache?: ArtCache | null;
  /** Admin/indexer introspection. Optional so tests (and headless setups) skip Prowlarr admin calls. */
  prowlarrAdmin?: ProwlarrAdminClient | null;
  /**
   * Shared HLS package manager (one instance for routes + the completion poller).
   * Optional for tests/embedders — the playback router falls back to its own.
   */
  packageManager?: PackageManager | null;
}
