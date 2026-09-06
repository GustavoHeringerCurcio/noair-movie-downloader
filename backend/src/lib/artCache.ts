import fs from 'node:fs/promises';
import path from 'node:path';
import type { ArtKind, ArtFilesRepository } from '../db/artFilesRepo.js';
import type { MediaArt, MediaType } from '../types.js';

/**
 * Artwork download pipeline (D17, temporary).
 *
 * For a set of titles it makes sure a `poster` (+ optional `background`,
 * `logo`) image exists on the `art` volume, downloading only what is missing:
 *   - poster      → Fanart `posterUrl` (hi-res) else TMDB poster `w780`
 *   - background  → Fanart `thumbUrl` (else UI blurs the poster)
 *   - logo        → Fanart `logoUrl`
 *
 * Candidate URLs are resolved locally (DB-backed, never blocking on a network
 * fetch of Fanart metadata). Only actual image downloads hit the network.
 * Files are written atomically and recorded in `art_files`; a transient
 * download failure leaves no row so the next pass retries it.
 */
export type ArtWarmSubject = {
  mediaType: MediaType;
  tmdbId: number;
  /** TMDB poster path (`/xxx.jpg`); the fallback source when Fanart has none. */
  posterPath: string | null;
};

export interface ArtCache {
  /** Download any missing art files for the subjects. Returns the number of files written. */
  warm(subjects: ArtWarmSubject[]): Promise<number>;
}

export interface ArtCacheConfig {
  repo: ArtFilesRepository;
  artDir: string;
  tmdbImageBaseUrl: string;
  /** Non-blocking Fanart-art resolver (memo + DB). Map keyed `${mediaType}:${tmdbId}`. */
  resolveMediaArt: (subjects: Array<{ mediaType: MediaType; tmdbId: number }>) => Promise<Map<string, MediaArt | null>>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Re-fetch a stored file after this long (art may be replaced upstream). */
const REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

const CONCURRENCY = 4;
const TIMEOUT_MS = 20_000;

interface Candidate {
  kind: ArtKind;
  originUrl: string;
}

function subjectKey(mediaType: MediaType, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

function rowKey(mediaType: MediaType, tmdbId: number, kind: ArtKind): string {
  return `${mediaType}:${tmdbId}:${kind}`;
}

function tmdbPosterUrl(baseUrl: string, posterPath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/t/p/w780${posterPath}`;
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
  const { repo, artDir, tmdbImageBaseUrl, resolveMediaArt } = config;
  const fetchImpl = config.fetchImpl ?? fetch;
  const nowMs = config.now ?? Date.now;

  async function candidatesFor(subjects: ArtWarmSubject[]): Promise<Map<string, Candidate>> {
    const mediaArt = await resolveMediaArt(subjects);
    const out = new Map<string, Candidate>();
    for (const subject of subjects) {
      const art = mediaArt.get(subjectKey(subject.mediaType, subject.tmdbId)) ?? null;
      const add = (kind: ArtKind, originUrl: string | null): void => {
        if (!originUrl) return;
        out.set(rowKey(subject.mediaType, subject.tmdbId, kind), { kind, originUrl });
      };
      add('poster', art?.posterUrl ?? (subject.posterPath ? tmdbPosterUrl(tmdbImageBaseUrl, subject.posterPath) : null));
      add('background', art?.thumbUrl ?? null);
      add('logo', art?.logoUrl ?? null);
    }
    return out;
  }

  async function fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async function downloadOne(row: ArtWarmSubject, candidate: Candidate): Promise<string | null> {
    try {
      const res = await fetchImpl(candidate.originUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type');
      const ext = extForContentType(contentType);
      const fileName = `${row.mediaType}_${row.tmdbId}_${candidate.kind}.${ext}`;
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
      const unique = new Map(subjects.map((s) => [subjectKey(s.mediaType, s.tmdbId), s]));
      const list = Array.from(unique.values());
      if (list.length === 0) return 0;

      const candidates = await candidatesFor(list);
      const existing = await repo.getMany(list);
      const byRow = new Map(existing.map((r) => [rowKey(r.mediaType, r.tmdbId, r.kind), r]));

      const toDownload: Array<{ subject: ArtWarmSubject; candidate: Candidate }> = [];
      for (const subject of list) {
        for (const kind of ['poster', 'background', 'logo'] as const) {
          const candidate = candidates.get(rowKey(subject.mediaType, subject.tmdbId, kind));
          if (!candidate) continue;
          const row = byRow.get(rowKey(subject.mediaType, subject.tmdbId, kind));
          if (
            row &&
            row.status === 'ok' &&
            row.filePath &&
            row.originUrl === candidate.originUrl &&
            nowMs() - Date.parse(row.fetchedAt) < REFRESH_AFTER_MS &&
            (await fileExists(path.join(artDir, row.filePath)))
          ) {
            continue;
          }
          toDownload.push({ subject, candidate });
        }
      }

      let written = 0;
      const writtenRows: Array<{ subject: ArtWarmSubject; candidate: Candidate; filePath: string }> = [];
      await mapWithConcurrency(toDownload, CONCURRENCY, async ({ subject, candidate }) => {
        const filePath = await downloadOne(subject, candidate);
        if (filePath) {
          written += 1;
          writtenRows.push({ subject, candidate, filePath });
        }
      });

      if (writtenRows.length > 0) {
        await repo.upsertMany(
          writtenRows.map(({ subject, candidate, filePath }) => ({
            mediaType: subject.mediaType,
            tmdbId: subject.tmdbId,
            kind: candidate.kind,
            originUrl: candidate.originUrl,
            filePath,
            status: 'ok' as const,
            fetchedAt: new Date(nowMs()).toISOString(),
          })),
        );
      }
      return written;
    },
  };
}
