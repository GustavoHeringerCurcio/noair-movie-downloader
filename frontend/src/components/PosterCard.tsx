import type { MediaItem } from '../types';
import { posterUrl } from '../api';

export function PosterCard({ item }: { item: MediaItem }) {
  const poster = posterUrl(item.posterPath);
  return (
    <article className="poster-card">
      {poster ? (
        <img className="poster-card-image" src={poster} alt={`${item.title} poster`} loading="lazy" />
      ) : (
        <div className="poster-card-placeholder" aria-hidden="true">
          {item.title.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="poster-card-info">
        <h3 className="poster-card-title" title={item.title}>
          {item.title}
        </h3>
        <span className="poster-card-year">{item.year ?? '—'}</span>
      </div>
    </article>
  );
}
