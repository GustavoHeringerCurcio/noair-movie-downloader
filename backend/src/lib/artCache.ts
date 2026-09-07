import fs from 'node:fs/promises';
import path from 'node:path';
import type { ArtFilesRepository } from '../db/artFilesRepo.js';
import type { ArtSubject } from '../types.js';

/**
 * Portrait-poster download pipeline (D21).
 *
 * For a set of titles it makes sure a `poster` image (kind `poster`, sourced
 * from OMDb via `resolveOrigin`) exists on the `art` volume, downloading only
 * what is missing. `resolveOrigin` resolves the Amazon portrait URL
 * (IMDb id via TMDB → OMDb) and is expected to return `posterUrl: null` for
 * titles with no poster or when no OMDb key is configured. The IMDb score
 * (`imdbRating`) rides the same OMDb response and is persisted alongside the
 * poster (T-004) — no extra network call.
 *
 * Only actual image downloads hit the network. Files are written atomically and
 * recorded in `art_files`; a transient download failure leaves no row so the
 * next pass retries it. Titles resolved as having no poster are recorded as
 * `status='empty'` so the pass (and the image route) does not re-ask OMDb for
 * them until `EMPTY_RETRY_MS` elapses.
 */
export interface ArtCache {
  /** Download any missing poster files for the subjects. Returns the number of files written. */
  warm(subjects: ArtSubject[]): Promise<number>;
}

/** What `resolveOrigin` learns from OMDb for a subject (poster + IMDb score in one call). */
export interface PosterResolution {
  /** Amazon portrait URL; null when the title has no poster (or no OMDb key is configured). */
  posterUrl: string | null;
  /** IMDb's own score from the same response; null when OMDb has none. */
  imdbRating: number | null;
}

export interface ArtCacheConfig {
  repo: ArtFilesRepository;
  artDir: string;
  /** Resolve the OMDb/Amazon portrait + IMDb score for a subject. */
  resolveOrigin: (subject: ArtSubject) => Promise<PosterResolution>;
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
      const fileName = `${subject.mediaType}_${subject.tmdbId}_poster.${ext}`;
      const finalPath = path.join(artDir, fileName);
      const tmpPath = `${finalPath}.tmp`;
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
      const bySubject = new Map(rows.filter((r) => r.kind === 'poster').map((r) => [subjectKey(r), r]));

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
        kind: 'poster';
        originUrl: string | null;
        filePath: string | null;
        status: 'ok' | 'empty';
        imdbRating: number | null;
      }> = [];

      await mapWithConcurrency(toResolve, CONCURRENCY, async (subject) => {
        // `resolveOrigin` throws only for transient failures (OMDb unreachable /
        // daily budget). Those must NOT be recorded as "no poster" — skip and
        // let a later pass retry. A `posterUrl: null` result means "definitively
        // no poster" and is persisted so OMDb is not re-asked for a while (the
        // IMDb score still rides along when OMDb reported one).
        let resolution: PosterResolution;
        try {
          resolution = await resolveOrigin(subject);
        } catch {
          return;
        }
        if (!resolution.posterUrl) {
          upserts.push({
            mediaType: subject.mediaType,
            tmdbId: subject.tmdbId,
            kind: 'poster',
            originUrl: null,
            filePath: null,
            status: 'empty',
            imdbRating: resolution.imdbRating,
          });
          return;
        }
        const filePath = await downloadOne(subject, resolution.posterUrl);
        if (filePath) {
          written += 1;
          upserts.push({
            mediaType: subject.mediaType,
            tmdbId: subject.tmdbId,
            kind: 'poster',
            originUrl: resolution.posterUrl,
            filePath,
            status: 'ok',
            imdbRating: resolution.imdbRating,
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
