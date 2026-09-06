/**
 * OMDb webservice client (portrait posters only).
 *
 * OMDb returns a single portrait `Poster` URL per IMDb id — the input to the
 * in-app wide-card composite (D21). The free tier is capped at 1,000 requests
 * per day, so the client enforces a conservative in-memory daily budget and
 * never lets the warm loop wedge the key.
 *
 * Results are status-aware and never throw:
 * - `ok`    → usable poster URL
 * - `empty` → the title has no poster (or no IMDb record) — storable
 * - `error` → transient failure OR the daily budget is exhausted — NOT storable
 */

export type OmdbStatus = 'ok' | 'empty' | 'error';

export interface OmdbPosterResult {
  status: OmdbStatus;
  posterUrl: string | null;
}

export interface OmdbClient {
  /** Resolve the Amazon-hosted portrait poster URL for an IMDb id (`tt1234567`). */
  fetchPoster(imdbId: string): Promise<OmdbPosterResult>;
}

export interface OmdbClientConfig {
  apiKey: string;
  baseUrl?: string;
  /** Conservative slice of the 1,000/day free tier. Default 850. */
  dailyLimit?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const REQUEST_TIMEOUT_MS = 8000;

function dayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function createOmdbClient(config: OmdbClientConfig): OmdbClient {
  const fetchImpl = config.fetchImpl ?? fetch;
  const base = (config.baseUrl ?? 'https://www.omdbapi.com').replace(/\/+$/, '');
  const dailyLimit = config.dailyLimit ?? 850;
  const nowMs = config.now ?? Date.now;

  let budgetDay = dayKey(nowMs());
  let budgetUsed = 0;

  function consumeBudget(): boolean {
    const today = dayKey(nowMs());
    if (today !== budgetDay) {
      budgetDay = today;
      budgetUsed = 0;
    }
    if (budgetUsed >= dailyLimit) return false;
    budgetUsed += 1;
    return true;
  }

  async function fetchPoster(imdbId: string): Promise<OmdbPosterResult> {
    if (!/^tt\d+$/.test(imdbId)) {
      return { status: 'empty', posterUrl: null };
    }
    if (!consumeBudget()) {
      console.warn('[omdb] daily poster budget exhausted — skipping');
      return { status: 'error', posterUrl: null };
    }
    const url = `${base}/?apikey=${encodeURIComponent(config.apiKey)}&i=${encodeURIComponent(imdbId)}&plot=short&r=json`;
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) {
        // 429/5xx — transient, must not be cached as "no poster".
        return { status: 'error', posterUrl: null };
      }
      const data = (await res.json()) as { Response?: string; Poster?: string; Error?: string };
      if (data.Response === 'False') {
        return { status: 'empty', posterUrl: null };
      }
      const poster = data.Poster ?? '';
      if (!poster || poster === 'N/A') {
        return { status: 'empty', posterUrl: null };
      }
      try {
        const parsed = new URL(poster);
        if (parsed.protocol !== 'https:') return { status: 'empty', posterUrl: null };
      } catch {
        return { status: 'empty', posterUrl: null };
      }
      return { status: 'ok', posterUrl: poster };
    } catch {
      return { status: 'error', posterUrl: null };
    }
  }

  return { fetchPoster };
}
