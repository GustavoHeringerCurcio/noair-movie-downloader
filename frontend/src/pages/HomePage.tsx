import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { HomeSection, MediaItem } from '../types';
import { browse } from '../api';
import { PosterCard } from '../components/PosterCard';

const SECTIONS: HomeSection[] = [
  { section: 'trending-today', title: 'Trending Today' },
  { section: 'trending-week', title: 'Trending This Week' },
  { section: 'now-playing', title: 'Now Playing' },
  { section: 'popular-movies', title: 'Popular Movies' },
  { section: 'top-rated-recent', title: 'Top Rated (Recent)' },
  { section: 'airing-today', title: 'Airing Today' },
  { section: 'on-the-air', title: 'On The Air' },
  { section: 'popular-tv', title: 'Popular TV' },
];

interface SectionState {
  items: MediaItem[];
  loading: boolean;
  error: string | null;
}

function useSections(sections: HomeSection[]): Record<string, SectionState> {
  const [state, setState] = useState<Record<string, SectionState>>(() =>
    Object.fromEntries(sections.map((s) => [s.section, { items: [], loading: true, error: null }])),
  );

  useEffect(() => {
    let cancelled = false;
    setState(Object.fromEntries(sections.map((s) => [s.section, { items: [], loading: true, error: null }])));
    for (const s of sections) {
      browse(s.section)
        .then((res) => {
          if (cancelled) return;
          setState((prev) => ({ ...prev, [s.section]: { items: res.items, loading: false, error: null } }));
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          const message = e instanceof Error ? e.message : 'Failed to load';
          setState((prev) => ({ ...prev, [s.section]: { items: [], loading: false, error: message } }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [sections]);

  return state;
}

function SectionRow({ section, state }: { section: HomeSection; state: SectionState }) {
  const navigate = useNavigate();
  return (
    <section className="home-section">
      <h2 className="home-section-title">{section.title}</h2>
      {state.loading ? (
        <div className="poster-row">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="poster-card skeleton poster-row-card" aria-hidden="true" />
          ))}
        </div>
      ) : state.error ? (
        <div className="home-section-error">Couldn&rsquo;t load &ldquo;{section.title}&rdquo;.</div>
      ) : state.items.length === 0 ? (
        <div className="home-section-error">Nothing here yet.</div>
      ) : (
        <div className="poster-row">
          {state.items.map((item) => (
            <button
              key={`${item.mediaType}-${item.tmdbId}`}
              type="button"
              className="poster-link poster-row-card"
              onClick={() => navigate(`/media/${item.tmdbId}?type=${item.mediaType}`)}
            >
              <PosterCard item={item} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function HomePage() {
  const state = useSections(SECTIONS);
  return (
    <div className="home-page">
      <h1 className="home-heading">Browse</h1>
      {SECTIONS.map((section) => (
        <SectionRow key={section.section} section={section} state={state[section.section]} />
      ))}
    </div>
  );
}
