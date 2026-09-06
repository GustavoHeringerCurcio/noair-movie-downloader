import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowDownToLine, Play, Download, ChevronDown, Volume2, VolumeX } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { HoverCardInfo, MediaItem } from '../types';
import { cardImages, hoverCardFor, posterStyleLayers, trailerEmbedUrl } from '../api';
import { durationLabel, hoverTags, seasonCountLabel } from '../lib/hoverCard';
import { useArtPreference, useCardStyle, useImageProvider } from '../store/settingsStore';

/** How long a card must stay hovered before the expanded card (D20) opens (D18). */
const TRAILER_HOVER_DELAY_MS = 600;
/** Hover-card width = 1.7× the base card (Netflix-style scale). */
const POP_SCALE = 1.7;
/** Small close grace so the pointer can move from the card onto the pop-up. */
const POP_CLOSE_GRACE_MS = 200;

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

interface PopGeometry {
  left: number;
  top: number;
  width: number;
  mediaHeight: number;
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
  const isPoster = style === 'poster';

  const cardRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const [hovering, setHovering] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [info, setInfo] = useState<HoverCardInfo | null>(null);
  const [geometry, setGeometry] = useState<PopGeometry | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [logoFailed, setLogoFailed] = useState(false);

  const leavingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);

  // Full state reset when the subject changes (moving to a different card).
  useEffect(() => {
    setHovering(false);
    setExpanded(false);
    setInfo(null);
    setGeometry(null);
    setSoundOn(true);
    setLogoFailed(false);
  }, [subjectKey]);

  const canHover = item.tmdbId > 0 && !prefersReducedMotion();

  // D18/D20: sustained hover opens the expanded card (no pop for reduced motion
  // or titles without a resolvable TMDB id — e.g. manual torrent downloads).
  useEffect(() => {
    if (!hovering || !canHover) {
      setExpanded(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setExpanded(true);
    }, TRAILER_HOVER_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [hovering, canHover, subjectKey]);

  // Resolve the hover payload once the card expands. A failure (null) keeps the
  // card static — the pop-up must never depend on an unreachable backend.
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setLogoFailed(false);
    setSoundOn(true);
    setInfo(null);
    void hoverCardFor({ tmdbId: item.tmdbId, mediaType: item.mediaType }).then((res) => {
      if (cancelled) return;
      if (!res) {
        setExpanded(false);
        return;
      }
      setInfo(res);
    });
    return () => {
      cancelled = true;
    };
  }, [expanded, item.tmdbId, item.mediaType]);

  // Any scroll/resize while a pop-up is open would leave it floating over the
  // wrong cell — close it (Netflix also dismisses previews on scroll).
  useEffect(() => {
    if (!expanded) return;
    const close = (): void => setExpanded(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [expanded]);

  // Measure the base card AFTER the expanded class has removed its hover scale,
  // then size the pop-up to it: 1.7× wide, centered horizontally. This first pass
  // uses a provisional top; the layout effect below re-centers it vertically so
  // the card grows equally above and below the hovered cell (Netflix overlap).
  useEffect(() => {
    if (!expanded) {
      setGeometry(null);
      return;
    }
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const width = Math.max(200, Math.min(Math.round(rect.width * POP_SCALE), vw - 24));
    const mediaHeight = Math.round((width * 9) / 16);
    const maxLeft = Math.max(12, vw - width - 12);
    const left = Math.min(Math.max(12, Math.round(rect.left + rect.width / 2 - width / 2)), maxLeft);
    setGeometry((prev) =>
      prev && prev.width === width && prev.left === left && prev.mediaHeight === mediaHeight
        ? prev
        : { left, top: Math.max(72, Math.round(rect.top)), width, mediaHeight },
    );
  }, [expanded, subjectKey]);

  // Balance the pop-up vertically once its real height is known (the details
  // column is content-sized). Runs before paint so the card never jumps; re-runs
  // when the hover payload lands and the details grow. Clamped so the pop-up
  // stays below the header and, when possible, fully inside the viewport.
  useLayoutEffect(() => {
    if (!expanded || !geometry) return;
    const card = cardRef.current;
    const pop = popRef.current;
    if (!card || !pop) return;
    const height = pop.offsetHeight;
    if (height <= 0) return;
    const cardRect = card.getBoundingClientRect();
    const navH = 72;
    const vh = window.innerHeight;
    const centerY = cardRect.top + cardRect.height / 2;
    let top = Math.round(centerY - height / 2);
    const maxTop = vh - height - 8;
    if (top > maxTop) top = maxTop;
    if (top < navH) top = navH;
    if (Math.abs(top - geometry.top) > 1) {
      setGeometry((g) => (g && Math.abs(top - g.top) > 1 ? { ...g, top } : g));
    }
  }, [geometry, expanded, info]);

  const showTrailer = info?.trailer != null;

  const figureSources = useMemo(
    () => (isPoster ? posterStyleLayers(item).figure : cardImages(item, provider, preference)),
    [item, provider, preference, isPoster],
  );
  const backgroundSources = useMemo(() => (isPoster ? posterStyleLayers(item).background : []), [item, isPoster]);

  const figure = useImageChain(figureSources, resetKey);
  const background = useImageChain(backgroundSources, resetKey);

  // Artwork for the pop-up's media half while there is no trailer (or none at all).
  const popArtUrl = isPoster ? background.src ?? figure.src : figure.src;

  function goDetail(): void {
    navigate(openDetail(item));
  }

  function playAction(): void {
    if (primary && primary.icon === 'play' && !primary.disabled) {
      primary.onClick();
      return;
    }
    goDetail();
  }

  function handleKey(e: ReactKeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goDetail();
    }
  }

  /** True when the pointer (from a leave event) is still over the card/pop-up. */
  function pointInside(el: HTMLElement | null, x: number, y: number): boolean {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function scheduleClose(e: ReactMouseEvent<HTMLDivElement>): void {
    // The base card snaps back to 1:1 when the pop-up opens (no hover scale), so a
    // pointer near the card edge can trigger a spurious mouse-leave while it is
    // still over the pop-up. If the pointer is still inside the card or the pop-up,
    // don't close.
    if (pointInside(cardRef.current, e.clientX, e.clientY) || pointInside(popRef.current, e.clientX, e.clientY)) {
      return;
    }
    leavingRef.current = true;
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      if (leavingRef.current) setHovering(false);
    }, POP_CLOSE_GRACE_MS);
  }

  function cancelClose(): void {
    leavingRef.current = false;
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  const metaLabel =
    item.mediaType === 'tv' ? seasonCountLabel(info?.seasons ?? null) : durationLabel(info?.runtime ?? null);
  const tags = hoverTags(info?.genres ?? []);
  const logoUrl = item.art?.logoUrl ?? null;

  return (
    <>
      <div
        ref={cardRef}
        className={`title-card ${isPoster ? 'title-card-poster' : ''} ${expanded ? 'tc-pop-open' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={`${title} — open details`}
        onClick={goDetail}
        onKeyDown={handleKey}
        onMouseEnter={() => {
          cancelClose();
          setHovering(true);
        }}
        onMouseLeave={scheduleClose}
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

        {!expanded && primary && (
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

        {pct != null && (
          <div className="progress-track" aria-label={`${pct}% downloaded`}>
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      {expanded && geometry && (
        createPortal(
          <div
            ref={popRef}
            className="tc-pop"
            style={{ left: geometry.left, top: geometry.top, width: geometry.width }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className="tc-pop-media" style={{ height: geometry.mediaHeight }} onClick={playAction}>
              {showTrailer && info?.trailer ? (
                <iframe
                  key={`${info.trailer.videoId}:${soundOn ? 'on' : 'muted'}`}
                  className="tc-pop-video"
                  src={trailerEmbedUrl(info.trailer, { muted: !soundOn })}
                  title={`${item.title} trailer preview`}
                  tabIndex={-1}
                  allow="autoplay; encrypted-media; picture-in-picture"
                />
              ) : popArtUrl ? (
                <img className="tc-pop-art" src={popArtUrl} alt="" loading="lazy" onError={figure.onError} />
              ) : (
                <div className="tc-pop-fallback" aria-hidden="true">
                  {item.title.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="tc-pop-scrim" aria-hidden="true" />
              <div className="tc-pop-title">
                {logoUrl && !logoFailed ? (
                  <img
                    className="tc-pop-logo"
                    src={logoUrl}
                    alt=""
                    onError={() => setLogoFailed(true)}
                  />
                ) : (
                  <span className="tc-pop-title-text">{item.title}</span>
                )}
              </div>
              {showTrailer && (
                <button
                  type="button"
                  className="tc-pop-sound"
                  aria-label={soundOn ? 'Mute preview' : 'Unmute preview'}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSoundOn((s) => !s);
                  }}
                >
                  {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
                </button>
              )}
            </div>

            <div className="tc-pop-details">
              <div className="tc-pop-actions">
                <div className="tc-pop-actions-l">
                  <button
                    type="button"
                    className="tc-pop-btn tc-pop-btn-play"
                    aria-label="Play"
                    onClick={playAction}
                  >
                    <Play size={20} fill="currentColor" />
                  </button>
                  {variants && variants.length > 0 && (
                    <div className="tc-pop-variants">
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
                <div className="tc-pop-actions-r">
                  <button
                    type="button"
                    className="tc-pop-btn tc-pop-btn-more"
                    aria-label="More info"
                    onClick={(e) => {
                      e.stopPropagation();
                      goDetail();
                    }}
                  >
                    <ChevronDown size={18} />
                  </button>
                </div>
              </div>

              {(info?.certification || metaLabel) && (
                <div className="tc-pop-meta">
                  {info?.certification && <span className="tc-pop-cert">{info.certification}</span>}
                  {metaLabel && <span className="tc-pop-meta-text">{metaLabel}</span>}
                  <span className="tc-pop-hd">HD</span>
                </div>
              )}

              {tags.length > 0 && (
                <div className="tc-pop-tags">
                  {tags.map((tag, i) => (
                    <span key={tag} className="tc-pop-tag">
                      {i > 0 && (
                        <span className="tc-pop-tag-sep" aria-hidden="true">
                          •
                        </span>
                      )}
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )
      )}
    </>
  );
}
