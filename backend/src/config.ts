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
  omdbApiKey: string | null;
  /** Optional fanart.tv key (16:9 key-art thumbs for the horizontal poster cards, T-002). */
  fanartApiKey: string | null;
  fanartBaseUrl: string;
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
  /** Soft size cap for the package cache; oldest completed packages are evicted beyond it (D26). */
  packageMaxBytes: number | null;
  /** Root where the poster pipeline stores downloaded portrait posters (OMDb). */
  artDir: string;
  /** Remote access (beta): whether the cloudflared tunnel is enabled (D28). */
  remoteAccessEnabled: boolean;
  /** Shared volume dir where the cloudflared entrypoint writes the live public URL. */
  remoteDataDir: string;
  /** Optional stable hostname for a named Cloudflare tunnel (D28). */
  cloudflareTunnelHostname: string | null;
  pollIntervalMs: number;
  artWarmIntervalMs: number;
}

export function loadConfig(): AppConfig {
  return {
    port: parseInt(optionalEnv('PORT', '3000'), 10),
    tmdbApiKey: requireEnv('TMDB_API_KEY'),
    tmdbBaseUrl: 'https://api.themoviedb.org/3',
    tmdbImageBaseUrl: 'https://image.tmdb.org/t/p',
    omdbApiKey: optionalEnv('OMDB_API_KEY', '') || null,
    fanartApiKey: optionalEnv('FANART_API_KEY', '') || null,
    fanartBaseUrl: 'https://webservice.fanart.tv/v3',
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
    packageMaxBytes: parseInt(optionalEnv('PACKAGE_MAX_BYTES', ''), 10) || null,
    artDir: optionalEnv('ART_DIR', '/art'),
    remoteAccessEnabled: optionalEnv('REMOTE_ACCESS', '0') === '1',
    remoteDataDir: optionalEnv('REMOTE_DATA_DIR', '/remote'),
    cloudflareTunnelHostname: optionalEnv('CLOUDFLARE_TUNNEL_HOSTNAME', '') || null,
    pollIntervalMs: 2000,
    artWarmIntervalMs: parseInt(optionalEnv('ART_WARM_INTERVAL_MS', String(12 * 60 * 60 * 1000)), 10),
  };
}

export const config = loadConfig();
