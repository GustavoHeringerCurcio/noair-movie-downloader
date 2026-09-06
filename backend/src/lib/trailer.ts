import type { TmdbVideo } from '../services/tmdb.js';
import type { Trailer, TrailerProvider } from '../types.js';

/** Maps an upstream TMDB `site` value to an embeddable provider; drops everything else. */
function providerFor(site: string): TrailerProvider | null {
  switch (site.toLowerCase()) {
    case 'youtube':
      return 'youtube';
    case 'vimeo':
      return 'vimeo';
    default:
      return null;
  }
}

/** "Trailer" is the hover preview; teasers are close enough; anything else is a last resort. */
function kindScore(kind: string): number {
  switch (kind.toLowerCase()) {
    case 'trailer':
      return 0;
    case 'teaser':
      return 1;
    default:
      return 2;
  }
}

interface Candidate {
  video: TmdbVideo;
  provider: TrailerProvider;
}

/**
 * Picks the best embeddable trailer for a title (S15). Keep only YouTube/Vimeo,
 * prefer the English subset when it has candidates, then rank by kind
 * (Trailer → Teaser → other), official-first, newest first, YouTube over Vimeo.
 * Returns null when nothing is embeddable.
 */
export function pickTrailer(videos: TmdbVideo[]): Trailer | null {
  const candidates = videos
    .map((video): Candidate | null => {
      const provider = providerFor(video.site);
      if (provider === null || !video.key) return null;
      return { video, provider };
    })
    .filter((c): c is Candidate => c !== null);
  if (candidates.length === 0) return null;

  const pool = candidates.some((c) => c.video.language === 'en') ? candidates.filter((c) => c.video.language === 'en') : candidates;

  pool.sort((a, b) => {
    const kind = kindScore(a.video.kind) - kindScore(b.video.kind);
    if (kind !== 0) return kind;
    if (a.video.official !== b.video.official) return a.video.official ? -1 : 1;
    if (a.provider !== b.provider) return a.provider === 'youtube' ? -1 : 1;
    return publishedMs(b.video.publishedAt) - publishedMs(a.video.publishedAt);
  });

  const best = pool[0];
  if (!best) return null;
  return { provider: best.provider, videoId: best.video.key, name: best.video.name };
}

function publishedMs(publishedAt: string | null): number {
  if (!publishedAt) return -Infinity;
  const ms = Date.parse(publishedAt);
  return Number.isFinite(ms) ? ms : -Infinity;
}
