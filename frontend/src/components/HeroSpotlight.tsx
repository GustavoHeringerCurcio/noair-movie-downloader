import type { MediaItem } from '../types';
import { backdropUrl } from '../api';

interface HeroSpotlightProps {
  item: MediaItem;
}

export function HeroSpotlight({ item }: HeroSpotlightProps) {
  const backdrop = backdropUrl(item.backdropPath);
  return (
    <a className={`hero-spotlight ${backdrop ? '' : 'hero-spotlight--noart'}`} href={`/media/${item.tmdbId}?type=${item.mediaType}`}>
      {backdrop && <img className="hero-spotlight-backdrop" src={backdrop} alt="" />}
      <div className="hero-spotlight-shade" />
      <div className="hero-spotlight-content">
        <span className="hero-spotlight-kicker">Trending now</span>
        <h1 className="hero-spotlight-title">{item.title}</h1>
        <div className="hero-spotlight-meta">
          <span>{item.year ?? '—'}</span>
          <span className="hero-spotlight-rating">★ {item.voteAverage.toFixed(1)}</span>
        </div>
        <p className="hero-spotlight-overview">{item.overview}</p>
        <span className="btn btn-primary hero-spotlight-cta">View details</span>
      </div>
    </a>
  );
}
