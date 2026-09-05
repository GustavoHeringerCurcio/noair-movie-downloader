import { useNavigate } from 'react-router-dom';
import { ArrowDownToLine, Play, Info, Download } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { MediaItem, MediaType } from '../types';
import { backdropUrl, posterUrl } from '../api';

export interface TitleCardPrimary {
  label: string;
  onClick: () => void;
  icon?: 'download' | 'play' | 'down';
  disabled?: boolean;
}

interface TitleCardProps {
  item: MediaItem;
  progress?: number | null;
  quality?: string | null;
  primary?: TitleCardPrimary | null;
  onOpenDetail?: () => void;
}

function openDetail(item: MediaItem): string {
  return `/media/${item.tmdbId}?type=${item.mediaType}`;
}

function glyphFor(type?: 'download' | 'play' | 'down'): JSX.Element {
  switch (type) {
    case 'download':
      return <Download size={18} />;
    case 'play':
      return <Play size={18} fill="currentColor" />;
    case 'down':
      return <ArrowDownToLine size={18} />;
    default:
      return <ArrowDownToLine size={18} />;
  }
}

export function TitleCard({ item, progress, quality, primary, onOpenDetail }: TitleCardProps) {
  const navigate = useNavigate();
  const backdrop = backdropUrl(item.backdropPath);
  const poster = posterUrl(item.posterPath);
  const pct = progress == null ? null : Math.min(100, Math.max(0, Math.round(progress * 100)));

  function goDetail(e?: { stopPropagation(): void }): void {
    e?.stopPropagation();
    navigate(openDetail(item));
  }

  function handleKey(e: ReactKeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Enter') navigate(openDetail(item));
  }

  const title = `${item.title}${item.year ? ` (${item.year})` : ''}`;
  const mediaType: MediaType = item.mediaType;

  return (
    <div
      className="title-card"
      role="button"
      tabIndex={0}
      aria-label={`${title} — open details`}
      onClick={() => navigate(openDetail(item))}
      onKeyDown={handleKey}
    >
      {backdrop ? (
        <img className="title-card-media" src={backdrop} alt="" loading="lazy" />
      ) : poster ? (
        <img className="title-card-media" src={poster} alt="" loading="lazy" />
      ) : (
        <div className="title-card-fallback" aria-hidden="true">
          {item.title.charAt(0).toUpperCase()}
        </div>
      )}

      <div className="title-card-overlay" onClick={(e) => e.stopPropagation()}>
        {primary && (
          <button
            type="button"
            className="tc-btn tc-primary"
            aria-label={primary.label}
            title={primary.label}
            onClick={primary.onClick}
            disabled={primary.disabled}
          >
            {glyphFor(primary.icon)}
          </button>
        )}
        {onOpenDetail ? (
          <button type="button" className="tc-btn" aria-label="More info" title="More info" onClick={onOpenDetail}>
            <Info size={18} />
          </button>
        ) : (
          <button type="button" className="tc-btn" aria-label="More info" title="More info" onClick={goDetail}>
            <Info size={18} />
          </button>
        )}
      </div>

      <div className="title-card-shade" aria-hidden="true" />
      <div className="title-card-info">
        <span className="title-card-title" title={title}>
          {item.title}
        </span>
        {quality && <span className="chip">{quality}</span>}
        {mediaType === 'tv' && <span className="chip">TV</span>}
      </div>

      {pct != null && (
        <div className="progress-track" aria-label={`${pct}% downloaded`}>
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
