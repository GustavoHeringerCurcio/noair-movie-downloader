import type { TorrentState } from '../types.js';
import { UpstreamError } from '../types.js';

export interface QBittorrentTorrentInfo {
  hash: string;
  name: string;
  state: string;
  progress: number;
  dlspeed: number;
  upspeed: number;
  eta: number;
  ratio: number;
  size: number;
  content_path: string | null;
}

export interface QBittorrentClient {
  addTorrent(magnetUri: string): Promise<void>;
  listTorrents(): Promise<QBittorrentTorrentInfo[]>;
  deleteTorrent(infoHash: string, deleteFiles: boolean): Promise<void>;
  pauseTorrent(infoHash: string): Promise<void>;
  resumeTorrent(infoHash: string): Promise<void>;
}

export interface QBittorrentClientConfig {
  baseUrl: string;
  username: string;
  password: string;
  savePath: string;
  category: string;
  fetchImpl?: typeof fetch;
}

const STATE_MAP: Record<string, TorrentState> = {
  queuedDL: 'queued',
  queuedUP: 'queued',
  metaDL: 'fetching-metadata',
  forcedMetaDL: 'fetching-metadata',
  downloading: 'downloading',
  forcedDL: 'downloading',
  stalledDL: 'stalled',
  stalledUP: 'stalled',
  pausedDL: 'paused',
  pausedUP: 'paused',
  checkingDL: 'checking',
  checkingUP: 'checking',
  checkingResumeData: 'checking',
  uploading: 'seeding',
  error: 'error',
  missingFiles: 'error',
};

export function toCanonicalState(qbitState: string): TorrentState {
  return STATE_MAP[qbitState] ?? 'unknown';
}

function extractCookies(headers: Headers): string {
  const setCookies: string[] = [];
  if (typeof headers.getSetCookie === 'function') {
    setCookies.push(...headers.getSetCookie());
  }
  if (setCookies.length === 0) {
    const single = headers.get('set-cookie');
    if (single) setCookies.push(single);
  }
  return setCookies
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

interface QBittorrentInfoDto {
  hash?: string;
  name?: string;
  state?: string;
  progress?: number;
  dlspeed?: number;
  upspeed?: number;
  eta?: number;
  ratio?: number;
  size?: number;
  content_path?: string | null;
}

export function createQbittorrentClient(config: QBittorrentClientConfig): QBittorrentClient {
  const fetchImpl = config.fetchImpl ?? fetch;
  const base = config.baseUrl.replace(/\/+$/, '');
  let cookie = '';

  async function login(): Promise<void> {
    const form = new URLSearchParams();
    form.set('username', config.username);
    form.set('password', config.password);
    const res = await fetchImpl(`${base}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: base },
      body: form,
    });
    const isOk = res.status === 204 || (res.status === 200 && (await res.text()).trim() === 'Ok.');
    if (!isOk) {
      throw new UpstreamError(502, 'qBittorrent login failed');
    }
    cookie = extractCookies(res.headers);
  }

  async function request(path: string, init: RequestInit): Promise<Response> {
    const doFetch = (): Promise<Response> => {
      const headers: Record<string, string> = { Referer: base };
      if (init.headers) {
        const source = init.headers as Record<string, string>;
        for (const key of Object.keys(source)) headers[key] = source[key]!;
      }
      if (cookie) headers.Cookie = cookie;
      return fetchImpl(base + path, { ...init, headers });
    };

    let res = await doFetch();
    if (res.status === 403) {
      await login();
      res = await doFetch();
    }
    return res;
  }

  async function addTorrent(magnetUri: string): Promise<void> {
    const form = new FormData();
    form.set('urls', magnetUri);
    form.set('category', config.category);
    form.set('savepath', config.savePath);
    form.set('sequentialDownload', 'true');
    form.set('firstLastPiecePriority', 'true');
    const res = await request('/api/v2/torrents/add', { method: 'POST', body: form });
    if (res.status === 409) throw new UpstreamError(409, 'qBittorrent: torrent already exists');
    const text = (await res.text()).trim();
    if (text === 'Ok.') return;

    const isDuplicate = (reason: string): boolean =>
      /already|duplicate|conflict/i.test(reason);

    try {
      const parsed = JSON.parse(text) as {
        success_count?: number;
        failure_count?: number;
        error?: string;
      };
      if (typeof parsed.success_count === 'number' && parsed.success_count >= 1) return;
      if (typeof parsed.failure_count === 'number' && parsed.failure_count >= 1) {
        const reason = parsed.error ?? text;
        if (isDuplicate(reason)) throw new UpstreamError(409, `qBittorrent: ${reason}`);
        throw new UpstreamError(502, `qBittorrent add failed: ${reason}`);
      }
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
    }

    if (isDuplicate(text)) throw new UpstreamError(409, `qBittorrent: ${text || 'duplicate torrent'}`);
    throw new UpstreamError(502, `qBittorrent add failed: ${text || `HTTP ${res.status}`}`);
  }

  async function listTorrents(): Promise<QBittorrentTorrentInfo[]> {
    const res = await request(
      `/api/v2/torrents/info?category=${encodeURIComponent(config.category)}`,
      { method: 'GET' },
    );
    if (!res.ok) throw new UpstreamError(502, `qBittorrent list failed (HTTP ${res.status})`);
    const data = (await res.json()) as QBittorrentInfoDto[];
    return data.map((t) => ({
      hash: (t.hash ?? '').toLowerCase(),
      name: t.name ?? '',
      state: t.state ?? 'unknown',
      progress: t.progress ?? 0,
      dlspeed: t.dlspeed ?? 0,
      upspeed: t.upspeed ?? 0,
      eta: t.eta ?? -1,
      ratio: t.ratio ?? 0,
      size: t.size ?? 0,
      content_path: t.content_path || null,
    }));
  }

  async function deleteTorrent(infoHash: string, deleteFiles: boolean): Promise<void> {
    const params = new URLSearchParams({
      hashes: infoHash.toLowerCase(),
      deleteFiles: deleteFiles ? 'true' : 'false',
    });
    const res = await request(`/api/v2/torrents/delete?${params.toString()}`, { method: 'POST' });
    if (!res.ok) throw new UpstreamError(502, `qBittorrent delete failed (HTTP ${res.status})`);
  }

  async function pauseTorrent(infoHash: string): Promise<void> {
    const params = new URLSearchParams({ hashes: infoHash.toLowerCase() });
    const res = await request(`/api/v2/torrents/stop?${params.toString()}`, { method: 'POST' });
    if (!res.ok) throw new UpstreamError(502, `qBittorrent pause failed (HTTP ${res.status})`);
  }

  async function resumeTorrent(infoHash: string): Promise<void> {
    const params = new URLSearchParams({ hashes: infoHash.toLowerCase() });
    const res = await request(`/api/v2/torrents/start?${params.toString()}`, { method: 'POST' });
    if (!res.ok) throw new UpstreamError(502, `qBittorrent resume failed (HTTP ${res.status})`);
  }

  return { addTorrent, listTorrents, deleteTorrent, pauseTorrent, resumeTorrent };
}
