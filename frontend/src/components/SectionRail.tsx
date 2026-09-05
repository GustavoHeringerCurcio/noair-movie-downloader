import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';

interface SectionRailProps {
  title: string;
  subtitle?: string;
  count: number;
  loading?: boolean;
  error?: string | null;
  emptyHint?: string;
  emptyContent?: ReactNode;
  onRetry?: () => void;
  children: ReactNode;
}

export function SectionRail({
  title,
  subtitle,
  count,
  loading,
  error,
  emptyHint,
  emptyContent,
  onRetry,
  children,
}: SectionRailProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const measure = useCallback((): void => {
    const el = scrollerRef.current;
    if (!el) return;
    const canRightNow = el.scrollWidth - el.scrollLeft - el.clientWidth > 8;
    const canLeftNow = el.scrollLeft > 8;
    setCanLeft(canLeftNow);
    setCanRight(canRightNow);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    measure();
    let raf = 0;
    const onScroll = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const ResizeObserverCtor =
      typeof window !== 'undefined' && typeof window.ResizeObserver !== 'undefined'
        ? window.ResizeObserver
        : null;
    if (ResizeObserverCtor) {
      const ro = new ResizeObserverCtor(() => measure());
      ro.observe(el);
      return () => {
        el.removeEventListener('scroll', onScroll);
        cancelAnimationFrame(raf);
        ro.disconnect();
      };
    }
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [measure, count, loading]);

  useEffect(() => {
    measure();
  }, [count, loading, measure]);

  function scrollBy(direction: -1 | 1): void {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.85, 300), behavior: 'smooth' });
  }

  const showContent = count > 0 && !error && !loading;

  return (
    <section className="rail">
      <div className="rail-head">
        <div className="rail-title-wrap">
          <h2 className="rail-title">{title}</h2>
          {subtitle && <span className="rail-subtitle">{subtitle}</span>}
        </div>
      </div>

      {error ? (
        <div className="rail-error" role="alert">
          <span>{error}</span>
          {onRetry && (
            <button type="button" className="btn btn-sm btn-outline" onClick={onRetry}>
              <RotateCw size={14} /> Retry
            </button>
          )}
        </div>
      ) : loading ? (
        <div className="rail-body">
          <div className="rail-scroller" ref={scrollerRef} aria-hidden="true">
            <div className="rail-scroll">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="title-card skeleton" />
              ))}
            </div>
          </div>
        </div>
      ) : showContent ? (
        <div className="rail-body">
          <div className="rail-scroller" ref={scrollerRef}>
            <div className="rail-scroll">{children}</div>
          </div>
          {canLeft && (
            <button
              type="button"
              className="rail-arrow left"
              aria-label={`Scroll ${title} left`}
              onClick={() => scrollBy(-1)}
            >
              <ChevronLeft size={40} />
            </button>
          )}
          {canRight && (
            <button
              type="button"
              className="rail-arrow right"
              aria-label={`Scroll ${title} right`}
              onClick={() => scrollBy(1)}
            >
              <ChevronRight size={40} />
            </button>
          )}
        </div>
      ) : emptyContent ? (
        <div className="rail-empty-rich">{emptyContent}</div>
      ) : (
        <div className="rail-empty">{emptyHint ?? 'Nothing here yet.'}</div>
      )}
    </section>
  );
}
