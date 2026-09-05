import type { Source } from '../types.js';

export interface MediaIdentity {
  title: string;
  year: number | null;
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'with', 'into', 'to', 'in', 'on',
  'at', 'by', 'is', 'are', 'was', 'were', 'it', 'its', 'de', 'la', 'el', 'das',
  'der', 'die', 'le', 'les',
]);

function tokenize(value: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of value.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length >= 2 && !STOPWORDS.has(raw)) tokens.add(raw);
  }
  return tokens;
}

/**
 * Hides Prowlarr results that are almost certainly a different release than the
 * requested media:
 *  - the release embeds a foreign year (a 4-digit token that conflicts with the
 *    media year and is NOT part of the media's own title, e.g. "2049"), or
 *  - the release shares none of the media's significant title words.
 *
 * Releases with no conflicting year are kept even if they omit one. If hiding
 * everything would produce an empty list, the original list is returned instead
 * so a genuine hit never renders as "no sources".
 */
export function filterSourcesToMedia(sources: Source[], media: MediaIdentity): Source[] {
  if (sources.length === 0 || !media.title) return sources;

  const mediaTokens = tokenize(media.title);
  if (mediaTokens.size === 0) return sources;

  const mediaYear = media.year;

  function hasForeignYear(title: string): boolean {
    if (mediaYear == null) return false;
    for (const raw of title.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (!/^\d{4}$/.test(raw)) continue;
      const num = parseInt(raw, 10);
      if (num < 1900 || num > 2099) continue;
      if (Math.abs(num - mediaYear) <= 1) continue;
      // A number that is part of the media title (e.g. "2049") is not a year
      // annotation we can safely treat as conflicting.
      if (mediaTokens.has(raw)) continue;
      return true;
    }
    return false;
  }

  const kept = sources.filter((source) => {
    if (hasForeignYear(source.title)) return false;
    const candidate = tokenize(source.cleanTitle || source.title);
    for (const token of mediaTokens) {
      if (!candidate.has(token)) return false;
    }
    return true;
  });

  return kept.length > 0 ? kept : sources;
}
