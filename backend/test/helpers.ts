import type pg from 'pg';
import { loadConfig, type AppConfig } from '../src/config.js';
import type { AppDeps } from '../src/deps.js';
import { createArtService, type ArtService } from '../src/lib/artService.js';
import { createFanartGateway } from '../src/lib/fanartGateway.js';
import type { ArtRepository, MediaArtRow } from '../src/db/artRepo.js';
import type { ArtSubject, CreateDownloadInput, DownloadRecord, TorrentState } from '../src/types.js';

export function createMemoryArtRepo(seed: MediaArtRow[] = []): ArtRepository {
  const rows = new Map<string, MediaArtRow>();
  for (const row of seed) rows.set(`${row.mediaType}:${row.tmdbId}`, row);
  return {
    async getMany(keys: ArtSubject[]) {
      return keys
        .map((key) => rows.get(`${key.mediaType}:${key.tmdbId}`))
        .filter((row): row is MediaArtRow => row != null);
    },
    async upsertMany(newRows: MediaArtRow[]) {
      for (const row of newRows) {
        rows.set(`${row.mediaType}:${row.tmdbId}`, { ...row, fetchedAt: row.fetchedAt ?? new Date().toISOString() });
      }
    },
  };
}

/** An art service that resolves nothing — useful when art behavior is out of scope. */
export function makeEmptyArtService(): ArtService {
  return {
    resolveManyCached: async () => new Map(),
    enqueueMissing: () => {},
    resolveOne: async () => null,
    refresh: () => {},
    refreshExpired: async () => 0,
    refreshThumbless: async () => 0,
    drain: async () => {},
    clear: () => {},
  };
}


export function createResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => headers[name] ?? null,
      getSetCookie: () => [],
    },
    async text(): Promise<string> {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
    async json(): Promise<unknown> {
      return typeof body === 'string' ? JSON.parse(body) : body;
    },
  } as unknown as Response;
}

export function createResponseWithCookies(status: number, body: string, setCookies: string[]) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => (name === 'set-cookie' ? setCookies.join(', ') : null),
      getSetCookie: () => setCookies,
    },
    async text(): Promise<string> {
      return body;
    },
    async json(): Promise<unknown> {
      return JSON.parse(body);
    },
  } as unknown as Response;
}

export interface FetchHandler {
  match: (url: string) => boolean;
  respond: (url: string, init?: RequestInit) => Response;
}

export function makeFetch(handlers: FetchHandler[]): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    for (const handler of handlers) {
      if (handler.match(url)) return handler.respond(url, init);
    }
    throw new Error(`unhandled fetch: ${url}`);
  };
  return fn as typeof fetch;
}

export function makeDownloadRecord(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    id: 1,
    tmdbId: 1,
    mediaType: 'movie',
    title: 'Inception',
    year: 2010,
    posterPath: '/abc.jpg',
    backdropPath: null,
    seasonNumber: null,
    episodeNumber: null,
    infoHash: 'a'.repeat(40),
    torrentName: 'Inception.2010.1080p',
    indexer: '1337x',
    sizeBytes: 1000,
    state: 'downloading',
    progress: 0.5,
    downloadSpeed: 100,
    uploadSpeed: 10,
    etaSeconds: 60,
    ratio: 0.1,
    contentPath: '/downloads/inception',
    streamFilePath: 'inception/Inception.mkv',
    streamable: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    completedAt: null,
    resolution: null,
    source: null,
    codec: null,
    hdr: false,
    isDolbyVision: false,
    ...overrides,
  };
}

export function makeTestDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  const config: AppConfig = loadConfig();
  const base: Partial<AppDeps> = {
    config,
    pool: undefined as unknown as pg.Pool,
    tmdb: {
      searchMulti: async () => [],
      details: async () => {
        throw new Error('not stubbed');
      },
      browse: async () => [],
      seasonEpisodes: async () => [],
      tvdbId: async () => null,
      videos: async () => [],
    },
    prowlarr: {
      search: async () => [],
    },
    qbittorrent: {
      addTorrent: async () => {},
      listTorrents: async () => [],
      deleteTorrent: async () => {},
      pauseTorrent: async () => {},
      resumeTorrent: async () => {},
    },
    downloads: {
      insert: async (input: CreateDownloadInput) => makeDownloadRecord({ infoHash: input.infoHash }),
      findByInfoHash: async () => null,
      findByTorrentName: async () => null,
      list: async () => [],
      update: async () => {},
      adoptInfoHash: async () => {},
      remove: async () => {},
    },
    settings: {
      get: async () => null,
      set: async () => {},
    },
  };
  const deps = { ...base, ...overrides } as Partial<AppDeps>;
  if (!deps.art) {
    deps.art = createArtService({
      repo: createMemoryArtRepo(),
      gateway: createFanartGateway({
        fanart: deps.fanart ?? null,
        resolveTvdbId: (tmdbId) => deps.tmdb!.tvdbId(tmdbId),
        minGapMs: 0,
      }),
    });
  }
  return deps as AppDeps;
}

export function asAny(value: unknown) {
  return value as never;
}

export type { TorrentState };
