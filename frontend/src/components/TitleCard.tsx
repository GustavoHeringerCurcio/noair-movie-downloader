import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownToLine, Play, Download } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { MediaItem } from '../types';
import { cardImages } from '../api';
import { useImageProvider } from '../store/settingsStore';

export interface TitleCardPrimary {
  label: string;
  onClick: () => void;
  icon?: 'download' | 'play' | 'down';
  disabled?: boolean;
}

interface TitleCardProps {
  item: MediaItem;
  progress?: number | null;
  primary?: TitleCardPrimary | null;
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

export function TitleCard({ item, progress, primary }: TitleCardProps) {
  const navigate = useNavigate();
  const provider = useImageProvider();
  const pct = progress == null ? null : Math.min(100, Math.max(0, Math.round(progress * 100)));
  const title = `${item.title}${item.year ? ` (${item.year})` : ''}`;

  const sources = useMemo(() => cardImages(item, provider), [item, provider]);
  const [srcIndex, setSrcIndex] = useState(0);

  useEffect(() => {
    setSrcIndex(0);
  }, [item.tmdbId, item.mediaType, provider]);

  const src = srcIndex < sources.length ? sources[srcIndex] : null;

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
      {src ? (
        <img
          className="title-card-media"
          src={src}
          alt=""
          loading="lazy"
          onError={() => setSrcIndex((i) => (i + 1 < sources.length ? i + 1 : i))}
        />
      ) : (
        <div className="title-card-fallback" aria-hidden="true">
          {item.title.charAt(0).toUpperCase()}
        </div>
      )}

      {primary && (
        <div className="title-card-overlay">
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
        </div>
      )}

      {pct != null && (
        <div className="progress-track" aria-label={`${pct}% downloaded`}>
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
