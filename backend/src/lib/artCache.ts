import fs from 'node:fs/promises';
import path from 'node:path';
import type { ArtFilesRepository, ArtKind } from '../db/artFilesRepo.js';
import type { ArtSubject } from '../types.js';

/**
 * Artwork download pipeline (poster pipeline D21, extended to any `kind` by
 * T-002).
 *
 * For a set of titles it makes sure one artwork file exists on the `art`
 * volume, downloading only what is missing. `resolveOrigin` resolves the
 * upstream URL for the configured `kind` (`poster` from OMDb, `thumb` from
 * fanart.tv, `logo` from TMDB) and is expected to return `null` for titles
 * with no such art or when no key is configured.
 *
 * Only actual image downloads hit the network. Files are written atomically and
 * recorded in `art_files`; a transient download failure leaves no row so the
 * next pass retries it. Titles resolved as having no artwork are recorded as
 * `status='empty'` so the pass (and the image routes) do not re-ask the
 * provider for them until `EMPTY_RETRY_MS` elapses.
 */
export interface ArtCache {
  /** Download any missing artwork files for the subjects. Returns the number of files written. */
  warm(subjects: ArtSubject[]): Promise<number>;
}

export interface ArtCacheConfig {
  repo: ArtFilesRepository;
  artDir: string;
  /** Which `art_files` kind this cache writes/serves (`poster` by default). */
  kind?: ArtKind;
  /** Resolve the upstream artwork URL for a subject (null = no art / no key). */
  resolveOrigin: (subject: ArtSubject) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Re-fetch a stored file after this long (poster may be replaced upstream). */
const REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
/** Do not re-ask a title recorded as "no poster" more often than this. */
const EMPTY_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

const CONCURRENCY = 4;
const TIMEOUT_MS = 20_000;

function subjectKey(subject: ArtSubject): string {
  return `${subject.mediaType}:${subject.tmdbId}`;
}

function extForContentType(contentType: string | null): string {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  if (type.includes('svg')) return 'svg';
  return 'jpg';
}

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      await fn(items[current] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

export function createArtCache(config: ArtCacheConfig): ArtCache {
  const { repo, artDir, resolveOrigin } = config;
  const kind: ArtKind = config.kind ?? 'poster';
  const fetchImpl = config.fetchImpl ?? fetch;
  const nowMs = config.now ?? Date.now;

  async function fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async function downloadOne(subject: ArtSubject, originUrl: string): Promise<string | null> {
    try {
      const res = await fetchImpl(originUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type');
      const ext = extForContentType(contentType);
      const fileName = `${subject.mediaType}_${subject.tmdbId}_${kind}.${ext}`;
      const finalPath = path.join(artDir, fileName);
      // Unique temp name so concurrent warms of the same subject (two rails
      // rendering the same title at once) never interleave on one .tmp file.
      const tmpPath = `${finalPath}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.mkdir(artDir, { recursive: true });
      await fs.writeFile(tmpPath, buffer);
      await fs.rename(tmpPath, finalPath);
      return fileName;
    } catch {
      return null;
    }
  }

  return {
    async warm(subjects) {
      const unique = new Map(subjects.map((s) => [subjectKey(s), s]));
      const list = Array.from(unique.values());
      if (list.length === 0) return 0;

      const rows = await repo.getMany(list);
      const bySubject = new Map(rows.filter((r) => r.kind === kind).map((r) => [subjectKey(r), r]));

      const toResolve: ArtSubject[] = [];
      for (const subject of list) {
        const row = bySubject.get(subjectKey(subject));
        if (!row) {
          toResolve.push(subject);
          continue;
        }
        if (row.status === 'ok' && row.filePath && (await fileExists(path.join(artDir, row.filePath)))) {
          if (nowMs() - Date.parse(row.fetchedAt) >= REFRESH_AFTER_MS) toResolve.push(subject);
          continue;
        }
        if (row.status === 'empty' && nowMs() - Date.parse(row.fetchedAt) < EMPTY_RETRY_MS) continue;
        toResolve.push(subject);
      }

      let written = 0;
      const upserts: Array<{
        mediaType: ArtSubject['mediaType'];
        tmdbId: number;
        kind: ArtKind;
        originUrl: string | null;
        filePath: string | null;
        status: 'ok' | 'empty';
      }> = [];

      await mapWithConcurrency(toResolve, CONCURRENCY, async (subject) => {
        // `resolveOrigin` throws only for transient failures (provider
        // unreachable / budget exhausted). Those must NOT be recorded as
        // "no art" — skip and let a later pass retry. A `null` result means
        // "definitively no artwork" and is persisted so the provider is not
        // re-asked for a while.
        let originUrl: string | null = null;
        try {
          originUrl = await resolveOrigin(subject);
        } catch {
          return;
        }
        if (!originUrl) {
          upserts.push({
            mediaType: subject.mediaType,
            tmdbId: subject.tmdbId,
            kind,
            originUrl: null,
            filePath: null,
            status: 'empty',
          });
          return;
        }
        const filePath = await downloadOne(subject, originUrl);
        if (filePath) {
          written += 1;
          upserts.push({
            mediaType: subject.mediaType,
            tmdbId: subject.tmdbId,
            kind,
            originUrl,
            filePath,
            status: 'ok',
          });
        }
      });

      if (upserts.length > 0) {
        await repo.upsertMany(
          upserts.map((u) => ({ ...u, fetchedAt: new Date(nowMs()).toISOString() })),
        );
      }
      return written;
    },
  };
}
