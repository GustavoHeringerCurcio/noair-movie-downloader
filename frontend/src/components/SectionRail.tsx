import { useRef, type ReactNode } from 'react';

const SCROLL_STEP = 700;

interface SectionRailProps {
  title: string;
  subtitle?: string;
  count: number;
  loading?: boolean;
  emptyHint?: string;
  error?: string | null;
  children: ReactNode;
}

export function SectionRail({ title, subtitle, count, loading, emptyHint, error, children }: SectionRailProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  function scrollBy(direction: -1 | 1): void {
    scrollerRef.current?.scrollBy({ left: direction * SCROLL_STEP, behavior: 'smooth' });
  }

  return (
    <section className="rail">
      <div className="rail-head">
        <div className="rail-title-wrap">
          <h2 className="rail-title">{title}</h2>
          {subtitle && <span className="rail-subtitle">{subtitle}</span>}
        </div>
        <div className="rail-controls">
          <button
            type="button"
            className="rail-arrow"
            onClick={() => scrollBy(-1)}
            aria-label={`Scroll ${title} left`}
          >
            ‹
          </button>
          <button
            type="button"
            className="rail-arrow"
            onClick={() => scrollBy(1)}
            aria-label={`Scroll ${title} right`}
          >
            ›
          </button>
        </div>
      </div>

      {error ? (
        <div className="rail-empty">{error}</div>
      ) : loading ? (
        <div className="poster-row" ref={scrollerRef} aria-hidden="true">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="poster-card skeleton" />
          ))}
        </div>
      ) : count > 0 ? (
        <div className="poster-row" ref={scrollerRef}>
          {children}
        </div>
      ) : (
        <div className="rail-empty">{emptyHint ?? 'Nothing here yet.'}</div>
      )}
    </section>
  );
}
