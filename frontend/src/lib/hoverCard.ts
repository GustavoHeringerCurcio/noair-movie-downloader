/** Runtime → Netflix-style duration label (S16/D20): `139` → "2h 19m". */
export function durationLabel(runtimeMinutes: number | null): string | null {
  if (runtimeMinutes == null || !Number.isFinite(runtimeMinutes) || runtimeMinutes <= 0) return null;
  const total = Math.round(runtimeMinutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/** Season count label for the hover card: `2` → "2 Seasons". */
export function seasonCountLabel(count: number | null): string | null {
  if (count == null || count <= 0) return null;
  return count === 1 ? '1 Season' : `${count} Seasons`;
}

/** Genre tags shown on the hover card's last row; capped like Netflix. */
export function hoverTags(genres: string[]): string[] {
  return genres.filter(Boolean).slice(0, 3);
}
