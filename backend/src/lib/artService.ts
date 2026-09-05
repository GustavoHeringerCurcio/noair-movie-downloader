import type { ArtRepository } from '../db/artRepo.js';
import type { FanartGateway, FanartOutcome } from './fanartGateway.js';
import { sleep } from './http.js';
import type { ArtSubject, MediaArt } from '../types.js';

export function artKey(subject: ArtSubject): string {
  return `${subject.mediaType}:${subject.tmdbId}`;
}

const ART_MEMO_TTL_MS = 24 * 60 * 60 * 1000;
const EMPTY_MEMO_TTL_MS = 6 * 60 * 60 * 1000;
const FAIL_MEMO_TTL_MS = 60 * 1000;

interface MemoEntry {
  kind: 'art' | 'empty' | 'fail';
  art: MediaArt | null;
  until: number;
}

export interface ArtService {
  /**
   * Resolve art for a batch from memory + DB only — never blocks on the
   * network. Keys with no known art (missing row / persisted empty) are absent
   * from the returned map.
   */
  resolveManyCached(subjects: ArtSubject[]): Promise<Map<string, MediaArt | null>>;
  /** Fire-and-forget: queue a fetch for any subject we don't yet know about. */
  enqueueMissing(subjects: ArtSubject[]): void;
  /** Block until a single subject resolves (fetching it if needed). */
  resolveOne(subject: ArtSubject, timeoutMs?: number): Promise<MediaArt | null>;
  /** Forget cached knowledge and refetch (used to detect art added later). */
  refresh(subjects: ArtSubject[]): void;
  /** Refetch subjects whose persisted row is `empty` and older than `olderThanMs`. Returns count. */
  refreshExpired(subjects: ArtSubject[], olderThanMs: number): Promise<number>;
  /** Wait until every outstanding fetch has finished and been persisted. */
  drain(): Promise<void>;
  clear(): void;
}

export interface ArtServiceConfig {
  repo: ArtRepository;
  gateway: FanartGateway;
  now?: () => number;
}

export function createArtService(config: ArtServiceConfig): ArtService {
  const { repo, gateway } = config;
  const nowMs = config.now ?? Date.now;

  const memo = new Map<string, MemoEntry>();
  const pending = new Map<string, Promise<void>>();

  function storeMemo(key: string, kind: MemoEntry['kind'], art: MediaArt | null, ttlMs: number): void {
    memo.set(key, { kind, art, until: nowMs() + ttlMs });
  }

  async function persistOutcome(subject: ArtSubject, outcome: FanartOutcome): Promise<void> {
    const key = artKey(subject);
    if (outcome.kind === 'ok') {
      const art: MediaArt = { thumbUrl: outcome.thumbUrl, logoUrl: outcome.logoUrl };
      storeMemo(key, 'art', art, ART_MEMO_TTL_MS);
      await repo.upsertMany([
        {
          mediaType: subject.mediaType,
          tmdbId: subject.tmdbId,
          tvdbId: outcome.tvdbId,
          thumbUrl: outcome.thumbUrl,
          logoUrl: outcome.logoUrl,
          status: 'ok',
          fetchedAt: new Date().toISOString(),
        },
      ]);
    } else if (outcome.kind === 'empty') {
      storeMemo(key, 'empty', null, EMPTY_MEMO_TTL_MS);
      await repo.upsertMany([
        {
          mediaType: subject.mediaType,
          tmdbId: subject.tmdbId,
          tvdbId: outcome.tvdbId,
          thumbUrl: null,
          logoUrl: null,
          status: 'empty',
          fetchedAt: new Date().toISOString(),
        },
      ]);
    } else {
      storeMemo(key, 'fail', null, FAIL_MEMO_TTL_MS);
    }
  }

  function ensureFetch(subject: ArtSubject, priority: 'high' | 'low'): Promise<void> {
    const key = artKey(subject);
    const existing = pending.get(key);
    if (existing) return existing;
    const task = gateway
      .fetch(subject, priority)
      .then((outcome) => persistOutcome(subject, outcome))
      .catch(() => storeMemo(key, 'fail', null, FAIL_MEMO_TTL_MS))
      .finally(() => {
        pending.delete(key);
      });
    pending.set(key, task);
    return task;
  }

  async function resolveManyCached(subjects: ArtSubject[]): Promise<Map<string, MediaArt | null>> {
    const out = new Map<string, MediaArt | null>();
    const dbMisses: ArtSubject[] = [];
    for (const subject of subjects) {
      const key = artKey(subject);
      const entry = memo.get(key);
      if (!entry) {
        dbMisses.push(subject);
        continue;
      }
      if (entry.kind === 'art' && entry.art) out.set(key, entry.art);
    }
    if (dbMisses.length === 0) return out;

    const rows = await repo.getMany(dbMisses);
    const byKey = new Map(rows.map((row) => [artKey(row), row]));
    for (const subject of dbMisses) {
      const key = artKey(subject);
      const row = byKey.get(key);
      if (!row) continue;
      if (row.status === 'ok' && (row.thumbUrl != null || row.logoUrl != null)) {
        const art: MediaArt = { thumbUrl: row.thumbUrl, logoUrl: row.logoUrl };
        storeMemo(key, 'art', art, ART_MEMO_TTL_MS);
        out.set(key, art);
      } else {
        storeMemo(key, 'empty', null, EMPTY_MEMO_TTL_MS);
      }
    }
    return out;
  }

  function enqueueMissing(subjects: ArtSubject[]): void {
    for (const subject of subjects) {
      const key = artKey(subject);
      if (memo.has(key)) continue;
      void ensureFetch(subject, 'low').catch(() => undefined);
    }
  }

  async function resolveOne(subject: ArtSubject, timeoutMs = 12_000): Promise<MediaArt | null> {
    const key = artKey(subject);
    const entry = memo.get(key);
    if (entry?.kind === 'art') return entry.art;
    if (entry?.kind === 'empty' || entry?.kind === 'fail') return null;

    const task = ensureFetch(subject, 'high');
    const settled = await Promise.race([
      task.then(() => true),
      sleep(timeoutMs).then(() => false),
    ]);
    if (!settled) return null;
    const after = memo.get(key);
    return after?.kind === 'art' ? after.art : null;
  }

  function refresh(subjects: ArtSubject[]): void {
    for (const subject of subjects) {
      const key = artKey(subject);
      memo.delete(key);
      void ensureFetch(subject, 'low').catch(() => undefined);
    }
  }

  async function refreshExpired(subjects: ArtSubject[], olderThanMs: number): Promise<number> {
    const rows = await repo.getMany(subjects);
    const cutoff = nowMs() - olderThanMs;
    const stale = rows.filter((row) => row.status === 'empty' && Date.parse(row.fetchedAt) < cutoff);
    if (stale.length > 0) refresh(stale.map((row) => ({ mediaType: row.mediaType, tmdbId: row.tmdbId })));
    return stale.length;
  }

  async function drain(): Promise<void> {
    for (;;) {
      const tasks = Array.from(pending.values());
      if (tasks.length === 0) return;
      await Promise.allSettled(tasks);
    }
  }

  return { resolveManyCached, enqueueMissing, resolveOne, refresh, refreshExpired, drain, clear: () => memo.clear() };
}
