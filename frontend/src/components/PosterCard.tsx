import type { MediaItem } from '../types';
import { posterUrl } from '../api';

interface PosterCardProps {
  item: MediaItem;
  progress?: number | null;
  subtitle?: string | null;
}

export function PosterCard({ item, progress, subtitle }: PosterCardProps) {
  const poster = posterUrl(item.posterPath);
  const pct = progress == null ? null : Math.min(100, Math.max(0, Math.round(progress * 100)));
  const showRating = item.voteAverage > 0;

  return (
    <article className="poster-card">
      {poster ? (
        <img className="poster-card-image" src={poster} alt={`${item.title} poster`} loading="lazy" />
      ) : (
        <div className="poster-card-placeholder" aria-hidden="true">
          {item.title.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="poster-card-shade" aria-hidden="true" />

      {showRating && (
        <span className="poster-card-rating" title={`Rating ${item.voteAverage.toFixed(1)}/10`}>
          ★ {item.voteAverage.toFixed(1)}
        </span>
      )}

      {pct != null && (
        <div className="poster-card-progress" aria-label={`${pct}% downloaded`}>
          <div className="poster-card-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="poster-card-info">
        <h3 className="poster-card-title" title={item.title}>
          {item.title}
        </h3>
        {subtitle && <span className="poster-card-subtitle" title={subtitle}>{subtitle}</span>}
        <span className="poster-card-year">{pct != null ? `Downloading ${pct}%` : (item.year ?? '—')}</span>
      </div>
    </article>
  );
}
