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
  Size?: number;
  Seeders?: number;
  Leechers?: number;
  InfoHash?: string | null;
  IndexerId?: number;
  Indexer?: unknown;
  MagnetUrl?: string | null;
}

function indexerName(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'name' in value && typeof value.name === 'string') return value.name;
  return '';
}

export function createProwlarrClient(config: ProwlarrClientConfig): ProwlarrClient {
  const fetchImpl = config.fetchImpl ?? fetch;

  async function search(query: string, category: 2000 | 5000): Promise<Source[]> {
    const url = `${config.baseUrl}/api/v1/search?query=${encodeURIComponent(query)}&categories=${category}&type=search`;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: { 'X-Api-Key': config.apiKey },
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new UpstreamError(502, 'Prowlarr unreachable');
    }
    if (!res.ok) throw new UpstreamError(502, `Prowlarr search failed (HTTP ${res.status})`);

    const data = (await res.json()) as ProwlarrResult[] | { results?: ProwlarrResult[] };
    const results = Array.isArray(data) ? data : (data.results ?? []);

    const sources: Source[] = [];
    for (const r of results) {
      const infoHash = typeof r.InfoHash === 'string' ? r.InfoHash.trim().toLowerCase() : '';
      const magnet = typeof r.MagnetUrl === 'string' ? r.MagnetUrl.trim() : '';
      if (!infoHash && !magnet) continue;

      let finalInfoHash = infoHash;
      if (!finalInfoHash) {
        finalInfoHash = infoHashFromMagnet(magnet) ?? '';
      }
      if (!finalInfoHash) continue;

      const title = r.Title ?? '';
      sources.push({
        indexerId: r.IndexerId ?? 0,
        indexer: indexerName(r.Indexer),
        title,
        sizeBytes: r.Size ?? 0,
        seeders: r.Seeders ?? 0,
        leechers: r.Leechers ?? 0,
        infoHash: finalInfoHash,
        magnetUri: magnet || buildMagnet(finalInfoHash, title),
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
