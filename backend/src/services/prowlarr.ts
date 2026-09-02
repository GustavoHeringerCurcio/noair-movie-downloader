import { createHash } from 'node:crypto';
import type { Source } from '../types.js';
import { UpstreamError } from '../types.js';
import { buildMagnet, infoHashFromMagnet } from '../lib/magnet.js';

export interface ProwlarrClient {
  search(query: string, category: 2000 | 5000): Promise<Source[]>;
}

export interface ProwlarrClientConfig {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

interface ProwlarrResult {
  Title?: string | null;
  title?: string | null;
  Size?: number;
  size?: number;
  Seeders?: number;
  seeders?: number;
  Leechers?: number;
  leechers?: number;
  InfoHash?: string | null;
  infoHash?: string | null;
  IndexerId?: number;
  indexerId?: number;
  Indexer?: unknown;
  indexer?: unknown;
  MagnetUrl?: string | null;
  magnetUrl?: string | null;
  DownloadUrl?: string | null;
  downloadUrl?: string | null;
}

function indexerName(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'name' in value && typeof value.name === 'string') return value.name;
  return '';
}

export function placeholderInfoHash(downloadUrl: string): string {
  return 'url-' + createHash('sha256').update(downloadUrl).digest('hex').slice(0, 40);
}

export function isPlaceholderInfoHash(value: string): boolean {
  return value.startsWith('url-');
}

function normalizeDownloadUrl(url: string, baseUrl: string): string {
  return url.replace(/^https?:\/\/[^/]+/, baseUrl.replace(/\/+$/, ''));
}

export function createProwlarrClient(config: ProwlarrClientConfig): ProwlarrClient {
  const fetchImpl = config.fetchImpl ?? fetch;

  async function search(query: string, category: 2000 | 5000): Promise<Source[]> {
    const url = `${config.baseUrl}/api/v1/search?query=${encodeURIComponent(query)}&categories=${category}&type=search`;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: { 'X-Api-Key': config.apiKey },
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new UpstreamError(502, 'Prowlarr unreachable');
    }
    if (res.status === 401) {
      throw new UpstreamError(401, 'Prowlarr API key invalid');
    }
    if (!res.ok) throw new UpstreamError(502, `Prowlarr search failed (HTTP ${res.status})`);

    const data = (await res.json()) as ProwlarrResult[] | { results?: ProwlarrResult[] };
    const results = Array.isArray(data) ? data : (data.results ?? []);

    const sources: Source[] = [];
    for (const r of results) {
      const rawInfoHash =
        typeof r.infoHash === 'string'
          ? r.infoHash.trim()
          : typeof r.InfoHash === 'string'
            ? r.InfoHash.trim()
            : '';
      const magnet =
        typeof r.magnetUrl === 'string'
          ? r.magnetUrl.trim()
          : typeof r.MagnetUrl === 'string'
            ? r.MagnetUrl.trim()
            : '';
      const downloadUrl =
        typeof r.downloadUrl === 'string'
          ? r.downloadUrl.trim()
          : typeof r.DownloadUrl === 'string'
            ? r.DownloadUrl.trim()
            : '';

      const title = r.title ?? r.Title ?? '';

      let finalInfoHash = rawInfoHash.toLowerCase();
      let magnetUri: string;
      if (finalInfoHash) {
        magnetUri = magnet.startsWith('magnet:') ? magnet : buildMagnet(finalInfoHash, title);
      } else if (magnet.startsWith('magnet:')) {
        finalInfoHash = infoHashFromMagnet(magnet) ?? '';
        if (!finalInfoHash) continue;
        magnetUri = magnet;
      } else if (downloadUrl) {
        finalInfoHash = placeholderInfoHash(downloadUrl);
        magnetUri = normalizeDownloadUrl(downloadUrl, config.baseUrl);
      } else {
        continue;
      }

      sources.push({
        indexerId: r.indexerId ?? r.IndexerId ?? 0,
        indexer: indexerName(r.indexer ?? r.Indexer),
        title,
        sizeBytes: r.size ?? r.Size ?? 0,
        seeders: r.seeders ?? r.Seeders ?? 0,
        leechers: r.leechers ?? r.Leechers ?? 0,
        infoHash: finalInfoHash,
        magnetUri,
      });
    }

    sources.sort((a, b) => b.seeders - a.seeders);
    const seen = new Set<string>();
    return sources.filter((s) => {
      if (seen.has(s.infoHash)) return false;
      seen.add(s.infoHash);
      return true;
    });
  }

  return { search };
}
