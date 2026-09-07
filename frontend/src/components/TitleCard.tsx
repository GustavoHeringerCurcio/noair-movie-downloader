import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowDownToLine, Play, Plus, Download, ChevronDown, Volume2, VolumeX, ThumbsUp } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { HoverCardInfo, MediaItem } from '../types';
import { backdropUrl, fanartThumbUrl, hoverCardFor, logoUrl, posterUrl, trailerEmbedUrl, trailerStillUrl } from '../api';
import { durationLabel, hoverTags, seasonCountLabel } from '../lib/hoverCard';
import { RatingBadge } from './RatingBadge';
import { usePosterStyleStore } from '../store/posterStyleStore';
import { usePosterImdbStore } from '../store/posterImdbStore';

/** How long a card must stay hovered before the expanded card (D20) opens (D18). */
const TRAILER_HOVER_DELAY_MS = 320;
/** Hover-time before the payload prefetch starts. Kept well under the expand
    delay so the pop-up opens with its trailer/backdrop already resolved, but
    long enough that accidental fast sweeps across a row cost no requests. */
const PREFETCH_HOVER_DELAY_MS = 150;
/** If the embed never reports ready (blocked, ad-heavy, or slow), reveal it
    anyway after this grace period so the pop-up can't sit on a static still. */
const TRAILER_REVEAL_FALLBACK_MS = 3000;
/** Hover-card width vs the base card (Netflix-style scale). Vertical 2:3
    posters keep 1.7×; horizontal key-art cards get 1.8× so their pop-up stays
    clearly wide next to the portrait vertical one. */
const POP_SCALE = 1.7;
const POP_SCALE_HORIZ = 1.8;
/** Small close grace so the pointer can move from the card onto the pop-up. */
const POP_CLOSE_GRACE_MS = 200;
/**
 * Art-image retry budget. The image routes warm a title on first request
 * (fanart.tv fetch / download, TMDB logo lookup, …) which can take longer than
 * an <img> fetch-failure budget on a cold cache — so each art tier retries a
 * couple of times with a short pause before the card commits to its fallback.
 * Kept short so genuinely art-less titles reach their fallback fast.
 */
const ART_RETRIES = 2;
const ART_RETRY_DELAY_MS = 800;

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

/**
 * One lazily-loading art layer with a bounded retry budget. While `visible` an
 * <img> should be in the DOM (it requests the route and paints when loaded);
 * `loaded` flips on a successful load, `givenUp` means the tier is definitively
 * absent (no source, or retries exhausted) and the card may commit to the next
 * fallback. A failed attempt unmounts the image right away so the fallback
 * beneath never sits behind a broken icon.
 */
interface ArtImage {
  src: string | null;
  visible: boolean;
  loaded: boolean;
  givenUp: boolean;
  reloadKey: string;
  onLoad: () => void;
  onError: () => void;
}

function useArtImage(src: string | null, resetKey: string, retries: number, retryDelayMs: number): ArtImage {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
    setLoaded(false);
  }, [resetKey, src]);

  useEffect(() => {
    if (!src || !failed || attempt >= retries) return;
    const timer = window.setTimeout(() => {
      setAttempt((a) => a + 1);
      setFailed(false);
      setLoaded(false);
    }, retryDelayMs);
    return () => window.clearTimeout(timer);
  }, [src, failed, attempt, retries, retryDelayMs, resetKey]);

  if (src == null) {
    return { src: null, visible: false, loaded: false, givenUp: true, reloadKey: resetKey, onLoad: () => {}, onError: () => {} };
  }
  const givenUp = failed && attempt >= retries;
  return {
    src,
    visible: !failed && !givenUp,
    loaded,
    givenUp,
    reloadKey: `${resetKey}:${attempt}`,
    onLoad: () => setLoaded(true),
    onError: () => setFailed(true),
  };
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

export function TitleCard({ item, progress, primary, variants, onVariantSelect }: TitleCardProps) {
  const navigate = useNavigate();
  const pct = progress == null ? null : Math.min(100, Math.max(0, Math.round(progress * 100)));
  const title = `${item.title}${item.year ? ` (${item.year})` : ''}`;
  const resetKey = `${item.tmdbId}:${item.mediaType}`;
  const subjectKey = `${item.mediaType}:${item.tmdbId}`;
  const vertical = usePosterStyleStore((s) => s.style === 'vertical');
  const showImdbBadge = usePosterImdbStore((s) => s.show);

  const cardRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const [hovering, setHovering] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [info, setInfo] = useState<HoverCardInfo | null>(null);
  const [geometry, setGeometry] = useState<PopGeometry | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [trailerReady, setTrailerReady] = useState(false);

  const leavingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const expandTimerRef = useRef<number | null>(null);
  const prefetchTimerRef = useRef<number | null>(null);
  const fetchIdRef = useRef(0);
  const collapseRef = useRef<() => void>(() => {});
  const releaseRef = useRef<(() => void) | null>(null);

  // Full state reset when the subject changes (moving to a different card).
  useEffect(() => {
    setHovering(false);
    setExpanded(false);
    setInfo(null);
    setGeometry(null);
    setSoundOn(true);
    setTrailerReady(false);
  }, [subjectKey]);

  const reduceMotion = prefersReducedMotion();
  const canHover = item.tmdbId > 0;

  // Sustained hover opens the expanded card for every resolvable title. Users
  // who prefer reduced motion still get the full info pop-up — the trailer is
  // simply never autoplayed (a static first-frame stands in below), so nothing
  // on screen moves on its own.
  useEffect(() => {
    if (!hovering || !canHover) {
      setExpanded(false);
      return;
    }
    if (expandTimerRef.current != null) {
      window.clearTimeout(expandTimerRef.current);
    }
    expandTimerRef.current = window.setTimeout(() => {
      expandTimerRef.current = null;
      // Each fresh open re-hides the iframe (so the artwork crossfades in again
      // instead of showing a buffering embed at full opacity) and restarts with
      // sound on.
      setSoundOn(true);
      setTrailerReady(false);
      setExpanded(true);
    }, TRAILER_HOVER_DELAY_MS);
    return () => {
      if (expandTimerRef.current != null) {
        window.clearTimeout(expandTimerRef.current);
        expandTimerRef.current = null;
      }
    };
  }, [hovering, canHover, subjectKey]);

  // Resolve the hover payload a beat after a hover begins — before the expand
  // delay above ends — so the pop-up opens with its trailer/backdrop already
  // resolved and the rise feels instant. Too-short sweeps (under the prefetch
  // wait) never fire a request. A failure (null) keeps the card static: the
  // pop-up must never depend on an unreachable backend. `fetchIdRef` lets a
  // stale in-flight response be dropped if the user moves on mid-flight.
  useEffect(() => {
    fetchIdRef.current += 1;
    const id = fetchIdRef.current;
    if (!canHover || !hovering) {
      setInfo(null);
      return;
    }
    if (prefetchTimerRef.current != null) {
      window.clearTimeout(prefetchTimerRef.current);
    }
    prefetchTimerRef.current = window.setTimeout(() => {
      prefetchTimerRef.current = null;
      void hoverCardFor({ tmdbId: item.tmdbId, mediaType: item.mediaType }).then((res) => {
        if (id !== fetchIdRef.current) return;
        if (!res) {
          // Learned before the pop-up opened that the backend can't answer —
          // cancel the pending expansion instead of opening an empty card.
          if (expandTimerRef.current != null) {
            window.clearTimeout(expandTimerRef.current);
            expandTimerRef.current = null;
          }
          setExpanded(false);
          return;
        }
        setInfo(res);
      });
    }, PREFETCH_HOVER_DELAY_MS);
    return () => {
      if (prefetchTimerRef.current != null) {
        window.clearTimeout(prefetchTimerRef.current);
        prefetchTimerRef.current = null;
      }
    };
  }, [canHover, hovering, item.tmdbId, item.mediaType]);

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
  // then size the pop-up to it: centered horizontally, wider than the card. This
  // first pass uses a provisional top; the layout effect below re-centers it
  // vertically so the card grows equally above and below the hovered cell. A
  // 2:3 (vertical) base card is narrower, so its pop-up keeps a wider minimum
  // and a smaller scale than the 16:9 card — the details column must never feel
  // cramped, and horizontal pop-ups stay comfortably wide (1.8×).
  useEffect(() => {
    if (!expanded) {
      setGeometry(null);
      return;
    }
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const scale = vertical ? POP_SCALE : POP_SCALE_HORIZ;
    const minW = vertical ? 248 : 220;
    const width = Math.min(Math.max(minW, Math.round(rect.width * scale)), vw - 24);
    const mediaHeight = Math.round((width * 9) / 16);
    const maxLeft = Math.max(12, vw - width - 12);
    const left = Math.min(Math.max(12, Math.round(rect.left + rect.width / 2 - width / 2)), maxLeft);
    setGeometry((prev) =>
      prev && prev.width === width && prev.left === left && prev.mediaHeight === mediaHeight
        ? prev
        : { left, top: Math.max(72, Math.round(rect.top)), width, mediaHeight },
    );
  }, [expanded, subjectKey, vertical]);

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

  const hasTrailer = info?.trailer != null;
  // Reduced-motion users never get an autoplaying <iframe>; a static YouTube
  // first-frame stands in so the pop-up stays motion-free but informative.
  const showTrailer = hasTrailer && !reduceMotion;
  // YouTube's first-frame is also the cheapest "loading poster": it sits under
  // the autoplaying embed so the band is never black while YouTube buffers.
  const trailerFrame = trailerStillUrl(info?.trailer ?? null);
  const trailerStill = reduceMotion ? trailerFrame : null;

  // Reveal the iframe after a grace period even if its onLoad never fires.
  useEffect(() => {
    if (!expanded || !hasTrailer || trailerReady) return;
    const timer = window.setTimeout(() => setTrailerReady(true), TRAILER_REVEAL_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [expanded, hasTrailer, trailerReady, subjectKey]);

  // ------------------------------------------------------------------------
  // Artwork (T-002). Default = vertical 2:3 poster: raw TMDB poster over the
  // typography mark. Horizontal (opt-in) = the 16:9 poster look: fanart.tv
  // key-art thumb (the "real horizontal poster"), falling back to TMDB
  // backdrop with the transparent studio logo overlaid, else typography.
  // ------------------------------------------------------------------------
  const fanart = useArtImage(
    vertical ? null : fanartThumbUrl(item.mediaType, item.tmdbId),
    resetKey,
    ART_RETRIES,
    ART_RETRY_DELAY_MS,
  );
  const backdrop = useArtImage(
    vertical ? null : backdropUrl(item.backdropPath),
    resetKey,
    ART_RETRIES,
    ART_RETRY_DELAY_MS,
  );
  const logo = useArtImage(
    vertical ? null : logoUrl(item.mediaType, item.tmdbId),
    resetKey,
    ART_RETRIES,
    ART_RETRY_DELAY_MS,
  );
  const poster = useArtImage(
    vertical && item.posterPath ? posterUrl(item.posterPath, 'w780') : null,
    resetKey,
    ART_RETRIES,
    ART_RETRY_DELAY_MS,
  );

  // The transparent logo overlay is requested only once the backdrop is
  // actually showing (fanart gave up); until it loads (or if it never does) the
  // mark's strong typography carries the card over the backdrop.
  const logoActive = !vertical && fanart.givenUp && backdrop.loaded && logo.visible && logo.src != null;
  const showLogoOverlay = logoActive && logo.loaded;
  const noArt = vertical ? poster.givenUp : fanart.givenUp && backdrop.givenUp;
  const posterOrientedStill = vertical;

  // Artwork for the pop-up's media half while there is no trailer (or none at
  // all): wide art first (backdrop for a true Netflix still, else the loaded
  // key-art), the vertical poster only as the last resort (it is portrait).
  const popArtSrc = vertical
    ? poster.loaded
      ? poster.src
      : null
    : backdrop.loaded
      ? backdrop.src
      : fanart.loaded
        ? fanart.src
        : null;

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
  const initial = item.title.charAt(0).toUpperCase();

  const artModeClass = vertical ? 'title-card-vert' : 'title-card-horiz';
  const artStateClass = showLogoOverlay ? 'tc-logo-on' : noArt ? 'tc-noart' : '';

  // IMDb badge on the poster (bottom-left): shows the cached score the listing
  // carries, but only while the user hasn't turned it off and the backend
  // actually knows a score — unknown titles never get an empty pill.
  const imdbRating = item.imdbRating ?? null;
  const imdbBadge =
    showImdbBadge && imdbRating != null && Number.isFinite(imdbRating) && imdbRating > 0
      ? imdbRating.toFixed(1)
      : null;

  return (
    <>
      <div
        ref={cardRef}
        className={`title-card ${artModeClass} ${expanded ? 'tc-pop-open' : ''} ${artStateClass}`.trim()}
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
        {/* T-002 art stack. The typographic mark is the base layer; each art
            tier paints over it as it resolves, so the card always reads as a
            poster and never as a bare empty box. */}
        {!vertical && fanart.visible && fanart.src && (
          <img
            key={`fanart:${fanart.reloadKey}`}
            className="title-card-art tc-art-main"
            src={fanart.src}
            alt=""
            aria-hidden="true"
            onLoad={fanart.onLoad}
            onError={fanart.onError}
          />
        )}
        {!vertical && fanart.givenUp && backdrop.visible && backdrop.src && (
          <img
            key={`backdrop:${backdrop.reloadKey}`}
            className="title-card-art tc-art-backdrop"
            src={backdrop.src}
            alt=""
            aria-hidden="true"
            loading="lazy"
            onLoad={backdrop.onLoad}
            onError={backdrop.onError}
          />
        )}
        {logoActive && logo.src && (
          <img
            key={`logo:${logo.reloadKey}`}
            className="tc-logo"
            src={logo.src}
            alt=""
            aria-hidden="true"
            onLoad={logo.onLoad}
            onError={logo.onError}
          />
        )}
        {vertical && poster.visible && poster.src && (
          <img
            key={`poster:${poster.reloadKey}`}
            className="title-card-art tc-art-poster"
            src={poster.src}
            alt=""
            aria-hidden="true"
            onLoad={poster.onLoad}
            onError={poster.onError}
          />
        )}

        {/* Typography mark — the strong-title treatment that keeps any card
            without resolved art looking like an intentional poster. */}
        <div className="title-card-mark" aria-hidden="true">
          <span className="tc-mark-letter">{initial}</span>
          <span className="tc-mark-title">{item.title}</span>
          {item.year != null && <span className="tc-mark-year">{item.year}</span>}
        </div>

        {/* IMDb score badge (bottom-left over the poster art). */}
        {imdbBadge != null && (
          <span className="tc-imdb" aria-label={`IMDb rating ${imdbBadge}`}>
            <span className="tc-imdb-mark" aria-hidden="true">
              IMDb
            </span>
            <span className="tc-imdb-value">{imdbBadge}</span>
          </span>
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
            className={`tc-pop ${vertical ? 'tc-pop-vert' : 'tc-pop-horiz'}`}
            style={{ left: geometry.left, top: geometry.top, width: geometry.width }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className="tc-pop-media" style={{ height: geometry.mediaHeight }} onClick={playAction}>
              {/* Base layer: always paints so the band is never blank/black while
                  the embed buffers — the artwork "hides" the load and the video
                  crossfades in on top once its onLoad fires. In reduced motion
                  (or no trailer) this layer IS the pop-up's media. */}
              {showTrailer && popArtSrc ? (
                <img
                  key={`popstill:${popArtSrc}`}
                  className={`tc-pop-art ${posterOrientedStill ? 'tc-pop-art-poster' : ''}`}
                  src={popArtSrc}
                  alt=""
                  loading="lazy"
                />
              ) : trailerStill ? (
                <img
                  key={`trailerstill:${trailerStill}`}
                  className="tc-pop-art"
                  src={trailerStill}
                  alt=""
                  loading="lazy"
                />
              ) : showTrailer && trailerFrame ? (
                <img
                  key={`trailerframe:${trailerFrame}`}
                  className="tc-pop-art"
                  src={trailerFrame}
                  alt=""
                  loading="lazy"
                />
              ) : popArtSrc ? (
                <img
                  key={`popstill:${popArtSrc}`}
                  className={`tc-pop-art ${posterOrientedStill ? 'tc-pop-art-poster' : ''}`}
                  src={popArtSrc}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="tc-pop-fallback" aria-hidden="true">
                  {initial}
                </div>
              )}

              {showTrailer && info?.trailer && (
                <iframe
                  key={`${info.trailer.videoId}:${soundOn ? 'on' : 'muted'}`}
                  className={`tc-pop-video ${trailerReady ? 'is-ready' : ''}`}
                  src={trailerEmbedUrl(info.trailer, { muted: !soundOn })}
                  title={`${item.title} trailer preview`}
                  tabIndex={-1}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  onLoad={() => setTrailerReady(true)}
                />
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
