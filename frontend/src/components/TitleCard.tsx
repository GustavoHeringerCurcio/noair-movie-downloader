import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownToLine, Play, Download } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { MediaItem } from '../types';
import { cardImages, posterStyleLayers } from '../api';
import { useArtPreference, useCardStyle, useImageProvider } from '../store/settingsStore';

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

/** Walk an ordered candidate list: on error advance to the next, then give up. */
function useImageChain(sources: string[], resetKey: string): { src: string | null; onError: () => void } {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setIndex(0);
    setFailed(false);
  }, [resetKey]);

  const src = !failed && index < sources.length ? sources[index] : null;
  const onError = (): void => {
    if (index + 1 < sources.length) {
      setIndex((i) => i + 1);
    } else {
      setFailed(true);
    }
  };
  return { src, onError };
}

export function TitleCard({ item, progress, primary }: TitleCardProps) {
  const navigate = useNavigate();
  const provider = useImageProvider();
  const preference = useArtPreference();
  const style = useCardStyle();
  const pct = progress == null ? null : Math.min(100, Math.max(0, Math.round(progress * 100)));
  const title = `${item.title}${item.year ? ` (${item.year})` : ''}`;
  const resetKey = `${item.tmdbId}:${item.mediaType}:${provider}:${preference.tmdb}:${preference.fanart}:${style}`;

  const isPoster = style === 'poster';

  const figureSources = useMemo(
    () => (isPoster ? posterStyleLayers(item).figure : cardImages(item, provider, preference)),
    [item, provider, preference, isPoster],
  );
  const backgroundSources = useMemo(() => (isPoster ? posterStyleLayers(item).background : []), [item, isPoster]);

  const figure = useImageChain(figureSources, resetKey);
  const background = useImageChain(backgroundSources, resetKey);

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
      className={`title-card ${isPoster ? 'title-card-poster' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${title} — open details`}
      onClick={goDetail}
      onKeyDown={handleKey}
    >
      {isPoster ? (
        <>
          {background.src ? (
            <img className="title-card-bg" src={background.src} alt="" aria-hidden="true" onError={background.onError} />
          ) : (
            <div className="title-card-bg-empty" aria-hidden="true" />
          )}
          {figure.src ? (
            <img className="title-card-figure" src={figure.src} alt="" loading="lazy" onError={figure.onError} />
          ) : (
            <div className="title-card-fallback" aria-hidden="true">
              {item.title.charAt(0).toUpperCase()}
            </div>
          )}
        </>
      ) : figure.src ? (
        <img className="title-card-media" src={figure.src} alt="" loading="lazy" onError={figure.onError} />
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
