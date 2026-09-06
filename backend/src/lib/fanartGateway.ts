import type { ArtSubject } from '../types.js';
import type { FanartClient, FanartResult } from '../services/fanart.js';
import { sleep } from './http.js';

export type FanartOutcome =
  | {
      kind: 'ok';
      thumbUrl: string | null;
      backgroundUrl?: string | null;
      posterUrl?: string | null;
      logoUrl: string | null;
      tvdbId: number | null;
    }
  | { kind: 'empty'; tvdbId: number | null }
  | { kind: 'error' };

export interface FanartGateway {
  /** Fetch art for one subject. `error` = transient failure; never cached by callers. */
  fetch(subject: ArtSubject, priority: 'high' | 'low'): Promise<FanartOutcome>;
  /** True while a fetch is running or queued. */
  isBusy(): boolean;
}

export interface FanartGatewayConfig {
  fanart: FanartClient | null;
  /** Resolve a TMDB tv id to a TVDB id (only called for TV subjects). */
  resolveTvdbId?: (tmdbId: number) => Promise<number | null>;
  /** Minimum time between the start of two Fanart requests (free-key friendly). */
  minGapMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

/**
 * Fanart.tv free keys are throttled to ~1 request/second. This gateway funnels
 * every fetch (warm + on-demand) through a single, paced worker so a home-page
 * load can never burst the API into 429s. `high` priority (user-triggered)
 * always jumps ahead of the background warm queue.
 */
export function createFanartGateway(config: FanartGatewayConfig): FanartGateway {
  const { fanart, resolveTvdbId } = config;
  const minGapMs = config.minGapMs ?? 800;
  const wait = config.sleepImpl ?? sleep;

  interface Task {
    subject: ArtSubject;
    priority: 'high' | 'low';
    resolve: (value: FanartOutcome) => void;
  }

  const high: Task[] = [];
  const low: Task[] = [];
  const inFlight = new Map<string, Promise<FanartOutcome>>();
  let running = false;
  let lastStartMs = -Infinity;

  async function execute(subject: ArtSubject): Promise<FanartOutcome> {
    if (!fanart) return { kind: 'error' };
    try {
      if (subject.mediaType === 'movie') {
        const result = await fanart.getMovieArt(subject.tmdbId);
        return mapMovieResult(result);
      }
      const tvdb = resolveTvdbId ? await resolveTvdbId(subject.tmdbId) : null;
      if (tvdb == null) return { kind: 'empty', tvdbId: null };
      const result = await fanart.getTvArt(tvdb);
      return mapTvResult(result, tvdb);
    } catch {
      return { kind: 'error' };
    }
  }

  function mapMovieResult(result: FanartResult): FanartOutcome {
    if (result.status === 'ok') {
      return {
        kind: 'ok',
        thumbUrl: result.thumbUrl,
        backgroundUrl: result.backgroundUrl,
        posterUrl: result.posterUrl,
        logoUrl: result.logoUrl,
        tvdbId: null,
      };
    }
    return result.status === 'error' ? { kind: 'error' } : { kind: 'empty', tvdbId: null };
  }

  function mapTvResult(result: FanartResult, tvdbId: number): FanartOutcome {
    if (result.status === 'ok') {
      return {
        kind: 'ok',
        thumbUrl: result.thumbUrl,
        backgroundUrl: result.backgroundUrl,
        posterUrl: result.posterUrl,
        logoUrl: result.logoUrl,
        tvdbId,
      };
    }
    return result.status === 'error' ? { kind: 'error' } : { kind: 'empty', tvdbId };
  }

  async function enqueue(subject: ArtSubject, priority: 'high' | 'low'): Promise<FanartOutcome> {
    return new Promise<FanartOutcome>((resolve) => {
      (priority === 'high' ? high : low).push({ subject, priority, resolve });
      void kick();
    });
  }

  async function kick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (high.length > 0 || low.length > 0) {
        const task = high.shift() ?? low.shift();
        if (!task) break;
        const elapsed = Date.now() - lastStartMs;
        if (lastStartMs !== -Infinity && elapsed < minGapMs) {
          await wait(minGapMs - elapsed);
        }
        lastStartMs = Date.now();
        try {
          task.resolve(await execute(task.subject));
        } catch {
          task.resolve({ kind: 'error' });
        }
      }
    } finally {
      running = false;
      // A task enqueued while the loop was unwinding must not be stranded.
      if (high.length > 0 || low.length > 0) void kick();
    }
  }

  function fetch(subject: ArtSubject, priority: 'high' | 'low'): Promise<FanartOutcome> {
    const key = `${subject.mediaType}:${subject.tmdbId}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = enqueue(subject, priority).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
  }

  return {
    fetch,
    isBusy: () => running || high.length > 0 || low.length > 0,
  };
}
