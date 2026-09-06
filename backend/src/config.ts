import dotenv from 'dotenv';
import fs from 'node:fs';

for (const path of ['.env', '../.env', '../../.env']) {
  if (fs.existsSync(path)) {
    dotenv.config({ path });
    break;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required environment variable ${name}. See .env.example / docs/credentials.md.`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

export interface AppConfig {
  port: number;
  tmdbApiKey: string;
  tmdbBaseUrl: string;
  tmdbImageBaseUrl: string;
  fanartApiKey: string | null;
  prowlarrUrl: string;
  prowlarrApiKey: string;
  prowlarrBootstrapIndexers: boolean;
  prowlarrBootstrapIndexerNames: string[];
  qbittorrentUrl: string;
  qbittorrentUser: string;
  qbittorrentPass: string;
  databaseUrl: string;
  downloadDir: string;
  /** Root for the HLS package cache produced for completed files (Playback). */
  packageDir: string;
  /** Root where the artwork pipeline stores downloaded images (poster-first tiles). */
  artDir: string;
  pollIntervalMs: number;
  fanartMinGapMs: number;
  artWarmIntervalMs: number;
}

export function loadConfig(): AppConfig {
  return {
    port: parseInt(optionalEnv('PORT', '3000'), 10),
    tmdbApiKey: requireEnv('TMDB_API_KEY'),
    tmdbBaseUrl: 'https://api.themoviedb.org/3',
    tmdbImageBaseUrl: 'https://image.tmdb.org/t/p',
    fanartApiKey: optionalEnv('FANART_API_KEY', '') || null,
    prowlarrUrl: requireEnv('PROWLARR_URL'),
    prowlarrApiKey: requireEnv('PROWLARR_API_KEY'),
    prowlarrBootstrapIndexers: optionalEnv('PROWLARR_BOOTSTRAP_INDEXERS', '1') === '1',
    prowlarrBootstrapIndexerNames: optionalEnv('PROWLARR_BOOTSTRAP_INDEXERS_LIST', 'YTS,LimeTorrents,TorrentDownload,1337x')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
    qbittorrentUrl: requireEnv('QBITTORRENT_URL'),
    qbittorrentUser: requireEnv('QBITTORRENT_USER'),
    qbittorrentPass: requireEnv('QBITTORRENT_PASS'),
    databaseUrl: requireEnv('DATABASE_URL'),
    downloadDir: optionalEnv('DOWNLOAD_DIR', '/downloads'),
    packageDir: optionalEnv('PACKAGE_DIR', '/packages'),
    artDir: optionalEnv('ART_DIR', '/art'),
    pollIntervalMs: 2000,
    fanartMinGapMs: parseInt(optionalEnv('FANART_MIN_GAP_MS', '800'), 10),
    artWarmIntervalMs: parseInt(optionalEnv('ART_WARM_INTERVAL_MS', String(12 * 60 * 60 * 1000)), 10),
  };
}

export const config = loadConfig();
