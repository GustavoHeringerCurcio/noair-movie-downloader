import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownToLine, Play, Download } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { MediaItem, Trailer } from '../types';
import { cardImages, posterStyleLayers, trailerEmbedUrl, trailerFor } from '../api';
import { useArtPreference, useCardStyle, useImageProvider } from '../store/settingsStore';

/** How long a card must stay hovered before the trailer fetch/play starts (D18). */
const TRAILER_HOVER_DELAY_MS = 600;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export interface TitleCardPrimary {
  label: string;
  onClick: () => void;
  icon?: 'download' | 'play' | 'down';
  disabled?: boolean;
}

export interface TitleCardVariant {
  id: string;
  label: string;
  active: boolean;
}

interface TitleCardProps {
  item: MediaItem;
  progress?: number | null;
  primary?: TitleCardPrimary | null;
  /** Optional version chips shown on hover (multi-release titles in My Downloads). */
  variants?: TitleCardVariant[] | null;
  onVariantSelect?: (id: string) => void;
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

export function TitleCard({ item, progress, primary, variants, onVariantSelect }: TitleCardProps) {
  const navigate = useNavigate();
  const provider = useImageProvider();
  const preference = useArtPreference();
  const style = useCardStyle();
  const pct = progress == null ? null : Math.min(100, Math.max(0, Math.round(progress * 100)));
  const title = `${item.title}${item.year ? ` (${item.year})` : ''}`;
  const resetKey = `${item.tmdbId}:${item.mediaType}:${provider}:${preference.tmdb}:${preference.fanart}:${style}`;

  const subjectKey = `${item.mediaType}:${item.tmdbId}`;
  const [hovering, setHovering] = useState(false);
  const [trailer, setTrailer] = useState<Trailer | null>(null);
  const [trailerResolved, setTrailerResolved] = useState(false);

  // D18 hover-trailer: debounced fetch on a sustained hover; art stays put until
  // playback begins; a "no trailer" answer is remembered so the card stays static.
  useEffect(() => {
    setTrailer(null);
    setTrailerResolved(false);
  }, [subjectKey]);

  useEffect(() => {
    if (!hovering || trailerResolved || prefersReducedMotion()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void trailerFor({ tmdbId: item.tmdbId, mediaType: item.mediaType }).then((tr) => {
        if (cancelled) return;
        setTrailer(tr);
        setTrailerResolved(true);
      });
    }, TRAILER_HOVER_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hovering, trailerResolved, item.tmdbId, item.mediaType]);

  const showTrailer = hovering && trailerResolved && trailer !== null;

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
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
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
          {variants && variants.length > 0 && (
            <div className="tc-variants">
              {variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`tc-version-chip ${v.active ? 'active' : ''}`}
                  title={v.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    onVariantSelect?.(v.id);
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {showTrailer && trailer && (
        <iframe
          className="title-card-trailer"
          src={trailerEmbedUrl(trailer)}
          title={`${title} trailer preview`}
          aria-hidden="true"
          tabIndex={-1}
          allow="autoplay; encrypted-media; picture-in-picture"
        />
      )}

      {pct != null && (
        <div className="progress-track" aria-label={`${pct}% downloaded`}>
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
