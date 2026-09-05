import type pg from 'pg';
import type { AppConfig } from './config.js';
import type { DownloadsRepository } from './db/downloadsRepo.js';
import type { FanartClient } from './services/fanart.js';
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
  fanart?: FanartClient | null;
}
