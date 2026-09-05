import { useNavigate } from 'react-router-dom';
import { ArrowDownToLine, Play, Info, Download } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { MediaItem } from '../types';
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
  const title = `${item.title}${item.year ? ` (${item.year})` : ''}`;

  function goDetail(): void {
    navigate(openDetail(item));
  }

  function handleKey(e: ReactKeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goDetail();
    }
  }

  return (
    <div
      className="title-card"
      role="button"
      tabIndex={0}
      aria-label={`${title} — open details`}
      onClick={goDetail}
      onKeyDown={handleKey}
    >
      {/* Blurred stage behind the sharp poster */}
      {poster && (
        <img
          className="title-card-bg"
          src={backdrop ?? poster}
          alt=""
          aria-hidden="true"
          loading="lazy"
        />
      )}

      {poster ? (
        <div className="title-card-stage">
          <img className="title-card-poster" src={poster} alt="" loading="lazy" />
        </div>
      ) : backdrop ? (
        <>
          <img className="title-card-media" src={backdrop} alt="" loading="lazy" />
          <div className="title-card-shade" aria-hidden="true" />
          <div className="title-card-info">
            <span className="title-card-title" title={title}>
              {item.title}
            </span>
          </div>
        </>
      ) : (
        <div className="title-card-fallback" aria-hidden="true">
          {item.title.charAt(0).toUpperCase()}
        </div>
      )}

      <div className="title-card-chips" aria-hidden="true">
        {quality && <span className="chip">{quality}</span>}
        {item.mediaType === 'tv' && <span className="chip">TV</span>}
      </div>

      <div className="title-card-overlay">
        {primary && (
          <button
            type="button"
            className="tc-btn tc-primary"
            aria-label={primary.label}
            title={primary.label}
            onClick={(e) => {
              e.stopPropagation();
              primary?.onClick();
            }}
            disabled={primary.disabled}
          >
            {glyphFor(primary.icon)}
          </button>
        )}
        <button
          type="button"
          className="tc-btn"
          aria-label="More info"
          title="More info"
          onClick={(e) => {
            e.stopPropagation();
            if (onOpenDetail) onOpenDetail();
            else goDetail();
          }}
        >
          <Info size={18} />
        </button>
      </div>

      {pct != null && (
        <div className="progress-track" aria-label={`${pct}% downloaded`}>
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
