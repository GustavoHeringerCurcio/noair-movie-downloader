import type { AppDeps } from '../deps.js';
import type { Source } from '../types.js';

/**
 * User-facing release-quality ceiling for source searches. Stored site-wide
 * (like the audio language) and defaulting to 1080p so the biggest 4K remuxes
 * never show up (or get auto-picked) until someone deliberately raises it.
 */
export type MaxResolution = '2160p' | '1080p' | '720p';

export const DEFAULT_MAX_RESOLUTION: MaxResolution = '1080p';

export const MAX_RESOLUTION_KEY = 'maxResolution';

const VALID_MAX_RESOLUTIONS: ReadonlySet<string> = new Set(['2160p', '1080p', '720p']);

export function isMaxResolution(value: unknown): value is MaxResolution {
  return typeof value === 'string' && VALID_MAX_RESOLUTIONS.has(value);
}

/** Higher = heavier. A release whose resolution the parser couldn't read is treated as the lightest. */
const RESOLUTION_RANK: Record<string, number> = { '480p': 0, '720p': 1, '1080p': 2, '2160p': 3 };

function rank(value: string | null | undefined): number {
  if (value == null) return 0;
  return RESOLUTION_RANK[value] ?? 0;
}

/**
 * Keeps only releases at or below `cap`. Unknown-resolution releases are kept:
 * hiding them would also hide legitimate 720p/1080p hits from trackers that
 * don't tag resolutions, and real 2160p releases are almost always tagged.
 */
export function filterSourcesByMaxResolution(sources: Source[], cap: MaxResolution): Source[] {
  const max = rank(cap);
  return sources.filter((s) => rank(s.resolution) <= max);
}

/** Persisted site-wide quality ceiling (single-user install). Defaults to 1080p. */
export async function loadMaxResolutionPreference(deps: AppDeps): Promise<MaxResolution> {
  const setting = await deps.settings.get<{ maxResolution?: unknown }>(MAX_RESOLUTION_KEY);
  return isMaxResolution(setting?.maxResolution) ? setting.maxResolution : DEFAULT_MAX_RESOLUTION;
}

export async function saveMaxResolutionPreference(deps: AppDeps, maxResolution: MaxResolution): Promise<void> {
  await deps.settings.set(MAX_RESOLUTION_KEY, { maxResolution });
}
