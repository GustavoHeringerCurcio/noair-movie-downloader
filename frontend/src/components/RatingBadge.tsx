/**
 * IMDb rating chip (T-004) — the single display used by both the hover card and
 * the detail-page header (movies and TV). Shows the true IMDb score stored by
 * the OMDb poster pipeline as `★ 8.3`; a title without a cached rating renders
 * nothing (no empty slot, no fallback number). One component, one look.
 */
export function RatingBadge({ value }: { value: number | null | undefined }): JSX.Element | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  const display = value.toFixed(1);
  return (
    <span className="rating-badge" role="img" aria-label={`IMDb rating ${display}`}>
      <span className="rating-badge-star" aria-hidden="true">
        ★
      </span>
      {display}
    </span>
  );
}
