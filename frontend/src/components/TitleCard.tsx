import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowDownToLine, Play, Plus, Download, ChevronDown, Volume2, VolumeX, ThumbsUp } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { HoverCardInfo, MediaItem } from '../types';
import { cardPosterUrl, hoverCardFor, trailerEmbedUrl } from '../api';
import { durationLabel, hoverTags, seasonCountLabel } from '../lib/hoverCard';
import { RatingBadge } from './RatingBadge';

/** How long a card must stay hovered before the expanded card (D20) opens (D18). */
const TRAILER_HOVER_DELAY_MS = 600;
/** Hover-card width = 1.7× the base card (Netflix-style scale). */
const POP_SCALE = 1.7;
/** Small close grace so the pointer can move from the card onto the pop-up. */
const POP_CLOSE_GRACE_MS = 200;
/**
 * How many times a card retries its poster before showing the monogram. The
 * image route warms a title on first request (TMDB→IMDb→OMDb→download), which
 * can take longer than an <img> fetch failure budget on a cold cache — so the
 * card retries a few times with a pause instead of giving up instantly.
 */
const POSTER_RETRIES = 4;
const POSTER_RETRY_DELAY_MS = 1500;

/**
 * Global single-player guarantee: at most one expanded preview may stream at a
 * time. Each expanded card registers its own collapse here; when any other card
 * expands it evicts the previous one first, so two trailers (and their audio)
 * can never overlap — even if a stale hover state survives an alt-tab.
 */
let activePreviewClose: (() => void) | null = null;

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

/**
 * Load the OMDb-backed poster for a subject, retrying a few times before giving
 * up (the backend image route warms a title on first request). Each retry is a
 * keyed remount so the browser re-issues the fetch. When the poster finally
 * exists the same URL is used for both the blurred ground and the crisp figure,
 * so a single successful fetch resolves the whole tile.
 */
function usePosterArt(src: string, resetKey: string): { src: string | null; onError: () => void; reloadKey: string } {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [resetKey]);

  useEffect(() => {
    if (!failed || attempt >= POSTER_RETRIES) return;
    const timer = window.setTimeout(() => {
      setAttempt((a) => a + 1);
      setFailed(false);
    }, POSTER_RETRY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [failed, attempt, resetKey]);

  const givenUp = failed && attempt >= POSTER_RETRIES;
  return {
    src: givenUp ? null : src,
    onError: () => setFailed(true),
    reloadKey: `${resetKey}:${attempt}`,
  };
}

export function TitleCard({ item, progress, primary, variants, onVariantSelect }: TitleCardProps) {
  const navigate = useNavigate();
  const pct = progress == null ? null : Math.min(100, Math.max(0, Math.round(progress * 100)));
  const title = `${item.title}${item.year ? ` (${item.year})` : ''}`;
  const resetKey = `${item.tmdbId}:${item.mediaType}`;
  const subjectKey = `${item.mediaType}:${item.tmdbId}`;

  const cardRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const [hovering, setHovering] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [info, setInfo] = useState<HoverCardInfo | null>(null);
  const [geometry, setGeometry] = useState<PopGeometry | null>(null);
  const [soundOn, setSoundOn] = useState(true);

  const leavingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const collapseRef = useRef<() => void>(() => {});
  const releaseRef = useRef<(() => void) | null>(null);

  // Full state reset when the subject changes (moving to a different card).
  useEffect(() => {
    setHovering(false);
    setExpanded(false);
    setInfo(null);
    setGeometry(null);
    setSoundOn(true);
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

  const poster = usePosterArt(cardPosterUrl(item.mediaType, item.tmdbId), resetKey);
  const posterSrc = poster.src;

  // Artwork for the pop-up's media half while there is no trailer (or none at all).
  const popArtUrl = posterSrc;

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

  /** Drop the preview immediately: stop the trailer and clear any pending close. */
  function collapse(): void {
    leavingRef.current = false;
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setHovering(false);
    setExpanded(false);
  }
  collapseRef.current = collapse;

  // Alt-tab, background the tab, or otherwise lose the window while a preview is
  // open (or its hover is pending): collapse it right away so the trailer can't
  // keep streaming audio into the background. Coming back to the page therefore
  // never finds a zombie preview still playing under the next hover.
  useEffect(() => {
    if (!hovering && !expanded) return;
    const suspend = (): void => collapseRef.current();
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') suspend();
    };
    window.addEventListener('blur', suspend);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', suspend);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [hovering, expanded, subjectKey]);

  // Enforce the global single-player guarantee above: when this card expands it
  // evicts any other expanded card first, and unmounting/contracting releases
  // the slot only if we still own it (so a newer owner is never cleared).
  useEffect(() => {
    if (!expanded) {
      const release = releaseRef.current;
      if (release) {
        if (activePreviewClose === release) activePreviewClose = null;
        releaseRef.current = null;
      }
      return;
    }
    const release = (): void => collapseRef.current();
    if (activePreviewClose) activePreviewClose();
    activePreviewClose = release;
    releaseRef.current = release;
    return () => {
      if (activePreviewClose === release) activePreviewClose = null;
      if (releaseRef.current === release) releaseRef.current = null;
    };
  }, [expanded, subjectKey]);

  const metaLabel =
    item.mediaType === 'tv' ? seasonCountLabel(info?.seasons ?? null) : durationLabel(info?.runtime ?? null);
  const tags = hoverTags(info?.genres ?? []);

  return (
    <>
      <div
        ref={cardRef}
        className={`title-card title-card-poster ${expanded ? 'tc-pop-open' : ''}`}
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
        {posterSrc ? (
          <img
            key={`${poster.reloadKey}:bg`}
            className="title-card-bg"
            src={posterSrc}
            alt=""
            aria-hidden="true"
            onError={poster.onError}
          />
        ) : (
          <div className="title-card-bg-empty" aria-hidden="true" />
        )}
        {posterSrc ? (
          <img key={`${poster.reloadKey}:fg`} className="title-card-figure" src={posterSrc} alt="" loading="lazy" onError={poster.onError} />
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
                <img key={`${poster.reloadKey}:pop`} className="tc-pop-art" src={popArtUrl} alt="" loading="lazy" onError={poster.onError} />
              ) : (
                <div className="tc-pop-fallback" aria-hidden="true">
                  {item.title.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="tc-pop-scrim" aria-hidden="true" />
              <div className="tc-pop-title">
                <span className="tc-pop-title-text">{item.title}</span>
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
                  <button
                    type="button"
                    className="tc-pop-btn tc-pop-btn-secondary"
                    aria-label="Add to list"
                    title="My List — coming soon"
                  >
                    <Plus size={20} strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    className="tc-pop-btn tc-pop-btn-secondary"
                    aria-label="Rate"
                    title="Rate — coming soon"
                  >
                    <ThumbsUp size={16} strokeWidth={2} />
                  </button>
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

              {(info?.imdbRating != null || info?.certification || metaLabel) && (
                <div className="tc-pop-meta">
                  <RatingBadge value={info?.imdbRating ?? null} />
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
