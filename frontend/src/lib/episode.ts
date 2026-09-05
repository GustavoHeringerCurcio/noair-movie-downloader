export interface EpisodeKey {
  season: number;
  episode: number;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Formats a season/episode as the canonical `S01E03` deep-link token. */
export function episodeToken(season: number, episode: number): string {
  return `S${pad(season)}E${pad(episode)}`;
}

/** Parses an `S01E03` token back into its parts; null when malformed. */
export function parseEpisodeToken(token: string): EpisodeKey | null {
  const m = /\bs(\d{1,2})e(\d{1,3})\b/i.exec(token);
  if (!m) return null;
  const season = Number(m[1]);
  const episode = Number(m[2]);
  if (season <= 0 || episode <= 0) return null;
  return { season, episode };
}

/** Client-side fallback when a stream file carries no server tag (S13). */
export function episodeKeyFromFilename(name: string): EpisodeKey | null {
  const base = name.replace(/\.!qb$/i, '');
  const m = /\bs(\d{1,2})e(\d{1,3})\b/i.exec(base);
  if (!m) return null;
  const season = Number(m[1]);
  const episode = Number(m[2]);
  if (season <= 0 || episode <= 0) return null;
  return { season, episode };
}
