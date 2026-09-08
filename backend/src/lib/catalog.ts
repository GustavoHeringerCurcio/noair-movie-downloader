import type { AppDeps } from '../deps.js';
import type { Source } from '../types.js';

/**
 * Server-wide catalog strictness for release search results (Phase 1).
 *
 * `browser-friendly` (default) hides every release that would need a re-encode
 * before the browser can play it (HEVC/x265, HDR/DoVi, 4K, unknown codecs), so
 * a normal user's find → download → watch journey needs no conversion and no
 * GPU. `all` (the "Show all releases" toggle) brings everything back for users
 * who want specific encodes — those go through the background optimizer
 * instead. Mirrors the frontend's `isWebExhibitable` (coverage.ts) so the UI and
 * server agree on what "plays directly" means.
 */
export type ReleaseCatalogMode = 'browser-friendly' | 'all';

export const DEFAULT_RELEASE_CATALOG: ReleaseCatalogMode = 'browser-friendly';

export const RELEASE_CATALOG_KEY = 'releaseCatalog';

const VALID_MODES: ReadonlySet<string> = new Set(['browser-friendly', 'all']);

export function isReleaseCatalogMode(value: unknown): value is ReleaseCatalogMode {
  return typeof value === 'string' && VALID_MODES.has(value);
}

/**
 * True when a release plays in the browser with zero re-encode: x264 or AV1 in
 * SDR up to 1080p. x265/HEVC is never browser-safe, HDR/DoVi almost always
 * implies HEVC 10-bit, unknown codecs are not trusted, and 4K is excluded.
 * H.264 in an MKV still qualifies — repackaging is a copy, not a re-encode.
 */
export function isBrowserFriendlyRelease(source: Source): boolean {
  return (
    (source.codec === 'x264' || source.codec === 'AV1') &&
    !source.hdr &&
    !source.isDolbyVision &&
    source.resolution !== '2160p'
  );
}

export function filterSourcesByReleaseCatalog(sources: Source[], mode: ReleaseCatalogMode): Source[] {
  if (mode === 'all') return sources;
  return sources.filter(isBrowserFriendlyRelease);
}

/** Persisted site-wide catalog mode (single-user install). Defaults to browser-friendly. */
export async function loadReleaseCatalogPreference(deps: AppDeps): Promise<ReleaseCatalogMode> {
  const stored = await deps.settings.get<{ mode?: unknown }>(RELEASE_CATALOG_KEY);
  return isReleaseCatalogMode(stored?.mode) ? stored.mode : DEFAULT_RELEASE_CATALOG;
}

export async function saveReleaseCatalogPreference(deps: AppDeps, mode: ReleaseCatalogMode): Promise<void> {
  await deps.settings.set(RELEASE_CATALOG_KEY, { mode });
}
